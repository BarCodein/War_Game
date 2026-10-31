import { describe, expect, it } from 'vitest';
import { buildFormationOrders, routeAnchorOf } from '../../src/input/orders.js';
import { World } from '../../src/simulation/world.js';
import { deployForces } from '../../src/simulation/level.js';
import { loadPvpLevel } from '../../server/src/levels.js';

// U1 验收：多选拖一条轨迹 → "每个单位一条绝对路径"（保持队形），而不是所有单位共用一个绝对路径。
function makeWorld(levelId = 'dujiang_pvp') {
  const { level, map } = loadPvpLevel(levelId);
  const world = new World(map);
  deployForces(world, level.forces, level.anchors ?? {});
  return world;
}

const line = (points) => points.map(([x, y]) => ({ x, y }));

describe('buildFormationOrders：多选拖轨迹 → 每单位一条命令', () => {
  it('每个存活单位各得一条 move，路径 = 自身位置 + 轨迹相对位移（队形不塌）', () => {
    const world = makeWorld();
    const units = world.units.filter((unit) => unit.faction === 'blue').slice(0, 3);
    const drawn = line([[units[0].x, units[0].y], [units[0].x + 100, units[0].y], [units[0].x + 100, units[0].y + 60]]);

    const orders = buildFormationOrders(units.map((unit) => unit.id), drawn, { world });
    expect(orders).toHaveLength(3);
    for (const order of orders) {
      expect(order.unitIds).toHaveLength(1);
      expect(order.command.type).toBe('move');
      expect(order.command.path).toHaveLength(3);
    }
    // 第一条的起点 = 该单位自身位置
    const first = units.find((unit) => unit.id === orders[0].unitIds[0]);
    // 浮点累加有 1e-14 级误差，逐轴近似
    expect(orders[0].command.path[0].x).toBeCloseTo(first.x, 6);
    expect(orders[0].command.path[0].y).toBeCloseTo(first.y, 6);
    // 每个单位的路径都是"自己的位置 + 同一组相对位移" → 彼此保持原来的相对位置
    orders.forEach((order, index) => {
      const unit = units[index];
      // 浮点累加有 1e-14 级误差，逐轴近似比较
      expect(order.command.path[2].x).toBeCloseTo(unit.x + 100, 6);
      expect(order.command.path[2].y).toBeCloseTo(unit.y + 60, 6);
    });
    // 相对位移彼此一致（队形不塌的关键）
    const deltas = orders.map((order) => {
      const unit = units.find((item) => item.id === order.unitIds[0]);
      return {
        x: order.command.path[2].x - unit.x,
        y: order.command.path[2].y - unit.y,
      };
    });
    // 相对位移彼此一致（队形不塌）：浮点逐轴近似比较
    for (const delta of deltas) {
      expect(delta.x).toBeCloseTo(deltas[0].x, 6);
      expect(delta.y).toBeCloseTo(deltas[0].y, 6);
    }
  });

  it('E 急行军 → forced:true；Shift 拖拽 → appendRoute（锚点接在路线尾）', () => {
    const world = makeWorld();
    const unit = world.units.find((item) => item.faction === 'blue');
    const drawn = line([[unit.x, unit.y], [unit.x + 80, unit.y]]);

    const [forced] = buildFormationOrders([unit.id], drawn, { world, forced: true });
    expect(forced.command.forced).toBe(true);

    // 追加：单位已有路线时，锚点 = 路线末端
    unit.route = line([[unit.x + 10, unit.y + 10], [unit.x + 40, unit.y + 40]]);
    unit.routeIndex = 0;
    const [appended] = buildFormationOrders([unit.id], drawn, { world, append: true });
    expect(appended.command.type).toBe('appendRoute');
    expect(appended.command.path[0]).toEqual({ x: unit.x + 40, y: unit.y + 40 });  // anchor
    expect(appended.command.path).toHaveLength(2);
  });

  it('跳过阵亡/溃逃单位；轨迹不足 2 点 → 空批次', () => {
    const world = makeWorld();
    const units = world.units.filter((unit) => unit.faction === 'blue').slice(0, 2);
    units[0].state = 'dead';
    units[1].state = 'rout';
    const drawn = line([[100, 100], [140, 100]]);
    expect(buildFormationOrders(units.map((unit) => unit.id), drawn, { world })).toHaveLength(0);
    expect(buildFormationOrders([], drawn, { world })).toHaveLength(0);
    expect(buildFormationOrders([units[0].id], line([[100, 100]]), { world })).toHaveLength(0);
  });

  it('routeAnchorOf：pendingQueue 尾 > route 尾 > 自身坐标', () => {
    const unit = { x: 7, y: 9, route: [], routeIndex: 0, pendingQueue: [] };
    expect(routeAnchorOf(unit)).toEqual({ x: 7, y: 9 });
    unit.route = line([[1, 1], [2, 2]]);
    expect(routeAnchorOf(unit)).toEqual({ x: 2, y: 2 });
    unit.pendingQueue = [line([[5, 5], [6, 6]])];
    expect(routeAnchorOf(unit)).toEqual({ x: 6, y: 6 });
  });
});
