import { describe, expect, it } from 'vitest';
import { makePlainMap, makeWorld } from './helpers.js';
import { planRoute } from '../../src/simulation/systems/movement.js';
import { values } from '../../src/config/index.js';

function riverWorldWithBridge() {
  // 第 15 列（x=300~320）一整列水域，第 16 行放一座桥（唯一可通行缺口）
  const cells = {};
  for (let cy = 0; cy < 36; cy += 1) cells[`15,${cy}`] = values.terrain.codes.water;
  cells['15,16'] = values.terrain.codes.bridge; // 桥位于 (310, 330)
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
    // 第 40 列一整列水域、无桥梁 → 不可达
    // （坐标与其它用例不同，避免共用全局 pathCache 的格子键被复用）
    const cells = {};
    for (let cy = 0; cy < 36; cy += 1) cells[`40,${cy}`] = values.terrain.codes.water;
    const world = makeWorld(makePlainMap({ terrainCells: cells }));
    const route = planRoute(world.terrain, 600, 360, [{ x: 900, y: 360 }]);
    expect(route).toEqual([{ x: 900, y: 360 }]);
  });
});
