import { describe, expect, it } from 'vitest';
import { advance, makePlainMap, makeWorld } from './helpers.js';
import { moveCommand } from '../../src/simulation/commands.js';
import { values } from '../../src/config/index.js';

function combatWorld({ forestForRed = false } = {}) {
  const cells = {};
  // (120~140, 100~120) 一带设为森林：10px 网格下的 2×2 块，对应原 20px 的 (6,5)
  if (forestForRed) {
    for (const key of ['12,10', '13,10', '12,11', '13,11']) cells[key] = values.terrain.codes.forest;
  }
  const map = makePlainMap({ terrainCells: cells });
  const world = makeWorld(map);
  const blue = world.spawnUnit('blue', 'light', 100, 100);
  const red = world.spawnUnit('red', 'light', 120, 100);
  return { world, blue, red };
}

describe('combat', () => {
  it('敌对单位进入交战距离自动攻击，首击即时且双方互伤', () => {
    const { world, blue, red } = combatWorld();
    advance(world, 1 / 60);
    const expectedHp = 60 - values.units.light.damage * values.combat.defend;
    expect(blue.hp).toBeCloseTo(expectedHp);
    expect(red.hp).toBeCloseTo(expectedHp);
    expect(blue.state).toBe('combat');
    expect(red.state).toBe('combat');
  });

  it('攻击间隔冷却：1s 内只命中一次，第 2 秒再命中', () => {
    const { world, red } = combatWorld();
    advance(world, 0.5);
    const afterHalfSecond = red.hp;
    expect(afterHalfSecond).toBeLessThan(red.maxHp);
    advance(world, 0.5); // 累计 1s
    expect(red.hp).toBeLessThan(afterHalfSecond);
  });

  it('伤害受防御者地形修正（森林 ×0.85）', () => {
    const { world, red } = combatWorld({ forestForRed: true });
    advance(world, 1 / 60);
    expect(red.hp).toBeCloseTo(60 - values.units.light.damage * 0.85 * values.combat.defend);
  });

  it('目标选择：优先当前目标直至死亡，再转最近（接触判定）', () => {
    const map = makePlainMap();
    const world = makeWorld(map);
    const blue = world.spawnUnit('blue', 'light', 100, 100);
    const red1 = world.spawnUnit('red', 'light', 120, 100); // 最近（20，与蓝接触）
    const red2 = world.spawnUnit('red', 'light', 100, 121); // 次近（21，仍接触；与 red1 相距 > 半径和，不被推开）
    blue.targetId = red1.id;
    world.killUnit(red1, 'test'); // 当前目标结束后应切换到另一个接触目标
    expect(red1.state).toBe('dead');
    advance(world, 1 / 60);
    expect(blue.targetId).toBe(red2.id);
    advance(world, 1.0);
    expect(red2.hp).toBeLessThan(red2.maxHp);
  });

  it('交战判定需接触：超出接触距离不触发战斗', () => {
    const map = makePlainMap();
    const world = makeWorld(map);
    const blue = world.spawnUnit('blue', 'light', 100, 100);
    const red = world.spawnUnit('red', 'light', 100, 131); // 距离 31 > 半径和+容忍(30)
    advance(world, 1);
    expect(blue.state).not.toBe('combat');
    expect(red.state).not.toBe('combat');
    expect(blue.hp).toBe(60);
    expect(red.hp).toBe(60);
  });

  it('阵亡单位不再攻击，且产生 unitDied 事件', () => {
    const { world, blue, red } = combatWorld();
    world.killUnit(red, 'combat');
    const blueHp = blue.hp;
    advance(world, 1 / 60);
    expect(blue.hp).toBe(blueHp); // 无反击
    expect(world.history.some(e => e.type === 'unitDied' && e.unitId === red.id)).toBe(true);
  });

  it('move 指令可使单位脱离战斗并继续行军', () => {
    const { world, blue, red } = combatWorld();
    advance(world, 1 / 60);
    expect(blue.state).toBe('combat'); // 双方进入交战
    expect(Math.hypot(red.x - blue.x, red.y - blue.y))
      .toBeLessThanOrEqual(blue.radius + red.radius + values.combat.contactTolerance); // 处于接触范围内

    // 主动后撤：下达 move 命令后单位不再被自动交战锁定，可脱离接触
    world.issueCommands([blue.id], moveCommand([{ x: 40, y: 100 }]));
    expect(blue.state).toBe('moving');
    advance(world, 0.5);
    expect(blue.state).toBe('moving'); // 已脱离交战，未被重新锁定为 combat
    expect(blue.x).toBeLessThan(85);   // 确实离开了接触位置（实测约 74）

    // 敌军清空后继续沿预定路线前进
    world.killUnit(red, 'combat');
    advance(world, 0.5);
    expect(blue.state).toBe('moving');
    expect(blue.x).toBeLessThan(65);   // 实测约 54
  });
});
