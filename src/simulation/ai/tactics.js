import { values } from '../../config/index.js';
import { effectsFor, stockRatio } from '../systems/supplyStock.js';
import { capabilityRatio } from '../capability.js';
import { supplyPolicy, supplyScore } from './supply.js';

// 战术效用打分（docs/ai-design.md 阶段一 A）：把"该打谁"变成可解释的加权分数。
// 纯函数、不依赖 Phaser/DOM，可单测（tests/unit/ai-tactics.test.js）。
// 战力估算刻意复用真实伤害公式的成分（缺补倍率、血量衰减、地形修正），避免两套数值打架。

// 单位的基础战力：dps × 有效血量（有效血量按己方所在地形防御修正放大）
export function combatPower(unit, world) {
  if (!unit || unit.state === 'dead') return 0;
  const stats = values.units[unit.type];
  const defense = world?.terrain?.defenseModifierAt(unit.x, unit.y) ?? 1;
  const dps = (stats.damage / stats.attackInterval)
    * effectsFor(stockRatio(unit)).damageMultiplier
    * capabilityRatio(unit);
  return Math.max(0.01, dps * (unit.hp / Math.max(0.01, defense)));
}

// 某个点周围的双方战力（只算 radius 内的活单位）
export function localPower(world, x, y, faction, radius = values.ai.localForceRadius) {
  let friendly = 0;
  let enemy = 0;
  for (const other of world.spatial.query(x, y, radius)) {
    if (other.state === 'dead') continue;
    const power = combatPower(other, world);
    if (other.faction === faction) friendly += power;
    else enemy += power;
  }
  return { friendly, enemy };
}

// 局部兵力比：我方战力占比，0.5 = 势均力敌，> 0.5 我方占优（0~1）
// 公平模式传入 knowns 时，敌方一侧只用"看得见 + 记得住"的敌情估算（docs/ai-design.md 阶段三）
export function localBalance(world, unit, radius = values.ai.localForceRadius, knowns = null) {
  const { friendly, enemy: trueEnemy } = localPower(world, unit.x, unit.y, unit.faction, radius);
  let enemy = trueEnemy;
  if (knowns) {
    enemy = 0;
    for (const item of knowns) {
      if (Math.hypot(item.x - unit.x, item.y - unit.y) > radius) continue;
      enemy += estimatedPower(world, item);
    }
  }
  return friendly / Math.max(1e-6, friendly + enemy);
}

// 情报条目的战力估算：可见条目用真实单位，记忆条目按轻型基准 × 置信度折算（诚实近似）
export function estimatedPower(world, item) {
  if (item.unit) return combatPower(item.unit, world);
  const reference = {
    type: 'light',
    hp: values.units.light.hp,
    supplyStock: values.units.light.supplyStock,
    maxSupplyStock: values.units.light.supplyStock,
    x: item.x,
    y: item.y,
    state: 'hold',
    faction: item.faction,
  };
  return combatPower(reference, world) * (item.confidence ?? 1);
}

// 目标价值：指定歼灭单位 > 重型 > 据点守军 > 普通轻装（0~1）
export function targetValue(world, enemy) {
  if (enemy.objective) return 1;
  if (enemy.type === 'heavy') return 0.8;
  const standsOnPoint = (world.capturePoints ?? []).some(point => point.faction === enemy.faction
    && Math.hypot(point.x - enemy.x, point.y - enemy.y)
      <= (point.radius ?? values.capturePoints.capture.radius));
  if (standsOnPoint) return 0.7;
  return 0.5;
}

// 该目标是否处于溃逃/失序（承受伤害 ×values.combat.disorderedDamageTaken）
export function isVulnerable(enemy) {
  return enemy.state === 'rout' || enemy.state === 'unordered';
}

/**
 * 单个敌人的交战得分。因素全部归一化到 0~1 后加权（权重见 values.ai.weights）：
 *   威胁（局部兵力比）· 可击杀性（残血）· 距离 · 目标价值 · 易伤（溃逃/失序）· 追击 · 我方地形 · **补给**
 * 集中火力上限由调用方通过 ctx.targetCounts 提供：已达上限的目标直接跳过。
 */
export function scoreAttack(world, unit, enemy, ctx = {}) {
  // 权重与集火上限都从本局 cfg 读（关卡 ai.tuning 可覆盖 → presets.js 的 AI_TUNING_GROUPS）
  const w = ctx.cfg?.weights ?? values.ai.weights;
  const cap = (ctx.cfg?.squad ?? values.ai.squad).maxAttackersPerTarget;
  if ((ctx.targetCounts?.get(enemy.id) ?? 0) >= cap) return null;
  const policy = ctx.policy ?? supplyPolicy(ctx.cfg);
  const distance = Math.hypot(enemy.x - unit.x, enemy.y - unit.y);
  const near = 1 - Math.min(1, distance / (ctx.cfg?.engageRadius ?? values.ai.engageRadius));
  const vulnerable = isVulnerable(enemy);
  const terrainFactor = world.terrain.attackMultiplierAt(unit.x, unit.y); // 陆上 1 / 水里 0.5
  const score = w.threat * localBalance(world, unit, ctx.cfg?.localForceRadius ?? values.ai.localForceRadius, ctx.knowns ?? null)
    + w.kill * (1 - enemy.hp / Math.max(1, enemy.maxHp ?? values.units[enemy.type].hp))
    + w.distance * near
    + w.value * targetValue(world, enemy)
    + w.vulnerability * (vulnerable ? 1 : 0)
    + w.chase * (vulnerable ? near : 0)
    + w.terrain * terrainFactor
    // 补给：存量越足、战场越在补给可达区内越值得打（docs/ai-design.md §3.7）
    + w.supply * policy.weightScale * supplyScore(world, unit, enemy, policy);
  return { enemy, distance, vulnerable, score };
}

// 在候选敌人里挑一个：优先级 = 溃逃/失序目标（易伤，追击收益高）> 得分最高
export function chooseTarget(world, unit, enemies, ctx = {}) {
  let best = null;
  for (const enemy of enemies) {
    const scored = scoreAttack(world, unit, enemy, ctx);
    if (!scored) continue;
    if (!best) {
      best = scored;
      continue;
    }
    // 溃逃目标优先（在交战半径内时）；同类之间比分数
    const bestVulnerable = best.vulnerable;
    if (scored.vulnerable !== bestVulnerable) {
      if (scored.vulnerable) best = scored;
      continue;
    }
    if (scored.score > best.score) best = scored;
  }
  return best;
}

// 半径内的敌方单位（用空间网格，避免全量扫描）
export function enemiesWithin(world, unit, radius = values.ai.engageRadius) {
  const found = [];
  for (const other of world.spatial.query(unit.x, unit.y, radius)) {
    if (other.state === 'dead' || other.faction === unit.faction) continue;
    if (Math.hypot(other.x - unit.x, other.y - unit.y) > radius) continue;
    found.push(other);
  }
  return found;
}
