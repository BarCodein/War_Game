import { describe, expect, it } from 'vitest';
import { values } from '../../src/config/index.js';
import { makePlainMap, makeWorld, advance } from './helpers.js';
import {
  attackMoveCommand, enqueueRouteCommand, appendRouteCommand, moveCommand, validateCommand,
} from '../../src/simulation/commands.js';
import { updateSupplyStock } from '../../src/simulation/systems/supplyStock.js';
import { updateMovement } from '../../src/simulation/systems/movement.js';

// 急行军（gdd.md §4）：命令带 forced: true。
// 除了水域之外的地形提速 1.5×；代价是行军补给 -10/s（取代普通行军的 -5/s）与每秒 1.5 点掉血。
const CFG = values.movement.forcedMarch;
const STEP = values.simulation.fixedStep;

function mapWithWater() {
  // 直线路径上有一段水域：x ∈ [400, 500] 的水带（gridCellSize 10 → 格子 40..49）
  const terrainCells = {};
  for (let cx = 40; cx <= 49; cx += 1) {
    for (let cy = 0; cy < 48; cy += 1) terrainCells[`${cx},${cy}`] = values.terrain.codes.water;
  }
  return makePlainMap({ width: 800, height: 480, terrainCells });
}

describe('急行军：命令与校验', () => {
  it('move / attackMove / appendRoute / enqueueRoute 都支持 forced 标志', () => {
    expect(moveCommand([{ x: 1, y: 2 }], { forced: true })).toEqual({
      type: 'move', path: [{ x: 1, y: 2 }], forced: true,
    });
    expect(attackMoveCommand({ x: 1, y: 2 }, { forced: true }).forced).toBe(true);
    expect(appendRouteCommand([{ x: 1, y: 2 }], { forced: true }).forced).toBe(true);
    expect(enqueueRouteCommand({ x: 1, y: 2 }, { forced: true }).forced).toBe(true);
    // 不带选项时是普通行军
    expect(moveCommand([{ x: 1, y: 2 }]).forced).toBe(false);
    expect(validateCommand(moveCommand([{ x: 1, y: 2 }], { forced: true })).forced).toBe(true);
  });

  it('forced 必须是布尔值（防止 AI/脚本传字符串）', () => {
    expect(() => validateCommand({ type: 'move', path: [{ x: 1, y: 2 }], forced: 'yes' }))
      .toThrow(/forced must be a boolean/);
  });

  it('下达/取消急行军会同步单位状态', () => {
    const world = makeWorld(makePlainMap({ width: 800, height: 480 }));
    const unit = world.spawnUnit('blue', 'light', 100, 240);

    world.issueCommands([unit.id], moveCommand([{ x: 600, y: 240 }], { forced: true }));
    expect(unit.forcedMarch).toBe(true);

    world.issueCommands([unit.id], moveCommand([{ x: 600, y: 240 }]));
    expect(unit.forcedMarch).toBe(false);

    world.issueCommands([unit.id], moveCommand([{ x: 600, y: 240 }], { forced: true }));
    world.issueCommands([unit.id], { type: 'hold' });
    expect(unit.forcedMarch).toBe(false);
  });
});

describe('急行军：速度', () => {
  it('陆地提速 1.5×（与地形倍率叠乘）', () => {
    const world = makeWorld(makePlainMap({ width: 800, height: 480 }));
    const normal = world.spawnUnit('blue', 'light', 100, 120);
    const forced = world.spawnUnit('blue', 'light', 100, 360);
    world.issueCommands([normal.id], moveCommand([{ x: 700, y: 120 }]));
    world.issueCommands([forced.id], moveCommand([{ x: 700, y: 360 }], { forced: true }));

    advance(world, 1);
    const normalDistance = normal.x - 100;
    const forcedDistance = forced.x - 100;
    expect(forcedDistance).toBeCloseTo(normalDistance * CFG.speedMultiplier, 3);
  });

  it('水域不给加成（仍按 terrain.moveMultiplier 的水域倍率走）', () => {
    const world = makeWorld(mapWithWater());
    const normal = world.spawnUnit('blue', 'light', 450, 100); // 站在水里
    const forced = world.spawnUnit('blue', 'light', 450, 380);
    world.issueCommands([normal.id], moveCommand([{ x: 450, y: 100 }])); // 原地不动只保留路线
    world.issueCommands([forced.id], moveCommand([{ x: 450, y: 380 }], { forced: true }));

    // 手动摆一条向左穿过水域的路径，直接比较一格 tick 的位移
    for (const unit of [normal, forced]) {
      unit.route = [{ x: 300, y: unit.y }];
      unit.routeIndex = 0;
      unit.state = 'moving';
    }
    const before = { normal: normal.x, forced: forced.x };
    world.tick(STEP);
    const normalStep = before.normal - normal.x;
    const forcedStep = before.forced - forced.x;
    expect(normalStep).toBeGreaterThan(0);
    expect(forcedStep).toBeCloseTo(normalStep, 6); // 水里两个单位一样快
  });
});

describe('急行军：补给与血量代价', () => {
  it('行军补给从 -5/s 换成 -10/s（单独急行军约 8 s 就会耗尽失序）', () => {
    const world = makeWorld(makePlainMap({ width: 800, height: 480 }));
    const normal = world.spawnUnit('blue', 'light', 100, 120);
    const forced = world.spawnUnit('blue', 'light', 100, 360);
    for (const unit of [normal, forced]) {
      unit.route = [{ x: 700, y: unit.y }];
      unit.routeIndex = 0;
      unit.state = 'moving';
      unit.supplyIntake = 0; // 只看消耗：关掉进货
    }
    forced.forcedMarch = true;

    const before = { normal: normal.supplyStock, forced: forced.supplyStock };
    updateSupplyStock(world, 1); // 平地地形系数 1.0 → 差值就是行军消耗之差
    const normalDrop = before.normal - normal.supplyStock;
    const forcedDrop = before.forced - forced.supplyStock;
    expect(forcedDrop - normalDrop).toBeCloseTo(Math.abs(CFG.supplyPerSecond) - Math.abs(values.supplyStock.perSecond.moving), 6);

    // 代价的后果：单独一支急行军（没有补给线进货）存量掉得比普通行军快得多，
    // 中途就会耗尽"失序"原地停下（gdd.md §6）——这就是急行军不能无脑常开的原因。
    const lone = makeWorld(makePlainMap({ width: 800, height: 480 }));
    const runner = lone.spawnUnit('blue', 'light', 100, 240);
    lone.issueCommands([runner.id], moveCommand([{ x: 700, y: 240 }], { forced: true }));
    let everUnordered = false;
    for (let i = 0; i < 60 * 20 && !everUnordered; i += 1) {
      runner.supplyIntake = 0; // 断补：只出不进
      lone.tick(STEP);
      if (runner.state === 'unordered') everUnordered = true;
    }
    expect(everUnordered).toBe(true);
  });

  it('每秒掉 0.5 血并计入伤亡；掉光即力竭阵亡（cause = forcedMarch）', () => {
    const world = makeWorld(makePlainMap({ width: 800, height: 480 }));
    const unit = world.spawnUnit('blue', 'light', 100, 240);
    world.issueCommands([unit.id], moveCommand([{ x: 700, y: 240 }], { forced: true }));

    // 只跑移动系统：排除"补给耗尽 → 失序停下"的干扰（那是另一层代价，上面单独测）
    for (let i = 0; i < 600; i += 1) updateMovement(world, STEP); // 60 px/s × 10 s = 600 px，正好走完
    expect(unit.state).not.toBe('dead');
    expect(unit.maxHp - unit.hp).toBeCloseTo(CFG.hpPerSecond * 10, 1);
    expect(world.casualties.blue).toBeCloseTo(CFG.hpPerSecond * 10, 1);

    // 再下一段急行军命令，把血量压到只够两 tick → 力竭阵亡
    // （走 world.tick 而不是直接调 updateMovement：事件要在 tick 末才写进 history）
    unit.hp = CFG.hpPerSecond * STEP * 2;
    world.issueCommands([unit.id], moveCommand([{ x: 100, y: 240 }], { forced: true }));
    world.tick(STEP);
    world.tick(STEP);
    expect(unit.state).toBe('dead');
    expect(world.history.some(e => e.type === 'unitDied' && e.unitId === unit.id && e.cause === 'forcedMarch')).toBe(true);
  });

  it('普通行军不掉血', () => {
    const world = makeWorld(makePlainMap({ width: 800, height: 480 }));
    const unit = world.spawnUnit('blue', 'light', 100, 240);
    world.issueCommands([unit.id], moveCommand([{ x: 700, y: 240 }]));
    advance(world, 5);
    expect(unit.hp).toBe(unit.maxHp);
    expect(world.casualties.blue).toBe(0);
  });
});

describe('急行军：接敌后继续', () => {
  it('接敌停下交战，敌军清空后仍按急行军继续（状态不丢）', () => {
    const world = makeWorld(makePlainMap({ width: 800, height: 480 }));
    const blue = world.spawnUnit('blue', 'light', 200, 240);
    const red = world.spawnUnit('red', 'light', 320, 240); // 距离 120 → 先行军再接触
    world.issueCommands([blue.id], moveCommand([{ x: 700, y: 240 }], { forced: true }));

    advance(world, 3); // 走到接触范围内开打
    expect(blue.state).toBe('combat');
    expect(blue.forcedMarch).toBe(true);

    red.hp = 0;
    world.killUnit(red, 'combat');
    advance(world, 1); // 敌军清空 → 恢复行军
    expect(blue.state).toBe('moving');
    expect(blue.forcedMarch).toBe(true);
  });
});
