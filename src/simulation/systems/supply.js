import { values } from '../../config/index.js';
import {
  buildBlockedMask, buildSupplyField, createSupplyField, supplyCostAt, supplyFactor, supplyGrid, supplyOwnerAt,
} from '../supplyPath.js';

// 补给与城市维护（gdd.md §7、§8）：
// 1. 每 refreshSeconds 重算一次补给分配：单位 → 己方城市的最短路径（地形加权、
//    不穿敌方实际控制区）→ 城市按「离自己最近的单位优先」支出吞吐点数 →
//    单位实收 = 支出点数 × 距离因子（见 supplyPath.js 顶部说明）；
// 2. 把实收点数换算成**补给存量进货速率**（`unit.supplyIntake`，供 supplyStock 系统消费）；
// 3. 己方城市附近恢复生命（速率见 values.cities.recovery；多城不叠加）；
// 4. 城市生产：当前关闭（values.cities.production.enabled = false）；
// 5. 环境损耗：身处水域的单位 hp −1/s（可溺水阵亡）。
// 注：补给存量归零后的掉血（attrition）由 supplyStock 系统负责——那里才有最新的存量。
//
// 重算结果写在 world 上：world.supplyFields[faction]（代价场，渲染层也读它）、
// world.supplyToken（每次重算 +1，渲染层用它判断缓存是否过期）、
// world.citySupplyLoad（各城本轮支出，HUD/调试用）。
const FACTIONS = ['blue', 'red'];
const EPS = 1e-9;

export function updateSupply(world, dt) {
  refreshSupply(world, dt);
  recoverNearCity(world, dt);
  produceUnits(world, dt);
  applyWaterDamage(world, dt);
}

/**
 * 补给结算（两档节流）：
 *   · 代价场（多源 Dijkstra）每 fieldRefreshSeconds 重算一次 —— 它只取决于城市与敌方控制区，
 *     与单位位置无关，是全套里最贵的一步；重算后 supplyToken +1（渲染层的路径缓存跟着失效）；
 *   · 分配每 refreshSeconds 重跑一次 —— 单位一直在动，但这步只是排序 + 查表，很便宜。
 * 返回本次是否重跑过分配（测试与调试用）。
 */
export function refreshSupply(world, dt) {
  world.supplyTimer += dt;
  world.supplyFieldTimer += dt;
  if (world.supplyTimer < values.supply.refreshSeconds) return false;
  world.supplyTimer = 0;
  world.citySupplyLoad.clear();

  const rebuildFields = world.supplyFieldTimer >= values.supply.fieldRefreshSeconds;
  if (rebuildFields) {
    world.supplyFieldTimer = 0;
    world.supplyToken += 1;
  }

  for (const faction of FACTIONS) {
    const field = ensureField(world, faction);
    if (!field) {
      clearFaction(world, faction);
      continue;
    }
    if (rebuildFields) {
      // 敌方实际控制区在每个阵营下是同一张掩码的正负两面：各建一张，分配里重算子集时复用
      world.supplyMasks[faction] = buildBlockedMask(world, faction, world.supplyMasks[faction]);
      buildSupplyField(world, faction, field, { mask: world.supplyMasks[faction] });
    }
    distribute(world, faction, field);
  }
  return true;
}

// 每个阵营一张代价场（首次用到时按地图尺寸建立；没有己方城市就不建）
function ensureField(world, faction) {
  if (!world.cities.some(city => city.faction === faction)) {
    world.supplyFields[faction] = null;
    return null;
  }
  if (!world.supplyFields[faction]) world.supplyFields[faction] = createSupplyField(supplyGrid(world));
  return world.supplyFields[faction];
}

function scratchField(world) {
  if (!world.supplyScratch) world.supplyScratch = createSupplyField(supplyGrid(world));
  return world.supplyScratch;
}

// 没有任何己方城市：全员断补（实收 0 → 不进货）
function clearFaction(world, faction) {
  for (const unit of world.units) {
    if (unit.faction !== faction) continue;
    unit.supplied = false;
    unit.supplyRatio = 0;
    unit.supplyIntake = 0;
    unit.supplyEdges = [];
    unit.supplyCost = Infinity;
  }
}

/**
 * 本轮申领量（点）：**按缺口申领，缺口越大申领越多，上限 demandPerUnit**。
 *   · 存量已满 → 缺口 0 → 申领 0：**不占用城市运力**，多余的运力自然流向其他缺补的部队（gdd.md §8）；
 *   · 缺口大（≥ demandPerUnit × stockPerPoint 点存量）→ 申领 demandPerUnit（照旧 20/s 补满，手感不变）；
 *   · 快满（缺口不足一轮的量）→ 按缺口精确申领，收尾不留浪费。
 * 注：单位只有在**有缺口**时才申领，所以"城市容量"限制的是每秒能补多少缺口，
 * 而不是"能养多少个单位"——满额部队再多也不会互相挤占运力。
 */
function claimOf(unit) {
  const cfg = values.supply;
  const deficit = Math.max(0, (unit.maxSupplyStock ?? 0) - unit.supplyStock);
  return Math.min(cfg.demandPerUnit, deficit / cfg.stockPerPoint);
}

/**
 * 分配：把所有**有缺口**的己方单位按「到最近可用城市的代价」升序排序，逐个支出城市点数。
 * 城市点数用光就把它剔出种子、重算代价场（于是每个单位自动落到下一座最近的城），
 * 直到全员满足或没有城可用——这就是「最近的城市满了就找其他城市，都没有则断补」。
 * 没有缺口的单位不申领，但**仍记一条 0 流量的"待机"补给边**，渲染层据此画出那条淡线
 * （路是通的、当前没在运货）。
 */
function distribute(world, faction, mainField) {
  const cfg = values.supply;
  const cities = world.cities.filter(city => city.faction === faction);
  const units = world.units.filter(unit => unit.state !== 'dead' && unit.faction === faction);
  const remaining = new Map(cities.map(city => [city.id, cfg.capacityPerCity]));
  /** @type {Map<number, number>} 本轮开始时每个单位的申领量，用来算"申领被满足了多少" */
  const claimed = new Map(units.map(unit => [unit.id, claimOf(unit)]));
  const need = new Map(claimed);
  let field = mainField;
  const active = new Set(cities.map(city => city.id));

  for (const unit of units) {
    unit.supplyEdges = [];
    unit.supplyCost = Infinity;
  }

  // 待机补给边 + 记录路径代价：在没有缺口的单位上先做一遍（用全部城市的主场算）
  for (const unit of units) {
    const cost = supplyCostAt(world, field, unit.x, unit.y);
    if (!Number.isFinite(cost)) continue;
    const city = world.cities[supplyOwnerAt(world, field, unit.x, unit.y)];
    if (!city || !active.has(city.id)) continue;
    unit.supplyCost = cost; // 到最近己方城市的代价（HUD 用）
    if (claimed.get(unit.id) > EPS) continue; // 有缺口的单位走正常分配
    unit.supplyEdges.push({
      cityId: city.id, cost, factor: supplyFactor(cost), points: 0, received: 0, standby: true,
    });
  }

  for (let pass = 0; pass <= cities.length; pass += 1) {
    // 候选：本轮还有缺口、且能把补给线拉到某座"还有点数的城"的单位
    const pending = [];
    for (const unit of units) {
      if (need.get(unit.id) <= EPS) continue;
      const cost = supplyCostAt(world, field, unit.x, unit.y);
      if (!Number.isFinite(cost)) continue;
      const city = world.cities[supplyOwnerAt(world, field, unit.x, unit.y)];
      if (!city || !active.has(city.id)) continue;
      pending.push({ unit, cost, city });
    }
    if (pending.length === 0) break;
    pending.sort((a, b) => (a.cost - b.cost) || (a.unit.id - b.unit.id)); // 代价相同按 id，保证确定性

    let exhausted = null;
    for (const entry of pending) {
      const left = need.get(entry.unit.id);
      if (left <= EPS) continue;
      const stock = remaining.get(entry.city.id);
      if (stock <= EPS) { exhausted = entry.city; break; }
      const factor = supplyFactor(entry.cost);
      const give = Math.min(left / factor, stock); // 城市要多掏 1/因子 才能把 need 送到单位手里
      const received = give * factor;
      need.set(entry.unit.id, Math.max(0, left - received));
      remaining.set(entry.city.id, stock - give);
      entry.unit.supplyEdges.push({
        cityId: entry.city.id, cost: entry.cost, factor, points: give, received,
      });
      world.citySupplyLoad.set(entry.city.id, (world.citySupplyLoad.get(entry.city.id) ?? 0) + give);
      if (stock - give <= EPS) { exhausted = entry.city; break; }
    }
    if (!exhausted) break; // 全员按当前可用城市结算完毕
    active.delete(exhausted.id);
    if (active.size === 0) break;
    const seeds = cities.filter(city => active.has(city.id));
    field = buildSupplyField(world, faction, scratchField(world), {
      cities: seeds, mask: world.supplyMasks[faction],
    });
  }

  for (const unit of units) {
    // 满足度 = 本轮"申领被满足了多少"（不是缺口覆盖率：一个 0 存量的单位一次只申领 1 点，
    // 拿到就是 100%，而它还需要好几轮才能补满——那由进货速率决定）。
    // 没有申领（存量已满 / 够不着）时视为满足：满额部队不该被标成"断补"。
    const want = claimed.get(unit.id);
    const ratio = want > EPS
      ? Math.max(0, Math.min(1, 1 - need.get(unit.id) / want))
      : 1;
    unit.supplyRatio = ratio;
    // supplied = **补给线是否可达**（有己方城市且路径够得着）：断线标记、"补给线已断"提示用它。
    // 注意与 supplyRatio 的区别：满额部队即使被包围也是 ratio=1（没有缺口），但 supplied=false（路断了）。
    unit.supplied = Number.isFinite(unit.supplyCost);
    // 进货速率（补给存量/秒）= 实收点数 ÷ 结算间隔 × 换算系数。
    // 补给线被切断 → 实收 0 → 不进货（但不会立刻掉血，部队先吃存量，见 supplyStock.js）
    const received = (unit.supplyEdges ?? []).reduce((sum, edge) => sum + edge.received, 0);
    unit.supplyIntake = (received / cfg.refreshSeconds) * cfg.stockPerPoint;
  }
}

// 2. 恢复：己方城市附近恢复生命（速率 = values.cities.recovery.hpPerSecond）
//    **多城不叠加**：判据是"是否落在任意一座己方城市的恢复半径内"（some → 布尔），
//    每 tick 只结算一次。压在 3 座城中间和贴着 1 座城，回血速率完全一样。
function recoverNearCity(world, dt) {
  const { radius, hpPerSecond } = values.cities.recovery;
  for (const unit of world.units) {
    if (unit.state === 'dead') continue;
    const nearCity = world.cities.some(city => city.faction === unit.faction
      && Math.hypot(city.x - unit.x, city.y - unit.y) <= radius);
    if (nearCity) unit.hp = Math.min(unit.maxHp, unit.hp + hpPerSecond * dt);
  }
}

// 3. 生产：已按配置关闭（values.cities.production.enabled = false）→ 城市不再产出单位。
//    开启时恢复旧行为：每 interval 秒产 1 个 unitType，补给满（本轮支出的吞吐点数用光）
//    或城市被围攻（敌方单位进入占领半径）时暂停，计时器保持满值、解除后立即生产（gdd.md §7）。
function produceUnits(world, dt) {
  if (!values.cities.production.enabled) return;
  for (const city of world.cities) {
    city.productionTimer += dt;
    if (city.productionTimer < values.cities.production.interval) continue;
    const load = world.citySupplyLoad.get(city.id) ?? 0;
    const contested = world.spatial.query(city.x, city.y, values.cities.capture.radius)
      .some(unit => unit.state !== 'dead' && unit.faction !== city.faction);
    if ((values.cities.production.pauseWhenSupplyFull && load >= values.supply.capacityPerCity) || contested) {
      city.productionTimer = values.cities.production.interval;
      continue;
    }
    city.productionTimer = 0;
    world.spawnUnit(city.faction, values.cities.production.unitType, city.x, city.y);
  }
}

// 4. 环境损耗：身处水域 hp −1/s（gdd.md §5）。与补给无关，站在水里就掉；
// 桥梁不算水域（地形码 bridge ≠ water），所以过桥不受影响。同样计入伤亡，可溺水阵亡。
// 注：**补给存量归零后的掉血**不在这里 —— 见 supplyStock.js 的 applyAttrition
//     （那里才有本 tick 最新的存量，且判定口径是"存量是否为 0"而不是"补给线是否被切断"）。
function applyWaterDamage(world, dt) {
  for (const unit of world.units) {
    if (unit.state === 'dead') continue;
    if (!world.terrain.isWaterAt(unit.x, unit.y)) continue;
    world.damageUnit(unit, values.terrain.waterHpPerSecond * dt);
    if (unit.hp <= 0) world.killUnit(unit, 'water');
  }
}
