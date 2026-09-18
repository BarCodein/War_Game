import { values } from '../../config/index.js';
import { estimatedPower, localPower } from './tactics.js';

// 断敌粮道（docs/ai-design.md §3.8）：纯函数，只读 world 与 values，可单测。
//
// 机制依据（都在模拟层现成算好，AI 不自己寻路）：敌方补给线 = **敌单位 → 它最近的敌城**
// 之间的最短路径，而"一个单位脚下 140px 内的格子算我方实际控制"
// （values.controlLine.unit.influenceRadius，判定阈值 supply.path.controlBlockMin）——
// 所以把部队插到那条走廊上，就能真的掐断对方的补给（supplyPath 的敌方控制区掩码）。
//
// AI 只用**公开信息**估算这条走廊：
//   · 敌城坐标与归属（地图上公开显示）；
//   · **看得见**的敌单位位置（公平模式下不拿 lastSeen 记忆里的旧坐标当粮道——那是幻觉）；
//   · 威胁估计可以带记忆条目（按置信度折算），这只会让 AI 更保守，不会让它去偷看敌方的代价场。
// 绝不读 `world.supplyFields[敌]`：那是"看不见的对手粮道"（与 §3.4 同一条边界）。

// 点到线段的距离（走廊是一条线段：单位 → 城）
function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq <= 1e-9) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

/**
 * 敌方补给走廊：每个**看得见**的敌单位连到它最近的敌城。
 * 走廊太短（敌人就在城边）或敌人没有城（该阵营城市已全丢）时不算——那种情况本来就没粮道可断。
 * @returns {Array<{unitId:number, ax:number, ay:number, bx:number, by:number, cityId:string, power:number}>}
 */
export function enemyCorridors(world, faction, knowns, cfg = values.ai) {
  const corridors = [];
  const cities = (world?.cities ?? []).filter(city => city.faction !== 'neutral');
  if (cities.length === 0) return corridors;
  for (const item of knowns ?? []) {
    if (item.ghost) continue;              // 公平：记忆里的旧坐标不能当粮道
    if (item.faction === faction) continue;
    let city = null;
    let best = Infinity;
    for (const candidate of cities) {
      if (candidate.faction !== item.faction) continue; // 只能靠自己的城补给
      const distance = Math.hypot(candidate.x - item.x, candidate.y - item.y);
      if (distance < best) {
        best = distance;
        city = candidate;
      }
    }
    if (!city || best < cfg.interdiction.minCorridor) continue;
    corridors.push({
      unitId: item.id,
      ax: item.x,
      ay: item.y,
      bx: city.x,
      by: city.y,
      cityId: city.id,
      power: estimatedPower(world, item),
    });
  }
  // 确定性：按敌单位 id 排序（候选点的生成顺序就固定了，同分时取先生成的那个）
  corridors.sort((a, b) => a.unitId - b.unitId);
  return corridors;
}

/** 该点能压住几条敌补给线（cutRadius 内即算——一个单位的影响力就覆盖这么远）。 */
export function cutCountAt(point, corridors, radius = values.ai.interdiction.cutRadius) {
  let count = 0;
  for (const corridor of corridors) {
    if (distanceToSegment(point.x, point.y, corridor.ax, corridor.ay, corridor.bx, corridor.by) <= radius) {
      count += 1;
    }
  }
  return count;
}

/** 走廊上的采样点：按 0.3 → 0.7 均分，避开"城下"与"单位脚下"两端。 */
export function corridorCandidates(corridors, cfg = values.ai) {
  const samples = Math.max(1, Math.round(cfg.interdiction.corridorSamples));
  const candidates = [];
  for (const corridor of corridors) {
    for (let i = 0; i < samples; i += 1) {
      const t = samples === 1 ? 0.5 : 0.3 + (0.4 * i) / (samples - 1);
      candidates.push({
        x: corridor.ax + (corridor.bx - corridor.ax) * t,
        y: corridor.ay + (corridor.by - corridor.ay) * t,
        cityId: corridor.cityId,
      });
    }
  }
  return candidates;
}

/**
 * 断粮方案：挑一个"能同时压住 ≥ minCuts 条敌补给线、自己够得着、又不会一头撞进强敌"的点。
 *   得分 = 压制面（cuts / 走廊总数）× 0.5 + 局部安全（我方战力占比）× 0.25 + 距离（越近越好）× 0.25
 * 没有可行点（敌人太少/太分散、走廊太长够不着、点太危险）时返回 null —— 调用方照旧推进正面。
 * @param {{cfg?:object, knowns?:Array, from?:{x:number,y:number}|null}} options
 */
export function interdictionPlan(world, faction, { cfg = values.ai, knowns = [], from = null } = {}) {
  const cfgI = cfg.interdiction;
  const corridors = enemyCorridors(world, faction, knowns, cfg);
  if (corridors.length === 0) return null;

  const seen = new Set();
  let best = null;
  for (const candidate of corridorCandidates(corridors, cfg)) {
    // 同格去重（相邻采样点常常落在同一条走廊上）
    const key = `${Math.round(candidate.x / 40)},${Math.round(candidate.y / 40)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const cuts = cutCountAt(candidate, corridors, cfgI.cutRadius);
    if (cuts < cfgI.minCuts) continue; // 只压得住一条：顺手的事，不值得为它改方向

    let distance = 0;
    if (from) {
      distance = Math.hypot(candidate.x - from.x, candidate.y - from.y);
      if (distance < cfgI.minDistance) continue; // 就在自己控制里，不算"断人粮道"
      if (distance > cfgI.maxDistance) continue; // 太远：等走到了，仗已经打完
    }

    const friendly = localPower(world, candidate.x, candidate.y, faction, cfg.weakSpot.sampleRadius).friendly;
    // 威胁只按已知敌情估（公平模式含记忆条目，按置信度折算 → 只会更保守）
    let threat = 0;
    for (const item of knowns ?? []) {
      if (item.faction === faction) continue;
      if (Math.hypot(item.x - candidate.x, item.y - candidate.y) > cfg.weakSpot.sampleRadius) continue;
      threat += estimatedPower(world, item);
    }
    const total = friendly + threat;
    const safety = total <= 1e-6 ? 1 : friendly / total;
    const proximity = from ? 1 - Math.min(1, distance / Math.max(1, cfgI.maxDistance)) : 1;
    const coverage = cuts / Math.max(1, corridors.length);
    const score = coverage * 0.5 + safety * 0.25 + proximity * 0.25;
    if (!best || score > best.score) {
      best = {
        x: candidate.x, y: candidate.y, cuts, cityId: candidate.cityId, score, coverage, safety, proximity, corridors,
      };
    }
  }
  return best;
}

/** 到 plan 里任意走廊的最近距离。 */
function nearestCorridorDistance(point, corridors) {
  let best = Infinity;
  for (const corridor of corridors) {
    const distance = distanceToSegment(point.x, point.y, corridor.ax, corridor.ay, corridor.bx, corridor.by);
    if (distance < best) best = distance;
  }
  return best;
}

/**
 * 某个候选点（接近轴端点 / 战线点）对断粮计划的价值（0~1）：
 *   压制面 = 该点压住的走廊数 ÷ 计划本身的走廊数（×0.6）+ 离走廊多近（×0.4）。
 * "数"决定值不值得，"近"决定同样压得住时哪条轴更贴——两者都要：接近轴之间的间距只有约 130px，
 * 小于压制半径 140，只看"压住几条"的话相邻两条轴会拿到一模一样的分数（等于这项没用）。
 */
export function interdictionScore(point, plan, radius = values.ai.interdiction.cutRadius) {
  if (!plan) return 0;
  const cuts = cutCountAt(point, plan.corridors, radius);
  if (cuts === 0) return 0;
  const coverage = Math.min(1, cuts / Math.max(1, plan.cuts));
  const closeness = 1 - Math.min(1, nearestCorridorDistance(point, plan.corridors) / Math.max(1, radius));
  return Math.max(0, Math.min(1, coverage * 0.6 + closeness * 0.4));
}
