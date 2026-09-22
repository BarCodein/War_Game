import { values } from '../../config/index.js';
import { effectsFor, stockRatio } from './supplyStock.js';
import { isSpotted } from './fog.js';

// 移动系统：沿命令路径点行进；直行遇不可通行地形时在逻辑网格上 A* 绕行（路径缓存共享）；
// 软排斥防止单位重叠；交战中冻结；溃逃单位不受指挥，向评估后最安全的己方城市全速撤退
// （默认最近；路线穿敌时改选安全城市，见 rankRoutTargets），无路可退或被困超过时限则投降（gdd.md §4、§6）。

// A* 路径缓存：同 tick 跨单位共享；容量上限内保留，超限清空（确定性）。
const pathCache = new Map();
const PATH_CACHE_MAX = 512;

const LOCK_ROUTE_UPDATE_INTERVAL = 0.5; // seconds

// 水里"卡住"的判据（px/tick，朝当前路点的净前进量）：正常水域步长是 speed × 0.4 ÷ 60 ≈ 0.27，
// 让路时会降到一半左右，所以只有**几乎没朝路点前进**（原地打转）才算停滞。
const MIN_WATER_PROGRESS = 0.02;

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

    // 更新锁定目标的路径
    if (unit.lockedTargetId != null) {
      updateLockRoute(world, unit);
    }

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

function updateLockRoute(world, unit) {
  const target = world.units.find(u => u.id === unit.lockedTargetId);
  if (!target || target.state === 'dead') {
    // 目标死亡或不存在，清除锁定
    unit.lockedTargetId = null;
    unit.command = null;
    unit.targetId = null;
    return;
  }

  // 检查目标是否在视野内，或有最后已知位置
  const targetFaction = unit.faction;
  const spotted = isSpotted(world, target, targetFaction);
  let targetX = target.x;
  let targetY = target.y;

  if (!spotted && target.lastSeen?.[targetFaction]) {
    // 使用最后已知位置
    targetX = target.lastSeen[targetFaction].x;
    targetY = target.lastSeen[targetFaction].y;
  } else if (!spotted) {
    // 目标不可见且无最后已知位置，停止追踪
    return;
  }

  // 限制路径更新频率
  unit._lockRouteTimer = (unit._lockRouteTimer ?? 0) + (world.time - (unit._lockLastTime ?? world.time));
  unit._lockLastTime = world.time;
  if (unit._lockRouteTimer < LOCK_ROUTE_UPDATE_INTERVAL) return;
  unit._lockRouteTimer = 0;

  // 重新规划路径到目标当前位置
  const newRoute = planRoute(world.terrain, unit.x, unit.y, [{ x: targetX, y: targetY }]);
  if (newRoute.length > 0) {
    unit.route = newRoute;
    unit.routeIndex = 0;
    unit.pathDirty = true;
    unit.targetId = unit.lockedTargetId;
  }
}

function updateBlockedUnits(world, previousPositions, dt) {
  for (const [unit, previous] of previousPositions) {
    if (unit.state !== 'moving' || unit.routeIndex >= unit.route.length) {
      unit.stuckTime = 0;
      unit.rerouteAttempts = 0;
      continue;
    }
    const displacement = Math.hypot(unit.x - previous.x, unit.y - previous.y);
    // 陆地上沿用原来的判据（单 tick 位移 < minDisplacement）。
    // ⚠️ 水里另有一套判据：让路（waterSafeStep）本来就会把速度压到半速，位移小是正常的，
    // 所以看的是**朝当前路点有没有真的前进** —— 挤在一起的单位会"前进量与推回量互相抵消"，
    // 单 tick 位移不为 0 却在几秒里一步都不往前走，位移判据完全漏掉这种僵持（实测的卡死）。
    const inWater = world.terrain.terrainAt(unit.x, unit.y) === values.terrain.codes.water;
    let stalled = displacement < values.movement.minDisplacement;
    if (inWater) {
      const direction = movementDirection(unit);
      const progress = direction
        ? (unit.x - previous.x) * direction.x + (unit.y - previous.y) * direction.y
        : displacement;
      stalled = progress < MIN_WATER_PROGRESS;
    }
    if (!stalled) {
      unit.stuckTime = 0;
      unit.rerouteAttempts = 0;
      continue;
    }
    unit.stuckTime += dt;
    if (unit.stuckTime < values.movement.stuckThresholdSeconds) continue;
    unit.stuckTime = 0;
    if (tryRerouteBlockedUnit(world, unit)) {
      unit.rerouteAttempts = 0;
      continue;
    }
    unit.rerouteAttempts += 1;
    if (unit.rerouteAttempts < values.movement.maxRerouteAttempts) continue;
    if (inWater) {
      // 水里最常见的是"两个友军正好在一条直线上迎面相遇"：软排斥的推力与前进量互相抵消，
      // 双方都以 ~0 的速度顶着（实测僵死）。首选解法是上面的侧向绕行；
      // 侧向也被堵死时**只跳过当前这个轨迹采样点**（拖曳轨迹 8px 一个点，跳一个无所谓），
      // 绝不丢掉整条轨迹 —— 旧代码在这里直接清空路线，单位于是永远冻在河中央。
      skipUnreachableWaypoint(world, unit);
      continue;
    }
    // 陆地：只停被挡住的那一段（队列里后续路径段保留）
    unit.route = [];
    unit.routeIndex = 0;
    unit.state = 'hold';
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

// 急行军速度倍率（gdd.md §4）：除水域之外的地形都提速；
// 水面上不给加成，仍按 terrain.moveMultiplier 的水域 0.4 走。
function forcedMarchMultiplier(world, unit) {
  if (!unit.forcedMarch) return 1;
  if (world.terrain.terrainAt(unit.x, unit.y) === values.terrain.codes.water) return 1;
  return values.movement.forcedMarch.speedMultiplier;
}

// 向路径点行进；ignoreStockEffects 用于溃逃（不受缺补削弱）。
function moveAlongRoute(world, unit, dt, ignoreStockEffects = false, speedMultiplier = 1) {
  skipImpassableWaypoints(world, unit);
  if (unit.routeIndex >= unit.route.length) return;

  let target = unit.route[unit.routeIndex];
  const distance = Math.hypot(target.x - unit.x, target.y - unit.y);
  const stats = unitStats(unit);
  const terrainMult = world.terrain.moveMultiplierAt(unit.x, unit.y);
  const stockMult = ignoreStockEffects ? 1 : effectsFor(stockRatio(unit)).speedMultiplier;
  const forcedMult = forcedMarchMultiplier(world, unit);
  const travel = stats.speed * terrainMult * stockMult * speedMultiplier * forcedMult * dt;

  // 急行军代价：缓慢掉血（走 damageUnit，计入结算伤亡）；掉光即力竭阵亡。
  if (unit.forcedMarch && !ignoreStockEffects) {
    world.damageUnit(unit, values.movement.forcedMarch.hpPerSecond * dt);
    if (unit.hp <= 0) {
      world.killUnit(unit, 'forcedMarch');
      return;
    }
  }

  if (distance <= travel) {
    const waypointPassable = world.terrain.passableAt(target.x, target.y);
    if (!waypointPassable || segmentBlocked(world.terrain, unit.x, unit.y, target.x, target.y)) {
      // 够不到这个采样点：能绕就绕（A*），绕不过就**跳过它继续走后面的轨迹**。
      // 旧实现在这里把整条轨迹丢掉并原地 hold —— 拖曳轨迹是 8px 一个采样点的长轨迹，
      // 只要其中一个点被挡住（水域里直线航行会偏离规划路径，很容易撞上这种点），
      // 单位就会停在半路不动，在水里就是"卡在河中央"（bug）。
      const detour = waypointPassable
        ? findPath(world.terrain, unit.x, unit.y, target.x, target.y)
        : null;
      if (detour && detour.length > 0) {
        unit.route.splice(unit.routeIndex, 0, ...detour);
        unit.pathDirty = true;
        return; // 下一 tick 沿插入的绕行点走
      }
      skipUnreachableWaypoint(world, unit);
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
    const nextX = unit.x + waterStep.x;
    const nextY = unit.y + waterStep.y;
    // 直线航行不看地形，但**不能踏进不可通行地形**：高山（和地图外）的移动倍率是 0，
    // 踏进去这一步位移就恒为 0，单位会永远定在那里不被任何逻辑救回来（水边紧贴高山的图上会踩到）。
    // 前方是墙就落回下面的常规分支，交给 A* 绕行或跳过这个采样点。
    if (world.terrain.passableAt(nextX, nextY)) {
      unit.x = nextX;
      unit.y = nextY;
      return;
    }
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
        // 绕不过去：跳过这个够不着的采样点，保留后面的轨迹（旧实现丢掉整条轨迹 → 停在半路）
        skipUnreachableWaypoint(world, unit);
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
      // 这一步迈不出去（前方是不可通行地形/被挡）：跳过这个采样点继续走后面的轨迹，
      // 而不是把整条轨迹丢掉停在半路（见 skipUnreachableWaypoint）。
      skipUnreachableWaypoint(world, unit);
      return;
    }
    unit.x = nextX;
    unit.y = nextY;
  }
}

/**
 * 跳过当前轨迹点：拖曳轨迹每 `input.routeSampleDistance`（8px）一个采样点，个别点因为
 * 单位被软排斥推开、或在水里直线航行偏离了规划路径而变得够不着时，**跳过它继续走后面的轨迹**
 * 才是玩家期望的行为。旧实现在这些分支里把**整条轨迹**清空并转入 hold，于是单位停在半路，
 * 在水里就是"卡在河中央"（bug）。轨迹点全部跳完（或被清空）才停下。
 */
function skipUnreachableWaypoint(world, unit) {
  unit.routeIndex += 1;
  unit.rerouteAttempts = 0;
  unit.stuckTime = 0;
  if (unit.routeIndex < unit.route.length) return;
  unit.route = [];
  unit.routeIndex = 0;
  activateNextQueuedRoute(world, unit);
}

function waterSafeStep(world, unit, target, travel) {
  const dx = target.x - unit.x;
  const dy = target.y - unit.y;
  const length = Math.hypot(dx, dy);
  const directionX = dx / length;
  const directionY = dy / length;
  let allowed = travel;
  for (const other of world.units) {
    if (other === unit || other.state === 'dead') continue;
    if (other.faction !== unit.faction) continue; // Allow approaching enemy units in water
    const offsetX = other.x - unit.x;
    const offsetY = other.y - unit.y;
    const clearance = waterClearance(unit, other);
    // ⚠️ 让路判据必须比软排斥的**分离距离更紧**（`movement.waterYieldMargin` 的余量）。
    // 软排斥每 tick 保证圆心距 ≥ clearance；若两者取同一个阈值，一对正好卡在阈值上的友军
    // 就会"我判你挡路、软排斥却认为已经够开而不推"互相锁死（浮点相等更是刀锋），
    // 双方 allowed 恒为 0，永远停在河中央 —— 实测的僵死 bug。
    const yieldDistance = clearance - values.movement.waterYieldMargin;
    if (Math.hypot(offsetX, offsetY) >= yieldDistance) continue;
    const along = offsetX * directionX + offsetY * directionY;
    if (along <= 0 || along > travel + unit.radius + other.radius) continue;
    const lateral = Math.abs(offsetX * directionY - offsetY * directionX);
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
        if (other.faction !== unit.faction) continue; // Don't separate from enemy units in water
        if (other.id < unit.id && world.terrain.terrainAt(other.x, other.y) === values.terrain.codes.water) continue;
        const dx = unit.x - other.x;
        const dy = unit.y - other.y;
        const distance = Math.hypot(dx, dy);
        const clearance = waterClearance(unit, other);
        if (distance >= clearance) continue;
        const nx = distance > 0.001 ? dx / distance : (unit.id < other.id ? 1 : -1);
        const ny = distance > 0.001 ? dy / distance : 0;
        const push = (clearance - distance) / 2;
        applySeparationPush(world, unit, nx * push, ny * push);
        applySeparationPush(world, other, -nx * push, -ny * push);
        changed = true;
      }
    }
    if (!changed) break;
  }
}

/**
 * 把一对单位的推向量作用到其中一方：目标点不可通行时**不推**。
 * 陆地软排斥（separateOverlaps）一直有这个守卫；水域这一份以前没有，
 * 于是挤在岸边的单位会被推进不可通行的高山格 —— 那里移动倍率是 0、位移恒为 0，
 * 单位再也出不来（"过水域时卡住"的另一种成因）。
 */
function applySeparationPush(world, unit, pushX, pushY) {
  const nextX = unit.x + pushX;
  const nextY = unit.y + pushY;
  if (!world.terrain.passableAt(nextX, nextY)) return;
  unit.x = nextX;
  unit.y = nextY;
}

// 单位当前的前进方向（朝当前路点）；没有路线/不在移动时返回 null。
function movementDirection(unit) {
  if (unit.state !== 'moving' && unit.state !== 'rout') return null;
  const target = unit.route?.[unit.routeIndex];
  if (!target) return null;
  const dx = target.x - unit.x;
  const dy = target.y - unit.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-3) return null;
  return { x: dx / length, y: dy / length };
}

function waterClearance(unit, other) {
  // Match land separation so units can reach contact distance (radius + radius + unitSeparation)
  return unit.radius + other.radius + Math.max(2, values.movement.unitSeparation);
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

// 溃退目标评估（gdd.md §6 增强）：不再无条件选「最近己方城市」。
// 对每个己方城市用 A* 规划一条撤退路线，按路线沿途与敌军（敌方单位 + 敌方城市/占领点）
// 的贴近程度打分：路线越贴敌分数越高；威胁分相同时取更近的城市。
// 效果：最近城市的撤退路线如果穿过敌军火力范围，会改选一条更安全的己方城市，
// 避免「一头扎进敌方怀抱」；全场无威胁时所有路线威胁分为 0，行为与旧版一致（取最近城市）。
const ROUT_THREAT_RADIUS = 150;    // 敌军构成威胁的距离（px），超过即视为不构成威胁
const ROUT_DISTANCE_WEIGHT = 0.02; // 距离分权重（px⁻¹），仅用于威胁分相同时打破平局

function routMovement(world, unit, dt) {
  // 目标选择与路径重算同频：进入新格子（或路径脏）时重新评估最安全城市，
  // 其余 tick 沿用已有路线，避免每帧重排导致的目标抖动与寻路开销。
  const cellKey = world.terrain.cellIndex(world.terrain.cellAt(unit.x, unit.y).cx, world.terrain.cellAt(unit.x, unit.y).cy);
  if (unit.pathDirty || unit.pathCheckCell !== cellKey) {
    unit.pathDirty = false;
    unit.pathCheckCell = cellKey;
    const targets = rankRoutTargets(world, unit);
    if (targets.length === 0) {
      world.killUnit(unit, 'surrender');
      return;
    }
    unit.route = targets[0].path;
    unit.routeIndex = 0;
  }
  const beforeX = unit.x;
  const beforeY = unit.y;
  moveAlongRoute(world, unit, dt, true, values.movement.routSpeedMultiplier);
  // 被困判定：位移极小则累计，超过时限投降（gdd.md §6）
  if (Math.hypot(unit.x - beforeX, unit.y - beforeY) < 0.5) unit.stuckTime += dt;
  else unit.stuckTime = 0;
  if (unit.stuckTime >= values.supplyStock.rout.stuckSeconds) world.killUnit(unit, 'surrender');
}

/**
 * 为溃退单位排布「安全撤退目标」：返回按分数升序的 { city, path, score } 列表（只含可达城市）。
 * score = 路线威胁分 + 距离分；取列表首项即最安全目标。
 * 导出供单测直接断言目标选择（不依赖整局模拟）。
 */
export function rankRoutTargets(world, unit) {
  const candidates = world.cities.filter(city => city.faction === unit.faction);
  if (candidates.length === 0) return [];

  // 威胁源：敌方存活单位 + 敌方城市 + 敌方占领点（都是「敌方怀抱」）。
  // 敌方单位走空间网格查询（只取附近，避免对全局敌军全量遍历）；静态目标数量少，直接遍历。
  const enemyStructures = [];
  for (const city of world.cities) {
    if (isEnemyHeld(city.faction, unit.faction)) enemyStructures.push(city);
  }
  for (const point of world.capturePoints ?? []) {
    if (isEnemyHeld(point.faction, unit.faction)) enemyStructures.push(point);
  }

  const scored = [];
  for (const city of candidates) {
    const path = findPath(world.terrain, unit.x, unit.y, city.x, city.y);
    if (path === null) continue; // 不可达的城市不作为候选（找不到任何可达城市时才投降）
    const threat = routeThreat(world, unit, path, enemyStructures);
    const length = pathLength(path);
    const fallbackDistance = Math.hypot(city.x - unit.x, city.y - unit.y);
    scored.push({ city, path, score: threat + ROUT_DISTANCE_WEIGHT * (length > 0 ? length : fallbackDistance) });
  }
  scored.sort((a, b) => a.score - b.score || a.city.id.localeCompare(b.city.id));
  return scored;
}

function isEnemyHeld(faction, ownFaction) {
  return faction === 'blue' || faction === 'red' ? faction !== ownFaction : false;
}

// 路线威胁分：取所有采样点中最大的「敌军贴近缺额」（0 = 全程远离敌军）。
// 缺额 = ROUT_THREAT_RADIUS − 距最近威胁源距离；路径上任何一点贴敌都会被计入。
function routeThreat(world, unit, path, enemyStructures) {
  const samples = path.length === 0
    ? [{ x: unit.x, y: unit.y }]
    : [{ x: unit.x, y: unit.y }, ...path];
  let worst = 0;
  for (const point of samples) {
    let threat = 0;
    for (const structure of enemyStructures) {
      const d = Math.hypot(structure.x - point.x, structure.y - point.y);
      if (d < ROUT_THREAT_RADIUS) threat = Math.max(threat, ROUT_THREAT_RADIUS - d);
    }
    const nearby = world.spatial.query(point.x, point.y, ROUT_THREAT_RADIUS);
    for (const enemy of nearby) {
      if (enemy.faction === unit.faction || enemy.state === 'dead') continue;
      const d = Math.hypot(enemy.x - point.x, enemy.y - point.y);
      threat = Math.max(threat, ROUT_THREAT_RADIUS - d);
    }
    if (threat > worst) worst = threat;
  }
  return worst;
}

function pathLength(path) {
  let total = 0;
  for (let i = 1; i < path.length; i += 1) {
    total += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
  }
  return total;
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
  const activeUnits = world.units.filter(unit => unit.state !== 'dead'
    && world.terrain.terrainAt(unit.x, unit.y) !== values.terrain.codes.water);
  const unitIndexes = new Map(activeUnits.map((unit, index) => [unit, index]));
  for (let index = 0; index < activeUnits.length; index += 1) {
    const unit = activeUnits[index];
    if (unit.state === 'dead') continue;
    const neighbors = world.spatial.query(unit.x, unit.y, unit.radius + maxRadius);
    for (const other of neighbors) {
      if (other === unit || other.state === 'dead') continue;
      if (world.terrain.terrainAt(other.x, other.y) === values.terrain.codes.water) continue;
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

// 把世界坐标夹进地图矩形。
// 必需：terrain.passableAt() 会把格子索引夹到边缘格，因此地图外的坐标"看起来可通行"，
// 若直接把它当成路径终点，单位会走出地图，进入画布上根本没有渲染的区域。
export function clampToMap(terrain, point) {
  const maxX = terrain.cols * terrain.cellSize;
  const maxY = terrain.rows * terrain.cellSize;
  return {
    x: Math.max(0, Math.min(maxX, point.x)),
    y: Math.max(0, Math.min(maxY, point.y)),
  };
}

// 下达命令时整条规划最短路径：对每个途经点逐段用 A* 绕开水域，返回去掉共线点的路径点。
// move 与 attackMove 共用（attack-forward 攻击前进，见 gdd.md §4）——
// 调用方在 applyCommand 时规划，使轨迹显示的是真实的绕行路径。
export function planRoute(terrain, startX, startY, waypoints) {
  const points = [];
  let cx = Math.max(0, Math.min(terrain.cols * terrain.cellSize, startX));
  let cy = Math.max(0, Math.min(terrain.rows * terrain.cellSize, startY));
  for (const waypoint of waypoints) {
    const wp = clampToMap(terrain, waypoint); // 地图外的目标点夹回地图内
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
        points.push(wp);
        cx = wp.x;
        cy = wp.y;
      }
    }
  }
  return simplify(points);
}
