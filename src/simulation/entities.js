import { values } from '../config/index.js';

// 实体工厂：返回纯数据对象（可序列化，渲染层不持有实体类）。
// 类型参数一律取自 config（values.units），实体只存实例值（architecture.md §6）。

export function makeUnit({ id, faction, type, x, y }) {
  const stats = values.units[type];
  if (!stats) throw new Error(`[entities] unknown unit type: ${type}`);
  return {
    id,
    faction,
    type,
    group: null,         // 编队标签（关卡 forces[].group / AI spawn.group 写入）：脚本只指挥同组单位
    x,
    y,
    hp: stats.hp,
    maxHp: stats.hp,
    supplyStock: stats.supplyStock,     // 补给存量（gdd.md §6）：战斗/行军消耗、补给线进货；归零 = 断补
    maxSupplyStock: stats.supplyStock,  // 存量上限（按兵种，values.units.*.supplyStock）
    radius: stats.radius,
    state: 'hold',       // hold | moving | combat | rout | dead | unordered
    command: null,       // 最近一次指令（commands.js 格式）
    forcedMarch: false,  // 急行军（命令带 forced: true）：提速 1.5×（水域除外），补给 -10/s、每秒掉 1.5 血
    route: [],           // 世界坐标路径点
    routeIndex: 0,       // 下一个目标路径点下标
    pathDirty: true,     // 路径变更标记（触发水域绕行检查）
    pendingQueue: [],    // Shift 追加的待执行路径段
    targetId: null,
    cooldown: 0,         // 攻击冷却剩余（s）
    underFire: false,    // 本 tick 是否被攻击（combat 置位，supplyStock 消费）
    supplied: true,      // supply 系统每 refreshSeconds 重算：实收 ≥ 需求（补给线通畅）
    supplyRatio: 1,      // 实收 ÷ 需求（0..1）：决定每小时进货量，也是补给线粗细的依据
    supplyIntake: 0,     // 每秒进货的补给存量（实收点数 ÷ 结算间隔 × supply.stockPerPoint）
    supplyEdges: [],     // 本轮的补给线 [{ cityId, cost, factor, points, received }]，按代价升序（渲染/HUD 用）
    supplyCost: Infinity, // 到最近己方城市的路径代价（等效像素；无路可达 = Infinity）
    effects: { damageMultiplier: 1, speedMultiplier: 1 }, // supplyStock 系统每 tick 重算
    stuckTime: 0,        // 溃逃被困累计（s）
    rerouteAttempts: 0,  // 当前路径连续重规划次数
    lastMoveX: x,
    lastMoveY: y,
    lastSeen: { blue: null, red: null }, // 敌方目视记录 { x, y, time }（fog 系统维护）
    // 编队目标标记（关卡 forces[].objective，由 deployForces 写入）：
    // 'annihilate' = 该单位是歼灭胜负条件的「指定单位」
    objective: null,
    deadAt: null,
  };
}

export function makeCity({ id, x, y, faction }) {
  return {
    id,
    x,
    y,
    faction,
    captureProgress: 0, // 0..100（由敌方单位积累）
    productionTimer: 0,
  };
}

// 占领点：可被占领（中立起点，或初始归某方）。
// 与城市的关键区别：被占领后**仅提供视野**——不提供补给容量、不补给存量、
// 不生产、不恢复，也不计入胜负（gdd.md §7.1）。因此没有 productionTimer 字段。
export function makeCapturePoint({ id, x, y, faction }) {
  return {
    id,
    x,
    y,
    faction,            // 'neutral' | 'blue' | 'red'
    captureProgress: 0, // 0..100（由在场单位积累）
  };
}
