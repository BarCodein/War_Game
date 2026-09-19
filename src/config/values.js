// 全部游戏数值的唯一权威来源。
// gdd.md §12 的数值总表是本文件的镜像；两者一致性由 Vitest 同步测试守护（architecture.md §9）。
// 任何模块禁止硬编码数值——新增或调整数值先改这里。所有数值状态均为「暂定」。

export const values = {
  simulation: {
    fixedStep: 1 / 60,        // 固定模拟步长（s）
    maxCatchUpTicks: 5,       // 每帧最多补算的 tick 数
    speeds: [0.5, 1, 2],      // 游戏速度档位
  },

  // 地图缩放（游戏页，gdd.md §11）：滚动鼠标滚轮，以**光标位置为焦点**缩放
  // （光标下的那一点在缩放过程中保持不动）。只放大不缩小：1× = 整图适配，所以不会出现留白；
  // 不做平移——想看别处就把光标移过去再滚。视口始终被夹在地图范围内（clamp）。
  camera: {
    zoomMin: 1,
    zoomMax: 3,
    zoomStep: 1.1,       // 每格滚轮的倍率（向上滚 = 放大）
    zoomSmoothing: 1, // 每帧向目标缩放逼近的系数（0~1，越大越跟手；按 60fps 标定）
  },

  // 战术 AI（docs/ai-design.md）：脚本负责"打哪、何时打"，这一层负责"怎么打"。
  // 只在脚本使用 `engage` 动作时生效——旧的 attackNearest / attackMove 行为与关卡平衡完全不变。
  // 阶段一：效用选目标（含追击溃逃）＋ 编队协同（队形、不添油、窄口纵队、集中火力）。
  // 阶段二：薄弱点进攻（复用战线找最弱接近轴）＋ 难度/性格三档（presets + 关卡 tuning）＋ 回城休整。
  ai: {
    preset: 'standard',            // 全局默认档位；关卡可写 ai.preset 覆盖
    // 三档性格：只有这几项随档位变化（决策节奏与休整阈值是全局的）
    presets: {
      // supplyCaution：补给敏感度，0 = 激进（敢短时脱离补给线换机会），1 = 保守（贴着补给线打）。
      // 它插值出 ai.supply 里的四组阈值（活动范围 / 打分倍率 / 急行军门槛 / 回城阈值）。
      cautious: { reserveRatio: 0.3, pursuitRadius: 180, useForcedMarch: false, terrainBias: 'defensive', feint: false, supplyCaution: 0.8 },
      standard: { reserveRatio: 0.15, pursuitRadius: 320, useForcedMarch: true, terrainBias: 'balanced', feint: false, supplyCaution: 0.5 },
      sly: { reserveRatio: 0, pursuitRadius: 520, useForcedMarch: true, terrainBias: 'mobility', feint: true, supplyCaution: 0.2 },
    },
    decisionIntervalSeconds: 0.5,  // 战术层决策节奏（模拟时间，秒）
    hysteresis: 0.15,              // 换目标所需的分数优势（防止每半秒反复横跳）
    engageRadius: 320,             // 考虑交战的半径（px）：超出这个距离只推进、不点杀
    localForceRadius: 180,         // 统计局部兵力比的半径（px）
    weights: {
      threat: 0.3,             // 局部兵力比（我方战力占比）
      kill: 0.15,              // 目标可击杀性（残血优先）
      distance: 0.15,          // 距离越近越优先
      value: 0.15,             // 目标价值（指定单位 / 重型 / 据点守军）
      vulnerability: 0.1,      // 目标处于溃逃/失序（承受伤害 ×1.5）
      chase: 0.15,             // 追击溃逃目标的额外权重
      terrain: 0.15,           // 我方所在地形（水里输出减半）
      approach: 0.4,           // 接近轴的地形偏好权重（配合 presets[].terrainBias）
      supply: 0.25,            // 补给（存量是否够、战场是否在补给可达区内）——见 ai.supply 与 docs/ai-design.md §3.7
      interdiction: 0.2,       // 断敌粮道（接近轴/薄弱点压住敌方补给走廊的偏好）——见 ai.interdiction 与 §3.8。
                               // ⚠️ 它实际是**开关**而不是旋钮：0.1~0.6 的行为逐位相同（§5.3 教训 2），
                               //    因为断粮任务只判断 `> 0`；0 = 整套断粮关闭（§7 决策 37 决定保持这个语义）。
    },
    // 补给视野（docs/ai-design.md §3.7）：硬约束阈值 + 由档位 supplyCaution 线性插值的软阈值。
    // 硬约束（与档位无关）：补给线断了（supplied=false）或存量比例 < lowRatio → 收紧
    //   （不急行军、不主动接战、向补给区内回撤）。
    supply: {
      lowRatio: 0.3,              // 硬约束：存量比例低于此值视为"低补给"
      squadCutFraction: 0.5,      // 小队里断补人数占比达到此值 → 整队转入低补给姿态
      reachRatio: { min: 0.95, max: 0.65 },        // 允许活动范围 = supply.path.maxCost × 该值
      weightScale: { min: 0.7, max: 1.4 },         // 效用打分里补给项的倍率
      forcedMarchStock: { min: 0.35, max: 0.7 },   // 急行军要求的最低存量比例
      regroupCautionRange: 0.2,   // 回城阈值 = regroup.supplyRatio + 该值 × (supplyCaution − 0.5)：标准档不漂移
      regroupRatioFallback: 0.5,  // cfg.regroup.supplyRatio 缺省时的兜底
    },
    // 断敌粮道（docs/ai-design.md §3.8）：敌方补给线 = 敌单位 → 它最近的敌城（两条都是公开信息），
    // 而"一个单位脚下 140px 内的格子算我方实际控制"（controlLine.unit.influenceRadius）——
    // 所以把部队插到那条走廊上，就能真的掐断它的补给。AI 只做两件事：
    //   ① 软权重：接近轴 / 薄弱点打分里偏向"压得住敌走廊"的方向（weights.interdiction）；
    //   ② 预备队任务：闲置的预备队去守那个点（不下正面攻击命令 = 不否决正面目标）。
    // 公平：只用**可见**敌单位的位置（记忆里的 ghost 不参与）+ 敌城坐标，绝不读 supplyFields[敌]。
    // 关闭方式：weights.interdiction = 0（打分项归零，预备队也不再领断粮任务）。
    //   注：weights.interdiction 只分"开/关"两档——它在 0.1~0.6 之间不改变任何行为（§5.3 教训 2、
    //   §7 决策 37）：断粮任务只判断 `> 0`，而接近轴打分的区分度又不足以改变选择。
    interdiction: {
      minCuts: 2,          // 至少要能同时压住几条敌方补给线才值得为它调整方向（1 条 = 顺手刮一下）
      corridorSamples: 3,  // 每条走廊采样几个点（按 0.3 / 0.5 / 0.7 均分：避开城下与单位脚下）
      minCorridor: 240,    // 走廊短于这个长度就不算"粮道"（敌人就在城边，掐不断）
      minDistance: 160,    // 断粮点离我方形心太近（已经在自己控制里）不算数
      maxDistance: 900,    // 太远的断粮点不值得绕路（超出直接出局）
      cutRadius: 140,      // 压制半径 = controlLine.unit.influenceRadius：一个单位能压住的地盘
    },
    // 护己方粮道（docs/ai-design.md §3.8）：解围 + 撤退选城避开被围的城。
    // "被围"= 看得见的敌人在城周 threatRadius 内，或这城正在被夺（captureProgress > 0，公开信息）。
    relief: {
      threatRadius: 200,        // 己城周围这个半径内出现敌军 = 被围
      standoff: 180,            // 解围分队停在城外多远（不直接撞进占领圈）
      minUsers: 2,              // 这城至少是这么多己方单位的"最近己方城市"才值得解围
      minLoadPoints: 1,         // 或本轮至少输出这么多运力点（城被切断时 load=0，改看 minUsers）
      forceRatio: 0.5,          // 解围分队战力 ≥ 围城敌军战力 × 该值才去（否则等主力，不送人头）
      maxDistance: 1200,        // 解围分队的有效驰援距离（再远就来不及，出局）
      retreatThreatPenalty: 400, // 撤退选城时，被围的城按等效像素加罚（代价场单位：平地 px）
    },
    squad: {
      cohesionRadius: 170,       // 队形松散判定半径（px）
      cohesionRatio: 0.7,        // 达标比例：低于它就不让跑在前面的单位继续推进
      slotSpacing: 34,           // 队形槽位间距（px）
      maxAttackersPerTarget: 2,  // 集中火力：同一个敌人最多几个人打
      columnSampleStep: 20,      // 窄口（水域/桥梁/不可通行）判定沿直线的采样步长（px）
      advanceStep: 60,           // 编队整体每轮向目标推进的距离（px）
    },
    // 薄弱点进攻：复用控制线的 0 等值线段定位战线，再沿战线采样局部兵力比
    weakSpot: {
      frontSearchRadius: 460,  // 在目标周围多大范围内找战线采样点（px）
      sampleRadius: 170,       // 每个采样点的兵力统计半径（px）
      pointLimit: 24,          // 最多采样多少个战线点（性能上限）
      axisCount: 3,            // 围绕目标生成几条接近轴（正面 + 左右侧翼）
      axisSpread: 0.6,         // 侧翼张角（弧度）
      standoff: 220,           // 接近轴端点相对目标的停战线距离（px）
    },
    // 地形偏好：cautious 偏防守地形、sly 偏机动（道路），用于接近轴打分
    terrainBias: {
      defensive: { defense: 0.7, mobility: 0.1 },
      balanced: { defense: 0.4, mobility: 0.4 },
      mobility: { defense: 0.15, mobility: 0.7 },
    },
    // 预备队：按档位比例留人，什么时候投入
    reserve: {
      commitMainRatio: 0.6,     // 主力战力掉到开战时的这个比例以下 → 投入预备队
      commitWeaknessRatio: 0.7, // 目标方向我方相对优势达到这个值 → 投入预备队扩大战果
      rallyBehind: 170,         // 预备队待命位置 = 主力形心后方多远处（px）
    },
    // 回城休整（全局阈值，不随档位变化）
    regroup: {
      hpRatio: 0.45,            // 小队平均血量低于此值 → 撤退休整
      supplyRatio: 0.5,         // 或平均补给存量低于上限的这个比例（去城里重新进货）
      recoverHpRatio: 0.75,     // 恢复到该血量比例 → 回归脚本目标
      recoverSupplyRatio: 0.75, // 且补给存量恢复到这个比例
      cooldownSeconds: 12,      // 休整完的冷却，避免来回抖动
    },
    march: { minDistance: 650 }, // 距目标超过这个距离且档位允许时才走急行军（代价：补给 -10/s、掉血 1.5/s）

    // ---- 阶段三：迷雾公平 + 侦察（docs/ai-design.md §3.4）----
    // 默认关闭：旧的关卡（塔山/宿北）行为与平衡完全不变；想公平的关卡写 "ai": { "fog": true }。
    fog: false,
    memory: {
      fadeSeconds: 25,       // lastSeen 记忆的有效期（秒）：超过就当忘了
      staleConfidence: 0.35, // 置信度低于此值的记忆不再用于行动
      // 置信度 = 1 - 记忆年龄 / fadeSeconds（可见目标置信度恒为 1）
    },
    scout: {
      enabled: true,         // 公平模式下是否派侦察兵
      perGroup: 1,           // 每个编队抽几个侦察兵
      minSquadSize: 3,       // 编队人数小于此值不抽（免得把主力抽空）
      maxExploreRadius: 900, // 侦察兵不会离出发点超过这个距离（px，防止满地图乱跑）
    },
  },

  // 开局准备阶段（gdd.md §11）：进关卡后先倒计时若干秒，期间**可以下达预先指令**
  // （选择/轨迹/急行军都照常），但模拟不推进——部队不动、AI 不动、计时不动，
  // 倒计时结束才真正开打。编辑器试玩跳过这个阶段（反复试地图不该每次都等 5 秒）。
  prep: { seconds: 5 },

  units: {
    // supplyStock = 补给存量上限（gdd.md §6）：出击时带满，战斗中/行军中消耗，回补给线内进货。
    // 存量归零 = 完全断补（掉血 + 归零溃逃），所以上限 ≈ 断补后还能撑多久 × 消耗速率。
    light: { hp: 60, damage: 0.8, attackInterval: 0.2, range: 40, speed: 40, radius: 14, vision: 140, supplyStock: 80 },
    heavy: { hp: 80, damage: 1, attackInterval: 0.2, range: 40, speed: 40, radius: 14, vision: 160, supplyStock: 120 },
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
    // 行军消耗的**地形系数**（gdd.md §4）：沿道路行军补给消耗减半，其余地形照常
    marchSupplyMultiplier: { plain: 1.0, forest: 1.0, water: 1.0, bridge: 1.0, mountain: 1.0, highMountain: 1.0, road: 0.5, town: 1.0 },
    // 攻方所在位置的地形对输出的影响（gdd.md §5）：水里站不稳，攻击力打对折。
    // 注意是**攻方所在地形**，与 defenseModifier（守方所在地形）不是一回事。
    attackMultiplier: { plain: 1.0, forest: 1.0, water: 0.5, bridge: 1.0, mountain: 1.0, highMountain: 0, road: 1.0, town: 1.0 },
    waterHpPerSecond: 1, // 身处水域每秒损失的血量（走 World.damageUnit，计入伤亡；可溺水阵亡）
  },

  // 补给存量系统（gdd.md §6）：这套机制原本是士气，**现在数值的含义是「单位剩余的补给存量」**
  // ——战斗消耗补给、行军消耗补给、急行军消耗更多；唯一的进货渠道是补给系统
  // （城市运力 × 距离因子算出的实收点数，见 supply.stockPerPoint 与 §8）。
  // 机制（阈值削弱 / 归零溃逃投降 / 溃逃撤退）都保留，只是含义变了：
  //   存量 ≥ 60% 上限 → 正常；< 60% → 缺补（削弱）；< 30% → 将尽（动摇）；= 0 → 耗尽（溃逃/失序）。
  supplyStock: {
    min: 0,
    // 存量上限按兵种分开（见 units.*.supplyStock）：出击时带满，归零即完全断补
    perSecond: {
      // 只保留「消耗」类修正。友军密度（+2）、城市范围（+5）、友军阵亡（−10）都已删除：
      // 补给只能沿补给线从城市运来，不能凭空产生、也不会因为战友阵亡而减少。
      idle: -1,     // **驻军基础口粮**：站着不动也要吃。与交战/行军消耗**叠加**。
                    // 断补的驻军因此会缓慢耗尽（轻 80 → 80 s）→ 存量归零后周期性失序（原地停摆 + 易伤 ×1.5）。
      inCombat: -4, // 交战中（正被敌方瞄准）的补给消耗
      // 参战但当前**没有**被敌方瞄准（state=combat 且 !underFire，例如两个单位打同一个敌人时
      // 只有前排被还击）：同样消耗补给，但比面对面的单位少
      inCombatSupport: -3,
      moving: -2.5,   // 行军消耗
      attack: 1.3,  // 进攻（有路线）时的消耗放大因子
    },
    thresholds: { weakenedBelow: 0.6, shakenBelow: 0.3, routAt: 0 }, // 按**存量比例**（各兵种上限不同）
    effects: {
      weakened: { damageMultiplier: 0.75, speedMultiplier: 0.85 },
      shaken: { damageMultiplier: 0.5, speedMultiplier: 0.7 },
    },
    // 溃逃/失序时的补给恢复（无条件下就地搜集，gdd.md §6）
    rout: { recoverPerSecond: 8, stopAt: 20, stuckSeconds: 5 },
    unordered: { recoverPerSecond: 10, stopAt: 20, stuckSeconds: 5 }
  },

  cities: {
    capture: { radius: 60, perUnitPerSecond: 0.05, capPerSecond: 0.15, decayPerSecond: 0.03 },
    // 生产：当前**关闭**（enabled: false）——双方兵力只来自关卡 forces 部署与 AI 增援，
    // 不再随时间自动涨兵（避免拖时间自动获得单位，破坏关卡设计的兵力配比）。
    // 逻辑仍保留在 supply.js，改回 true 即恢复「每 interval 秒产 1 个 unitType」的旧行为。
    production: { enabled: false, interval: 12, unitType: 'light', pauseWhenSupplyFull: true },
    recovery: { radius: 100, hpPerSecond: 3 }, // 只回血：补给走补给系统（gdd.md §7、§8）
    vision: 180,
  },

  // 占领点：可被占领的中立/阵营目标，被占领后**仅提供视野**；
  // 不提供补给容量、不提供补给存量加成、不生产、不恢复、不计入胜负（gdd.md §7.1）。
  capturePoints: {
    vision: 180, // 被己方占领后提供的视野半径（独立数值，可单独调）
    capture: { radius: 60, perUnitPerSecond: 0.05, capPerSecond: 0.15, decayPerSecond: 0.03 }, // 沿用城市占领规则
  },

  // 补给（gdd.md §7）：不再按直线就近分配，改成**沿最短路径的运力结算**。
  //   1. 单位 → 己方城市的最短路径（地形加权，「等效像素」= 平原上走的距离），
  //      路径**不可穿过敌方实际控制区**（读 world.controlLine 的带符号影响力）；
  //   2. 城市有吞吐点数（capacityPerCity），按「路径代价最小的单位优先」分配
  //      —— 也就是「城市优先补给离自己最近的单位」；某城点数用光就顺延到下一座城；
  //   3. 城市为把补给送到单位手里要付 demand ÷ factor 点（factor 由路径代价决定），
  //      单位实收 = 付出的点数 × factor；因此**近城一座就够，远城要好几座城合力**；
  //   4. 实收 < 需求 = 进货不足（补给线被切断就完全不进货）；
  //      所有城都够不着 / 点数都用光 = 断补（实收 0）；
  //   5. 实收点数按 stockPerPoint 换算成**补给存量**加进单位（gdd.md §6），
  //      存量耗尽才开始掉血（attritionHpPerSecond）。
  supply: {
    demandPerUnit: 1,       // 每个单位的需求（点）
    capacityPerCity: 5,     // 每座城的吞吐点数（5 点 = 5 个近城的满额单位，远城供不了这么多）
    // 1 点实收 = 10 点补给存量。满补给时每秒实收 2 点（每 0.5s 结算 1 点）→ 进货 +20/s：
    // 比战斗消耗（−8/s）、行军（−5/s）都快，所以**补给线通畅的部队不会掉存量**；
    // 远城因子 0.33 时只有 +6.6/s，战斗中就会慢慢入不敷出。断开供给（断补）= 只出不进。
    stockPerPoint: 2,
    attritionHpPerSecond: 1,     // 补给存量归零（完全断补）时的血量损耗
    refreshSeconds: 0.5,    // 分配重算间隔（单位位置一直在变，这步很便宜）
    // 代价场（多源 Dijkstra）重算间隔。代价场只取决于城市 + 敌方控制区，与单位位置无关，
    // 所以它比分配算得稀得多：500 单位的地图上，一次全图 Dijkstra 是这整套里最贵的一步。
    fieldRefreshSeconds: 1,
    enemyControlBlocks: true, // 补给线不可穿过敌方实际控制区（false = 只看地形，便于对比调试）
    waterIsBarrier: false,  // 水域是否阻断补给线（默认否：水能蹚过去，只是代价很贵，见 moveMultiplier）

    // 距离因子：factor = clamp(1 − (cost − fullCost) / (zeroCost − fullCost), min, 1)
    //   cost ≤ 100  → 1.0（近城，一座城就能喂饱一个单位）
    //   100 → 900   → 线性衰减
    //   cost ≥ 900  → 0.2（远城仍能救急，只是要花 5 点运力才能送到 1 点，见 gdd.md §7）
    factor: { fullCost: 100, zeroCost: 900, min: 0.2 },

    path: {
      // 寻路网格边长（px）：比 10 px 的地形格粗一档。补给线是战略级线条，不需要逐 10 px 精度，
      // 粗一档让 500 单位场景的重算开销降到约 1/4（与控制线同一个思路，见 gdd.md §9）。
      cellSize: 20,
      // 搜索上界（等效像素）：代价超过它的城视为够不着 —— 也就是**补给线的最大长度**。
      // 因子下限 0.2 落在 900，再远的城要掏 ≥ 1500/900×1 ≈ 1.7 点才送到 1 点（超过一座城的容量），
      // 实战中没有意义；同时这也是主要的性能护栏：可搜索面积按它的平方缩小。
      maxCost: 1500,
      // 判定「敌方实际控制区」的影响力阈值：|影响力| 不超过它的格子不算被谁实际控制。
      // 取 partitionFillValue(0.01) —— 控制线把**无人区域**按最近阵营铺满时赋的就是这个弱值，
      // 那是画线用的归属，不是"敌人真的控制着这里"。不排除它的话，一个孤立的敌军单位
      // 会凭一圈虚线归属把几百像素外的己方补给线整条掐断（"实际控制"变成了"名义归属"）。
      controlBlockMin: 0.01,
    },

    // 补给线渲染（选中单位时显示）：线宽/不透明度随「实收 ÷ 需求」变化，
    // 断补时改画红色虚线，并在切断处打叉。
    style: {
      color: 0x1f6fb2, cutColor: 0xc0392b, alpha: 0.9,
      width: { min: 1.5, max: 5 },
      dash: { length: 12, gap: 8 },
      cutMarkSize: 7,
    },
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
  // 纯视觉：不参与战斗 / 补给 / 补给存量 / 胜负判定（补给线**读**它判定敌方控制区，见 §8）。
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
    // 目的是让核心圈只覆盖影响力源「脚下的身体」，而不是在它周围造一圈很大的绝对领域。
    // **每个源各有自己的 coreRadius，与任何「占领半径」都不再共用同一个数**：
    //   单位 → 该单位的碰撞半径 units.*.radius（14）——即「单位始终在自己阵营的控制区内」的依据；
    //   城市 → controlLine.city.coreRadius（20）；
    //   占领点 → controlLine.capturePoint.coreRadius（20，覆盖标记本体并守住脚下那一格）。
    // 城市与占领点不享受这个保证：被敌方占领/争夺时，它们脚下可以是敌方控制区（gdd.md §9 的边界条件）。
    curve: {
      maxDistance: 40,     // 原型曲线的距离上界（= 中圈/外圈断点的缩放基准）
      coreExitRatio: 0.2,  // 出核心圈立刻降到该比例（原型的 100 → 20 断崖，保持原型手感）
      midDistance: 25,     // 中圈末端（× influenceRadius / maxDistance）
      midEndRatio: 0.0625, // 中圈末端强度比例（原型 (50−25)×0.25 = 6.25）
      edgeEndRatio: 0.025, // 外圈末端强度比例（原型 1/40×100 = 2.5），到 influenceRadius 截断为 0
    },

    unit: { influenceRadius: 140, strength: 100 },          // 半径取轻型视野 140
    // 城市：半径取城市视野 180。
    // coreRadius **与占领半径（cities.capture.radius = 60）脱钩**，是影响力系统自己的数值：
    // 它只管「城市本体满强度圈有多大」，占领判定仍用 60，两者互不影响。
    // 调大 → 城市在近处更强势（控制线被推离城墙、攻城方更难切断城下那一格）；
    // 调小 → 城市只守住本体，贴近城墙的一圈容易被敌方单位翻转。
    city: { influenceRadius: 140, strength: 80, coreRadius: 20 },
    // 占领点：核心圈同样**独立**，与占领半径 60 脱钩。
    // 取 20（= 覆盖它自己的标记体积，并且**守住脚下那一格**）：
    // 占领点没有"单位所在格"那样的硬保证，核心圈小于 14（控制格对角线）时，
    // 一个 30px 外的敌军就能把据点自己那一格翻成敌方（实测 −6.4）——地图上会看到控制线在据点里来回扫。
    // 调大 → 争夺中的据点向四周撑开控制区；调小 → 只有站上去的那一格算己方控制。
    capturePoint: { influenceRadius: 140, strength: 60, coreRadius: 20 },

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
    // 除了水域之外的地形都提速（水面上照常按 0.4 走，不给加成），代价是**补给消耗快得多** + 缓慢掉血。
    forcedMarch: {
      speedMultiplier: 1.5, // 与地形、缺补速度倍率**叠乘**（例：路上 40 × 1.25 × 1.5 = 75 px/s）
      supplyPerSecond: -10, // 取代普通行军的 supplyStock.perSecond.moving(-5)；仍乘地形系数与进攻因子
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
};

function deepFreeze(target) {
  if (typeof target !== 'object' || target === null || Object.isFrozen(target)) return target;
  Object.values(target).forEach(deepFreeze);
  return Object.freeze(target);
}

export default deepFreeze(values);
