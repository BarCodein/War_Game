import { describe, expect, it } from 'vitest';
import { advance, makePlainMap, makeWorld } from './helpers.js';
import { values } from '../../src/config/index.js';

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
