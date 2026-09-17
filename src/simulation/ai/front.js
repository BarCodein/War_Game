import { values } from '../../config/index.js';
import { facingTo } from './squad.js';
import { localPower } from './tactics.js';

// 薄弱点进攻（docs/ai-design.md 阶段二 B）：**复用控制线的 0 等值线段定位战线**，
// 再沿战线采样局部兵力比，选"离脚本目标近 + 我方相对优势大"的一段作为主攻方向；
// 并围绕目标生成若干接近轴（正面 + 左右侧翼），供多轴/佯动分兵使用。
// 全部是纯函数（只读 world 与 values），可单测（tests/unit/ai-front.test.js）。
//
// 权限边界（本轮确认）：**脚本给的目标点不变**——这里只决定"从哪个方向、哪一段接近"。

// 目标附近的战线采样点（控制线的 0 等值线段就是实际战线，已按 10Hz 在模拟层算好）
export function frontPointsNear(world, objective, radius = values.ai.weakSpot.frontSearchRadius) {
  const segments = world.controlLineSegments ?? [];
  const limit = values.ai.weakSpot.pointLimit;
  const found = [];
  for (const segment of segments) {
    // contour() 产出的线段是 { a: {x,y}, b: {x,y} }
    const points = [segment.a, segment.b].filter(Boolean);
    for (const point of points) {
      if (Math.hypot(point.x - objective.x, point.y - objective.y) > radius) continue;
      // 同格去重（线段端点很密，避免重复采样）
      const key = `${Math.round(point.x / 40)},${Math.round(point.y / 40)}`;
      if (found.some(item => item.key === key)) continue;
      found.push({ key, x: point.x, y: point.y });
      if (found.length >= limit) return found;
    }
  }
  return found;
}

// 某点的双方战力（复用 tactics.localPower，走空间网格）
export function pointStrength(world, point, faction, radius = values.ai.weakSpot.sampleRadius) {
  const { friendly, enemy } = localPower(world, point.x, point.y, faction, radius);
  const total = friendly + enemy;
  // 空点：没有任何部队 → 对"薄弱点"来说是最容易拿下的一段，占比记 1
  return { friendly, enemy, ratio: total <= 1e-6 ? 1 : friendly / total };
}

/**
 * 选主攻段：在目标附近的战线点里，挑一个"我方相对优势大（敌方薄弱）且离目标近"的点。
 * 没有任何战线点（还没接触/没有城市据点影响力）时返回 null，调用方退回"直接接近目标"。
 */
export function chooseWeakSpot(world, { objective, faction, cfg = values.ai }) {
  const candidates = frontPointsNear(world, objective, cfg.weakSpot.frontSearchRadius);
  if (candidates.length === 0) return null;
  const radius = cfg.weakSpot.sampleRadius;
  let best = null;
  for (const point of candidates) {
    const strength = pointStrength(world, point, faction, radius);
    // 敌方越弱（ratio 越高）越好；离目标越近越好
    const proximity = 1 - Math.min(1, Math.hypot(point.x - objective.x, point.y - objective.y)
      / Math.max(1, cfg.weakSpot.frontSearchRadius));
    const score = strength.ratio * 0.7 + proximity * 0.3;
    if (!best || score > best.score) best = { ...point, ...strength, score, proximity };
  }
  return best;
}

// 接近轴：以目标为圆心、从 origin 方向张开 axisCount 条轴线，端点落在 standoff 距离上
export function approachAxes(objective, origin, cfg = values.ai) {
  const { axisCount, axisSpread, standoff } = cfg.weakSpot;
  const base = Math.atan2(origin.y - objective.y, origin.x - objective.x); // 目标 → 我方
  const axes = [];
  for (let i = 0; i < axisCount; i += 1) {
    const offset = axisCount === 1 ? 0 : (i / (axisCount - 1) - 0.5) * 2 * axisSpread;
    const angle = base + offset;
    axes.push({
      index: i,
      angle,
      x: objective.x + Math.cos(angle) * standoff,
      y: objective.y + Math.sin(angle) * standoff,
    });
  }
  return axes;
}

// 地形偏好打分：接近轴端点处的地形更适合本档位吗（防守地形 / 机动地形）
export function terrainPreference(world, point, biasName = 'balanced') {
  const bias = values.ai.terrainBias[biasName] ?? values.ai.terrainBias.balanced;
  const defense = world.terrain.defenseModifierAt(point.x, point.y);   // 越小越适合防守（承伤更低）
  const mobility = world.terrain.moveMultiplierAt(point.x, point.y);   // 越大越好走
  const defenseScore = Math.max(0, Math.min(1, (1 - defense) / 0.5));  // 0.5(平原) → 1，0.85(森林) → 0.3
  const mobilityScore = Math.max(0, Math.min(1, (mobility - 0.5) / 0.75));
  return bias.defense * defenseScore + bias.mobility * mobilityScore;
}

/**
 * 给一个小队选接近轴：在若干轴线里挑"敌方最弱 + 地形合本档口味 + 离自己最近"的一条。
 * 返回值是 **停战线上的一个点**（不是脚本目标本身）——部队先推进到这里，再压向目标。
 */
export function chooseApproach(world, { unit, objective, faction, cfg = values.ai, taken = new Set() }) {
  const axes = approachAxes(objective, { x: unit.x, y: unit.y }, cfg);
  const biasName = cfg.terrainBias;
  let best = null;
  for (const axis of axes) {
    if (taken.has(axis.index)) continue;
    const strength = pointStrength(world, axis, faction, cfg.weakSpot.sampleRadius);
    const travel = Math.hypot(axis.x - unit.x, axis.y - unit.y);
    const proximity = 1 - Math.min(1, travel / Math.max(1, cfg.weakSpot.standoff * 2));
    const terrain = terrainPreference(world, axis, biasName);
    const score = strength.ratio * 0.45 + proximity * 0.25 + terrain * values.ai.weights.approach * 0.3;
    if (!best || score > best.score) best = { ...axis, ...strength, terrain, score };
  }
  return best;
}

// 佯动分队（sly 档）：给编队里最近的一小撮单位安排一条"侧翼接近轴"，只推进到停战线并牵制
export function feintAxis(world, { mainAxis, objective, faction, cfg = values.ai }) {
  const axes = approachAxes(objective, { x: objective.x, y: objective.y + 1 }, cfg);
  const mainIndex = mainAxis?.index ?? 0;
  const other = axes.find(axis => axis.index !== mainIndex) ?? axes[0];
  const strength = pointStrength(world, other, faction, cfg.weakSpot.sampleRadius);
  return { ...other, ...strength };
}

// 主攻方向与小队朝向：把"目标点"换成"接近轴端点 + 目标"的两段式推进点
export function approachWaypoint(axis, objective, unit) {
  if (!axis) return objective;
  // 已经越过停战线（比轴线更靠近目标）时直接压向目标
  const toObjective = Math.hypot(unit.x - objective.x, unit.y - objective.y);
  const axisToObjective = Math.hypot(axis.x - objective.x, axis.y - objective.y);
  return toObjective <= axisToObjective ? objective : { x: axis.x, y: axis.y };
}

// 朝向辅助（供队形使用）
export function approachFacing(unit, waypoint) {
  return facingTo(unit, waypoint);
}
