import { describe, expect, it } from 'vitest';
import { advance, makePlainMap, makeWorld } from './helpers.js';
import { values } from '../../src/config/index.js';
import { updateMorale } from '../../src/simulation/systems/morale.js';

function cityMap() {
  return makePlainMap({
    cities: [
      { id: 'c1', x: 100, y: 600, faction: 'blue' },
      { id: 'c2', x: 1100, y: 100, faction: 'red' },
    ],
    spawns: [
      { faction: 'blue', x: 100, y: 600 },
      { faction: 'red', x: 1100, y: 100 },
    ],
  });
}

describe('morale', () => {
  it('附近己方城市：城市修正 +5/s 与恢复 +5/s 叠加', () => {
    const world = makeWorld(cityMap());
    const unit = world.spawnUnit('blue', 'light', 150, 600); // 距城市 50 ≤ 120
    advance(world, 1);
    expect(unit.morale).toBeCloseTo(80 + 5 + 5 + 1); // 城市 + 恢复 + 补给充足
  });

  it('附近友军 +2/s', () => {
    const world = makeWorld(cityMap());
    const a = world.spawnUnit('blue', 'light', 300, 300);
    const b = world.spawnUnit('blue', 'light', 320, 300); // 相距 20 ≤ 60
    advance(world, 1);
    expect(a.morale).toBeCloseTo(80 + 2 + 1); // 友军 + 补给充足（最近城市供给）
    expect(b.morale).toBeCloseTo(80 + 2 + 1);
  });

  it('交战中按 inCombat 消耗士气（无路径时为防守，不乘 attack 系数）', () => {
    const world = makeWorld(cityMap());
    const blue = world.spawnUnit('blue', 'light', 500, 300);
    world.spawnUnit('red', 'light', 520, 300); // 相距 20 ≤ 接触距离 → 交战
    advance(world, 1);
    // 无路径 → mode = 1（防守）；补给 +1 与交战 inCombat 叠加
    expect(blue.morale).toBeCloseTo(
      80 + values.morale.perSecond.inCombat + values.morale.perSecond.supplied,
    );
  });

  it('参战但没被瞄准的单位也掉士气，且比面对面的少（inCombatSupport）', () => {
    const world = makeWorld(cityMap());
    const front = world.spawnUnit('blue', 'light', 500, 300);
    const support = world.spawnUnit('blue', 'light', 580, 300); // 相距 80 > 60 → 都没有友军加成
    for (const unit of [front, support]) {
      unit.state = 'combat'; // 都在交战状态
      unit.underFire = false;
    }
    front.underFire = true;  // 只有前排被敌方瞄准

    updateMorale(world, 1);
    expect(front.morale).toBeCloseTo(
      80 + values.morale.perSecond.supplied + values.morale.perSecond.inCombat, 5,
    );
    expect(support.morale).toBeCloseTo(
      80 + values.morale.perSecond.supplied + values.morale.perSecond.inCombatSupport, 5,
    );
    // "较少"的语义：支援位的惩罚绝对值严格小于面对面的单位
    expect(Math.abs(values.morale.perSecond.inCombatSupport))
      .toBeLessThan(Math.abs(values.morale.perSecond.inCombat));
  });

  it('实战 2v1：两个参战单位都会掉士气，被瞄准的那个掉得更多（回归）', () => {
    // 战场在 (600,300)，离蓝城 (100,600) 的路径代价 600+ px → 因子 0.3 上下，
    // 一座 5 点容量的城喂不满两个单位（新补给规则，gdd.md §7）。
    // 这里只想验证士气修正，所以给蓝方加一座 160 px 外的前哨城，保证两人都满补给：
    // 距离 > 城市士气加成范围 120，所以不会引入 cityNearby 的额外加成。
    const world = makeWorld(makePlainMap({
      cities: [
        { id: 'c1', x: 100, y: 600, faction: 'blue' },
        { id: 'c2', x: 1100, y: 100, faction: 'red' },
        { id: 'c3', x: 760, y: 300, faction: 'blue' },
      ],
      spawns: [
        { faction: 'blue', x: 100, y: 600 },
        { faction: 'red', x: 1100, y: 100 },
      ],
    }));
    world.spawnUnit('red', 'light', 600, 300);
    const a = world.spawnUnit('blue', 'light', 600, 272); // 敌正上方 28（接触范围内）
    const b = world.spawnUnit('blue', 'light', 600, 328); // 敌正下方 28，两者相隔 56 不会互相挤开

    advance(world, 1);
    expect(a.supplied && b.supplied).toBe(true); // 前哨城保证两人满补给（下方断言的 +1 前提）

    expect(a.state).toBe('combat');
    expect(b.state).toBe('combat');
    const targeted = a.underFire ? a : b;
    const other = a.underFire ? b : a;
    expect(targeted.underFire).toBe(true);
    expect(other.underFire).toBe(false);

    // 友军 +2 与补给 +1 两者都有（敌方目标选择可能落在任一侧，所以动态判断）
    expect(targeted.morale).toBeCloseTo(
      80 + 2 + 1 + values.morale.perSecond.inCombat, 4,
    );
    expect(other.morale).toBeCloseTo(
      80 + 2 + 1 + values.morale.perSecond.inCombatSupport, 4,
    );
    expect(other.morale).toBeLessThan(80 + 2 + 1); // 没被瞄准也照样掉了士气
  });

  it('未受攻击时士气耗尽进入失序并恢复', () => {
    const world = makeWorld(cityMap());
    const unit = world.spawnUnit('blue', 'light', 500, 300);
    const enemy = world.spawnUnit('red', 'light', 900, 300); // 距离 400：不在接触范围，故不处于被攻击状态
    unit.morale = 0;
    unit.state = 'unordered';

    advance(world, 1 / 60);

    expect(unit.state).toBe('unordered');
    expect(unit.morale).toBeCloseTo(values.morale.unordered.recoverPerSecond / 60);

    world.killUnit(enemy, 'test');
    advance(world, 2);

    expect(unit.state).toBe('hold');
    expect(unit.morale).toBeGreaterThanOrEqual(values.morale.unordered.stopAt);
  });

  it('附近友军阵亡瞬间 −10', () => {
    const world = makeWorld(cityMap());
    const a = world.spawnUnit('blue', 'light', 300, 300);
    const b = world.spawnUnit('blue', 'light', 320, 300);
    world.killUnit(b, 'combat');
    advance(world, 1 / 60);
    expect(a.morale).toBeCloseTo(80 - 10 + 1 / 60); // −10 阵亡冲击 + 补给 +1/s × 1 tick
  });

  it('阈值效果：削弱 ×0.75 / 动摇 ×0.5 作用于伤害', () => {
    const maxHp = values.units.light.hp;
    // 敌方原地固守（无路径）→ 承受伤害再乘 combat.defend
    const base = values.units.light.damage * values.combat.defend;

    const world = makeWorld(cityMap());
    const blue = world.spawnUnit('blue', 'light', 500, 300);
    const red = world.spawnUnit('red', 'light', 520, 300);
    blue.morale = 50; // 削弱
    advance(world, 1 / 60);
    expect(red.hp).toBeCloseTo(maxHp - base * values.morale.effects.weakened.damageMultiplier);

    const world2 = makeWorld(cityMap());
    const blue2 = world2.spawnUnit('blue', 'light', 500, 300);
    const red2 = world2.spawnUnit('red', 'light', 520, 300);
    blue2.morale = 20; // 动摇
    advance(world2, 1 / 60);
    expect(red2.hp).toBeCloseTo(maxHp - base * values.morale.effects.shaken.damageMultiplier);
  });

  it('士气归零且受攻击时溃逃；无城可退立即投降移除', () => {
    const world = makeWorld(makePlainMap());
    world.cities = world.cities.filter(c => c.faction !== 'red'); // 红方无城可退
    const unit = world.spawnUnit('red', 'light', 600, 100);
    world.spawnUnit('blue', 'light', 620, 100); // 接触 → 本 tick 处于被攻击状态
    unit.morale = 0;
    advance(world, 1 / 60);
    expect(unit.state).toBe('dead');
    expect(world.history.some(e => e.type === 'unitDied' && e.unitId === unit.id && e.cause === 'surrender')).toBe(true);
  });

  it('受攻击而溃逃后向己方城市撤退，士气恢复到 20 停止溃逃', () => {
    const world = makeWorld(cityMap());
    const unit = world.spawnUnit('red', 'light', 800, 150); // 距红城约 304（超出城市修正范围）
    world.spawnUnit('blue', 'light', 820, 150); // 接触 → 触发受攻击溃逃
    unit.morale = 0;
    advance(world, 1 / 60);
    expect(unit.state).toBe('rout');
    const distBefore = Math.hypot(unit.x - 1100, unit.y - 100);
    advance(world, 0.5);
    expect(Math.hypot(unit.x - 1100, unit.y - 100)).toBeLessThan(distBefore); // 向城移动
    advance(world, 5); // 恢复 +8/s → 达到 20
    expect(unit.state).toBe('hold');
    expect(unit.morale).toBeGreaterThanOrEqual(values.morale.rout.stopAt);
  });
});
