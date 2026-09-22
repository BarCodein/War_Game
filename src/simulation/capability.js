import { values } from '../config/index.js';

// 战斗力系数（血量口径）——「血量 ↔ 能力」的**唯一**函数（gdd.md §4、§6）。
//
//   系数 = clamp(血量 ÷ 血量上限 ÷ combat.hp_dps_ratio, 0, 1)
//
// 血量 ≥ `hp_dps_ratio`（0.8）× 上限 → 1（满战斗力，封顶不再增长）；
// 低于它按血量比例线性下降，血量见底趋近 0（并且夹在 0：damageUnit 允许 hp 短暂为负，
// 负血量绝不能算出负消耗——那会变成"越挨打越涨补给"）。
// 这就是兰切斯特定律下"部队越打越弱"的那条曲线，并考虑有预备队，所以在 80% 处封顶。
//
// 为什么要单独一个模块：战斗伤害（systems/combat.js）与**交战补给消耗**（systems/supplyStock.js）
// 走的是同一条「伤得越重、能力越弱」的曲线——残血部队打不动，也就不那么吃补给。
// 两处复用同一个函数、同一个阈值，改 `combat.hp_dps_ratio` 时两边一起变，不会各写一套。
// AI 的战力估算（ai/tactics.js 的 combatPower）也读它，保持"打分用的战力"与真实伤害一致。
export function capabilityRatio(unit) {
  const maxHp = unit.maxHp ?? values.units[unit.type]?.hp ?? 0;
  if (!(maxHp > 0)) return 0;
  return Math.max(0, Math.min(unit.hp / maxHp / values.combat.hp_dps_ratio, 1));
}
