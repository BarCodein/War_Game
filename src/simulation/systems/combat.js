import { values } from '../../config/index.js';
import { effectsFor } from './morale.js';

// 战斗系统（gdd.md §4）：敌我单位足够接近（圆点接触）后自动交战；
// 目标选择：优先当前目标直至死亡，否则取接触范围内最近（config.combat.targetPriority）；
// 伤害 = 基础伤害 × 士气削弱 × 防御者地形修正；每单位独立攻击冷却，首次接触立即攻击。
// 统一为「攻击前进」（attack-forward）：move 与 attackMove 都沿预定路线行军，
// 途中接触敌军即停下交战，敌军离开/清空后恢复行军（见 gdd.md §4）。
export function updateCombat(world, dt) {
  for (const unit of world.units) {
    if (unit.state !== 'dead') unit.underFire = false;
    unit.cooldown = Math.max(0, unit.cooldown - dt);
  }
  for (const unit of world.units) {
    if (unit.state === 'dead' || unit.state === 'rout') continue; // 溃逃单位不攻击
    const enemy = resolveTarget(world, unit);
    if (!enemy) {
      unit.targetId = null;
      unit.state = unit.route.length > 0 ? 'moving' : 'hold';
      continue;
    }
    unit.state = 'combat';
    unit.targetId = enemy.id;
    enemy.underFire = true; // 交战中持续生效（morale 每秒修正，gdd.md §6）
    if (unit.cooldown > 0) continue;
    const stats = values.units[unit.type];
    const effects = effectsFor(unit.morale);
    const damage = stats.damage * effects.damageMultiplier * world.terrain.defenseModifierAt(enemy.x, enemy.y);
    enemy.hp -= damage;
    unit.cooldown = stats.attackInterval;
    if (enemy.hp <= 0) world.killUnit(enemy, 'combat');
  }
}

// 交战目标：仅与「视觉上接触」的敌军交战——距离 ≤ 双方半径和 + contactTolerance。
// 相比按攻击距离（range）判定更严格，保证「图像上显示接触」才开打。
function resolveTarget(world, unit) {
  const maxRadius = values.units.heavy.radius; // 敌方最大半径（用于查询范围）
  const tolerance = values.combat.contactTolerance;
  const reach = unit.radius + maxRadius + tolerance;
  const candidates = world.spatial.query(unit.x, unit.y, reach);
  const enemies = candidates.filter(candidate =>
    candidate.state !== 'dead'
    && candidate.faction !== unit.faction
    && Math.hypot(candidate.x - unit.x, candidate.y - unit.y) <= unit.radius + candidate.radius + tolerance);
  if (enemies.length === 0) return null;
  const current = enemies.find(enemy => enemy.id === unit.targetId);
  if (current) return current;
  return enemies.reduce((nearest, enemy) =>
    Math.hypot(enemy.x - unit.x, enemy.y - unit.y) < Math.hypot(nearest.x - unit.x, nearest.y - unit.y) ? enemy : nearest);
}
