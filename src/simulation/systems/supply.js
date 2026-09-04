import { values } from '../../config/index.js';

// 补给与城市维护（gdd.md §7、§8）：
// 1. 每单位就近分配到一座己方城市，每城容量 5，超出者补给不足；
// 2. 己方城市附近恢复生命（+3/s）；
// 3. 城市自动生产（12s/轻型，补给容量满时暂停）；
// 4. 补给不足单位损耗（hp −1/s，士气修正由 morale 系统读取 supplied 标记）。
export function updateSupply(world, dt) {
  // 1. 分配
  const claimants = new Map(); // cityId → [{ unit, dist }]
  for (const city of world.cities) claimants.set(city.id, []);
  for (const unit of world.units) {
    if (unit.state === 'dead') continue;
    unit.supplied = false;
    const nearest = world.nearestOwnCity(unit);
    if (nearest) {
      claimants.get(nearest.id).push({ unit, dist: Math.hypot(unit.x - nearest.x, unit.y - nearest.y) });
    }
  }
  for (const list of claimants.values()) {
    list.sort((a, b) => a.dist - b.dist);
    list.forEach((entry, index) => {
      entry.unit.supplied = index < values.supply.capacityPerCity;
    });
  }

  // 2. 恢复：己方城市附近生命 +3/s
  for (const unit of world.units) {
    if (unit.state === 'dead') continue;
    const nearCity = world.cities.some(city => city.faction === unit.faction
      && Math.hypot(city.x - unit.x, city.y - unit.y) <= values.cities.recovery.radius);
    if (nearCity) unit.hp = Math.min(unit.maxHp, unit.hp + values.cities.recovery.hpPerSecond * dt);
  }

  // 3. 生产：每 12s 一个轻型单位；补给满或城市被围攻（敌方单位进入占领半径）时暂停。
  //    被围暂停保证攻城战可决出胜负（gdd.md §7）；计时器保持满值，解除后立即生产。
  for (const city of world.cities) {
    city.productionTimer += dt;
    if (city.productionTimer < values.cities.production.interval) continue;
    const assigned = (claimants.get(city.id) ?? []).length;
    const contested = world.spatial.query(city.x, city.y, values.cities.capture.radius)
      .some(unit => unit.state !== 'dead' && unit.faction !== city.faction);
    if ((values.cities.production.pauseWhenSupplyFull && assigned >= values.supply.capacityPerCity) || contested) {
      city.productionTimer = values.cities.production.interval;
      continue;
    }
    city.productionTimer = 0;
    world.spawnUnit(city.faction, values.cities.production.unitType, city.x, city.y);
  }

  // 4. 损耗：补给不足 hp −1/s
  for (const unit of world.units) {
    if (unit.state === 'dead' || unit.supplied) continue;
    unit.hp -= values.supply.attritionHpPerSecond * dt;
    if (unit.hp <= 0) world.killUnit(unit, 'attrition');
  }
}
