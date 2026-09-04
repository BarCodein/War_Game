import { values } from '../../config/index.js';

// 城市占领（gdd.md §7）：每单位 5%/s、上限 15%/s；
// 守方单位在场时进度冻结；攻方全部离开后 3%/s 衰减；达到 100% 城市易主。
export function updateCapture(world, dt) {
  for (const city of world.cities) {
    const nearby = world.spatial.query(city.x, city.y, values.cities.capture.radius);
    const attackers = nearby.filter(unit => unit.state !== 'dead' && unit.faction !== city.faction);
    if (attackers.length === 0) {
      city.captureProgress = Math.max(0, city.captureProgress - values.cities.capture.decayPerSecond * 100 * dt);
      continue;
    }
    const defenders = nearby.filter(unit => unit.state !== 'dead' && unit.faction === city.faction);
    if (defenders.length > 0) continue; // 争夺冻结
    const rate = Math.min(
      values.cities.capture.capPerSecond,
      attackers.length * values.cities.capture.perUnitPerSecond,
    );
    city.captureProgress += rate * 100 * dt;
    if (city.captureProgress >= 100) {
      city.faction = attackers[0].faction;
      city.captureProgress = 0;
      world.events.push({ type: 'cityCaptured', cityId: city.id, faction: city.faction, at: world.time });
    }
  }
}
