import { values } from '../../config/index.js';
import { facingTo } from './squad.js';
import { combatPower, localPower } from './tactics.js';
import { supplyPolicy, supplyCostOf } from './supply.js';
import { interdictionScore } from './interdiction.js';

// 薄弱点进攻（docs/ai-design.md 阶段二 B）：**复用控制线的 0 等值线段定位战线**，
// 再沿战线采样局部兵力比，选"离脚本目标近 + 我方相对优势大"的一段作为主攻方向；
// 并围绕目标生成若干接近轴（正面 + 左右侧翼），供多轴/佯动分兵使用。
// 打分里带**补给代价**（docs/ai-design.md §3.7）：同样弱的一段，优先从补给线短的那侧打。
// 打分里还带**断敌粮道**（§3.8）：同样弱的一段，优先从"压得住敌方补给走廊"的那侧打
// （软权重 ai.weights.interdiction，不否决正面目标）。
// 全部是纯函数（只读 world 与 values），可单测（tests/unit/ai-front.test.js）。
//
// 权限边界（本轮确认）：**脚本给的目标点不变**——这里只决定"从哪个方向、哪一段接近"。

// 补给可达性打分（0~1）：代价越低越接近 1；够不着 = 0。
// 只读**本方**的补给代价场，公平模式下不会去偷看对方的粮道。
function reachScore(world, faction, point, policy) {
  const cost = supplyCostOf(world, faction, point.x, point.y);
  if (!Number.isFinite(cost)) return 0;
  return Math.max(0, 1 - cost / Math.max(1, policy.reachCost));
}

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
// - 全知模式：敌方战力也来自真实单位
// - 公平模式（给了 knowns）：敌方战力只由"看得见 + 记得住"的敌情估算，
//   记忆条目没有实体，按轻型单位的基准战力 × 置信度折算（诚实近似，见 docs/ai-design.md §3.4）
export function pointStrength(world, point, faction, radius = values.ai.weakSpot.sampleRadius, knowns = null) {
  const { friendly, enemy: trueEnemy } = localPower(world, point.x, point.y, faction, radius);
  let enemy = trueEnemy;
  if (knowns) {
    enemy = 0;
    for (const item of knowns) {
      if (Math.hypot(item.x - point.x, item.y - point.y) > radius) continue;
      const unit = item.unit ?? {
        type: 'light', hp: values.units.light.hp,
        supplyStock: values.units.light.supplyStock, maxSupplyStock: values.units.light.supplyStock,
        x: item.x, y: item.y, state: 'hold', faction: item.faction,
      };
      enemy += combatPower(unit, world) * (item.ghost ? item.confidence : 1);
    }
  }
  const total = friendly + enemy;
  // 空点：没有任何部队 → 对"薄弱点"来说是最容易拿下的一段，占比记 1
  return { friendly, enemy, ratio: total <= 1e-6 ? 1 : friendly / total };
}

// 公平模式下的"自建战线"：只用已知敌情（可见 + 记忆）的位置当作战线采样点。
// 不看全知的影响力场——那是双方全知算出来的，公平模式用它就等于作弊。
export function frontFromKnowns(knowns, objective, radius = values.ai.weakSpot.frontSearchRadius) {
  const limit = values.ai.weakSpot.pointLimit;
  const found = [];
  for (const item of knowns) {
    if (Math.hypot(item.x - objective.x, item.y - objective.y) > radius) continue;
    const key = `${Math.round(item.x / 40)},${Math.round(item.y / 40)}`;
    if (found.some(point => point.key === key)) continue;
    found.push({ key, x: item.x, y: item.y, confidence: item.confidence });
    if (found.length >= limit) break;
  }
  return found;
}

/**
 * 选主攻段：在目标附近的战线点里，挑一个"我方相对优势大（敌方薄弱）且离目标近"的点。
 * 补给项（docs/ai-design.md §3.7）：主攻段要打得到、也要喂得上——超出补给可达区的采样点扣分。
 * 断粮项（§3.8）：这一段的阵地能不能顺手压住敌方补给走廊（软权重，不否决正面目标）。
 * 没有任何战线点（还没接触/没有城市据点影响力）时返回 null，调用方退回"直接接近目标"。
 */
export function chooseWeakSpot(world, { objective, faction, cfg = values.ai, knowns = null, fogAware = false, interdiction = null }) {
  const candidates = fogAware
    ? frontFromKnowns(knowns ?? [], objective, cfg.weakSpot.frontSearchRadius) // 公平：自建战线
    : frontPointsNear(world, objective, cfg.weakSpot.frontSearchRadius);       // 全知：读控制线
  if (candidates.length === 0) return null;
  const radius = cfg.weakSpot.sampleRadius;
  const policy = supplyPolicy(cfg);
  let best = null;
  for (const point of candidates) {
    const strength = pointStrength(world, point, faction, radius, fogAware ? (knowns ?? []) : null);
    // 敌方越弱（ratio 越高）越好；离目标越近越好；补给代价越低越好；越压得住敌粮道越好
    const proximity = 1 - Math.min(1, Math.hypot(point.x - objective.x, point.y - objective.y)
      / Math.max(1, cfg.weakSpot.frontSearchRadius));
    const supply = reachScore(world, faction, point, policy);
    const interdict = interdictionScore(point, interdiction);
    const score = strength.ratio * 0.6 + proximity * 0.25 + supply * 0.15
      + interdict * values.ai.weights.interdiction * policy.weightScale * 0.15;
    if (!best || score > best.score) best = { ...point, ...strength, score, proximity, supply, interdict };
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
 * 给一个小队选接近轴：在若干轴线里挑"敌方最弱 + 地形合本档口味 + 离自己最近 + **补给代价低**"的一条。
 * 返回值是 **停战线上的一个点**（不是脚本目标本身）——部队先推进到这里，再压向目标。
 * 补给项很关键：从补给线拉得最长的那条轴推进，等于让全队在半路上断粮（docs/ai-design.md §3.7）。
 * 断粮项（§3.8）：轴线端点若能压住敌方补给走廊，也加分（软权重，不影响脚本目标）。
 */
export function chooseApproach(world, { unit, objective, faction, cfg = values.ai, taken = new Set(), knowns = null, fogAware = false, interdiction = null }) {
  const axes = approachAxes(objective, { x: unit.x, y: unit.y }, cfg);
  const biasName = cfg.terrainBias;
  const policy = supplyPolicy(cfg);
  let best = null;
  for (const axis of axes) {
    if (taken.has(axis.index)) continue;
    const strength = fogAware
      ? pointStrength(world, axis, faction, cfg.weakSpot.sampleRadius, knowns ?? [])
      : pointStrength(world, axis, faction, cfg.weakSpot.sampleRadius);
    const travel = Math.hypot(axis.x - unit.x, axis.y - unit.y);
    const proximity = 1 - Math.min(1, travel / Math.max(1, cfg.weakSpot.standoff * 2));
    const terrain = terrainPreference(world, axis, biasName);
    const supply = reachScore(world, faction, axis, policy);
    const interdict = interdictionScore(axis, interdiction);
    const score = strength.ratio * 0.4 + proximity * 0.2
      + terrain * values.ai.weights.approach * 0.25
      + supply * values.ai.weights.approach * 0.25
      + interdict * values.ai.weights.interdiction * policy.weightScale * 0.25;
    if (!best || score > best.score) best = { ...axis, ...strength, terrain, supply, interdict, score };
  }
  return best;
}

// 佯动分队（sly 档）：给编队里最近的一小撮单位安排一条"侧翼接近轴"，只推进到停战线并牵制
export function feintAxis(world, { mainAxis, objective, faction, cfg = values.ai, knowns = null, fogAware = false }) {
  const axes = approachAxes(objective, { x: objective.x, y: objective.y + 1 }, cfg);
  const mainIndex = mainAxis?.index ?? 0;
  const other = axes.find(axis => axis.index !== mainIndex) ?? axes[0];
  const strength = fogAware
    ? pointStrength(world, other, faction, cfg.weakSpot.sampleRadius, knowns ?? [])
    : pointStrength(world, other, faction, cfg.weakSpot.sampleRadius);
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
