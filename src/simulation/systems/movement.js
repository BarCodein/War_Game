import { values } from '../../config/index.js';
import { effectsFor } from './morale.js';

// 移动系统：沿命令路径点行进；直行遇不可通行地形时在逻辑网格上 A* 绕行（路径缓存共享）；
// 软排斥防止单位重叠；交战中冻结；溃逃单位不受指挥，向最近己方城市全速撤退，
// 无路可退或被困超过时限则投降（gdd.md §4、§6）。

// A* 路径缓存：同 tick 跨单位共享；容量上限内保留，超限清空（确定性）。
const pathCache = new Map();
const PATH_CACHE_MAX = 512;

export function updateMovement(world, dt) {
  const previousPositions = new Map();
  for (const unit of world.units) {
    if (unit.state === 'dead') continue;
    if (unit.state === 'rout') {
      routMovement(world, unit, dt);
      continue;
    }
    if (unit.state === 'unordered') continue;
    if (unit.state === 'combat') continue; // 交战中冻结
    if (unit.route.length === 0 || unit.routeIndex >= unit.route.length) {
      activateNextQueuedRoute(world, unit);
      if (unit.route.length === 0 || unit.routeIndex >= unit.route.length) continue;
    }
    previousPositions.set(unit, { x: unit.x, y: unit.y });
    moveAlongRoute(world, unit, dt);
  }
  separateWaterOverlaps(world);
  separateOverlaps(world);
  updateBlockedUnits(world, previousPositions, dt);
}

function updateBlockedUnits(world, previousPositions, dt) {
  for (const [unit, previous] of previousPositions) {
    if (unit.state !== 'moving' || unit.routeIndex >= unit.route.length) {
      unit.stuckTime = 0;
      unit.rerouteAttempts = 0;
      continue;
    }
    const displacement = Math.hypot(unit.x - previous.x, unit.y - previous.y);
    if (displacement >= values.movement.minDisplacement) {
      unit.stuckTime = 0;
      unit.rerouteAttempts = 0;
      continue;
    }
    unit.stuckTime += dt;
    if (unit.stuckTime < values.movement.stuckThresholdSeconds) continue;
    unit.stuckTime = 0;
    if (world.terrain.terrainAt(unit.x, unit.y) === values.terrain.codes.water) {
      // Water speed and low morale can make a tick's displacement small;
      // water is passable, so do not replace the route with a side detour.
      unit.rerouteAttempts = 0;
      continue;
    }
    if (tryRerouteBlockedUnit(world, unit)) continue;
    unit.rerouteAttempts += 1;
    if (unit.rerouteAttempts >= values.movement.maxRerouteAttempts) {
      // Stop only the blocked segment. The queued segments remain available.
      unit.route = [];
      unit.routeIndex = 0;
      unit.state = 'hold';
    }
  }
}

function tryRerouteBlockedUnit(world, unit) {
  const remaining = unit.route.slice(unit.routeIndex);
  if (remaining.length === 0) return false;
  const target = remaining[0];
  const dx = target.x - unit.x;
  const dy = target.y - unit.y;
  const length = Math.hypot(dx, dy);
  if (length < values.movement.minDisplacement) return false;
  const normalX = -dy / length;
  const normalY = dx / length;
  const lane = (unit.id % 5) - 2;
  const baseOffset = Math.min(
    Math.max(1, Math.abs(lane)) * values.movement.formationOffset,
    values.movement.localRerouteRadius,
  );
  const signs = lane === 0 ? [1, -1] : [Math.sign(lane), -Math.sign(lane)];
  for (const sign of signs) {
    const offset = baseOffset * sign;
    const candidate = {
      x: Math.max(0, Math.min(world.size.width, unit.x + normalX * offset)),
      y: Math.max(0, Math.min(world.size.height, unit.y + normalY * offset)),
    };
    if (!world.terrain.passableAt(candidate.x, candidate.y)) continue;
    if (!hasSpaceForUnit(world, unit, candidate)) continue;
    const route = planRoute(world.terrain, unit.x, unit.y, [candidate, ...remaining]);
    if (route.length === 0) continue;
    unit.route = route;
    unit.routeIndex = 0;
    unit.pathDirty = true;
    unit.state = 'moving';
    return true;
  }
  return false;
}

function hasSpaceForUnit(world, unit, point) {
  for (const other of world.units) {
    if (other === unit || other.state === 'dead') continue;
    const required = unit.radius + other.radius + values.movement.unitSeparation;
    if (Math.hypot(other.x - point.x, other.y - point.y) < required) return false;
  }
  return true;
}

export function findNearbyRouteIndex(unit, route) {
  let nearestIndex = null;
  let nearestDistance = Infinity;
  for (let index = 0; index < route.length; index += 1) {
    const distance = Math.hypot(route[index].x - unit.x, route[index].y - unit.y);
    if (distance < nearestDistance) nearestDistance = distance;
    if (distance <= values.transition.checkRadius && nearestIndex === null) nearestIndex = index;
  }
  return { nearbyIndex: nearestIndex, nearestDistance };
}

function closestPointOnSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return { x: start.x, y: start.y, ratio: 0 };
  const ratio = Math.max(0, Math.min(1,
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return { x: start.x + dx * ratio, y: start.y + dy * ratio, ratio };
}

function closestRoutePair(oldRoute, newRoute) {
  let best = null;
  for (let oldIndex = 0; oldIndex < oldRoute.length - 1; oldIndex += 1) {
    const oldStart = oldRoute[oldIndex];
    const oldEnd = oldRoute[oldIndex + 1];
    for (let newIndex = 0; newIndex < newRoute.length - 1; newIndex += 1) {
      const newStart = newRoute[newIndex];
      const newEnd = newRoute[newIndex + 1];
      const oldPoint = closestPointOnSegment(newStart, oldStart, oldEnd);
      const newPoint = closestPointOnSegment(oldPoint, newStart, newEnd);
      const refinedOldPoint = closestPointOnSegment(newPoint, oldStart, oldEnd);
      const distance = Math.hypot(refinedOldPoint.x - newPoint.x, refinedOldPoint.y - newPoint.y);
      if (!best || distance < best.distance) {
        best = {
          oldIndex,
          newIndex,
          oldPoint: refinedOldPoint,
          newPoint,
          distance,
        };
      }
    }
  }
  return best;
}

export function catmullRomSpline(points, numPoints) {
  if (points.length < 2) return [];
  if (points.length === 2) {
    return Array.from({ length: numPoints }, (_, index) => {
      const ratio = (index + 1) / numPoints;
      return {
        x: points[0].x + (points[1].x - points[0].x) * ratio,
        y: points[0].y + (points[1].y - points[0].y) * ratio,
      };
    });
  }
  const result = [];
  const segments = points.length - 1;
  for (let index = 0; index < segments; index += 1) {
    const p0 = points[Math.max(0, index - 1)];
    const p1 = points[index];
    const p2 = points[Math.min(points.length - 1, index + 1)];
    const p3 = points[Math.min(points.length - 1, index + 2)];
    for (let step = 1; step <= numPoints; step += 1) {
      const t = step / numPoints;
      const t2 = t * t;
      const t3 = t2 * t;
      result.push({
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t
          + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2
          + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t
          + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2
          + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  return result;
}

export function transitionToNewRoute(unit, newRoute, world) {
  if (!newRoute?.length) return [];
  const oldTail = unit.route.slice(unit.routeIndex);
  if (oldTail.length === 0) {
    const first = newRoute[0];
    if (segmentBlocked(world.terrain, unit.x, unit.y, first.x, first.y)) {
      const detour = findPath(world.terrain, unit.x, unit.y, first.x, first.y);
      return detour?.length ? simplify([...detour, ...newRoute.slice(1)]) : newRoute;
    }
    const middle = { x: (unit.x + first.x) / 2, y: (unit.y + first.y) / 2 };
    const transition = catmullRomSpline([
      { x: unit.x, y: unit.y }, middle, first,
    ], values.transition.transitionPoints);
    return simplify([...transition, ...newRoute.slice(1)]);
  }

  const oldPolyline = [{ x: unit.x, y: unit.y }, ...oldTail];
  const newPolyline = newRoute.filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (newPolyline.length === 0) return [];
  if (newPolyline.length === 1) return planRoute(world.terrain, unit.x, unit.y, newPolyline);

  const pair = closestRoutePair(oldPolyline, newPolyline);
  if (!pair) return planRoute(world.terrain, unit.x, unit.y, newPolyline);

  const oldPrefix = oldPolyline.slice(0, pair.oldIndex + 1);
  oldPrefix.push(pair.oldPoint);
  const connectionStart = oldPrefix[oldPrefix.length - 1];
  const connectionEnd = pair.newPoint;
  let connection = [];
  if (Math.hypot(connectionStart.x - connectionEnd.x, connectionStart.y - connectionEnd.y)
    >= values.transition.minConnectionDistance) {
    if (segmentBlocked(world.terrain, connectionStart.x, connectionStart.y,
      connectionEnd.x, connectionEnd.y)) {
      connection = findPath(world.terrain, connectionStart.x, connectionStart.y,
        connectionEnd.x, connectionEnd.y) ?? [];
    } else {
      connection = [connectionEnd];
    }
  }

  const newSuffix = [connectionEnd, ...newPolyline.slice(pair.newIndex + 1)];
  return simplify([...oldPrefix, ...connection, ...newSuffix]);
}

function unitStats(unit) {
  return values.units[unit.type];
}

// 向路径点行进；ignoreMoraleEffects 用于溃逃（不受士气削弱）。
function moveAlongRoute(world, unit, dt, ignoreMoraleEffects = false, speedMultiplier = 1) {
  skipImpassableWaypoints(world, unit);
  if (unit.routeIndex >= unit.route.length) return;

  let target = unit.route[unit.routeIndex];
  const distance = Math.hypot(target.x - unit.x, target.y - unit.y);
  const stats = unitStats(unit);
  const terrainMult = world.terrain.moveMultiplierAt(unit.x, unit.y);
  const moraleMult = ignoreMoraleEffects ? 1 : effectsFor(unit.morale).speedMultiplier;
  const travel = stats.speed * terrainMult * moraleMult * speedMultiplier * dt;

  if (distance <= travel) {
    if (!world.terrain.passableAt(target.x, target.y) || segmentBlocked(world.terrain, unit.x, unit.y, target.x, target.y)) {
      unit.route = [];
      unit.routeIndex = 0;
      unit.state = 'hold';
      return;
    }
    unit.x = target.x;
    unit.y = target.y;
    unit.routeIndex += 1;
    if (unit.routeIndex >= unit.route.length) {
      unit.route = [];
      unit.routeIndex = 0;
      activateNextQueuedRoute(world, unit);
    }
    return;
  }

  // 水域是可通行地形，沿已规划目标直线前进；不要套用陆地障碍的
  // 惰性重规划，否则减速跨格时会反复改写目标方向，表现为原地转圈。
  if (world.terrain.terrainAt(unit.x, unit.y) === values.terrain.codes.water) {
    const waterStep = waterSafeStep(world, unit, target, travel);
    unit.x += waterStep.x;
    unit.y += waterStep.y;
    return;
  }

  // 仅在路径变更或进入新格子时检查不可通行地形
  const cellKey = world.terrain.cellIndex(world.terrain.cellAt(unit.x, unit.y).cx, world.terrain.cellAt(unit.x, unit.y).cy);
  if (unit.pathDirty || unit.pathCheckCell !== cellKey) {
    unit.pathDirty = false;
    unit.pathCheckCell = cellKey;
    if (segmentBlocked(world.terrain, unit.x, unit.y, target.x, target.y)) {
      const detour = findPath(world.terrain, unit.x, unit.y, target.x, target.y);
      if (detour && detour.length > 0) {
        unit.route.splice(unit.routeIndex, 0, ...detour);
        target = unit.route[unit.routeIndex];
      } else {
        // 找不到路径则原地保持（不穿行不可通行地形）
        unit.route = [];
        unit.routeIndex = 0;
        unit.state = 'hold';
        return;
      }
    }
  }

  skipImpassableWaypoints(world, unit);
  if (unit.routeIndex >= unit.route.length) return;
  target = unit.route[unit.routeIndex];
  const remaining = Math.hypot(target.x - unit.x, target.y - unit.y);
  const step = Math.min(travel, remaining);
  if (step > 0) {
    const nextX = unit.x + (target.x - unit.x) / remaining * step;
    const nextY = unit.y + (target.y - unit.y) / remaining * step;
    if (!world.terrain.passableAt(nextX, nextY) || segmentBlocked(world.terrain, unit.x, unit.y, nextX, nextY)) {
      unit.route = [];
      unit.routeIndex = 0;
      unit.state = 'hold';
      return;
    }
    unit.x = nextX;
    unit.y = nextY;
  }
}

function waterSafeStep(world, unit, target, travel) {
  const directionX = (target.x - unit.x) / Math.hypot(target.x - unit.x, target.y - unit.y);
  const directionY = (target.y - unit.y) / Math.hypot(target.x - unit.x, target.y - unit.y);
  let allowed = travel;
  for (const other of world.units) {
    if (other === unit || other.state === 'dead') continue;
    const offsetX = other.x - unit.x;
    const offsetY = other.y - unit.y;
    const along = offsetX * directionX + offsetY * directionY;
    if (along <= 0 || along > travel + unit.radius + other.radius) continue;
    const lateral = Math.abs(offsetX * directionY - offsetY * directionX);
    const clearance = waterClearance(unit, other);
    if (lateral >= clearance) continue;
    const forwardLimit = along - Math.sqrt(Math.max(0, clearance * clearance - lateral * lateral));
    allowed = Math.min(allowed, Math.max(0, forwardLimit));
  }
  return { x: directionX * allowed, y: directionY * allowed };
}

function separateWaterOverlaps(world) {
  const waterUnits = world.units.filter(unit => unit.state !== 'dead'
    && world.terrain.terrainAt(unit.x, unit.y) === values.terrain.codes.water);
  for (let pass = 0; pass < 8; pass += 1) {
    let changed = false;
    for (const unit of waterUnits) {
      for (const other of world.units) {
        if (other === unit || other.state === 'dead') continue;
        if (other.id < unit.id && world.terrain.terrainAt(other.x, other.y) === values.terrain.codes.water) continue;
        const dx = unit.x - other.x;
        const dy = unit.y - other.y;
        const distance = Math.hypot(dx, dy);
        const clearance = waterClearance(unit, other);
        if (distance >= clearance) continue;
        const nx = distance > 0.001 ? dx / distance : (unit.id < other.id ? 1 : -1);
        const ny = distance > 0.001 ? dy / distance : 0;
        const push = (clearance - distance) / 2;
        unit.x += nx * push;
        unit.y += ny * push;
        other.x -= nx * push;
        other.y -= ny * push;
        changed = true;
      }
    }
    if (!changed) break;
  }
}

function waterClearance(unit, other) {
  // Keep a visible two-pixel buffer even when older configs use zero separation.
  return unit.radius + other.radius + Math.max(2, values.movement.unitSeparation) + 0.01;
}

function activateNextQueuedRoute(world, unit) {
  while (unit.pendingQueue?.length > 0 && unit.routeIndex >= unit.route.length) {
    const segment = unit.pendingQueue.shift();
    const route = planRoute(world.terrain, unit.x, unit.y, segment);
    if (route.length === 0) continue;
    unit.route = route;
    unit.routeIndex = 0;
    unit.pathDirty = true;
    unit.state = 'moving';
    unit.command = { type: 'move', path: route };
    return;
  }
  if (unit.routeIndex >= unit.route.length) {
    unit.route = [];
    unit.routeIndex = 0;
    unit.state = 'hold';
    if (unit.command?.type !== 'attack') unit.command = null;
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
  moveAlongRoute(world, unit, dt, true, values.movement.routSpeedMultiplier);
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
  const activeUnits = world.units.filter(unit => unit.state !== 'dead');
  const unitIndexes = new Map(activeUnits.map((unit, index) => [unit, index]));
  for (let index = 0; index < activeUnits.length; index += 1) {
    const unit = activeUnits[index];
    if (unit.state === 'dead') continue;
    const neighbors = world.spatial.query(unit.x, unit.y, unit.radius + maxRadius);
    for (const other of neighbors) {
      if (other === unit || other.state === 'dead') continue;
      // Each pair is resolved once. Processing both directions cancels the push
      // and leaves units permanently overlapping.
      const otherIndex = unitIndexes.get(other);
      if (otherIndex <= index) continue;
      const dx = unit.x - other.x;
      const dy = unit.y - other.y;
      const dist = Math.hypot(dx, dy);
      const min = unit.radius + other.radius + values.movement.unitSeparation;
      if (dist >= min) continue;
      if (dist < 0.001) {
        const offset = unit.id < other.id ? 1 : -1;
        if (world.terrain.passableAt(unit.x + offset, unit.y)) unit.x += offset;
        if (world.terrain.passableAt(other.x - offset, other.y)) other.x -= offset;
        continue;
      }
      const push = min - dist;
      const nx = dx / dist;
      const ny = dy / dist;
      const newUnitX = unit.x + nx * push / 2;
      const newUnitY = unit.y + ny * push / 2;
      if (world.terrain.passableAt(newUnitX, newUnitY)) {
        unit.x = newUnitX;
        unit.y = newUnitY;
      }
      const newOtherX = other.x - nx * push / 2;
      const newOtherY = other.y - ny * push / 2;
      if (world.terrain.passableAt(newOtherX, newOtherY)) {
        other.x = newOtherX;
        other.y = newOtherY;
      }
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

// A*（4 方向）：代价 = 1/移动倍率（森林和水域更贵）；终点不可通行时
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
    if (!values.terrain.passable[name]) return null;
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
    if (last && Math.hypot(point.x - last.x, point.y - last.y) <= values.transition.mergeTolerance) continue;
    if (before && last && (last.x - before.x) * (point.y - before.y) === (last.y - before.y) * (point.x - before.x)) {
      simplified.pop();
    }
    simplified.push(point);
  }
  return simplified;
}

// 下达命令时整条规划最短路径：对每个途经点逐段用 A* 绕开水域，返回去掉共线点的路径点。
// move 与 attackMove 共用（attack-forward 攻击前进，见 gdd.md §4）——
// 调用方在 applyCommand 时规划，使轨迹显示的是真实的绕行路径。
export function planRoute(terrain, startX, startY, waypoints) {
  const points = [];
  let cx = startX;
  let cy = startY;
  for (const wp of waypoints) {
    if (segmentBlocked(terrain, cx, cy, wp.x, wp.y)) {
      const detour = findPath(terrain, cx, cy, wp.x, wp.y);
      if (detour && detour.length) {
        points.push(...detour);
        cx = detour[detour.length - 1].x;
        cy = detour[detour.length - 1].y;
      }
      // 无路可达时不可穿透不可通行地形，放弃该无法到达的路径点
    } else {
      if (terrain.passableAt(wp.x, wp.y)) {
        points.push({ x: wp.x, y: wp.y });
        cx = wp.x;
        cy = wp.y;
      }
    }
  }
  return simplify(points);
}
