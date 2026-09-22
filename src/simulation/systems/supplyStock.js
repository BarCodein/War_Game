import { values } from '../../config/index.js';
import { capabilityRatio } from '../capability.js';

// 补给存量系统（gdd.md §6）：这套机制原本是士气，**数值含义现在是「单位剩余的补给存量」**
// （上限按兵种，见 values.units.*.supplyStock；出击时带满）。
//
// 存量只有两个来源/去向：
//   · **进货**：接入补给系统 —— 城市运力 × 距离因子算出的实收点数，按 supply.stockPerPoint
//     换算成存量（`unit.supplyIntake`，由 supply.js 每轮结算写入）。补给线被切断就完全不进货。
//   · **消耗**：基础口粮（-1/s，站着也要吃）、交战（-8/s，参战未被瞄准 -3/s）、
//     行军（-5/s，道路 ×0.5）、急行军（-10/s 取代行军值）；有路线（进攻）时交战/行军项再乘 attack 因子 1.3。
//     **交战项还要乘「战斗力系数」**（血量口径，capability.js）：同一状态下伤得越重、消耗越少，
//     与伤害公式共用同一个函数与阈值（combat.hp_dps_ratio）；口粮/行军/急行军不乘。
// 不再有任何"凭空涨落"：友军密度、城市范围、友军阵亡这些士气项都已删除。
//
// 机制本身完全保留：
//   · 阈值削弱：存量 < 60% 上限 → 缺补（伤害 ×0.75、速度 ×0.85）；< 30% → 将尽（×0.5 / ×0.7）；
//   · 归零：正被攻击 → 溃逃（撤向己方城市，无城可退即投降）；未受攻击 → 失序原地；
//   · 溃逃/失序时无条件下就地搜集：+8/s、+10/s，恢复到 stopAt 停止。
// 另外：**存量归零才掉血**（supply.attritionHpPerSecond），补给线被切断本身不掉血——
// 部队靠存量继续打，撑多久取决于还剩多少补给。
export function updateSupplyStock(world, dt) {
  for (const unit of world.units) {
    if (unit.state === 'dead') continue;
    if (unit.state === 'rout') {
      routRecovery(unit, dt);
      continue;
    }
    if (unit.state === 'unordered') {
      unorderedRecovery(world, unit, dt);
      continue;
    }
    consume(world, unit, dt);
    applyEffects(unit);
  }
  applyAttrition(world, dt);
}

// 进货 − 消耗；归零时按状态进入溃逃/失序
function consume(world, unit, dt) {
  const cfg = values.supplyStock;
  // 进货（来自补给系统，断补时为 0）+ **基础口粮**（驻军也要吃饭，与交战/行军消耗叠加）
  let rate = (unit.supplyIntake ?? 0) + cfg.perSecond.idle;
  const mode = (unit.route.length === 0) ? 1 : cfg.perSecond.attack; // 防守 / 进攻
  // 战斗力系数（血量口径，gdd.md §6）：**只乘交战项**——同一状态下，伤得越重、战斗力越弱，
  // 交战消耗也按同一条曲线变小（与伤害公式共用 capability.js 的 capabilityRatio，
  // 阈值就是 combat.hp_dps_ratio：血量 ≥80% 上限时系数 = 1，与旧行为完全一致）。
  // 基础口粮、行军、急行军、进货、溃逃/失序的就地搜集都不吃这个系数。
  const power = capabilityRatio(unit);

  if (unit.underFire) {
    // 正被敌方瞄准：全额交战消耗（再乘上面的战斗力系数）
    rate += cfg.perSecond.inCombat * mode * power;
  } else if (unit.state === 'combat') {
    // 参战但当前没被瞄准（例如两个单位打同一个敌人时，只有前排被还击）：消耗少一些
    rate += cfg.perSecond.inCombatSupport * mode * power;
  }
  if (unit.state === 'moving') {
    // 行军消耗；急行军用更大的固定值替换普通行军值，两者都乘地形系数（道路 0.5）
    const marchCost = unit.forcedMarch
      ? values.movement.forcedMarch.supplyPerSecond
      : cfg.perSecond.moving;
    rate += marchCost * world.terrain.marchSupplyMultiplierAt(unit.x, unit.y);
  }

  unit.supplyStock = clamp(unit, unit.supplyStock + rate * dt);
  if (unit.supplyStock > cfg.thresholds.routAt) return;
  if (unit.underFire) enterRout(world, unit); // 存量耗尽且正被攻击 → 溃逃
  else enterUnordered(unit);                  // 否则原地失序
}

// 存量不随任何指令改变时也要扣：归零后每秒掉血（走 damageUnit 计入伤亡）
function applyAttrition(world, dt) {
  for (const unit of world.units) {
    if (unit.state === 'dead' || unit.supplyStock > 0) continue;
    world.damageUnit(unit, values.supply.attritionHpPerSecond * dt);
    if (unit.hp <= 0) world.killUnit(unit, 'attrition');
  }
}

// 放弃当前行程（溃逃/失序时不再执行命令）
function clearOrders(unit) {
  unit.route = [];
  unit.routeIndex = 0;
  unit.targetId = null;
  unit.command = null;
  unit.stuckTime = 0;
  unit.pathDirty = true;
}

function enterUnordered(unit) {
  unit.state = 'unordered';
}

function enterRout(world, unit) {
  unit.state = 'rout';
  unit.lockedTargetId = null;
  clearOrders(unit);
  if (!world.nearestOwnCity(unit)) world.killUnit(unit, 'surrender'); // 无城可退立即投降
}

// 失序：+10/s 就地搜集；被攻击立即转为溃逃
function unorderedRecovery(world, unit, dt) {
  if (unit.underFire) enterRout(world, unit);
  const cfg = values.supplyStock;
  unit.supplyStock = clamp(unit, unit.supplyStock + cfg.unordered.recoverPerSecond * dt);
  if (unit.supplyStock >= cfg.unordered.stopAt) {
    unit.state = unit.route.length === 0 ? 'hold' : 'moving';
    applyEffects(unit);
  }
}

// 溃逃：+8/s 就地搜集，**受击时先扣交战消耗**（-8/s，净值 ≈ 0：一边搜集一边挨打）；
// 恢复到 stopAt 停止溃逃（gdd.md §6）。
// 受击扣除的仍是**交战项**，所以同样乘战斗力系数：溃逃的部队多半已经残血，
// 挨打时掉的补给也按同一条曲线变少（与 consume 里的交战项一致，不搞两套口径）。
function routRecovery(unit, dt) {
  const cfg = values.supplyStock;
  const combatPenalty = unit.underFire ? cfg.perSecond.inCombat * capabilityRatio(unit) : 0; // 本身已是负数
  unit.supplyStock = clamp(unit, unit.supplyStock + (cfg.rout.recoverPerSecond + combatPenalty) * dt);
  if (unit.supplyStock >= cfg.rout.stopAt) {
    unit.state = 'hold';
    unit.route = [];
    unit.routeIndex = 0;
    unit.stuckTime = 0;
    applyEffects(unit);
  }
}

/**
 * 阈值效果：缺补（削弱）/ 将尽（动摇）。入参是**存量比例**（存量 ÷ 上限），
 * 因为各兵种上限不同；由 combat / movement / AI 每 tick 实时调用（避免跨系统延迟），
 * unit.effects 同时写入供 HUD 展示。
 */
export function effectsFor(ratio) {
  const t = values.supplyStock.thresholds;
  if (ratio < t.shakenBelow) return values.supplyStock.effects.shaken;
  if (ratio < t.weakenedBelow) return values.supplyStock.effects.weakened;
  return { damageMultiplier: 1, speedMultiplier: 1 };
}

/** 单位的存量比例（0..1）——阈值与 AI 判定统一用这个口径。 */
export function stockRatio(unit) {
  return unit.maxSupplyStock > 0 ? unit.supplyStock / unit.maxSupplyStock : 0;
}

function applyEffects(unit) {
  unit.effects = effectsFor(stockRatio(unit));
}

function clamp(unit, value) {
  return Math.min(unit.maxSupplyStock, Math.max(values.supplyStock.min, value));
}
