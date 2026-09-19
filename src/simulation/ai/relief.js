import { values } from '../../config/index.js';
import { combatPower, estimatedPower } from './tactics.js';
import { bestSupplyCity } from './supply.js';

// 护己方粮道（docs/ai-design.md §3.8）：解围 + 撤退选城避开被围的城。
// 与 interdiction.js 相反的方向：那里是"怎么掐断敌人的粮道"，这里是"怎么别让自己的粮道被掐断"。
//
// 判断依据（公开信息 + 己方情报）：
//   · 这城值不值得救：它是多少个己方单位的**最近己方城市**（欧氏最近即可——
//     补给线被切断时代价场是 Infinity，只有欧氏归属还成立），或本轮输出了多少运力点
//     （world.citySupplyLoad，补给系统现成算好的）；
//   · 被围了没有：看得见的敌人在城周 threatRadius 内，或这城正在被夺（city.captureProgress > 0，
//     HUD 上公开显示的信息）；
//   · 打不打得过：解围分队战力 ≥ 围城敌军战力 × forceRatio，否则不送人头，等主力。
// 公平模式（ai.fog）下"围城敌军"只按己方掌握的情报估——看不到就不知道城被围了（诚实局限，
// 与 §3.3 的"看不见就不主动咬"一致）；captureProgress 是公开信息，永远算数。

/** 每个己城的"养兵数"：按欧氏最近己方城市归属统计（一次扫完，避免每城重扫一遍单位表）。 */
export function supplyUserCounts(world, faction) {
  const cities = (world?.cities ?? []).filter(city => city.faction === faction);
  const counts = new Map(cities.map(city => [city.id, 0]));
  if (cities.length === 0) return counts;
  for (const unit of world.units) {
    if (unit.state === 'dead' || unit.faction !== faction) continue;
    let owner = null;
    let best = Infinity;
    for (const city of cities) {
      const distance = Math.hypot(city.x - unit.x, city.y - unit.y);
      if (distance < best) {
        best = distance;
        owner = city;
      }
    }
    if (owner) counts.set(owner.id, (counts.get(owner.id) ?? 0) + 1);
  }
  return counts;
}

/** 单城的养兵数（导出给测试/调试用）。 */
export function supplyUsers(world, faction, city) {
  return supplyUserCounts(world, faction).get(city.id) ?? 0;
}

/**
 * 城防压力：看得见的敌军战力/数量（threatRadius 内）+ 是否正在被夺。
 * `center` 是围城敌军的形心——解围就是"压向这几个人"（attackMove 接触即交战），
 * 没有可见敌军（只从 `captureProgress` 判断出被夺）时为 null。
 * @returns {{enemyPower:number, enemyCount:number, captureProgress:number, threatened:boolean, center:{x:number,y:number}|null}}
 */
export function cityThreat(world, faction, city, { cfg = values.ai, knowns = null } = {}) {
  const radius = cfg.relief.threatRadius;
  let enemyPower = 0;
  let enemyCount = 0;
  let sumX = 0;
  let sumY = 0;
  for (const item of knowns ?? []) {
    if (item.faction === faction) continue;
    if (Math.hypot(item.x - city.x, item.y - city.y) > radius) continue;
    enemyPower += estimatedPower(world, item);
    enemyCount += 1;
    sumX += item.x;
    sumY += item.y;
  }
  const captureProgress = Math.max(0, city.captureProgress ?? 0);
  return {
    enemyPower,
    enemyCount,
    captureProgress,
    threatened: enemyCount > 0 || captureProgress > 0,
    center: enemyCount > 0 ? { x: sumX / enemyCount, y: sumY / enemyCount } : null,
  };
}

/**
 * 解围方案：挑一座"被围住、又真的在养兵"的己城，让这支分队去**打退围城的敌军**。
 *   得分 = 这城养了多少兵（0.5）+ 围城压力（敌军战占双方战力之比，0.3）+ 分队离得多近（0.2）
 * 目标点：看得见围城敌军 → 直接压向他们的形心（attackMove 接触即交战）；
 *         只有 `captureProgress` 这一条线索（看不到人）→ 停在城外 standoff 处待机。
 * 返回 null = 没有值得解围的城（或打不过 / 太远）→ 预备队照旧在主力后方待命。
 * @param {{cfg?:object, knowns?:Array, units?:Array, from?:{x:number,y:number}|null}} options
 */
export function reliefPlan(world, faction, { cfg = values.ai, knowns = null, units = [], from = null } = {}) {
  const pool = (units ?? []).filter(unit => unit.state !== 'dead');
  if (pool.length === 0) return null;
  const power = pool.reduce((sum, unit) => sum + combatPower(unit, world), 0);
  const counts = supplyUserCounts(world, faction);
  const origin = from ?? { x: pool[0].x, y: pool[0].y };

  let best = null;
  for (const city of (world.cities ?? []).filter(candidate => candidate.faction === faction)) {
    const threat = cityThreat(world, faction, city, { cfg, knowns });
    if (!threat.threatened) continue;
    const users = counts.get(city.id) ?? 0;
    const load = world.citySupplyLoad?.get(city.id) ?? 0;
    // 无关紧要的城：丢了也断不了粮（没几个兵靠它，也没有运力从这里出去）
    if (users < cfg.relief.minUsers && load < cfg.relief.minLoadPoints) continue;
    if (power < threat.enemyPower * cfg.relief.forceRatio) continue; // 打不过：等主力，不送人头
    const distance = Math.hypot(city.x - origin.x, city.y - origin.y);
    if (distance > cfg.relief.maxDistance) continue; // 太远：等走到城已经丢了

    // 看得见人 → 直接压向围城敌军；只看得到"城正在被夺" → 停在城外 standoff（不撞进占领圈）
    const dx = origin.x - city.x;
    const dy = origin.y - city.y;
    const length = Math.hypot(dx, dy);
    const fallback = length <= 1e-6
      ? { x: city.x, y: city.y }
      : { x: city.x + (dx / length) * cfg.relief.standoff, y: city.y + (dy / length) * cfg.relief.standoff };
    const point = threat.center ?? fallback;

    const significance = Math.min(1, users / Math.max(1, cfg.relief.minUsers * 2));
    const pressure = threat.enemyPower / Math.max(1e-6, power + threat.enemyPower);
    const proximity = 1 - Math.min(1, distance / Math.max(1, cfg.relief.maxDistance));
    const score = significance * 0.5 + pressure * 0.3 + proximity * 0.2;
    if (!best || score > best.score) {
      best = {
        city, x: point.x, y: point.y, users, load, distance, score, power, ...threat,
      };
    }
  }
  return best;
}

/**
 * 撤退/休整该去哪座城（docs/ai-design.md §3.8）：
 *   · 首选仍是**补给代价最低**的那座（等价于旧行为 bestSupplyCity）；
 *   · 但它正被围住时，改挑"代价 + 被围罚分"最低的城——原来那套会整队撤进一座马上要丢的城，
 *     越撤越惨（撤退目标避开被切断的城）。
 * 没有己城 / 没有代价场时返回 null（调用方再退回 nearestOwnCity）。
 */
export function bestRetreatCity(world, faction, x, y, { cfg = values.ai, knowns = null } = {}) {
  const primary = bestSupplyCity(world, faction, x, y);
  if (!primary) return null;
  const cities = (world.cities ?? []).filter(city => city.faction === faction);
  if (cities.length <= 1) return primary.city;
  const threats = new Map(cities.map(city => [city.id, cityThreat(world, faction, city, { cfg, knowns })]));
  if (!threats.get(primary.city.id).threatened) return primary.city;

  let best = null;
  for (const city of cities) {
    // 只有"代价场认定的那座城"有真实路径代价，其余用欧氏距离近似（反正是绕开被围的城时的次优选择）
    const cost = city.id === primary.city.id && Number.isFinite(primary.cost)
      ? primary.cost
      : Math.hypot(city.x - x, city.y - y);
    const penalty = threats.get(city.id).threatened ? cfg.relief.retreatThreatPenalty : 0;
    const score = cost + penalty;
    if (!best || score < best.score) best = { city, score };
  }
  return best.city;
}
