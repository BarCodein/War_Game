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
    x,
    y,
    hp: stats.hp,
    maxHp: stats.hp,
    morale: values.morale.initial,
    radius: stats.radius,
    state: 'hold',       // hold | moving | combat | rout | dead
    command: null,       // 最近一次指令（commands.js 格式）
    route: [],           // 世界坐标路径点
    routeIndex: 0,       // 下一个目标路径点下标
    pathDirty: true,     // 路径变更标记（触发水域绕行检查）
    targetId: null,
    cooldown: 0,         // 攻击冷却剩余（s）
    underFire: false,    // 本 tick 是否被攻击（combat 置位，morale 消费）
    supplied: true,      // supply 系统每 tick 重算
    effects: { damageMultiplier: 1, speedMultiplier: 1 }, // morale 系统每 tick 重算
    stuckTime: 0,        // 溃逃被困累计（s）
    lastSeen: { blue: null, red: null }, // 敌方目视记录 { x, y, time }（fog 系统维护）
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
