import { values } from '../../config/index.js';
import {
  buildBlockedMask, buildSupplyField, createSupplyField, supplyCostAt, supplyFactor, supplyGrid, supplyOwnerAt,
} from '../supplyPath.js';

// 补给与城市维护（gdd.md §7；损耗见 §5）：
// 1. 每 refreshSeconds 重算一次补给分配：单位 → 己方城市的最短路径（地形加权、
//    不穿敌方实际控制区）→ 城市按「离自己最近的单位优先」支出吞吐点数 →
//    单位实收 = 支出点数 × 距离因子；缺多少按缺口比例吃损耗（见 supplyPath.js 顶部说明）；
// 2. 己方城市附近恢复生命（+3/s）；
// 3. 城市生产：当前关闭（values.cities.production.enabled = false）；
// 4. 缺补给单位按缺口比例损耗 hp（完全断补 = 1/s；士气修正由 morale 系统读 supplyRatio）；
// 5. 环境损耗：身处水域的单位 hp −1/s（可溺水阵亡）。
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
  applyAttrition(world, dt);
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

// 没有任何己方城市：全员断补（实收 0）
function clearFaction(world, faction) {
  for (const unit of world.units) {
    if (unit.faction !== faction) continue;
    unit.supplied = false;
    unit.supplyRatio = 0;
    unit.supplyEdges = [];
    unit.supplyCost = Infinity;
  }
}

/**
 * 分配：把所有仍需补给的己方单位按「到最近可用城市的代价」升序排序，逐个支出城市点数。
 * 城市点数用光就把它剔出种子、重算代价场（于是每个单位自动落到下一座最近的城），
 * 直到全员满足或没有城可用——这就是「最近的城市满了就找其他城市，都没有则断补」。
 */
function distribute(world, faction, mainField) {
  const cfg = values.supply;
  const cities = world.cities.filter(city => city.faction === faction);
  const units = world.units.filter(unit => unit.state !== 'dead' && unit.faction === faction);
  const remaining = new Map(cities.map(city => [city.id, cfg.capacityPerCity]));
  const need = new Map(units.map(unit => [unit.id, cfg.demandPerUnit]));
  for (const unit of units) {
    unit.supplyEdges = [];
    unit.supplyCost = Infinity;
  }

  let field = mainField;
  const active = new Set(cities.map(city => city.id));

  for (let pass = 0; pass <= cities.length; pass += 1) {
    // 候选：本轮还得补、且能把补给线拉到某座"还有点数的城"的单位
    const pending = [];
    for (const unit of units) {
      if (need.get(unit.id) <= EPS) continue;
      const cost = supplyCostAt(world, field, unit.x, unit.y);
      if (!Number.isFinite(cost)) continue;
      const city = world.cities[supplyOwnerAt(world, field, unit.x, unit.y)];
      if (!city || !active.has(city.id)) continue;
      if (unit.supplyCost === Infinity) unit.supplyCost = cost; // 到最近己方城市的代价（HUD 用）
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
    const ratio = cfg.demandPerUnit > 0
      ? Math.max(0, Math.min(1, 1 - need.get(unit.id) / cfg.demandPerUnit))
      : 1;
    unit.supplyRatio = ratio;
    unit.supplied = ratio >= 1 - 1e-6; // 满补给（浮点留一点余量，避免"理论上刚好够"被判成断补）
  }
}

// 2. 恢复：己方城市附近生命 +3/s
function recoverNearCity(world, dt) {
  for (const unit of world.units) {
    if (unit.state === 'dead') continue;
    const nearCity = world.cities.some(city => city.faction === unit.faction
      && Math.hypot(city.x - unit.x, city.y - unit.y) <= values.cities.recovery.radius);
    if (nearCity) unit.hp = Math.min(unit.maxHp, unit.hp + values.cities.recovery.hpPerSecond * dt);
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

// 4. 损耗：按缺口比例扣血（实收 60% → 只吃 40% 的损耗；完全断补 = attritionHpPerSecond）。
//    非战斗减员同样计入伤亡：1 点损失的血量 = 1 点伤亡。
function applyAttrition(world, dt) {
  for (const unit of world.units) {
    if (unit.state === 'dead') continue;
    const deficit = 1 - (unit.supplyRatio ?? 1);
    if (deficit <= EPS) continue;
    world.damageUnit(unit, values.supply.attritionHpPerSecond * deficit * dt);
    if (unit.hp <= 0) world.killUnit(unit, 'attrition');
  }
}

// 5. 环境损耗：身处水域 hp −1/s（gdd.md §5）。与补给无关，站在水里就掉；
// 桥梁不算水域（地形码 bridge ≠ water），所以过桥不受影响。同样计入伤亡，可溺水阵亡。
function applyWaterDamage(world, dt) {
  for (const unit of world.units) {
    if (unit.state === 'dead') continue;
    if (!world.terrain.isWaterAt(unit.x, unit.y)) continue;
    world.damageUnit(unit, values.terrain.waterHpPerSecond * dt);
    if (unit.hp <= 0) world.killUnit(unit, 'water');
  }
}
