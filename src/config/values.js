// 全部游戏数值的唯一权威来源。
// gdd.md §12 的数值总表是本文件的镜像；两者一致性由 Vitest 同步测试守护（architecture.md §9）。
// 任何模块禁止硬编码数值——新增或调整数值先改这里。所有数值状态均为「暂定」。

export const values = {
  simulation: {
    fixedStep: 1 / 60,        // 固定模拟步长（s）
    maxCatchUpTicks: 5,       // 每帧最多补算的 tick 数
    speeds: [0.5, 1, 2],      // 游戏速度档位
  },

  units: {
    light: { hp: 60, damage: 8, attackInterval: 1.0, range: 40, speed: 90, radius: 10, vision: 140 },
    heavy: { hp: 120, damage: 16, attackInterval: 1.6, range: 55, speed: 55, radius: 14, vision: 160 },
  },

  combat: {
    firstStrikeImmediate: true,        // 首次接触立即攻击
    targetPriority: 'currentUntilDead', // 优先当前目标直至死亡，否则取最近（暂定）
  },

  terrain: {
    gridCellSize: 20,                  // 逻辑网格边长（px）
    codes: { plain: 0, forest: 1, water: 2, bridge: 3 },
    passable: { plain: true, forest: true, water: false, bridge: true },
    moveMultiplier: { plain: 1.0, forest: 0.6, bridge: 1.0 },
    defenseModifier: { plain: 1.0, forest: 0.85, bridge: 0.9 }, // 防御者地形修正
  },

  morale: {
    initial: 80, min: 0, max: 100,
    perSecond: {
      friendlyNearby: 2,  // 附近友军（≤ ranges.friendly）
      cityNearby: 5,      // 附近己方城市（≤ ranges.city）
      supplied: 1,
      unsupplied: -2,
      inCombat: -1, // 持续交战的士气损耗（过低会使围攻不可行，见 gdd.md §6）
    },
    ranges: { friendly: 60, city: 120, allyDeath: 100 },
    onAllyDeath: -10,     // 附近友军阵亡瞬间
    thresholds: { weakenedBelow: 60, shakenBelow: 30, routAt: 0 },
    effects: {
      weakened: { damageMultiplier: 0.75, speedMultiplier: 0.85 },
      shaken: { damageMultiplier: 0.5, speedMultiplier: 0.7 },
    },
    rout: { recoverPerSecond: 8, stopAt: 20, stuckSeconds: 5 },
  },

  cities: {
    capture: { radius: 60, perUnitPerSecond: 0.05, capPerSecond: 0.15, decayPerSecond: 0.03 },
    production: { interval: 12, unitType: 'light', pauseWhenSupplyFull: true },
    recovery: { radius: 120, hpPerSecond: 3, moralePerSecond: 5 },
    vision: 180,
  },

  supply: {
    capacityPerCity: 5,
    attritionHpPerSecond: 1,
    attritionMoralePerSecond: 2,
  },

  fog: {
    forestSpotDistance: 60, // 森林中的敌军仅在此距离内可见
    showLastKnownGhost: true,
  },

  spatial: { cellSize: 64 }, // 均匀网格（≥ 最大攻击距离）

  performance: {
    targetFps: 60,
    targetUnits: 500,
    simTickBudgetMs: 8,
    renderBudgetMs: 8,
    hudRefreshMs: 100,      // HUD 更新节流（ms）
  },

  input: {
    clickHitRadius: 25,
    dragBoxThreshold: 8,
    routeSampleDistance: 8, // 轨迹采样间距
    routeMinLength: 4,      // 轨迹末端最小追加距离
    routeUnitOffset: 18,    // 多单位轨迹错开间距
  },

  ui: {
    toastDurationMs: 2200,
    timerRefreshMs: 1000,
  },

  // 教学关卡的规则性数值；地图几何体（地形格子/城市坐标/出生点）在关卡 JSON 中（architecture.md §7）
  tutorial: {
    map: { width: 1280, height: 720, midlineX: 640 },
    forces: { blue: { light: 3, heavy: 1 }, red: { light: 2, heavy: 2 } },
    garrisonRadius: 80,
    clearRadius: 200, // 目标 3「清除信标周边敌军」的判定半径
    reinforcement: {
      atSecond: 60,
      count: 2,
      unitType: 'light',
      spawn: { x: 1230, y: 400 },   // 增援出生点（东侧）
      moveTo: { x: 1080, y: 160 },  // 增援目标（信标）
    },
  },
};

function deepFreeze(target) {
  if (typeof target !== 'object' || target === null || Object.isFrozen(target)) return target;
  Object.values(target).forEach(deepFreeze);
  return Object.freeze(target);
}

export default deepFreeze(values);
