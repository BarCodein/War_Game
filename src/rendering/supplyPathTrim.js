// 补给线折线的"贴到单位身上"工具（纯函数，便于单元测试）。
//
// 背景（PvP 实测 bug，2026-10-30）：`createSupplyLines` 按 `${unitId}|${cityId}` 缓存 A* 结果，
// 缓存里存的是"从**当时**的单位位置算出来的折线"。单位继续移动后，画线仍是
// `[单位当前位置, 折线起点（旧位置）, …]` —— 视觉上就是线"先折回上一个途径点"。
// 修法：画出前把折线头部裁到"离单位最近的点"，并且单位偏离缓存起点过多时重算（见 supplyLines.js）。

/**
 * 把折线"贴到"单位身上：找到单位到折线的最近点（**按线段投影**，不是只看顶点），
 * 返回 `[投影点, …剩余折线]`。这样画出来的线是「单位 → 投影点（几乎垂直的短跳）→ 剩余路线」，
 * 不会再出现「先折回上一个途径点」。
 * @param {{x:number,y:number}[]} path
 * @param {{x:number,y:number}} unit
 * @returns {{x:number,y:number}[]} 新数组（不修改入参）
 */
export function trimToUnit(path, unit) {
  if (!Array.isArray(path) || path.length < 2) return path ?? [];
  let best = { d2: Infinity, index: 0, x: path[0].x, y: path[0].y };
  for (let i = 0; i < path.length - 1; i += 1) {
    const a = path[i];
    const b = path[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    let t = lengthSq > 0 ? ((unit.x - a.x) * dx + (unit.y - a.y) * dy) / lengthSq : 0;
    t = Math.max(0, Math.min(1, t));
    const px = a.x + dx * t;
    const py = a.y + dy * t;
    const d2 = (unit.x - px) ** 2 + (unit.y - py) ** 2;
    if (d2 < best.d2) best = { d2, index: i, x: px, y: py };
  }
  const rest = path.slice(best.index + 1);
  // 投影点几乎落在下一个顶点上时去掉重复点
  if (rest.length && Math.hypot(rest[0].x - best.x, rest[0].y - best.y) < 0.5) rest.shift();
  return [{ x: best.x, y: best.y }, ...rest];
}

/** 折线（按线段算）到单位当前位置的最短距离 */
export function offsetPx(path, unit) {
  if (!Array.isArray(path) || path.length === 0) return 0;
  if (path.length === 1) return Math.hypot(path[0].x - unit.x, path[0].y - unit.y);
  let best = Infinity;
  for (let i = 0; i < path.length - 1; i += 1) {
    const a = path[i];
    const b = path[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    let t = lengthSq > 0 ? ((unit.x - a.x) * dx + (unit.y - a.y) * dy) / lengthSq : 0;
    t = Math.max(0, Math.min(1, t));
    const distance = Math.hypot(unit.x - (a.x + dx * t), unit.y - (a.y + dy * t));
    if (distance < best) best = distance;
  }
  return best;
}

/**
 * 首段是否"往回走"：把「单位 → path[0]」投影到「path[0] → path[1]」方向上，
 * 投影为负说明画线会先折回，返回折回的像素数（0 = 没有折回）。
 */
export function backtrackPx(path, unit) {
  if (!Array.isArray(path) || path.length < 2) return 0;
  let i = 1;
  while (i < path.length && path[i].x === path[0].x && path[i].y === path[0].y) i += 1;
  if (i >= path.length) return 0;
  const v1x = path[0].x - unit.x;
  const v1y = path[0].y - unit.y;
  const v2x = path[i].x - path[0].x;
  const v2y = path[i].y - path[0].y;
  const length = Math.hypot(v2x, v2y);
  if (length === 0) return 0;
  const projection = (v1x * v2x + v1y * v2y) / length;
  return projection < 0 ? -projection : 0;
}
