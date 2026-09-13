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

  for (const point of world.capturePoints) updatePointCapture(world, point, dt);
}

// 占领点占领（gdd.md §7.1）：速率沿用城市规则，但支持中立起点，判定更严格：
// - 守方（属于该点的阵营）在场 → 冻结；
// - 无任何单位在场 → 进度按 decayPerSecond 衰减；
// - 在场单位分属多个阵营 → 争夺冻结（避免中立点上"谁先被遍历到谁占"的歧义）；
// - 仅一个阵营在场 → 该阵营积累进度，满 100% 易主。
function updatePointCapture(world, point, dt) {
  const cfg = values.capturePoints.capture;
  const nearby = world.spatial.query(point.x, point.y, cfg.radius)
    .filter(unit => unit.state !== 'dead');
  if (nearby.some(unit => unit.faction === point.faction)) return; // 守方在场：冻结
  const factions = new Set(nearby.map(unit => unit.faction));
  if (factions.size === 0) {
    point.captureProgress = Math.max(0, point.captureProgress - cfg.decayPerSecond * 100 * dt);
    return;
  }
  if (factions.size > 1) return; // 多阵营争夺：冻结
  const faction = [...factions][0];
  const rate = Math.min(cfg.capPerSecond, nearby.length * cfg.perUnitPerSecond);
  point.captureProgress += rate * 100 * dt;
  if (point.captureProgress >= 100) {
    point.faction = faction;
    point.captureProgress = 0;
    world.events.push({ type: 'capturePointCaptured', pointId: point.id, faction, at: world.time });
  }
}
