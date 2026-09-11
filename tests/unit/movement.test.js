import { describe, expect, it } from 'vitest';
import { makePlainMap, makeWorld } from './helpers.js';
import { planRoute, transitionToNewRoute } from '../../src/simulation/systems/movement.js';
import { values } from '../../src/config/index.js';

function riverWorldWithBridge() {
  // 第 30–31 列（x=300~320）一整列水域，第 32–33 行放一座桥（唯一可通行缺口）
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

  it('水域间规划出绕行路径：所有路径点可通行，且经过桥梁', () => {
    const world = riverWorldWithBridge();
    const route = planRoute(world.terrain, 200, 360, [{ x: 400, y: 360 }]);
    // 不穿过任何水域格
    for (const p of route) expect(world.terrain.passableAt(p.x, p.y)).toBe(true);
    // 绕行经过桥所在格子中心附近 (310, 330)
    expect(route.some(p => Math.hypot(p.x - 310, p.y - 330) <= 22)).toBe(true);
    // 保留原目标点
    expect(route[route.length - 1]).toEqual({ x: 400, y: 360 });
  });

  it('无路可达时回退为直线（保留目标点）', () => {
    // 第 80–81 列（x=800~820）一整列水域、无桥梁 → 不可达
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
