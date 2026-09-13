import { describe, expect, it } from 'vitest';
import { makePlainMap, makeWorld } from './helpers.js';
import { planRoute, transitionToNewRoute, updateMovement } from '../../src/simulation/systems/movement.js';
import { values } from '../../src/config/index.js';

function riverWorldWithBridge() {
  // 第 30–31 列（x=300~320）为水域，第 32–33 行放一座桥（水域可通行，桥用于验证桥梁通行）。
  // 10px 网格下，原 20px 的 (15,16) 对应 2×2 块 (30~31, 32~33)，桥仍在 (310, 330)。
  const cells = {};
  for (let cy = 0; cy < 72; cy += 1) {
    cells[`30,${cy}`] = values.terrain.codes.water;
    cells[`31,${cy}`] = values.terrain.codes.water;
  }
  for (const key of ['30,32', '31,32', '30,33', '31,33']) cells[key] = values.terrain.codes.bridge;
  return makeWorld(makePlainMap({ terrainCells: cells }));
}

describe('planRoute（最短路径规划）', () => {
  it('无障碍时保留原路径点', () => {
    const world = makeWorld(makePlainMap());
    const route = planRoute(world.terrain, 100, 100, [{ x: 200, y: 100 }, { x: 300, y: 100 }]);
    expect(route).toEqual([{ x: 200, y: 100 }, { x: 300, y: 100 }]);
  });

  it('水域可以通行，路径不再强制绕行到桥梁', () => {
    const world = riverWorldWithBridge();
    const route = planRoute(world.terrain, 200, 360, [{ x: 400, y: 360 }]);
    expect(world.terrain.passableAt(310, 360)).toBe(true);
    expect(route[route.length - 1]).toEqual({ x: 400, y: 360 });
  });

  it('水域中的单位按水域速度倍率移动', () => {
    const plainWorld = makeWorld(makePlainMap());
    const waterWorld = makeWorld(makePlainMap({
      terrainCells: { '10,11': values.terrain.codes.water }, // 10px 网格下单位 (100,110) 所在格
    }));
    const plainUnit = plainWorld.spawnUnit('blue', 'light', 100, 110);
    const waterUnit = waterWorld.spawnUnit('blue', 'light', 100, 110);
    plainWorld.issueCommands([plainUnit.id], { type: 'move', path: [{ x: 200, y: 110 }] });
    waterWorld.issueCommands([waterUnit.id], { type: 'move', path: [{ x: 200, y: 110 }] });
    plainWorld.tick(1 / 60);
    waterWorld.tick(1 / 60);
    expect(waterUnit.x - 100).toBeCloseTo(
      (plainUnit.x - 100) * values.terrain.moveMultiplier.water,
    );
  });

  it('路径目标始终保留，即使水域没有桥梁', () => {
    // 第 80–81 列（x=800~820）为水域；水域可通行，因此直线路径直达目标
    // （坐标与其它用例不同，避免共用全局 pathCache 的格子键被复用）
    const cells = {};
    for (let cy = 0; cy < 72; cy += 1) {
      cells[`80,${cy}`] = values.terrain.codes.water;
      cells[`81,${cy}`] = values.terrain.codes.water;
    }
    const world = makeWorld(makePlainMap({ terrainCells: cells }));
    const route = planRoute(world.terrain, 600, 360, [{ x: 900, y: 360 }]);
    expect(route).toEqual([{ x: 900, y: 360 }]);
  });

  it('高山地形围起封闭山谷时，谷外单位无法规划路径且被物理阻挡无法进入山谷', () => {
    const cells = {};
    for (let cx = 20; cx <= 30; cx += 1) {
      cells[`${cx},20`] = values.terrain.codes.highMountain;
      cells[`${cx},30`] = values.terrain.codes.highMountain;
    }
    for (let cy = 20; cy <= 30; cy += 1) {
      cells[`20,${cy}`] = values.terrain.codes.highMountain;
      cells[`30,${cy}`] = values.terrain.codes.highMountain;
    }
    const world = makeWorld(makePlainMap({ terrainCells: cells }));
    const route = planRoute(world.terrain, 100, 250, [{ x: 250, y: 250 }]);
    expect(route).toEqual([]);

    const unit = world.spawnUnit('blue', 'light', 100, 250);
    world.issueCommands([unit.id], { type: 'move', path: [{ x: 250, y: 250 }] });
    expect(unit.state).toBe('hold');
    expect(unit.route).toEqual([]);

    // 即使被强行赋予穿山路径，移动系统也必须在撞上高山前将其阻挡停下
    unit.route = [{ x: 250, y: 250 }];
    unit.routeIndex = 0;
    unit.state = 'moving';
    for (let tick = 0; tick < 180; tick += 1) world.tick(1 / 60);

    expect(unit.x).toBeLessThanOrEqual(200);
    expect(unit.state).toBe('hold');
  });

  it('高山地形围起山谷但有缺口时，单位通过缺口绕行进入山谷', () => {
    const cells = {};
    for (let cx = 20; cx <= 30; cx += 1) {
      cells[`${cx},20`] = values.terrain.codes.highMountain;
      cells[`${cx},30`] = values.terrain.codes.highMountain;
    }
    for (let cy = 20; cy <= 30; cy += 1) {
      cells[`20,${cy}`] = values.terrain.codes.highMountain;
      cells[`30,${cy}`] = values.terrain.codes.highMountain;
    }
    delete cells['20,22']; // 在 cy=22 留出缺口
    const world = makeWorld(makePlainMap({ terrainCells: cells }));
    const route = planRoute(world.terrain, 100, 255, [{ x: 255, y: 255 }]);
    expect(route.length).toBeGreaterThan(1);
    expect(route[route.length - 1]).toEqual({ x: 255, y: 255 });
  });
});

describe('移动轨迹衔接', () => {
  it('半径 40px 内命中新轨迹时从覆盖点继续，不返回轨迹起点', () => {
    const world = makeWorld(makePlainMap());
    const unit = world.spawnUnit('blue', 'light', 100, 100);
    unit.route = [{ x: 200, y: 100 }, { x: 300, y: 100 }];
    unit.routeIndex = 0;
    unit.state = 'moving';
    const newRoute = [{ x: 300, y: 180 }, { x: 220, y: 100 }, { x: 400, y: 100 }];
    const result = transitionToNewRoute(unit, newRoute, world);
    expect(result[0]).toEqual({ x: 100, y: 100 });
    expect(result.length).toBeLessThan(newRoute.length + unit.route.length);
    expect(result).not.toContainEqual({ x: 300, y: 180 });
  });

  it('远离新轨迹时生成平滑过渡点而不是直接折返', () => {
    const world = makeWorld(makePlainMap());
    const unit = world.spawnUnit('blue', 'light', 100, 100);
    const result = transitionToNewRoute(unit, [{ x: 400, y: 300 }, { x: 500, y: 300 }], world);
    expect(result.length).toBeGreaterThan(1);
    expect(result[0]).not.toEqual({ x: 400, y: 300 });
    expect(result.at(-1)).toEqual({ x: 500, y: 300 });
  });

  it('水域阻挡时过渡路径使用可通行路径点', () => {
    const world = riverWorldWithBridge();
    const unit = world.spawnUnit('blue', 'light', 200, 360);
    const result = transitionToNewRoute(unit, [{ x: 400, y: 360 }], world);
    expect(result.every(point => world.terrain.passableAt(point.x, point.y))).toBe(true);
  });

  it('使用旧路径与新路径之间的最近线段连接点', () => {
    const world = makeWorld(makePlainMap());
    const unit = world.spawnUnit('blue', 'light', 100, 100);
    unit.route = [{ x: 200, y: 100 }, { x: 300, y: 100 }];
    unit.routeIndex = 0;
    unit.state = 'moving';
    const result = transitionToNewRoute(unit, [{ x: 220, y: 140 }, { x: 320, y: 140 }], world);
    expect(result.some(point => Math.abs(point.x - 220) < 1 && Math.abs(point.y - 100) < 1)).toBe(true);
    expect(result.some(point => Math.abs(point.x - 220) < 1 && Math.abs(point.y - 140) < 1)).toBe(true);
    expect(result.at(-1)).toEqual({ x: 320, y: 140 });
  });
});

describe('多单位移动分离', () => {
  it('相同目标的单位不会因重复碰撞分离而卡在原地', () => {
    const world = makeWorld(makePlainMap());
    const first = world.spawnUnit('blue', 'light', 100, 100);
    const second = world.spawnUnit('blue', 'light', 100, 100);
    world.issueCommands([first.id, second.id], { type: 'move', path: [{ x: 400, y: 100 }] });
    const initialDistance = Math.hypot(second.x - first.x, second.y - first.y);
    for (let tick = 0; tick < 120; tick += 1) world.tick(1 / 60);
    expect(Math.max(first.x, second.x)).toBeGreaterThan(150);
    expect(Math.hypot(second.x - first.x, second.y - first.y)).toBeGreaterThan(initialDistance);
  });

  it('被静态己方单位阻挡后会生成稳定的侧向绕行路线', () => {
    const world = makeWorld(makePlainMap());
    const moving = world.spawnUnit('blue', 'light', 100, 100);
    world.spawnUnit('blue', 'light', 140, 100);
    world.issueCommands([moving.id], { type: 'move', path: [{ x: 400, y: 100 }] });
    moving.stuckTime = values.movement.stuckThresholdSeconds;
    world.tick(0);
    expect(moving.route.some(point => Math.abs(point.y - 100) > 1)).toBe(true);
    for (let tick = 0; tick < 360; tick += 1) world.tick(1 / 60);
    expect(moving.x).toBeGreaterThan(180);
    expect(moving.rerouteAttempts).toBeLessThanOrEqual(values.movement.maxRerouteAttempts);
  });
});

describe('溃退移动速度', () => {
  it('自动溃退速度低于普通移动速度', () => {
    const routWorld = makeWorld(makePlainMap());
    const routUnit = routWorld.spawnUnit('red', 'light', 800, 150);
    routUnit.state = 'rout';
    routUnit.route = [{ x: 1100, y: 100 }];
    routUnit.routeIndex = 0;
    routUnit.pathDirty = false;
    routUnit.pathCheckCell = routWorld.terrain.cellIndex(40, 7);

    const normalWorld = makeWorld(makePlainMap());
    const normalUnit = normalWorld.spawnUnit('red', 'light', 800, 150);
    normalUnit.state = 'moving';
    normalUnit.route = [{ x: 1100, y: 100 }];
    normalUnit.routeIndex = 0;
    normalUnit.pathDirty = false;
    normalUnit.pathCheckCell = normalWorld.terrain.cellIndex(40, 7);

    updateMovement(routWorld, 1 / 60);
    updateMovement(normalWorld, 1 / 60);

    const routDistance = Math.hypot(routUnit.x - 800, routUnit.y - 150);
    const normalDistance = Math.hypot(normalUnit.x - 800, normalUnit.y - 150);
    expect(routDistance).toBeCloseTo(normalDistance * values.movement.routSpeedMultiplier);
    expect(routDistance).toBeLessThan(normalDistance);
  });
});
