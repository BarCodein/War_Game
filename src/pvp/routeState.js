// 行军路线的客户端缓存（§11.15）。
//
// 服务器只发"变化的字段"（route / routeIndex / pendingQueue / forcedMarch），所以这里的关键语义是：
//   **字段缺失 = 保留缓存，不清空**。只有服务器明确发了空数组（例如 hold 之后 route: []）才清空。
//
// 数据形态与战役一致：unit.route 是整条路线（绝对坐标对象数组）、unit.routeIndex 是"已走到第几个点"，
// 渲染层（rendering/battleOverlay.js）按 `route.slice(routeIndex)` 画，因此可以直接复用战役画法。

const toPoints = (points) => (points ?? []).map((point) => (
  Array.isArray(point) ? { x: point[0], y: point[1] } : { x: point.x, y: point.y }
));

const toSegments = (segments) => (segments ?? []).map((segment) => toPoints(segment));

/**
 * 把一条路线 patch 合并到镜像单位上（缺字段不覆盖）。
 * @returns {boolean} 是否真的改了东西（供诊断统计）
 */
export function applyRoutePatch(unit, patch) {
  if (!unit || !patch) return false;
  let changed = false;
  if (Array.isArray(patch.route)) {
    unit.route = toPoints(patch.route);
    changed = true;
  }
  if (Number.isFinite(patch.routeIndex)) {
    unit.routeIndex = patch.routeIndex;
    changed = true;
  }
  if (Array.isArray(patch.pendingQueue)) {
    unit.pendingQueue = toSegments(patch.pendingQueue);
    changed = true;
  }
  if (typeof patch.forcedMarch === 'boolean') {
    unit.forcedMarch = patch.forcedMarch;
    changed = true;
  }
  return changed;
}

/** 首次进入 / 重连：用 ack 里的全量路线覆盖己方单位 */
export function applyRoutesFull(world, routes) {
  if (!world || !Array.isArray(routes)) return 0;
  let applied = 0;
  for (const entry of routes) {
    const unit = world.units.find((item) => item.id === entry.id);
    if (!unit) continue;
    applyRoutePatch(unit, {
      route: entry.route ?? [],
      routeIndex: entry.routeIndex ?? 0,
      pendingQueue: entry.pendingQueue ?? [],
      forcedMarch: entry.forcedMarch === true,
    });
    applied += 1;
  }
  return applied;
}

/** 阵亡单位清空路线缓存（避免"尸体还在画路线"） */
export function clearRoutesOfDead(world) {
  if (!world) return;
  for (const unit of world.units) {
    if (unit.state !== 'dead') continue;
    unit.route = [];
    unit.routeIndex = 0;
    unit.pendingQueue = [];
    unit.forcedMarch = false;
    unit.previewRoute = null;
  }
}

/** 诊断：己方有多少个单位带着路线（e2e 用） */
export function countRoutes(world, faction) {
  if (!world) return 0;
  return world.units.filter((unit) => unit.faction === faction
    && unit.state !== 'dead'
    && (unit.route?.length ?? 0) > (unit.routeIndex ?? 0)).length;
}
