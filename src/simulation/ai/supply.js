import { values } from '../../config/index.js';
import { supplyCostAt, supplyOwnerAt } from '../supplyPath.js';
import { stockRatio } from '../systems/supplyStock.js';

// AI 的**补给视野**（docs/ai-design.md §3.7）：纯函数，不依赖 Phaser/DOM，可单测。
//
// 从前的 AI 只看"敌人在哪、谁更弱、地形好不好"，完全不知道补给：于是会把部队推进到补给线够
// 不着的地方、断补了还继续硬打、急行军把存量烧光、撤退时挑一座被切断的城市。
// 这个模块把补给系统已经算好的三样东西交给 AI：
//   · 单位的补给状态：`unit.supplied`（路通不通）、`unit.supplyStock / maxSupplyStock`（存量比例）、
//     `unit.supplyIntake`（每秒进多少货）；
//   · **本方的补给代价场** `world.supplyFields[faction]`（全图每格到"最近己方城市"的路径代价，
//     已含地形权重与敌方实际控制区阻断）——查表即可判断"这个位置好不好补给"；
//   · 由档位 `supplyCaution`（0 激进 ~ 1 保守）派生的一整套阈值（见 `supplyPolicy`）。
//
// ⚠️ 公平模式（`ai.fog = true`）只读**本方**的场与已知情报：绝不读敌方的 `supplyFields`，
//    免得"看不见的对手粮道"被 AI 直接看穿（docs/ai-design.md 阶段三）。

const clamp01 = (value) => Math.max(0, Math.min(1, value));

/** 档位补给敏感度：0 = 激进（敢短时脱离补给线），1 = 保守（贴着补给线打）。 */
export function supplyCaution(cfg) {
  const raw = cfg?.supplyCaution;
  if (typeof raw !== 'number' || Number.isNaN(raw)) return 0.5;
  return clamp01(raw);
}

/**
 * 把「档位敏感度」摊成 AI 真正要用的几个阈值：
 *   · hardReachCost —— **行动边界**：`supply.path.maxCost`（真"够不着"的地方不去），与档位无关；
 *   · reachCost     —— **软**范围（= maxCost × 0.95~0.65）：只用于打分（越靠近边界越减分）；
 *   · weightScale   —— 效用打分里补给项的倍率（越保守越看重补给）；
 *   · forcedMarchStock —— 急行军要求的最低存量比例；
 *   · regroupRatio  —— 小队平均存量低于此值就回城休整。
 * 另外把"硬约束"的阈值原样带出来：断补（supplied=false）或存量比例 < lowRatio。
 */
export function supplyPolicy(cfg) {
  // 阈值从本局 cfg 读（关卡 ai.tuning 可以只覆盖 ai.supply 里的某几项）
  const s = cfg?.supply ?? values.ai.supply;
  const caution = supplyCaution(cfg);
  const lerp = (range) => range.min + (range.max - range.min) * caution;
  const reachRatio = lerp(s.reachRatio);
  return {
    caution,
    lowRatio: s.lowRatio,                                  // 硬约束：低于它就不再主动接战
    hardReachCost: values.supply.path.maxCost,             // 行动边界：与档位无关（gdd.md §8）
    reachRatio,                                            // 0.95（激进）~ 0.65（保守）
    reachCost: values.supply.path.maxCost * reachRatio,    // 软范围：仅用于打分
    weightScale: lerp(s.weightScale),
    forcedMarchStock: lerp(s.forcedMarchStock),
    regroupRatio: (cfg?.regroup?.supplyRatio ?? s.regroupRatioFallback)
      + s.regroupCautionRange * (caution - 0.5), // 标准档正好等于配置值，越保守越早回城
  };
}

/** 该点最近己方城市的路径代价（够不着 / 没有场 = Infinity）。只读本方的场。 */
export function supplyCostOf(world, faction, x, y) {
  const field = world?.supplyFields?.[faction];
  if (!field) return Infinity;
  return supplyCostAt(world, field, x, y);
}

/** 该点是否在"补给可达区"内（代价不超过给定上限）。
 *  **没有代价场**（还没 tick / 该阵营没有城市）时视为"未知 → 不限制"，返回 true。 */
export function withinSupply(world, faction, x, y, maxCost) {
  const field = world?.supplyFields?.[faction];
  if (!field) return true;
  const cost = supplyCostOf(world, faction, x, y);
  return Number.isFinite(cost) && cost <= maxCost;
}

/**
 * 该点补给条件最好（路径代价最低）的己方城市：
 *   · 格子在补给可达区内 → 直接用代价场的 owner（多源 Dijkstra 已经算出"最近的那座城"）；
 *   · 已经断补（够不着任何城）→ 退回欧氏最近，当作"往这个方向走总能接上补给"的近似。
 * @returns {{ city: object, cost: number }|null}
 */
export function bestSupplyCity(world, faction, x, y) {
  const cities = (world?.cities ?? []).filter(city => city.faction === faction);
  if (cities.length === 0) return null;

  const field = world?.supplyFields?.[faction];
  if (field) {
    const cost = supplyCostOf(world, faction, x, y);
    const owner = world.cities[supplyOwnerAt(world, field, x, y)];
    if (Number.isFinite(cost) && owner) return { city: owner, cost };
  }
  // 断补：代价场说"哪座城都够不着"，就用直线距离挑一座（往那边走才有机会接上补给）
  let best = cities[0];
  let bestDistance = Infinity;
  for (const city of cities) {
    const distance = Math.hypot(city.x - x, city.y - y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = city;
    }
  }
  return { city: best, cost: Infinity };
}

/**
 * 把一个目标点**夹进补给可达区**（行动边界，gdd.md §8 的"够不着"判定）：
 * 目标点若在区内原样返回；若在区外，就沿"自身 → 目标"这条直线二分回退，
 * 返回区内最靠外的那一点（留 `margin` 余量，避免贴着边界来回抖）。
 * 自身也在区外（已经断补）时返回自身位置——那种情况下由"回撤"逻辑接管。
 */
export function clampToSupply(world, faction, from, to, reachCost, margin = 0.95) {
  // 代价场还没建好（首帧）或该阵营没有城市 → 不做限制
  if (!world?.supplyFields?.[faction]) return { x: to.x, y: to.y, clamped: false };
  if (withinSupply(world, faction, to.x, to.y, reachCost)) return { x: to.x, y: to.y, clamped: false };
  if (!withinSupply(world, faction, from.x, from.y, reachCost)) return { x: from.x, y: from.y, clamped: true };

  let inside = 0;   // 已知在区内（t=0 是自身）
  let outside = 1;  // 已知在区外（t=1 是目标）
  for (let i = 0; i < 12; i += 1) { // 二分 12 次：误差 < 目标距离 / 4096
    const t = (inside + outside) / 2;
    const x = from.x + (to.x - from.x) * t;
    const y = from.y + (to.y - from.y) * t;
    if (withinSupply(world, faction, x, y, reachCost)) inside = t;
    else outside = t;
  }
  const t = Math.max(0, inside * margin);
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, clamped: true };
}

/** 单位是否处于"低补给"状态：补给线断了，或者存量比例低于警戒线。 */
export function isLowSupply(unit, policy) {
  if (!unit || unit.state === 'dead') return false;
  return !unit.supplied || stockRatio(unit) < policy.lowRatio;
}

/**
 * 小队层面的低补给判定：按**平均存量比例**与"断补人数占比"决定，
 * 避免一个掉队的单位把整队拖成防守姿态。
 */
export function squadLowSupply(units, policy, cutFraction = values.ai.supply.squadCutFraction) {
  const alive = units.filter(unit => unit.state !== 'dead');
  if (alive.length === 0) return false;
  const cut = alive.filter(unit => !unit.supplied).length / alive.length;
  const avgRatio = alive.reduce((sum, unit) => sum + stockRatio(unit), 0) / alive.length;
  return cut >= cutFraction || avgRatio < policy.lowRatio;
}

/**
 * 补给打分项（0~1）：这场仗值不值得打，从补给角度看。
 *   存量越足（相对警戒线的两倍封顶）越值得打；战场在补给可达区内加分；自己没断补加分。
 */
export function supplyScore(world, unit, enemy, policy) {
  const stock = clamp01(stockRatio(unit) / Math.max(0.01, policy.lowRatio * 2));
  const inside = withinSupply(world, unit.faction, enemy.x, enemy.y, policy.reachCost) ? 1 : 0;
  const linked = unit.supplied ? 1 : 0;
  return stock * 0.5 + inside * 0.3 + linked * 0.2;
}
