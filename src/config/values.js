// 全部游戏数值的唯一权威来源。
// gdd.md §12 的数值总表是本文件的镜像；两者一致性由 Vitest 同步测试守护（architecture.md §9）。
// 任何模块禁止硬编码数值——新增或调整数值先改这里。所有数值状态均为「暂定」。

export const values = {
  simulation: {
    fixedStep: 1 / 60,        // 固定模拟步长（s）
    maxCatchUpTicks: 5,       // 每帧最多补算的 tick 数
    speeds: [0.5, 1, 2],      // 游戏速度档位
  },

  // 开局准备阶段（gdd.md §11）：进关卡后先倒计时若干秒，期间**可以下达预先指令**
  // （选择/轨迹/急行军都照常），但模拟不推进——部队不动、AI 不动、计时不动，
  // 倒计时结束才真正开打。编辑器试玩跳过这个阶段（反复试地图不该每次都等 5 秒）。
  prep: { seconds: 5 },

  units: {
    light: { hp: 60, damage: 0.8, attackInterval: 0.2, range: 40, speed: 40, radius: 14, vision: 140 },
    heavy: { hp: 80, damage: 1, attackInterval: 0.2, range: 40, speed: 40, radius: 14, vision: 160 },
  },

  combat: {
    firstStrikeImmediate: true,        // 首次接触立即攻击
    targetPriority: 'currentUntilDead', // 优先当前目标直至死亡，否则取最近（暂定）
    contactTolerance: 2,               // 交战接触判定额外容忍（px）：圆点距离 ≤ 半径和 + 此值即触发交战
    defend: 0.75, // 防守一方遭受伤害系数
    hp_dps_ratio: 0.8, // 血量阈值，往下攻击力与血量成正比
    disorderedDamageTaken: 1.5, // 溃逃(rout) / 失序(unordered) 的部队承受伤害倍率（阵型散乱，易被歼灭）
  },

  terrain: {
    gridCellSize: 10,                  // 逻辑网格边长（px）
    codes: { plain: 0, forest: 1, water: 2, bridge: 3, mountain: 4, highMountain: 5, road: 6, town: 7 },
    passable: { plain: true, forest: true, water: true, bridge: true, mountain: true, highMountain: false, road: true, town: true },
    moveMultiplier: { plain: 1.0, forest: 0.6, water: 0.4, bridge: 1.0, mountain: 0.65, highMountain: 0, road: 1.25, town: 1.0 },
    defenseModifier: { plain: 1.0, forest: 0.85, bridge: 0.9, mountain: 0.75, road: 1.0, town: 0.6 }, // 防御者地形修正（town 0.6 = 防御大幅提升）
    moraleMoveMultiplier: { plain: 1.0, forest: 1.0, water: 1.0, bridge: 1.0, mountain: 1.0, highMountain: 1.0, road: 0.5, town: 1.0 },
    // 攻方所在位置的地形对输出的影响（gdd.md §5）：水里站不稳，攻击力打对折。
    // 注意是**攻方所在地形**，与 defenseModifier（守方所在地形）不是一回事。
    attackMultiplier: { plain: 1.0, forest: 1.0, water: 0.5, bridge: 1.0, mountain: 1.0, highMountain: 0, road: 1.0, town: 1.0 },
    waterHpPerSecond: 1, // 身处水域每秒损失的血量（走 World.damageUnit，计入伤亡；可溺水阵亡）
  },

  morale: {
    initial: 80, min: 0, max: 100,
    perSecond: {
      friendlyNearby: 2,  // 附近友军（≤ ranges.friendly）
      cityNearby: 5,      // 附近己方城市（≤ ranges.city）
      supplied: 1,
      unsupplied: -2,
      inCombat: -8, // 持续交战的士气损耗（过低会使围攻不可行，见 gdd.md §6）
      // 参战但当前**没有**被敌方瞄准（state=combat 且 !underFire，例如两个单位打同一个敌人时
      // 只有前排被还击）：同样消耗士气，但比面对面的单位少
      inCombatSupport: -3,
      moving: -5,
      attack: 1.3, // 进攻 士气消耗放大因子
    },
    ranges: { friendly: 60, city: 120, allyDeath: 100 },
    onAllyDeath: -10,     // 附近友军阵亡瞬间
    thresholds: { weakenedBelow: 60, shakenBelow: 30, routAt: 0 },
    effects: {
      weakened: { damageMultiplier: 0.75, speedMultiplier: 0.85 },
      shaken: { damageMultiplier: 0.5, speedMultiplier: 0.7 },
    },
    rout: { recoverPerSecond: 8, stopAt: 20, stuckSeconds: 5 },
    unordered: { recoverPerSecond: 10, stopAt: 20, stuckSeconds: 5 }
  },

  cities: {
    capture: { radius: 60, perUnitPerSecond: 0.05, capPerSecond: 0.15, decayPerSecond: 0.03 },
    // 生产：当前**关闭**（enabled: false）——双方兵力只来自关卡 forces 部署与 AI 增援，
    // 不再随时间自动涨兵（避免拖时间自动获得单位，破坏关卡设计的兵力配比）。
    // 逻辑仍保留在 supply.js，改回 true 即恢复「每 interval 秒产 1 个 unitType」的旧行为。
    production: { enabled: false, interval: 12, unitType: 'light', pauseWhenSupplyFull: true },
    recovery: { radius: 100, hpPerSecond: 3, moralePerSecond: 5 },
    vision: 180,
  },

  // 占领点：可被占领的中立/阵营目标，被占领后**仅提供视野**；
  // 不提供补给容量、不提供士气加成、不生产、不恢复、不计入胜负（gdd.md §7.1）。
  capturePoints: {
    vision: 180, // 被己方占领后提供的视野半径（独立数值，可单独调）
    capture: { radius: 60, perUnitPerSecond: 0.05, capPerSecond: 0.15, decayPerSecond: 0.03 }, // 沿用城市占领规则
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

  // 战斗统计（结算界面用）：1 点损失的血量 = 1 点伤亡。
  // 记账在 World.damageUnit()（战斗扣血与补给损耗的唯一入口），
  // 结算时由 hud 随 URL 参数传给 result.html。
  stats: {
    hpPerCasualty: 1, // 多少点血量损失记作 1 点伤亡
  },

  // 实际控制线（gdd.md §9）：把地图切成 cellSize 的方网格，每格累加双方影响力
  // （影响力源 = 存活单位 + 城市 + 占领点），按**带符号代数和**判定该格归属：
  // sum > 0 → 蓝方控制，sum < 0 → 红方控制，sum === 0 → 中立。
  // 相邻格归属不同处即为实际控制线，取 0 等值线（marching squares）绘制。
  // 纯视觉：不参与战斗 / 补给 / 士气 / 胜负判定。
  controlLine: {
    cellSize: 20,            // 影响力网格边长（px）。地形格是 10 px，这里刻意粗一档以控开销
    refreshTicks: 6,         // 每 N 个 tick 重算一次（60 Hz / 6 = 10 Hz）
    temporalSmoothing: 0.35, // 与上一次影响力的指数平滑系数（0 = 冻结，1 = 完全用新值）
    // 等值线提取前的 3×3 均值模糊次数。**必须保持 0**：实测（6 局 × 90 s，435,766 次采样）
    // 模糊 1 次会让「单位所在格归自己阵营」的失败率从 0.000% 涨到 5.3%——
    // 模糊会把邻近格的敌方影响力混进单位脚下，正好破坏核心圈要保证的那件事。
    // 线形的平顺交给时间平滑（temporalSmoothing）就够了。
    fieldBlurPasses: 0,
    // 分界线的几何平滑（Chaikin 切角迭代次数，0 = 不平滑）：
    // 只磨等值线的折角，不动影响力场——渲染用的折线由 chainSegments + smoothPath 生成。
    pathSmoothing: 2,
    neutralEpsilon: 0,       // |代数和| ≤ 该值算中立（0 = 严格按符号；用于排除纯浮点噪声）
    // 「铺满全图」：双方影响力都够不到的格子（旷野、迷雾、从未探索区）按**最近的阵营**归属
    // （多源 BFS，见 influence.js 的 partitionField）。
    // 关掉它这些格子就是中立、那里不画线（战线会在没有部队的旷野上断开，
    // 看起来像"迷雾把控制线吃掉了"）；打开后控制线铺满整张地图、随战况处处更新。
    partitionMap: true,
    partitionFillValue: 0.01, // 填充用的弱影响力：远小于真实下限 2.5，只决定归属、不挪动真实战线
    // 单位所在格的硬保证：把每个存活单位脚下那一格强制归它自己的阵营（最小幅度翻转，见
    // influence.js 的 guaranteeUnitCells）。否则单靠核心圈挡不住这三种情况：
    //   ① 城市/占领点核心圈 60px、强度 120 压过单位身体的 100（攻城时脚下被判给敌方）；
    //   ② 格边长 20px 而单位核心圈只有碰撞半径 14px，格心可能落在圈外（只剩 20% 影响力）；
    //   ③ 多个敌军贴身时影响力叠加超过你。
    guaranteeUnitCell: true,

    // 影响力衰减曲线：形状照搬原型 srcipt.js——
    //   r < 10 → 100；r < 25 → 30−r；r < 40 → (50−r)×0.25；r ≥ 40 → 0
    // 中圈/外圈的距离按 influenceRadius / maxDistance 等比缩放，强度按各源的 strength 缩放。
    // 注：原型在 r=25 处 5 → 6.25 有个 1.25 的小跳变（判断为笔误），这里按连续处理。
    //
    // ⚠️ 核心圈（满强度的那一段）**改用绝对值，不随 influenceRadius 缩放**，
    // 目的是让核心圈只覆盖影响力源「脚下的身体」，而不是在它周围造一圈很大的绝对领域：
    //   单位 → 该单位的碰撞半径 units.*.radius（14）——即「单位始终在自己阵营的控制区内」的依据；
    //   城市 → cities.capture.radius（60）；占领点 → capturePoints.capture.radius（60）。
    // 城市不享受这个保证：被敌方占领时，它脚下可以是敌方控制区（gdd.md §9 的边界条件）。
    curve: {
      maxDistance: 40,     // 原型曲线的距离上界（= 中圈/外圈断点的缩放基准）
      coreExitRatio: 0.2,  // 出核心圈立刻降到该比例（原型的 100 → 20 断崖，保持原型手感）
      midDistance: 25,     // 中圈末端（× influenceRadius / maxDistance）
      midEndRatio: 0.0625, // 中圈末端强度比例（原型 (50−25)×0.25 = 6.25）
      edgeEndRatio: 0.025, // 外圈末端强度比例（原型 1/40×100 = 2.5），到 influenceRadius 截断为 0
    },

    unit: { influenceRadius: 140, strength: 100 },          // 半径取轻型视野 140
    city: { influenceRadius: 180, strength: 120 },          // 半径取城市视野 180
    capturePoint: { influenceRadius: 180, strength: 100 },  // 占领点同半径，强度略低于城市

    // 分界线样式：深色主色 + 浅色底衬（halo）双色描边。
    // 只画深色时，叠在战争迷雾 / 森林这类深色底上对比度会归零（看起来像"被迷雾盖住了"）；
    // 加一圈更宽的浅色描边后，亮色纸地图上仍是深色战线，深色区域则靠浅边把线托出来。
    style: {
      lineWidth: 4, color: 0x101414, alpha: 0.82,          // 主色：深色粗线
      haloWidth: 9, haloColor: 0xf7f0dd, haloAlpha: 0.5,   // 底衬：浅色更宽的描边
    },
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

  queue: {
    maxSegments: 50,
  },

  transition: {
    checkRadius: 40,
    transitionPoints: 12,
    minConnectionDistance: 2,
    mergeTolerance: 1,
  },

  movement: {
    routSpeedMultiplier: 0.6,
    // 急行军（gdd.md §4）：E + 右键 / E + 左键拖轨迹下达，命令带 forced: true。
    // 除了水域之外的地形都提速（水面上照常按 0.4 走，不给加成），代价是士气掉得更快 + 缓慢掉血。
    forcedMarch: {
      speedMultiplier: 1.5, // 与地形、士气速度倍率**叠乘**（例：路上 40 × 1.25 × 1.5 = 75 px/s）
      moralePerSecond: -10, // 取代普通行军的 morale.perSecond.moving(-5)；仍乘地形士气系数与进攻因子
      hpPerSecond: 1.5,     // 每秒损失的血量（走 World.damageUnit，计入结算伤亡；可以力竭阵亡）
    },
    stuckThresholdSeconds: 0.35,
    minDisplacement: 0.25,
    unitSeparation: 2,
    formationOffset: 28,
    maxRerouteAttempts: 3,
    localRerouteRadius: 112,
  },

  ui: {
    toastDurationMs: 2200,
    timerRefreshMs: 1000,
  },

  // 教学关卡的规则性数值；地图几何体（地形格子/城市坐标/出生点）
  // 在关卡 JSON 中（architecture.md §7）
  tutorial: {
    map: { width: 1280, height: 800, midlineX: 640 },
    forces: { blue: { light: 6, heavy: 2 }, red: { light: 2, heavy: 2 } },
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
