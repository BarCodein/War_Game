import { describe, expect, it } from 'vitest';
import { advance, makePlainMap, makeWorld } from './helpers.js';
import { moveCommand } from '../../src/simulation/commands.js';
import { values } from '../../src/config/index.js';

function combatWorld({ forestForRed = false } = {}) {
  const cells = {};
  if (forestForRed) cells['6,5'] = values.terrain.codes.forest; // (130, 110) 所在格
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
    expect(blue.hp).toBeCloseTo(52);
    expect(red.hp).toBeCloseTo(52);
    expect(blue.state).toBe('combat');
    expect(red.state).toBe('combat');
  });

  it('攻击间隔冷却：1s 内只命中一次，第 2 秒再命中', () => {
    const { world, red } = combatWorld();
    advance(world, 0.5);
    expect(red.hp).toBeCloseTo(52); // 仅首击
    advance(world, 0.5); // 累计 1s
    expect(red.hp).toBeCloseTo(44); // 第二击
  });

  it('伤害受防御者地形修正（森林 ×0.85）', () => {
    const { world, red } = combatWorld({ forestForRed: true });
    advance(world, 1 / 60);
    expect(red.hp).toBeCloseTo(60 - 8 * 0.85);
  });

  it('目标选择：优先当前目标直至死亡，再转最近（接触判定）', () => {
    const map = makePlainMap();
    const world = makeWorld(map);
    const blue = world.spawnUnit('blue', 'light', 100, 100);
    const red1 = world.spawnUnit('red', 'light', 120, 100); // 最近（20，与蓝接触）
    const red2 = world.spawnUnit('red', 'light', 100, 121); // 次近（21，仍接触；与 red1 相距 > 半径和，不被推开）
    red1.hp = 10; // 两击致死（8/击）
    advance(world, 1.1); // red1 于 t=1.0 阵亡
    expect(red1.state).toBe('dead');
    expect(blue.targetId).toBe(red2.id);
    advance(world, 1.0); // 累计 2.1s：blue 于 t=2.0 命中 red2（冷却 1s）
    expect(red2.hp).toBeCloseTo(60 - 8); // 轻型单位 hp 60
  });

  it('交战判定需接触：超出接触距离不触发战斗', () => {
    const map = makePlainMap();
    const world = makeWorld(map);
    const blue = world.spawnUnit('blue', 'light', 100, 100);
    const red = world.spawnUnit('red', 'light', 100, 130); // 距离 30 > 半径和+容忍(22)
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

  it('前进为攻击前进：move 途中接敌停下交战，敌军清空后恢复行军', () => {
    const { world, blue, red } = combatWorld();
    advance(world, 1 / 60);
    expect(blue.state).toBe('combat'); // 双方进入交战
    world.issueCommands([blue.id], moveCommand([{ x: 40, y: 100 }])); // 攻击前进
    advance(world, 0.5);
    expect(blue.state).toBe('combat'); // 敌军仍在射程内：停下交战
    expect(Math.abs(blue.x - 100)).toBeLessThan(5); // 未脱离
    world.killUnit(red, 'combat'); // 敌军清空
    advance(world, 0.5);
    expect(blue.state).toBe('moving'); // 沿预定路线恢复行军
    expect(blue.x).toBeLessThan(85); // 继续前进
  });
});
