import { values } from '../../config/index.js';
import { effectsFor } from './morale.js';

// 移动系统：沿命令路径点行进；直行遇水域时在逻辑网格上 A* 绕行（路径缓存共享）；
// 软排斥防止单位重叠；交战中冻结；溃逃单位不受指挥，向最近己方城市全速撤退，
// 无路可退或被困超过时限则投降（gdd.md §4、§6）。

// A* 路径缓存：同 tick 跨单位共享；容量上限内保留，超限清空（确定性）。
const pathCache = new Map();
const PATH_CACHE_MAX = 512;

export function updateMovement(world, dt) {
  for (const unit of world.units) {
    if (unit.state === 'dead') continue;
    if (unit.state === 'rout') {
      routMovement(world, unit, dt);
      continue;
    }
    if (unit.state === 'combat') continue; // 交战中冻结
    if (unit.route.length === 0 || unit.routeIndex >= unit.route.length) continue;
    moveAlongRoute(world, unit, dt);
  }
  separateOverlaps(world);
}

function unitStats(unit) {
  return values.units[unit.type];
}

// 向路径点行进；ignoreMoraleEffects 用于溃逃（全速，不受士气削弱）。
function moveAlongRoute(world, unit, dt, ignoreMoraleEffects = false) {
  skipImpassableWaypoints(world, unit);
  if (unit.routeIndex >= unit.route.length) return;

  let target = unit.route[unit.routeIndex];
  const distance = Math.hypot(target.x - unit.x, target.y - unit.y);
  const stats = unitStats(unit);
  const terrainMult = world.terrain.moveMultiplierAt(unit.x, unit.y);
  const moraleMult = ignoreMoraleEffects ? 1 : effectsFor(unit.morale).speedMultiplier;
  const travel = stats.speed * terrainMult * moraleMult * dt;

  if (distance <= travel) {
    unit.x = target.x;
    unit.y = target.y;
    unit.routeIndex += 1;
    if (unit.routeIndex >= unit.route.length) {
      unit.route = [];
      unit.routeIndex = 0;
      unit.state = 'hold';
      unit.command = null;
    }
    return;
  }

  // 直行遇水域时 A* 绕行；仅在路径变更或进入新格子时检查
  const cellKey = world.terrain.cellIndex(world.terrain.cellAt(unit.x, unit.y).cx, world.terrain.cellAt(unit.x, unit.y).cy);
  if (unit.pathDirty || unit.pathCheckCell !== cellKey) {
    unit.pathDirty = false;
    unit.pathCheckCell = cellKey;
    if (segmentBlocked(world.terrain, unit.x, unit.y, target.x, target.y)) {
      const detour = findPath(world.terrain, unit.x, unit.y, target.x, target.y);
      if (detour) unit.route.splice(unit.routeIndex, 0, ...detour);
      // 找不到路径则原地保持（不改状态）
    }
  }

  skipImpassableWaypoints(world, unit);
  if (unit.routeIndex >= unit.route.length) return;
  target = unit.route[unit.routeIndex];
  const remaining = Math.hypot(target.x - unit.x, target.y - unit.y);
  const step = Math.min(travel, remaining);
  if (step > 0) {
    unit.x += (target.x - unit.x) / remaining * step;
    unit.y += (target.y - unit.y) / remaining * step;
  }
}

function routMovement(world, unit, dt) {
  const city = world.nearestOwnCity(unit);
  if (!city) {
    world.killUnit(unit, 'surrender');
    return;
  }
  // 目标 = 最近己方城市；遇水域 A* 绕行（每进入新格子检查一次）
  const cellKey = world.terrain.cellIndex(world.terrain.cellAt(unit.x, unit.y).cx, world.terrain.cellAt(unit.x, unit.y).cy);
  if (unit.pathDirty || unit.pathCheckCell !== cellKey) {
    unit.pathDirty = false;
    unit.pathCheckCell = cellKey;
    const path = findPath(world.terrain, unit.x, unit.y, city.x, city.y);
    if (!path) {
      world.killUnit(unit, 'surrender');
      return;
    }
    unit.route = path;
    unit.routeIndex = 0;
  }
  const beforeX = unit.x;
  const beforeY = unit.y;
  moveAlongRoute(world, unit, dt, true);
  // 被困判定：位移极小则累计，超过时限投降（gdd.md §6）
  if (Math.hypot(unit.x - beforeX, unit.y - beforeY) < 0.5) unit.stuckTime += dt;
  else unit.stuckTime = 0;
  if (unit.stuckTime >= values.morale.rout.stuckSeconds) world.killUnit(unit, 'surrender');
}

// 跳过不可通行的路径点（如目标点在水中）
function skipImpassableWaypoints(world, unit) {
  while (unit.routeIndex < unit.route.length) {
    const waypoint = unit.route[unit.routeIndex];
    if (world.terrain.passableAt(waypoint.x, waypoint.y)) break;
    unit.routeIndex += 1;
  }
}

// 软排斥：重叠单位相互推开一半（单趟处理，确定性）
function separateOverlaps(world) {
  const maxRadius = values.units.heavy.radius;
  for (const unit of world.units) {
    if (unit.state === 'dead') continue;
    const neighbors = world.spatial.query(unit.x, unit.y, unit.radius + maxRadius);
    for (const other of neighbors) {
      if (other === unit || other.state === 'dead') continue;
      const dx = unit.x - other.x;
      const dy = unit.y - other.y;
      const dist = Math.hypot(dx, dy);
      const min = unit.radius + other.radius;
      if (dist >= min) continue;
      if (dist < 0.001) {
        unit.x += 1; // 完全重叠时给确定性的最小分离
        continue;
      }
      const push = (min - dist) / 2;
      unit.x += dx / dist * push;
      unit.y += dy / dist * push;
      other.x -= dx / dist * push;
      other.y -= dy / dist * push;
    }
  }
}

// 直线段是否穿过水域（按格子中心采样）
function segmentBlocked(terrain, x0, y0, x1, y1) {
  const dist = Math.hypot(x1 - x0, y1 - y0);
  const step = terrain.cellSize / 2;
  const samples = Math.floor(dist / step);
  for (let i = 1; i <= samples; i += 1) {
    const t = i / (samples + 1);
    if (!terrain.passableAt(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return true;
  }
  return false;
}

// A*（4 方向）：代价 = 1/移动倍率（森林更贵），水域不可通行；终点不可通行时
// 就近取可通行格。返回路径点（不含起点），按格中心坐标。
export function findPath(terrain, x0, y0, x1, y1) {
  const start = terrain.cellAt(x0, y0);
  const end = terrain.cellAt(x1, y1);
  if (start.cx === end.cx && start.cy === end.cy) return [];
  const cacheKey = `${start.cx},${start.cy}>${end.cx},${end.cy}`;
  const cached = pathCache.get(cacheKey);
  if (cached) return cached;

  const endCell = resolveEndCell(terrain, end);
  if (!endCell) return null;

  const index = (cx, cy) => cy * terrain.cols + cx;
  const startIndex = index(start.cx, start.cy);
  const endIndex = index(endCell.cx, endCell.cy);
  const nameByCode = {};
  for (const [name, code] of Object.entries(values.terrain.codes)) nameByCode[code] = name;

  const costOf = (cx, cy) => {
    const name = nameByCode[terrain.cells[index(cx, cy)]];
    if (name === 'water') return null;
    return 1 / (values.terrain.moveMultiplier[name] ?? 1);
  };

  const gScore = new Map([[startIndex, 0]]);
  const cameFrom = new Map();
  const open = [{ index: startIndex, f: heuristic(start, endCell) }];
  const visited = new Set();
  const MAX_ITERATIONS = 10000;

  while (open.length > 0) {
    let best = 0;
    for (let i = 1; i < open.length; i += 1) if (open[i].f < open[best].f) best = i;
    const current = open.splice(best, 1)[0];
    if (visited.has(current.index)) continue;
    visited.add(current.index);
    if (visited.size > MAX_ITERATIONS) return null;
    if (current.index === endIndex) {
      const path = reconstruct(cameFrom, endIndex);
      if (pathCache.size >= PATH_CACHE_MAX) pathCache.clear();
      pathCache.set(cacheKey, path);
      return path;
    }
    const cx = current.index % terrain.cols;
    const cy = Math.floor(current.index / terrain.cols);
    for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
      if (nx < 0 || ny < 0 || nx >= terrain.cols || ny >= terrain.rows) continue;
      const stepCost = costOf(nx, ny);
      if (stepCost === null) continue;
      const neighbor = index(nx, ny);
      if (visited.has(neighbor)) continue;
      const tentative = gScore.get(current.index) + stepCost;
      if (tentative < (gScore.get(neighbor) ?? Infinity)) {
        gScore.set(neighbor, tentative);
        cameFrom.set(neighbor, current.index);
        open.push({ index: neighbor, f: tentative + heuristic({ cx: nx, cy: ny }, endCell) });
      }
    }
  }
  return null;

  function reconstruct(map, current) {
    const cells = [];
    while (current !== startIndex) {
      cells.push({ cx: current % terrain.cols, cy: Math.floor(current / terrain.cols) });
      current = map.get(current);
    }
    cells.reverse();
    return simplify(cells.map(c => ({
      x: c.cx * terrain.cellSize + terrain.cellSize / 2,
      y: c.cy * terrain.cellSize + terrain.cellSize / 2,
    })));
  }

  function heuristic(a, b) {
    // 曼哈顿距离 × 最小代价 1（可采纳）
    return (Math.abs(a.cx - b.cx) + Math.abs(a.cy - b.cy));
  }
}

// 终点不可通行时，就近（环形扩展）取可通行格
function resolveEndCell(terrain, end) {
  if (terrain.passableAt(end.cx * terrain.cellSize + terrain.cellSize / 2, end.cy * terrain.cellSize + terrain.cellSize / 2)) return end;
  for (let ring = 1; ring <= 10; ring += 1) {
    for (let dy = -ring; dy <= ring; dy += 1) {
      for (let dx = -ring; dx <= ring; dx += 1) {
        if (Math.abs(dx) !== ring && Math.abs(dy) !== ring) continue;
        const cx = end.cx + dx;
        const cy = end.cy + dy;
        if (cx < 0 || cy < 0 || cx >= terrain.cols || cy >= terrain.rows) continue;
        const x = cx * terrain.cellSize + terrain.cellSize / 2;
        const y = cy * terrain.cellSize + terrain.cellSize / 2;
        if (terrain.passableAt(x, y)) return { cx, cy };
      }
    }
  }
  return null;
}

// 去掉共线路径点
function simplify(points) {
  const simplified = [];
  for (const point of points) {
    const last = simplified[simplified.length - 1];
    const before = simplified[simplified.length - 2];
    if (before && last && (last.x - before.x) * (point.y - before.y) === (last.y - before.y) * (point.x - before.x)) {
      simplified.pop();
    }
    simplified.push(point);
  }
  return simplified;
}
