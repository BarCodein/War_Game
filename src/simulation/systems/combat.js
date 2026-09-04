import { values } from '../../config/index.js';
import { effectsFor } from './morale.js';

// 战斗系统（gdd.md §4）：敌对单位进入攻击距离后自动攻击；
// 目标选择：优先当前目标直至死亡，否则取攻击距离内最近（config.combat.targetPriority）；
// 伤害 = 基础伤害 × 士气削弱 × 防御者地形修正；每单位独立攻击冷却，首次接触立即攻击。
// 例外（bugfix）：正在执行 move（行军）命令的单位不被自动交战锁定——
// 可沿命令脱离战斗后撤；attackMove/attack/hold 仍按原规则接敌停下交战。
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
    if (hasMarchOrder(unit)) {
      // 行军命令途中：自动交战不锁定，单位继续前进（可后撤脱离战斗）
      unit.targetId = null;
      unit.state = 'moving';
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

function resolveTarget(world, unit) {
  const range = values.units[unit.type].range;
  const candidates = world.spatial.query(unit.x, unit.y, range);
  const enemies = candidates.filter(candidate =>
    candidate.state !== 'dead'
    && candidate.faction !== unit.faction
    && Math.hypot(candidate.x - unit.x, candidate.y - unit.y) <= range);
  if (enemies.length === 0) return null;
  const current = enemies.find(enemy => enemy.id === unit.targetId);
  if (current) return current;
  return enemies.reduce((nearest, enemy) =>
    Math.hypot(enemy.x - unit.x, enemy.y - unit.y) < Math.hypot(nearest.x - unit.x, nearest.y - unit.y) ? enemy : nearest);
}

// 是否处于执行中的行军（move）命令：命令有效且仍有未走完的路径点。
function hasMarchOrder(unit) {
  return unit.command?.type === 'move' && unit.routeIndex < unit.route.length;
}
