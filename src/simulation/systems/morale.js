import { values } from '../../config/index.js';

// 士气系统（gdd.md §6）：每秒修正（友军/城市/补给/交战/阵亡事件）、
// 阈值削弱效果、归零溃逃 → 恢复或投降移除。
export function updateMorale(world, dt) {
  applyDeathShock(world);
  for (const unit of world.units) {
    if (unit.state === 'dead') continue;
    if (unit.state === 'rout') {
      routRecovery(unit, dt);
      continue;
    }
    if (unit.morale <= values.morale.thresholds.routAt) { // 归零即溃逃（gdd.md §6）
      enterRout(world, unit);
      continue;
    }
    applyModifiers(world, unit, dt);
    applyEffects(unit);
  }
}

// 友军阵亡瞬间 −10（≤ ranges.allyDeath）
function applyDeathShock(world) {
  for (const event of world.events) {
    if (event.type !== 'unitDied') continue;
    for (const unit of world.units) {
      if (unit.state === 'dead' || unit.faction !== event.faction) continue;
      if (Math.hypot(unit.x - event.x, unit.y - event.y) <= values.morale.ranges.allyDeath) {
        unit.morale = clamp(unit.morale + values.morale.onAllyDeath);
      }
    }
  }
}

function applyModifiers(world, unit, dt) {
  const m = values.morale;
  let rate = 0;
  if (hasFriendlyNearby(world, unit)) rate += m.perSecond.friendlyNearby;
  if (nearOwnCity(world, unit, m.ranges.city)) {
    rate += m.perSecond.cityNearby + values.cities.recovery.moralePerSecond; // 城市士气修正 + 城市恢复（gdd.md §6、§7）
  }
  rate += unit.supplied ? m.perSecond.supplied : m.perSecond.unsupplied;
  if (unit.underFire) rate += m.perSecond.inCombat;
  unit.morale = clamp(unit.morale + rate * dt);
  if (unit.morale <= m.thresholds.routAt) enterRout(world, unit);
}

function enterRout(world, unit) {
  unit.state = 'rout';
  unit.route = [];
  unit.routeIndex = 0;
  unit.targetId = null;
  unit.command = null;
  unit.stuckTime = 0;
  unit.pathDirty = true;
  if (!world.nearestOwnCity(unit)) world.killUnit(unit, 'surrender'); // 无城可退立即投降
}

// 溃逃恢复：+8/s，受击 −3/s 仍生效；恢复至 stopAt 停止溃逃（gdd.md §6）
function routRecovery(unit, dt) {
  const m = values.morale;
  const combatPenalty = unit.underFire ? -m.perSecond.inCombat : 0;
  unit.morale = clamp(unit.morale + (m.rout.recoverPerSecond + combatPenalty) * dt);
  if (unit.morale >= m.rout.stopAt) {
    unit.state = 'hold';
    unit.route = [];
    unit.routeIndex = 0;
    unit.stuckTime = 0;
    applyEffects(unit);
  }
}

// 阈值效果：削弱 / 动摇。由士气值即时推导（combat/movement 每 tick 调用），
// 避免跨系统顺序带来的延迟；unit.effects 同时写入供 HUD 展示。
export function effectsFor(morale) {
  const t = values.morale.thresholds;
  if (morale < t.shakenBelow) return values.morale.effects.shaken;
  if (morale < t.weakenedBelow) return values.morale.effects.weakened;
  return { damageMultiplier: 1, speedMultiplier: 1 };
}

function applyEffects(unit) {
  unit.effects = effectsFor(unit.morale);
}

function hasFriendlyNearby(world, unit) {
  return world.spatial.query(unit.x, unit.y, values.morale.ranges.friendly)
    .some(other => other !== unit && other.state !== 'dead' && other.faction === unit.faction);
}

function nearOwnCity(world, unit, radius) {
  return world.cities.some(city => city.faction === unit.faction
    && Math.hypot(city.x - unit.x, city.y - unit.y) <= radius);
}

function clamp(value) {
  return Math.min(values.morale.max, Math.max(values.morale.min, value));
}
