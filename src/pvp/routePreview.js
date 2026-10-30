import { planRoute } from '../simulation/systems/movement.js';

// U3：下令后的"预计路线"（仅渲染，不参与结算）。
//
// 为什么可以本地规划：服务器的 `applyCommand` 也是调 `planRoute(terrain, unit.x, unit.y, waypoints)`
// （起点永远是单位自己的位置，地形静态），所以同一份地图 + 同一套 A*，本地算出来的路线与服务器一致；
// 万一服务器因受阻重算，单位会偏离预览 —— 这里用"偏离阈值 + TTL"丢弃预览，避免画出假路线。
export const PREVIEW_TTL_MS = 5000;
export const PREVIEW_DEVIATION_PX = 48;

/**
 * 为一条命令生成预计路线（只对 move / appendRoute / attackMove / enqueueRoute 有意义）
 * @returns {{points: {x:number,y:number}[], at: number} | null}
 */
export function previewForCommand(unit, command, world, nowMs = performance.now()) {
  if (!unit || !command || !world?.terrain) return null;
  if (command.type === 'move' || command.type === 'appendRoute') {
    if (!Array.isArray(command.path) || command.path.length === 0) return null;
    const points = planRoute(world.terrain, unit.x, unit.y, command.path);
    return points?.length ? { points, at: nowMs } : null;
  }
  if (command.type === 'attackMove' || command.type === 'enqueueRoute') {
    if (!command.target) return null;
    const points = planRoute(world.terrain, unit.x, unit.y, [{ x: command.target.x, y: command.target.y }]);
    return points?.length ? { points, at: nowMs } : null;
  }
  return null;
}

/** 点到折线的最短距离（线段距离，不是顶点距离） */
export function distanceToPath(points, x, y) {
  if (!Array.isArray(points) || points.length === 0) return Infinity;
  if (points.length === 1) return Math.hypot(points[0].x - x, points[0].y - y);
  let best = Infinity;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    let t = lengthSq > 0 ? ((x - a.x) * dx + (y - a.y) * dy) / lengthSq : 0;
    t = Math.max(0, Math.min(1, t));
    const distance = Math.hypot(x - (a.x + dx * t), y - (a.y + dy * t));
    if (distance < best) best = distance;
  }
  return best;
}

/**
 * 每帧整理预览：超时、或单位已明显偏离预计路线（说明服务器改了道/被挡住）→ 丢弃。
 * @returns {number} 本帧仍有效的预览条数
 */
export function prunePreviews(world, nowMs, { ttlMs = PREVIEW_TTL_MS, deviationPx = PREVIEW_DEVIATION_PX } = {}) {
  let alive = 0;
  for (const unit of world.units) {
    const preview = unit.previewRoute;
    if (!preview) continue;
    const expired = nowMs - preview.at > ttlMs;
    const deviated = unit.state === 'dead' || distanceToPath(preview.points, unit.x, unit.y) > deviationPx;
    if (expired || deviated) {
      unit.previewRoute = null;
      continue;
    }
    alive += 1;
  }
  return alive;
}
