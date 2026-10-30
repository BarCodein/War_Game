import { describe, expect, it } from 'vitest';
import { World } from '../../src/simulation/world.js';
import { deployForces } from '../../src/simulation/level.js';
import { loadPvpLevel } from '../../server/src/levels.js';
import {
  applyRoutePatch, applyRoutesFull, clearRoutesOfDead, countRoutes,
} from '../../src/pvp/routeState.js';

// §11.15 客户端合并语义：**字段缺失 = 保留缓存**（服务器只发变化字段）。
function makeWorld() {
  const { level, map } = loadPvpLevel('dujiang_pvp');
  const world = new World(map);
  deployForces(world, level.forces, level.anchors ?? {});
  return world;
}

describe('路线缓存合并（客户端）', () => {
  it('缺字段不覆盖：只带 routeIndex 的 patch 不会清掉 route / pendingQueue', () => {
    const world = makeWorld();
    const unit = world.units.find((item) => item.faction === 'blue');
    applyRoutePatch(unit, {
      route: [[10, 10], [20, 20]],
      routeIndex: 0,
      pendingQueue: [[[30, 30]]],
      forcedMarch: true,
    });
    expect(unit.route).toEqual([{ x: 10, y: 10 }, { x: 20, y: 20 }]);
    expect(unit.pendingQueue).toEqual([[{ x: 30, y: 30 }]]);
    expect(unit.forcedMarch).toBe(true);

    applyRoutePatch(unit, { routeIndex: 1 });
    expect(unit.routeIndex).toBe(1);
    expect(unit.route).toHaveLength(2);        // 没被清掉
    expect(unit.pendingQueue).toHaveLength(1);
    expect(unit.forcedMarch).toBe(true);
  });

  it('服务器明确发空数组 → 清空（hold 之后）', () => {
    const world = makeWorld();
    const unit = world.units.find((item) => item.faction === 'blue');
    applyRoutePatch(unit, { route: [[1, 1], [2, 2]], routeIndex: 1 });
    expect(unit.route).toHaveLength(2);
    applyRoutePatch(unit, { route: [] });
    expect(unit.route).toHaveLength(0);
    expect(countRoutes(world, 'blue')).toBe(0);
  });

  it('ack 全量覆盖己方单位', () => {
    const world = makeWorld();
    const ids = world.units.filter((unit) => unit.faction === 'blue').map((unit) => unit.id);
    const applied = applyRoutesFull(world, ids.map((id, index) => ({
      id,
      route: [[index, index], [index + 10, index + 10]],
      routeIndex: 0,
      pendingQueue: [],
      forcedMarch: index === 0,
    })));
    expect(applied).toBe(ids.length);
    expect(countRoutes(world, 'blue')).toBe(ids.length);
    expect(world.units.find((unit) => unit.id === ids[0]).forcedMarch).toBe(true);
  });

  it('阵亡单位清空路线与预览（避免"尸体画路线"）', () => {
    const world = makeWorld();
    const unit = world.units.find((item) => item.faction === 'blue');
    const other = world.units.find((item) => item.faction === 'blue' && item.id !== unit.id);
    applyRoutePatch(unit, { route: [[1, 1], [2, 2]], routeIndex: 0, forcedMarch: true });
    unit.previewRoute = { points: [{ x: 1, y: 1 }], at: 0 };
    unit.state = 'dead';
    clearRoutesOfDead(world);
    expect(unit.route).toEqual([]);
    expect(unit.forcedMarch).toBe(false);
    expect(unit.previewRoute).toBeNull();
    expect(other.route).toEqual([]);   // 其他单位本来就没路线，不受影响
  });

  it('countRoutes 只数"还有剩余路点"的存活己方单位', () => {
    const world = makeWorld();
    const [a, b] = world.units.filter((unit) => unit.faction === 'blue');
    applyRoutePatch(a, { route: [[1, 1], [2, 2]], routeIndex: 0 });
    applyRoutePatch(b, { route: [[1, 1], [2, 2]], routeIndex: 2 });   // 已走完
    expect(countRoutes(world, 'blue')).toBe(1);
    expect(countRoutes(world, 'red')).toBe(0);
  });
});
