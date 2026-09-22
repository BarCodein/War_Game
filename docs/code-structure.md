# War of Dots 代码结构与 JS 文件说明

> 本文件说明项目的代码目录结构，并逐文件描述每个 JS 文件的内容与职责。
> 代码遵循分层架构（`input → commands → simulation tick → world state → rendering`），
> 详见 `docs/architecture.md`。本文件只覆盖运行时代码（`src/`）、页面入口（`src/entries/`）与构建/测试配置；`node_modules/`、`dist/` 不在此列。

---

## 一、目录结构总览

```
war_game/
├─ index.html                  # 主页（落地页）：游戏/编辑器两个入口
├─ game.html                   # 游戏页：教学关或编辑器试玩
├─ editor.html                 # 地图编辑器页
├─ styles.css                  # 全局样式（含主页、编辑器、HUD）
├─ vite.config.js              # Vite 多页构建配置
├─ vitest.config.js            # Vitest 单元测试配置
├─ playwright.config.js        # Playwright e2e 配置
├─ package.json                # 依赖与脚本（Node >= 22.12）
├─ docs/                       # 设计/架构/验收/开发文档（非 JS）
├─ public/assets/maps/         # 关卡地图 JSON
├─ src/
│  ├─ entries/                 # 三个页面入口模块
│  │  ├─ home.js               #    主页入口（i18n 填充）
│  │  ├─ game.js               #    游戏页入口（创建 Phaser Game）
│  │  └─ editor.js             #    编辑器页入口
│  ├─ config/
│  │  ├─ values.js             #    全部数值唯一权威来源（深度冻结）
│  │  └─ index.js              #    配置聚合导出
│  ├─ simulation/              # 纯数据模拟（无 Phaser/DOM，可 Node headless）
│  │  ├─ world.js              #    世界容器 + tick 编排 + 统一命令入口
│  │  ├─ map.js                #    地图 JSON 校验/迁移/地形访问层
│  │  ├─ entities.js           #    单位/城市实体工厂
│  │  ├─ capability.js         #    战斗力系数（血量口径，战斗与交战补给共用，纯函数）
│  │  ├─ loop.js               #    固定时间步长累积器
│  │  ├─ commands.js           #    统一命令接口与校验
│  │  ├─ spatial.js            #    均匀网格空间分区
│  │  ├─ influence.js          #    影响力场 + 0 等值线（实际控制线，纯函数）
│  │  ├─ supplyPath.js         #    补给线寻路（地形加权 / 敌方控制区阻断，纯函数）
│  │  ├─ ai.js                 #    脚本敌军（解释关卡的事件→动作脚本）
│  │  ├─ level.js              #    关卡标准格式：校验 / 兵力部署 / 锚点与目标解析
│  │  └─ systems/              #    tick 内的规则系统
│  │     ├─ movement.js        #      移动/寻路/软排斥/溃逃撤退
│  │     ├─ combat.js          #      接触交战/伤害/目标选择
│  │     ├─ supplyStock.js     #      补给存量：消耗/阈值/溃逃
│  │     ├─ supply.js          #      补给运力结算/恢复/生产/损耗
│  │     ├─ capture.js         #      城市占领进度
│  │     ├─ fog.js             #      战争迷雾三态/目视/最后已知位置
│  │     ├─ controlLine.js     #      影响力场重算（10 Hz）+ 分界线线段
│  │     └─ victory.js         #      胜负判定
│  ├─ controllers/             # 交互状态控制器
│  │  └─ gameController.js     #    暂停/游戏速度/开局准备阶段
│  ├─ i18n/
│  │  ├─ index.js              #    t(key) 查表 + 插值
│  │  ├─ zh-CN.js              #    中文文案（默认）
│  │  └─ en.js                 #    英文（预留）
│  ├─ input/                   # 输入层（只产命令/选择状态）
│  │  ├─ selection.js          #    单选/框选/Shift 增减选
│  │  ├─ orders.js             #    右键移动/攻击 + 拖拽绘制轨迹
│  │  └─ keyboard.js           #    快捷键
│  ├─ rendering/               # 渲染层（只读世界状态）
│  │  ├─ hud.js                #    DOM HUD 界面
│  │  ├─ editorToolbar.js      #    DOM 编辑器工具栏
│  │  ├─ editorView.js         #    编辑器视图纯函数（缩放适配/纹理重建判定）
│  │  ├─ terrainRenderer.js    #    静态地形烘焙纹理
│  │  ├─ fogRenderer.js        #    迷雾罩层
│  │  ├─ unitRenderer.js       #    单位/城市/血条/裂纹/虚影
│  │  ├─ controlLineRenderer.js#    实际控制线
│  │  ├─ supplyLines.js        #    选中单位的补给线（断补红色虚线 + 切断点）
│  │  ├─ cameraView.js         #    地图缩放（滚轮以光标为焦点，纯函数 + Phaser 接线）
│  │  └─ scenes/               #    Phaser 场景
│  │     ├─ BootScene.js       #      游戏页启动/路由
│  │     ├─ GameScene.js       #      游戏主场景（组装各层）
│  │     ├─ EditorScene.js     #      编辑器主场景
│  │     └─ BenchScene.js      #      性能基准场景
│  └─ editor/
│     ├─ editorStore.js        # 编辑器纯数据状态
│     └─ mapResize.js          # 地图补齐到画布尺寸（纯数据）
├─ scripts/
│  └─ tune.mjs                 # 离线调参：headless 批量对局 + 参数扫描（npm run tune，不进构建产物）
└─ tests/
   ├─ unit/                    # 28 个 Vitest 测试文件（规则确定性）
   └─ e2e/                     # 7 个 Playwright 测试文件（浏览器流程）
```

---

## 二、页面入口（`src/entries/`）

这三个模块是三个 HTML 页面各自加载的 JavaScript 入口（`type="module"`）。

### `src/entries/home.js`
主页（`index.html`）入口。**不启动 Phaser**，只做 UI：
- 遍历 `[data-i18n]` 元素，用 `t()` 填充中文/英文文案。
- 设置 `document.title`。
- 导出：无（副作用脚本）。

### `src/entries/game.js`
游戏页（`game.html`）入口。创建 `Phaser.Game` 实例并注册场景：
- `scene: [BootScene, GameScene, BenchScene]`（编辑器由 `editor.html` 单独承载）。
- `parent: 'battlefield'`，逻辑分辨率 1280×800，`Scale.FIT` + 居中。
- 背景色 `#193d3d`。
- 导出：无。

### `src/entries/editor.js`
编辑器页（`editor.html`）入口。创建 `Phaser.Game`：
- `scene: [EditorScene]`。
- 同样 `parent: 'battlefield'`，1280×800，`Scale.FIT`。
- 导出：无。

### `src/level-link.js`
关卡定位（把"要玩哪一关"从 URL 里解析出来，并在页面间跳转时带上）：
- `levelIdFromLocation()`：`?level=<id>` → `#level=<id>`（只认带 `level=` 的 hash；裸 hash 是 `#bench` 这类标记，不能当关卡 id）。
- `rememberLevelId()` / `recallLevelId()`：用 `sessionStorage` 记住最近一次选择；`resolveLevelId()` 按 查询参数 → hash → 存储 → 缺省值 兜底；`levelHref(page, id)` 生成同时带查询参数与 hash 的地址。
- **为什么需要**：静态服务器的 `cleanUrls` 会把 `/game.html?level=x` **301 重写成 `/game` 并丢掉查询参数**（`npx serve` 默认开启，实测 `Location: /battlebackground`）——只认查询参数就会加载到默认关卡，表现是"点宿北却显示塔山"。服务器侧另由 `public/serve.json`（`cleanUrls: false`，构建后被复制到 `dist/serve.json`）关掉这个重写；`battlebackground.html` / `loading.html` 这两个 classic script 页面内置同一套兜底规则（见 `tests/unit/campaign-pages.test.js` 的契约测试）。
- **代价与补偿**：关掉 `cleanUrls` 后 `npx serve` 不再把 `/login` 解析成 `/login.html`，手输的、收藏夹里的干净 URL，以及浏览器缓存的旧 301，都会直接 **404**（外部托管（GitHub Pages 等）默认支持干净 URL，所以同一份 dist"外网能开、localhost 404"）。`public/serve.json` 因此额外补了两条"无扩展名 → `.html`"的 rewrite：`/:page([^/.]+)`（根目录页面，如 `/login`）与 `/:dir/:page([^/.]+)`（`members/`、`climb/` 下的页面）。实测 `/login`、`/battlechoose`、`/members/about`、`/climb/climb` 均 200，且**不产生重定向**、查询参数原样保留。

---

## 三、配置（`src/config/`）

### `src/config/values.js`
**全部游戏数值的唯一权威来源**，`gdd.md §12` 数值总表为其镜像（由同步测试守护）。导出 `values` 并被深度冻结（`deepFreeze`），任何模块禁止硬编码数值。包含字段：
- `simulation`：固定步长 `1/60`、最大补帧 `5`、速度档位 `[0.5,1,2]`。
- `units`：轻/重型的 `hp/damage/attackInterval/range/speed/radius/vision`。
- `combat`：`firstStrikeImmediate`、`targetPriority`、`contactTolerance`（接触交战容忍 px）。
- `terrain`：格子边长 `20`、四类地形 `codes`、`passable`、`moveMultiplier`、`defenseModifier`。
- `supplyStock`：存量下限、每秒消耗（交战/行军/急行军）、比例阈值、缺补效果、溃逃/失序搜集速率。`units.*.supplyStock` 是各兵种的存量上限。
- `cities`：占领半径/速率、生产、恢复、视野。
- `supply`：需求与每城吞吐（`demandPerUnit` / `capacityPerCity`）、完全断补时的损耗速率、结算节奏（`refreshSeconds` / `fieldRefreshSeconds`）、距离因子曲线 `factor`、寻路参数 `path`（网格边长 / 最大长度 / 控制区阈值）、补给线样式 `style`（`gdd.md §8`）。
- `fog`：森林目视距离、最后已知位置虚影开关。
- `spatial`：格子边长 `64`。
- `performance`：目标帧率/单位、tick/渲染预算、HUD 节流。
- `input`：点击半径、框选阈值、轨迹采样/偏移。
- `prep`：开局准备阶段倒计时秒数（`gdd.md §11`）。
- `ui`：UI 节流。`camera`：缩放范围与平滑。`controlLine`：影响力网格与控制线数值。

### `src/config/index.js`
配置聚合导出：`export { default as values } from './values.js'`。新增配置域在此扩展。

---

## 四、模拟层（`src/simulation/`）

这一层的代码**不依赖 Phaser 或 DOM**，可在 Node 环境 headless 运行完整对局。

### `src/simulation/world.js`
世界状态容器（`World` 类）与 tick 编排：
- 构造：`parseMap` 解析地图、建立单位数组、双阵营迷雾网格、空间分区。
- `spawnUnit` / `spawnInitial` / `killUnit` / `nearestOwnCity`。
- `issueCommands(unitIds, command)`：**统一命令入口**，人类/脚本/AI 共用；溃逃与阵亡单位不受指挥。
- `damageUnit(unit, amount)`：**扣血 + 记伤亡的唯一入口**（`gdd.md §11`）——返回本次实际损失的血量，并按 `values.stats.hpPerCasualty`（1 点血 = 1 点伤亡）累加到 `world.casualties[faction]`。战斗扣血（`combat.js`）与补给损耗（`supply.js`）都走它；**治疗直接改 hp、不走它**，所以恢复不会抵消伤亡；只剩 5 血时挨 100 伤害只记 5 点（超杀不算）。结算时由 hud 拼成 URL 参数交给 `result.html`。
- `tick(dt)`：固定系统顺序执行 `movement → combat → supply → supplyStock → capture → fog → controlLine → victory`，保证确定性；tick 末把事件推入 `history`。
- **补给状态字段**（`gdd.md §8`）：`supplyFields`（每阵营一张代价场）· `supplyMasks`（敌方控制区掩码）· `supplyToken`（代价场版本号，渲染层据此失效路径缓存）· `supplyTimer` / `supplyFieldTimer`（两档节流）· `citySupplyLoad`（各城本轮运力支出）。
- `applyCommand`：把命令写进单位并规划路径（`planRoute`，A* 绕行水域）；`move`/`attackMove` 都真实显示绕行路径。

### `src/simulation/map.js`
地图 JSON 模型与校验：
- `MAP_VERSION`、`migrations`、`migrateMap`（版本迁移链，机制就绪）。
- `validateMap`：结构 + 可玩性校验（尺寸、地形格、双阵营城市/出生点），并检查**城市 id / 出生点 id 唯一**。
- `makeTerrain`：地形访问层（`terrainAt`、`passableAt`、`moveMultiplierAt`、`defenseModifierAt`、格子索引）。
- `parseMap`：迁移 + 校验 + 规范化输出；`normalizeSpawns` 给缺 id 的出生点补 `s1`、`s2`…（跳过已占用的名字），使关卡能用 `{ spawnId }` 精确引用手写地图的出生点。

### `src/simulation/entities.js`
实体工厂，返回**纯数据对象**：
- `makeUnit({id, faction, type, x, y})`：从 `values.units` 取类型属性，初始化 hp/补给存量/状态/路径/目标/冷却/补给/效果倍率/最后目视等。
- `makeCity({id, x, y, faction})`：城市 + 占领进度 + 生产计时。

### `src/simulation/capability.js`
「血量 ↔ 能力」的**唯一**曲线（`gdd.md §4`、`§6`），纯函数、可 headless 单测：
- `capabilityRatio(unit)`：`clamp(血量 ÷ 血量上限 ÷ combat.hp_dps_ratio, 0, 1)`——血量 ≥ `hp_dps_ratio`（0.8）× 上限时为 1（封顶），往下按血量比例线性下降；下限夹 0（`damageUnit` 允许 hp 短暂为负，负血量绝不能算出负消耗）。
- **两个消费方共用它**：战斗伤害（`systems/combat.js`）与**交战补给消耗**（`systems/supplyStock.js` 的 `inCombat`/`inCombatSupport`，含溃逃受击扣的那一份）；AI 战力估算（`ai/tactics.js` 的 `combatPower`）也读它。改 `combat.hp_dps_ratio` → 三处一起变。
- 历史上它叫 `combat.calcDamageRatio`（兰切斯特定律 + 预备队阈值），因为不再是战斗专属，已移出 `combat.js` 并补了 0 下限。

### `src/simulation/loop.js`
固定时间步长累积器：
- `createLoop(world)`：`advance(renderDt, speed)` 每帧最多补 `maxCatchUpTicks` 个 tick，掉帧丢弃积压；`accumulator` getter。
- `advanceTo(world, targetTime)`：直接推进到目标时刻（测试/headless 用），分出胜负即停。

### `src/simulation/commands.js`
统一命令接口：
- `commandTypes`：`['move','attackMove','attack','hold']`。
- 工厂 `moveCommand(path)` / `attackMoveCommand(target)` / `attackCommand(targetId)` / `holdCommand()`。
- `validateCommand(command)`：类型 + 参数结构校验。

### `src/simulation/spatial.js`
均匀网格空间分区（`SpatialGrid`）：
- 每 tick 重建（O(n)），邻居查询近似 O(1)/单位，**禁止全单位两两检测**（`REQUIREMENTS.md §5`）。
- `rebuild(units)` / `cellKeyAt(x,y)` / `query(x,y,radius)`（按桶序，确定性）。

### `src/achievements.js`
**成就系统（数据 + 判定，纯函数）**（`gdd.md §11`）：不依赖 DOM，页面只负责渲染，因此可单测。
- `ACHIEVEMENTS`：成就定义（`id / name / stars(1~3) / desc / hint / condition(ctx)`）；点名的三条：宿北战役、塔山战役、睡衣登山大赛冠军。星级是成就本身的稀有度，解锁后计入总星数。
- `evaluateAchievements({ progress, stats, levels, climbCleared, customMapSaved })` → 每条成就 + `unlocked`；`summarizeAchievements(list)` → `{ unlocked, count, earnedStars, totalStars }`。
- 数据源（全部本地存储）：`war-of-dots.campaign-progress`（通关）、`war-of-dots.level-stats`（每关最快用时/最低伤亡，`result.html` 写入）、`war-of-dots.climb-cleared`（`public/climb/climb.js` 登顶写入）、`war-of-dots.custom-map`（编辑器保存写入）。键名常量在本模块导出，另有测试守住各写入方的字面量不漂移。

### `src/entries/achievements.js`
成就页（`achievements.html`）入口：读本地战绩 → `evaluateAchievements` → 渲染卡片与总进度条。已解锁优先、同状态按星级降序排列。


### `src/simulation/influence.js`
**影响力场与实际控制线的纯计算**（`gdd.md §9`）：不依赖 `World` / Phaser / DOM，输入是影响力源数组、输出是网格与线段，可 headless 单测。
- `influenceAt(distance, source, curve)`：单个源的影响力。**核心圈 `source.coreRadius` 是绝对值**（单位 = 碰撞体积、城市 = `controlLine.city.coreRadius`、占领点 = `controlLine.capturePoint.coreRadius`），圈内满强度；出圈按原型手感掉到 20%（`coreExitRatio`），之后中圈/外圈两段线性衰减（断点按 `influenceRadius / curve.maxDistance` 等比缩放），到影响力半径归零。
- `createField(width, height, cellSize)` → `{ cols, rows, values, raw, scratch, ready }`；`values` 是平滑后的影响力（对外），`raw` 是本次重算结果。
- `rebuildField(field, sources, cfg)`：清零 → 按半径框（**只遍历源影响力覆盖到的格子**，不扫全图）累加带符号影响力（蓝 +、红 −）→ 按 `temporalSmoothing` 与上一次做指数平滑 → 可选 3×3 均值模糊（`fieldBlurPasses`，**必须为 0**：模糊会把邻格的敌方影响力混进单位脚下，实测让「单位所在格归自己阵营」的失败率从 0.000% 涨到 5.3%）→ 可选 `partitionMap`。
- `partitionField(field, epsilon, fillValue)`：多源 BFS（曼哈顿 Voronoi）把"双方影响力都够不到"的格子按**最近的阵营**填上 ±`fillValue`。填充值远小于真实影响力下限（2.5），所以只决定归属、不挪动真实战线。作用：控制线铺满整张地图（含迷雾与从未探索区），否则战线会在没有部队的旷野断开——看起来像"迷雾把控制线吃掉了"。
- `guaranteeUnitCells(field, marks, minMagnitude)`：**单位所在格的硬保证**——每个存活单位脚下那一格若符号不对，就按原量级翻转回自己阵营（最小扰动）。补上核心圈挡不住的三种情况：城市（核心圈 20px / 强度 80）与占领点（核心圈 20px / 强度 60）压过单位身体的 100；格心落在碰撞半径之外；多个敌军贴身叠加。
- `contour(field, epsilon, out)`：marching squares 取 **0 等值线**，即实际控制线线段（`{x1,y1,x2,y2}`）。只有 2×2 格块里**同时存在正格与负格**才输出线段——否则「只有蓝方影响力」的区域会沿着自己影响范围的外沿画出一条假分界线。鞍点（`code 5/10`）用格心值拆分。
- `chainSegments(segments)`：按端点把线段串成折线（端点量化到 0.01 px 再匹配——相邻格块共享边上的过零点是同一对格值按同一公式算出来的，浮点结果一致）。一条战线 / 一个包围圈 = 一条折线，闭合的包围圈首尾同点。
- `smoothPath(points, iterations)`：Chaikin 切角平滑（每轮保留首尾、每段取 1/4 与 3/4 两点）。**只磨几何、不动影响力场**——所以它不会像空间模糊那样破坏「单位所在格归自己阵营」。
- `buildPaths(segments, iterations, out)`：串联 + 平滑，产出渲染用的折线数组。

### `src/simulation/systems/controlLine.js`
实际控制线系统（`gdd.md §9`）：
- `updateControlLine(world)`：每 `refreshTicks`（默认 6 tick = 10 Hz）重算一次影响力场，写 `world.controlLine`（网格）、`world.controlLineSegments`（原始线段）与 `world.controlLinePaths`（串联 + 平滑后的折线）；非重算 tick 直接返回，保持上一次结果。
- `collectSources(world)`：影响力源 = 存活单位 + 城市 + 占领点；蓝 `sign=+1`、红 `−1`，中立（`'neutral'` / 未占领）不产生影响力。**核心圈取绝对值、每个源一个数值**：单位用 `unit.radius`（碰撞体积），城市用 `controlLine.city.coreRadius`（**20**），占领点用 `controlLine.capturePoint.coreRadius`（**20**）——两者都与各自的占领半径 60 脱钩，所以核心圈只覆盖「脚下这块地」，单位始终在自己阵营的控制区内；城市与占领点不享受该保证（被占领 / 争夺时可以处在敌方控制区）。
- **不读战争迷雾**：影响力源是双方全部存活单位（含迷雾里的敌军），战线反映的是真实分界、不受视野限制。
- **铺满全图**（`partitionMap`）：无影响力的格子按最近阵营归属，控制线会延伸到地图边界，因此在迷雾/未探索区也能看到战线随战况更新。
- **单位所在格的硬保证**（`guaranteeUnitCell`）：重算后对每个存活单位脚下那一格做最小幅度符号纠正，保证"自己的兵不会站在敌方控制区里"（攻城、被贴身都成立）。
- 城市与占领点在争夺中（`captureProgress > 0`）按进度线性削弱现属方强度。
- 放在 tick 顺序末尾（`victory` 之前）：它只读位置/归属/占领进度。
- **补给线的屏障**：`supply` 读**上一 tick** 的控制线场判定「敌方实际控制区」（10 Hz 重算，最多陈旧 16 ms），补给线不允许穿过它——屏幕上那条控制线就是补给能走到的边界（`gdd.md §8`）。除此之外不参与战斗 / 补给存量 / 视野 / 胜负判定。

### `src/simulation/level.js`
关卡（Level）标准格式 v1——**"一局游戏"的完整规格**（`architecture.md` §7.1）：
- 字段：`id` / `name` / `subtitle` / `type`（`offensive` 进攻 | `defensive` 防守 | `annihilative` 歼灭，白名单见 `LEVEL_TYPES`）/ `difficulty` / `map`（引用地图路径）/ `anchors`（命名锚点表）/ `forces`（编队式兵力）/ `ai`（事件→动作脚本，**可写单个对象或数组＝多方剧本**）/ `victory`（胜负条件，见 `buildMission`）。
- **多方剧本**：`ai` 写数组时 `parseLevel` 归一化成 `level.scripts`（全部脚本），`level.ai` 仍是第一个脚本（向后兼容）；每个脚本只指挥自己阵营，蓝方剧本（我军增援）必须用 `units: { group }` 限定自家编队。校验与引用交叉校验逐脚本进行，错误定位到 `ai[i].…`。
- `validateLevel()` 结构 + 语义校验（阵营、单位类型、坐标引用与锚点定义、触发条件与动作类型、`repeatEvery > 0`）；`parseLevel()` 失败即抛错并聚合原因。
- **坐标引用 PointRef**：`{ x, y }` / `{ spawn }` / `{ spawnId }` / `{ city }` / `{ cityId }` / `{ capturePointId }` / `{ anchor }`，统一由 `resolvePoint(ref, world, anchors)` 解析（顺序：绝对坐标 → 命名锚点 → spawnId → spawn → cityId → capturePointId → city；解析不到返回 `null`）。`resolveAnchor` / `resolveTarget` 为同一函数的历史别名。
- `parseAnchors()` 校验命名锚点表（禁止锚点引用锚点）；`validateLevelReferences(level, mapData)` 在地图载入后交叉校验 `spawnId` / `cityId` / `capturePointId` / `anchor` 是否真实存在（`BootScene` 调用，仅告警）。
- `deployForces(world, forces, anchors)` 按数据部署：落点 = 锚点 + `offset` + `spacing × i`；编队的 `objective` 会写到单位上（`unit.objective`），供歼灭胜负条件识别「指定单位」。
- `buildMission(level, world)` 把 `victory` 解析成运行时任务规则（`world.mess`）：`{ mode, faction, time, points }`；`captureAll` / 未声明 → `null`。
- 常量：`LEVEL_VERSION`、`LEVEL_TYPES`、`VICTORY_MODES`、`OBJECTIVE_ANNIHILATE`、`FORCE_OBJECTIVES`、`AI_ACTION_TYPES`、`FACTIONS`、`LEVELS_INDEX_PATH`、`levelPath(id)`。

### `src/simulation/ai/supply.js`
**AI 的补给视野**（`docs/ai-design.md` §3.7）：纯函数，只读 `world` 与 `values`，可单测。
- `supplyPolicy(cfg)`：把档位 `supplyCaution`（0 激进 ~ 1 保守）插值成 AI 用的阈值——`hardReachCost`（行动边界 = `supply.path.maxCost`，与档位无关）、`reachCost`（软范围，仅用于打分）、`weightScale`（补给项倍率）、`forcedMarchStock`（急行军门槛）、`regroupRatio`（回城阈值，标准档正好等于 `ai.regroup.supplyRatio`）。
- `supplyCostOf` / `withinSupply`：查`world.supplyFields[faction]` 的代价场（O(1)）；**没有场时视为"未知 → 不限制"**（首帧、该阵营无城）。
- `bestSupplyCity`：撤退目标 = 补给代价最低（代价场的 `owner`）的那座城；断补时退回欧氏最近。
- `clampToSupply`：把目标点夹进行动边界内（沿"自身 → 目标"二分 12 次）。
- `isLowSupply` / `squadLowSupply`：硬约束判定（断补 或 存量比例 < `lowRatio`；小队看断补占比与平均比例）。
- `supplyScore`：补给打分项（存量 0.5 + 战场是否在可达区内 0.3 + 是否断补 0.2），供 `tactics.js` 与 `front.js` 使用。

### `src/simulation/ai.js`
脚本敌军（`ScriptedAI`）：**解释关卡 JSON 里的「事件 → 动作」脚本**，引擎不含关卡特例：
- 只读世界状态，通过 `world.issueCommands` 下发（与人类共用统一命令接口）。
- 触发条件：`{ time }`（经过秒数）、`{ enemyCrossX }`（任一敌军越过该 x）；首次满足**立即执行一次**动作，`repeatEvery` 存在时此后周期重复。
- **条件规则 `rules`（`{ when, then, otherwise?, after?, until?, repeatEvery? }`）**：持续状态语义，用来看局势下命令（例：占领点在手 → 坚守，丢了 → 撤退）。`when` 额外支持 `{ capturePoint, owner }` / `{ city, owner }`（`owner` = `self` / `enemy` / `neutral` / `blue` / `red`；据点值可为 id 数组 = 任意一个符合）与 `{ ownUnitsBelow }` / `{ enemyUnitsBelow }`。
- **只在条件翻转的那一帧下发命令**（`updateRule` 比对上一次的布尔值，`undefined` 视为尚未求值 → 首次也下发一次），避免每帧重发把行军路线反复重置；`after` / `until` 是生效时间窗，`repeatEvery` 让条件成立期间周期重发 `then`（一次 update 最多补发一次，不追帧）。
- 动作：`spawn`（可按 `order` 逐单位下令，可用 `group` 给增援打标签）、`attackNearest`（各打最近敌军，无敌人时转向 `fallback`）、`attackMove`（可带 `forced: true` → 急行军）、`engage`（**战术层**：队形推进 + 不添油 + 集中火力 + 追击溃逃，见下）、`hold`、`retreat`（`to` 省略时撤向最近的己方城市，无城可退则驻守）；所有点位经 `resolvePoint(ref, world, this.anchors)` 解析，构造时传入关卡 `anchors`。
- **只指挥一部分部队**：每个动作可选 `units: { group: 'x' }`，由 `ownUnits(selector)` / `commandUnits()` 过滤 `unit.group`（标签来自 `forces[].group` / `spawn.group`）；省略 = 全军，选不到单位时静默跳过。
- **`engage` 与战术层**（docs/ai-design.md 阶段一）：`doEngage` 把编队登记进 `intents`（编队 → 目标点），此后每 `values.ai.decisionIntervalSeconds` 由 `runTactics()` 决策：① 队形槽位推进 ② 脱离队形的先锋 `hold` 等主力 ③ 集中火力（同目标 ≤ `maxAttackersPerTarget`）④ 溃逃目标优先。脚本下 `hold` / `retreat` / `attackMove` 会 `clearIntents`（脚本意图优先）；命令签名去重避免重置行军路线。
- **补给约束**（阶段四，docs/ai-design.md §3.7）：`runTactics` 先算 `squadLowSupply`（断补占比 ≥ 0.5 或平均存量 < 0.3）→ 视同"该回去补给了"，直接进 `regroup`（撤向**补给代价最低**的城）；目标点经 `clampToSupply` 夹进 `supply.path.maxCost` 边界内；个别低补给单位自己 `move` 回补给城、不再前顶（也不主动接战）；`shouldForceMarch` 额外要求"全队存量 ≥ 档位门槛 + 无人断补 + 目的地可达"；`pickScouts`/`scoutFrontier` 同样受补给约束。
- **补给战术**（阶段五，docs/ai-design.md §3.8）：每轮决策先算 `interdictionPlan`（敌方走廊的压制点，仅公开信息）并作为软权重传给 `chooseApproach`/`chooseWeakSpot`；`reserveMission` 让**闲置的预备队**去执行解围（`reliefPlan`）或断粮（`interdictionPlan`）任务、目标点再经 `clampToSupply` 夹回己方补给可达区，没有任务时按旧行为在主力后方待命。
- `nearestEnemy` 用空间区扩张半径查询，避免全图扫描。
- `retreatCity(point)`：撤退目标 = `bestRetreatCity`（补给代价最低、但**避开被围的城**，见 `ai/relief.js`），没有城时才退回 `nearestOwnCity` 的欧氏最近。

### `src/simulation/ai/`（战术层纯函数，docs/ai-design.md）
- `tactics.js`：`combatPower`（复用 `capability.js` 的 `capabilityRatio` + 缺补倍率 + 地形防御）/ `localBalance`（半径内双方战力占比）/ `targetValue` / `scoreAttack`（含集火上限，达上限返回 null）/ `chooseTarget`（溃逃优先，再比分数）/ `enemiesWithin`（走空间网格）。
- `squad.js`：`formationSlots`（line / column / wedge，按朝向旋转）/ `squadAnchor`（形心向目标推进 `advanceStep`，不越过目标）/ `needsColumn`（沿直线采样水域/不可通行）/ `cohesionRatio`·`isCohesive`·`isRushingAhead`（不添油）/ `assignSlots`（按距锚点距离 + id 的确定性分配）。
- `front.js`（阶段二 B）：复用 `world.controlLineSegments`（控制线 0 等值线 = 实际战线）定位战线 → `pointStrength` 采样兵力比（空点记 1）→ `chooseWeakSpot` 选最弱段 / `approachAxes` 生成接近轴 → `chooseApproach` 按"敌弱 + 近 + 地形合口味 + **补给代价低** + **压得住敌粮道**"挑轴 → `approachWaypoint` 两段式推进；`terrainPreference` / `feintAxis` 供档位使用。**脚本目标点不变，只选接近方向。**
- `supply.js`（阶段四）：AI 的补给视野（`supplyPolicy` / `supplyCostOf` / `withinSupply` / `bestSupplyCity` / `clampToSupply` / `isLowSupply` / `squadLowSupply` / `supplyScore`），见上文。
- `interdiction.js`（阶段五）：断敌粮道——`enemyCorridors`（看得见的敌单位 → 它最近的敌城，走廊太短/记忆条目不算）、`cutCountAt`（该点压住几条走廊，半径 = `controlLine.unit.influenceRadius`）、`corridorCandidates`（0.3/0.5/0.7 采样）、`interdictionPlan`（压制面 + 安全 + 距离打分，只出"值得为它改方向"的点）、`interdictionScore`（接近轴/战线点的压制打分）。**只用公开信息，绝不读 `supplyFields[敌]`。**
- `relief.js`（阶段五）：护己方粮道——`supplyUserCounts` / `supplyUsers`（按欧氏最近己城统计每城养兵数）、`cityThreat`（看得见的围城敌军及其形心 + `captureProgress`）、`reliefPlan`（值得救 + 打得过 + 赶得上 → 压向围城敌军的形心；只看得到"城正在被夺"时改停在城外 `standoff`）、`bestRetreatCity`（首选补给代价最低的城，它被围时改挑"代价 + 被围罚分"最低的）。
- `presets.js`（阶段二 F / 阶段六）：`AI_PRESET_NAMES`（cautious / standard / sly）、`AI_TUNING_KEYS`（6 个扁平键：reserveRatio / pursuitRadius / useForcedMarch / terrainBias / feint / **supplyCaution**）、**`AI_TUNING_GROUPS`**（4 个域 27 个纯数字项的嵌套覆盖 + 区间校验：weights / supply / interdiction / relief）、`resolveAiConfig(preset, tuning)`（档位覆盖 values.ai，tuning 再覆盖，嵌套域只做一层浅拷贝，且 `pursuitRadius` 同步为 `engageRadius`）、`validateAiTuning`（关卡结构校验：档位 / tuning 键 / 嵌套子键与区间 / `ai.fog` 布尔）。
- `perception.js`（阶段三）：`visibleEnemies`（`isSpotted`，含森林隐蔽）/ `rememberedEnemies`（`lastSeen` + 年龄衰减，低于 `staleConfidence` 即遗忘，条目带 `ghost: true`）/ `knownEnemies`·`perceive`（可见 + 记忆，或全知）/ `unexploredFrontier`（fog 网格上有界 BFS 找最近未探索格，同深度优先靠近敌城）/ `awarenessSummary`（调试用情报摘要）。

### `src/simulation/systems/movement.js`
移动系统：
- `updateMovement`：沿路径行进；交战中冻结；溃逃单位不受指挥、向最近己方城市全速撤退、无路可退/被困超时投降。
- `findPath`：A*（4 方向，水域不可通行，森林代价更高；终点不可通行就近取格），含模块级 `pathCache` 确定性共享。
- `planRoute`：下达命令时对每个途经点逐段 A*，返回去掉共线点的真实路径（`move`/`attackMove` 共用）。
- 导出 `transitionToNewRoute`（新命令与当前路线合并，避免原地掉头）。
- `forcedMarchMultiplier(world, unit)`：急行军速度倍率——除水域之外的地形 `values.movement.forcedMarch.speedMultiplier`（1.5，与地形/缺补速度倍率叠乘），水面上返回 1（不给加成）。
- 急行军代价在 `moveAlongRoute` 里结算：每秒 `hpPerSecond` 掉血（走 `world.damageUnit`，计入伤亡），掉光即 `killUnit(unit, 'forcedMarch')`。溃逃（`ignoreStockEffects`）不参与。
- `clampToMap`：把目标点夹进地图矩形——`terrain.passableAt()` 会把格子索引夹到边缘格，因此**地图外的坐标看起来也可通行**，不夹取的话单位会走出地图、进入画布上未渲染的区域。
- `segmentBlocked`、`simplify`、`separateOverlaps`（软排斥）。
- **水域通行不卡死**（修过一轮 bug，`gdd.md §5`）：
  - `waterSafeStep`：水里沿目标直线行进；前方 `clearance` 内有友军时减速让路，但判据比软排斥分离距离**更紧** `movement.waterYieldMargin`（4 px）——分离每 tick 保证圆心距 ≥ clearance，同阈值会让一对卡在阈值上的友军互相"让路"却没人推，双方步长恒为 0（实测僵死）。
  - 水中停滞判据看**朝当前路点有没有真的前进**（`MIN_WATER_PROGRESS`），而不是单 tick 位移：挤住的单位会"前进量与推回量抵消"，位移不为 0 却几秒不前进；判为卡住后先 `tryRerouteBlockedUnit` 侧向绕行。
  - `skipUnreachableWaypoint`：轨迹点够不着/被挡住时**只跳过这个采样点**继续走后面的轨迹。旧实现在这些分支把整条轨迹清空并 hold，于是单位停在半路（水里就是"卡在河中央"）。水域里永远不整条丢弃。
  - `applySeparationPush`：水域软排斥也带可通行性守卫（陆地软排斥本来就有），不把单位推进高山格（那里移动倍率 0 = 永久出不来）；水里也不会主动踏进不可通行地形（会落回常规分支去 A* 绕行）。

### `src/simulation/systems/combat.js`
战斗系统：
- 交战判定：距离 ≤ 双方半径和 + `contactTolerance`（**接触才开打**，比按攻击距离更严格）。
- 目标选择：优先当前目标直至死亡，否则取接触范围内最近（`config.combat.targetPriority`）。
- 伤害 = 基础 × 缺补削弱 × 防御者地形修正 × **战斗力系数（血量口径，`capability.js` 的 `capabilityRatio`）** × **攻方地形修正**（`values.terrain.attackMultiplier`，站在水里 ×0.5）× 防御姿态（`combat.defend`，防御者原地不动时 ×0.75）× **溃逃/失序易伤**（`combat.disorderedDamageTaken`，目标处于 `rout`/`unordered` 时 ×1.5）；每单位独立攻击冷却，首次接触立即攻击。
- 曾在本模块导出的 `calcDamageRatio` 已移到 `src/simulation/capability.js`（`capabilityRatio`）：战斗伤害与交战补给消耗共用同一条曲线，AI 战力估算也改从那里引入。
- **attack-forward**：`move` 与 `attackMove` 都沿路线行军，接敌停下交战，敌军清空后恢复行军。

### `src/simulation/systems/supplyStock.js`
**补给存量系统**（`gdd.md §6`，机制原本是士气，数值含义已改为「剩余补给存量」）：
- `updateSupplyStock(world, dt)`：先按状态分派（溃逃/失序走各自的搜集分支），其余单位走 `consume`（进货 − 消耗），最后统一结算归零掉血。
- **进货**：`unit.supplyIntake`（由 `supply.js` 每轮结算写入的补给存量/秒）；**消耗**：基础口粮 −1/s（任何状态都吃，与下面叠加）、交战 −8/s、参战未瞄准 −3/s、行军 −5/s（乘 `terrain.marchSupplyMultiplier`，道路 0.5）、急行军 −10/s 取代行军值，有路线（进攻）时交战/行军项再乘 1.3。所以断补的驻军也会慢慢耗尽（轻步兵 80 s 见底 → 周期性失序）。
- **交战项乘战斗力系数**（`capability.js` 的 `capabilityRatio`，与伤害公式共用 `combat.hp_dps_ratio`）：同一状态下伤得越重、交战消耗越少（血量 40% → 交战消耗 ×0.5；血量 ≥80% → ×1，与旧行为一致）。基础口粮 / 行军 / 急行军 / 进货 / 就地搜集都**不**乘——残血驻军照样吃饭、残血行军照样 −5/s。溃逃受击时扣的那一份也是交战项，同样乘系数。
- **阈值**：`effectsFor(ratio)` 按**存量比例**返回倍率（<0.6 缺补 ×0.75/×0.85；<0.3 将尽 ×0.5/×0.7）；`stockRatio(unit)` 是统一口径（combat / movement / AI / HUD 都用它）。
- **归零**：正被攻击 → 溃逃（撤向己方城市，无城可退立即投降）；未受攻击 → 失序原地；两者都 +8/s、+10/s 就地搜集，恢复到 `stopAt` 停止。
- `applyAttrition`：**存量归零才掉血**（`supply.attritionHpPerSecond`，走 `world.damageUnit` 计入伤亡）——补给线被切断本身不掉血。
- 已删除的旧士气项：附近友军 +2/s、附近城市 +5/s（含 `cities.recovery.moralePerSecond`）、友军阵亡 −10。

### `src/simulation/supplyPath.js`
**补给线寻路的纯计算**（`gdd.md §8`）：不依赖 Phaser/DOM，输入是 `World`（只读地形 / 城市 / 控制线），输出是代价场或折线，可 headless 单测。
- `supplyGrid(world)`：补给网格（`supply.path.cellSize`，默认 20 px，比 10 px 地形格粗一档）。每格的进入代价 = `格边长 ÷ 通行倍率`（等效像素）；粗格取格内**可通行地形的平均倍率**，整格不可通行（或开 `waterIsBarrier` 且含水域）才是 `Infinity`。按地形缓存（`WeakMap`），避免每轮重算。
- `buildBlockedMask(world, faction, out)`：把「敌方实际控制区」预计算成 `Uint8Array`（1 = 不可通行），判定读 `world.controlLine` 的带符号影响力，阈值取 `supply.path.controlBlockMin`（0.01）——**只认真实影响力**，控制线给无人区域铺的名义归属不算实际控制。
- `buildSupplyField(world, faction, field, { cities, mask })`：从指定城市出发的**多源 Dijkstra**（8 邻域、对角 ×√2、禁止从两格障碍间斜穿、代价超过 `maxCost` 即停），产出 `cost`（到最近可用城市的代价）与 `owner`（是 `world.cities` 的哪一座）。`field` 的工作数组复用，支持 decrease-key。
- `findSupplyPath(world, faction, from, to, { ignoreControl })`：单点到单点的 A*（octile 启发）。渲染层用它画补给线；`ignoreControl: true` 得到"本来该走的那条路"，用于断补时画红色虚线。
- `supplyFactor(cost)`：`clamp(1 − (cost − 100) / 800, 0.2, 1)`。
- `inEnemyControl(world, faction, gx, gy)`：单格判定（渲染层标切断点用）。

### `src/simulation/systems/supply.js`
补给运力结算与城市维护（`gdd.md §8`）：
- **两档节流**：分配每 `refreshSeconds`（0.5 s）重跑；代价场每 `fieldRefreshSeconds`（1 s）重算一次并把 `world.supplyToken` +1（渲染层据此失效路径缓存）。
- **分配**（`distribute`）：**按缺口申领**——`claimOf(unit) = min(demandPerUnit, 缺口存量 ÷ stockPerPoint)`，存量已满的单位申领 0、**不占用运力**（多余运力流向缺补的部队，避免"收进来再被 clamp 丢掉"的溢出）。有缺口的单位按「到最近可用城市的代价」升序排序，逐个支出城市点数；城市要付出 `申领量 ÷ 因子` 点，单位实收 = 付出 × 因子；某城点数用光就把它剔出种子、用临时场重算一次（单位于是落到下一座最近的城）。全部城用光或够不着 = 断补。
- 结果写进单位：`supplied`（**补给线是否可达** = `supplyCost` 有限；满额但被围也是 false）、`supplyRatio`（**本轮申领满足度**）、`supplyIntake`（进货速率 = 实收点数 ÷ 结算间隔 × `stockPerPoint`，供 `supplyStock.js` 消费）、`supplyEdges`（本轮的每条补给边 `{ cityId, cost, factor, points, received }`，按代价升序；满额单位记一条 `standby: true` 的 0 流量边供渲染画淡线）、`supplyCost`（到最近己方城市的代价）；城市侧记在 `world.citySupplyLoad`。
- 己方城市附近恢复生命 +3/s；城市生产当前**关闭**（`values.cities.production.enabled = false`；逻辑保留：12s/轻型，本轮运力用光或被围暂停）。
- **缺补给损耗**：**存量归零**后生命 `−attritionHpPerSecond`/s（断补只停止进货，不掉血，见 `supplyStock.js`）。
- **环境损耗**：身处水域的单位每秒掉 `terrain.waterHpPerSecond`（1）点血（走 `world.damageUnit`，计入伤亡），掉光即溺水阵亡（`cause = 'water'`）；桥梁是独立地形，不算水域。

### `src/simulation/systems/capture.js`
城市占领：
- 每单位 5%/s、上限 15%/s；守方在场冻结；攻方全部离开后 3%/s 衰减；达到 100% 易主（记录 `cityCaptured` 事件）。

### `src/simulation/systems/fog.js`
战争迷雾：
- 每格三态 `FOG_UNEXPLORED=0` / `FOG_EXPLORED=1` / `FOG_VISIBLE=2`。
- 可见 = 己方单位视野圆 ∪ 己方城市视野圆；森林中敌军仅 `forestSpotDistance` 内可目视。
- `isSpotted` 判定；维护敌方 `lastSeen` 最后已知位置。

### `src/simulation/systems/victory.js`
胜负判定（写 `winner`/`endTime`，推 `victory` 事件）。**没有"通用基础规则"**，每个关卡完全由自己的 `victory` 任务规则结束：
- `normalVictory`（`mode: 'normal'`，也是 `captureAll` 与**不声明 victory** 时的缺省）：**占领地图上全部城市**即胜——对称判定，谁占光城市谁赢；占领点不计入。
- `defendVictory`：据点全丢立即判负；到时限结算——仍有据点不在手里则防守失败，全部守住即胜。
- `attackVictory`：时限内拿下全部据点即胜，超时判负（⚠️ 先判据点再判超时）。
- `annihilationVictory`：**消灭全部指定单位**（`unit.objective === 'annihilate'` 的敌军；未标记的敌军不计入）；声明了 `time` 则超时判负。
- ★ 除 `normal` 外**没有任何"占光城市即胜"的规则**：歼灭战/进攻战/防守战里把敌方城市全占了也不会结束（旧版那条无条件基础规则会让歼灭战提前获胜，已按需求移除）。
- `world.mess` 为 `null` 时按 `normal` 处理（编辑器试玩 / 没声明 victory 的关卡），否则那一局永远结束不了。
- `world.mess` 由 `GameScene` 用 `level.js` 的 `buildMission(level, world)` 写入（来源是关卡 JSON 的 `victory`）。

---

## 五、控制器（`src/controllers/`）

### `src/controllers/gameController.js`
游戏控制器：暂停、游戏速度与**开局准备阶段**（`gdd.md §11`）：
- `paused` / `speed` / `prepRemaining` / `isPrepping()` / `tickPrep(dt)` / `skipPrep()`；`onChange` 供 HUD 订阅。
- 准备阶段按**真实时间**倒计时（不受游戏速度影响）；`GameScene.update` 在准备阶段只调 `tickPrep`、不调 `loop.advance`，所以部队与脚本敌军都不行动，但输入层照常下单。编辑器试玩会 `skipPrep()`。
游戏控制器（`createGameController`）：
- 状态：`paused`、`speed`；`togglePause`/`setSpeed`（限 `values.simulation.speeds` 档位）。
- `onChange(listener)` 订阅，供 GameScene/HUD 刷新。被 GameScene 读取（暂停时跳过模拟 tick）。

---

## 六、国际化（`src/i18n/`）

### `src/i18n/index.js`
查表函数：
- `t(key, params)`：查当前语言字典，支持 `{name}` 插值；缺键在开发模式 `warn` 并返回键名。
- `currentLocale = 'zh-CN'`（默认中文）。

### `src/i18n/zh-CN.js`
中文文案（默认）。按顶栏/左栏/战场/右栏/单位/事件/胜利/编辑器/主页分组。

### `src/i18n/en.js`
英文文案（预留，未启用），与 zh-CN 同键。

---

## 七、输入层（`src/input/`）

输入层只**产命令/选择状态**，不直接改模拟。

### `src/input/selection.js`
单位选择：
- 只维护选中 id 集合（`selected`），`isSelected`、`select(ids, { additive })`、`clear`、`onChange`。
- 交互判定（bugfix）：**按下即命中己方单位 → 本次为点击单选，绝不进入框选**；只有按下空地并拖动超过阈值才框选。
- `getDragRect()` 供渲染层画选框；轨迹绘制期间由 `setRouteBlocked` 复位。

### `src/input/orders.js`
指挥输入：
- 右键空地 → `attackMove`；右键目视敌军 → `attack`。
- 左键从己方单位拖动 → 采样多路径点 `move` 轨迹（单位间按 `routeUnitOffset` 错开）。**不需要先框选**：按下命中的单位会被立即设为当前选择（Shift 为追加），拖动超过 `dragBoxThreshold` 才下达移动命令；只点击不拖动则把选择**收拢到点中的这个单位**、不下达命令（框选之后也能直接单击切换选择）。单位重叠时取**最近**的一个。
- `isRouting()` / `getCurrentRoute()` / `onOrder()`。

### `src/input/keyboard.js`
快捷键：空格暂停/继续、Esc 取消选择、1/2/3 切换速度（绑定到 controller）。

---

## 八、渲染层（`src/rendering/`）

渲染层**只读世界状态**。

### `src/rendering/hud.js`
DOM HUD：
- 读取/订阅暂停、速度、选择、订单；`els` 集合采集所有 HUD DOM 元素。
- `renderUnitList`/`renderCityCard`/`renderMission`/`renderEvents`/`renderTimer`/`renderVictory`。
- `resultQuery({ win, campaignId, timeText, casualties })`：**结算页 URL 参数**（纯函数，可单测）——
  `result` / `level` / `t` / `casualtiesBlue` / `casualtiesRed`（伤亡取整）；`revealResult` 用它跳转 `result-video.html`。
- **胜负节奏**：`renderVictory` 只负责在 `world.winner` 置位时启动 `ui.resultHoldMs`（1 s）延时，
  `revealResult` 才是真正跳转/弹窗的那一步——这一秒画面定格在最后的战场（`GameScene.update` 已因 `world.winner` 停止推进模拟与 AI）；
  场景 SHUTDOWN 时 `destroy()` 取消未触发的延时，避免离开页面后还被结算跳页拽走。
- **toast 顶部弹窗已移除**（`showToast` 为 no-op），进度只保留在右侧战场通讯日志。
- `returnFromGame`：`fromEditor` 时跳转 `/editor.html?fromPlaytest=1`，否则 `reload` 重开教学关。

### `src/rendering/editorToolbar.js`
DOM 编辑器工具栏：
- 保存/载入（localStorage）、导出（下载 JSON）、导入（文件 API）、新建对话框、试玩入口、校验状态栏。
- `createEditorToolbar(scene, store, callbacks)` 采集 `#editorToolbar` 等 DOM，按 `[data-i18n]` 填充文案。
- 操作只改 `editorStore`，画布刷新由 EditorScene 回调完成。
- 「新建」对话框的尺寸下拉框会先对齐**地图当前尺寸**（预设之外的尺寸临时补一个选项），避免下拉框显示的尺寸与地图实际尺寸不一致。

### `src/rendering/terrainRenderer.js`
静态地形：
- 四类地形按逻辑网格着色，**烘焙为纹理**后以单个 `Image` 显示，避免每帧数千矩形的 Graphics 重放。
- 桥面横纹标记；`generateTexture('terrain-static', ...)`。

### `src/rendering/fogRenderer.js`
迷雾罩层：
- 按玩家阵营（blue）网格叠加；当前可见透明，其余（未探索 + 已探索）统一盖一层**浅色/深色迷雾**（`0x0c1416, α0.5`），不再区分深浅。
- 仅在网格变化时重绘并**先清空 canvas 再 re-bake**（修复迷雾不随移动更新的 bug），平时单个 Image。

### `src/rendering/unitRenderer.js`
单位与城市（每帧重绘，只读状态）：
- 己方完整渲染；敌军仅在目视时渲染实时状态，否则画**最后已知位置虚影**（`drawGhost`）。
- 选中态：去掉黄色亮圈，改为**单位变深色**（`dim` 提黑 + 去饱和）；未选中蓝亮 `0x2f6bff`。
- 血条/补给存量条：仅己方显示，尺寸≈圆点直径，黑色框底；HP≥50% 绿、<50% 黄、<20% 橘红，补给存量青蓝；固定于单位真实位置不跟随震动。
- 血量裂纹：<50% 轻破碎(6 条)、<20% 重破碎(13 条)，`mulberry32(unit.id)` 确定性种子。
- 交战震动：沿「自身→敌人」连线方向的低频小幅度位移（仅渲染层，不影响模拟坐标）。

### `src/rendering/controlLineRenderer.js`
实际控制线（`gdd.md §9`）：**只描线，不做判断**——影响力统计与归属判定在 `simulation/influence.js` + `systems/controlLine.js`。
- 每帧读 `world.controlLinePaths`（已串联 + Chaikin 平滑的折线），用 `values.controlLine.style`（4 px / `0x101414` / 0.82）每条折线一次 `moveTo` 起头再 `lineTo`，最后一次性 `strokePath`（Phaser 的 `MOVE_TO` 会开新子路径，多条战线不会连错）。
- **永远可见**：底衬 / 主线两个图形 depth = 2、标签 depth = 3，都高于迷雾罩层的 depth = 1（`fogRenderer`）；且用 `style.haloWidth/haloColor/haloAlpha`（9 px 浅色）垫在 `style.lineWidth`（4 px 深色）之下做**双色描边**——深色线单独叠在迷雾/森林上对比度会归零，看起来像被迷雾盖住。
- 可能在多段（包围、多个战场）时把「实际控制线」标签贴在**最靠上**的那条战线旁边。

### `src/rendering/supplyLines.js`
补给线渲染（`gdd.md §8`）：**只在选中单位时画**，所以不存在用画面泄露敌情的问题。
- 每条补给边（城市 → 单位）一条线：折线由 `findSupplyPath`（A*，与分配用同一套代价与阻断规则）算出，线宽与不透明度随「实收 ÷ 需求」变化——一眼看出谁是主供城。
- 缺补给时再画「本来该走的那条路」（`ignoreControl: true`）：路径穿过敌方实际控制区 → 按 `supply.style.dash` 切成**红色虚线**、在切断处打叉、标注「补给被切断」；路径是通的（纯粹城里运力不够）→ 只标注「补给不足：城中运力不够」。
- 路径按 `world.supplyToken` 缓存（代价场每 1 s 才重算），敌方控制区掩码在同一轮里共用一份；单位那一端用实时坐标，所以线始终连在单位身上。depth = 7，压在单位 / 城市标签之上。

### `src/rendering/cameraView.js`
游戏页的地图相机（`gdd.md §11`）：**滚轮以光标为焦点缩放**，视口夹在地图内。
- 纯函数（可单测）：`clampZoom`、`worldAt` / `scrollForPoint`（互为逆运算，用来把"光标下的世界点"钉在原处）、`clampScroll`（把可见范围夹进地图，地图比视口小时居中）。
- `createMapCamera(scene, world, cfg)`：接线 Phaser（`input.on('wheel')` + `cameras.main.setZoom/setScroll`）；`update(dt)` 每帧推进平滑缩放（系数按 60fps 标定、与帧率无关），`reset()` 以当前视野中心为焦点回到 1×，另暴露 `zoom` / `zoomPercent` / `isZoomed` 供 HUD 读数。
- 只影响渲染相机，不参与模拟：`orders.js` / `selection.js` 用的 `pointer.worldX/worldY` 由 Phaser 换算，缩放后下令与框选仍然精确。

### `src/rendering/scenes/BootScene.js`
游戏页启动场景：把 URL 解析为**关卡**再启动游戏。
- `?level=<id>` → 加载 `/assets/levels/<id>.json`（标准关卡格式）→ 再加载其 `map` 指向的地图。
- `#bench` → 性能基准；`?fromEditor=1` → 编辑器试玩（地图取 `sessionStorage`，无关卡脚本）。
- 无参数 → 取关卡索引 `/assets/levels/index.json` 的第一关；索引同时供「下一关」导航使用。
- 载入地图后调用 `validateLevelReferences()` 交叉校验关卡的 `spawnId` / `cityId` / `anchor`，有误仅 `console.warn`（不致命）。
- `scene.start('Game', { level, mapData, fromEditor, levelIndex })`。

### `src/rendering/scenes/GameScene.js`
游戏主场景：
- `create()`：构造 `World`、`ScriptedAI`（关卡模式下，`level.scripts` 有几个脚本就建几个 → `this.ais`，`this.ai` 指向第一个）、控制器、循环（`createLoop(world, this.ais)`）、输入层（selection/orders/keyboard）、渲染层、HUD。
- **关卡模式**：`deployForces(world, level.forces, level.anchors)` 部署兵力，`new ScriptedAI(world, { faction, script, anchors })`；引擎不把关卡写进代码。
- **沙盒模式**（编辑器试玩 / 关卡不可用）：仅按地图出生点部署、无脚本敌军、显示"返回编辑器"。
- `update()`：固定步长推进（暂停/胜负时跳过），每帧重绘单位/迷雾/控制线/覆盖层 + 更新 HUD。
- `drawOverlays()`：盒选矩形、拖拽轨迹、行军/攻击前进轨迹含末端箭头（加深颜色 `0x1f2b24`）。

### `src/rendering/scenes/EditorScene.js`
编辑器主场景：
- `init()`：读 `?fromPlaytest=1` → 从 `sessionStorage` 恢复试玩前的编辑地图，否则 null。
- `create()`：载入/新建地图、建 store、`ensureCanvasSize()`、`fitCamera()`、画地形（烘焙纹理）/对象、建工具栏、绑指针事件。
- `ensureCanvasSize()`：把小于画布的地图补齐到画布尺寸（见 `editor/mapResize.js`）——可编辑区域 = 画布，否则画布边缘那条区域点不动、试玩时也不渲染。
- `fitCamera()`：按**当前**地图尺寸重算缩放并居中——新建/载入/导入不同尺寸的地图后必须重新适配，否则可编辑范围与画布对不上。缩放与"是否需要重建烘焙纹理"的规则抽在 `rendering/editorView.js`（纯函数，有单测）。
- `onMapChange` 回调（新建/载入/导入）：重建 `terrain` 访问层 → `fitCamera()` → `drawTerrain()` → `drawObjects()`，四者都跟着当前尺寸走。
- `drawTerrain()`：尺寸变化时先销毁并移除旧纹理再重新烘焙——Phaser 的 `Graphics.generateTexture` 对已存在的 key 只会画到旧画布上，不会改变画布尺寸（`phaser/src/gameobjects/graphics/Graphics.js:1510`）。
- 工具：绘制/擦除地形、放置/移动/删除城市与出生点、`hitObject`。
- `testPlay()`：校验可玩 → 把当前地图写 `sessionStorage` 并跳转 `/game.html?fromEditor=1`。

### `src/rendering/scenes/BenchScene.js`
性能基准场景（`#bench`，验收 G3）：
- 生成 500 活跃单位，测量模拟 tick 平均/p95 耗时与渲染帧率，显示在页面左上角覆盖层，`window.__bench` 暴露给 e2e。
- 帧率在软件渲染下偏低，60 FPS 需真实 GPU 三浏览器手动确认。

---

## 九、编辑器数据（`src/editor/`）

### `src/editor/editorStore.js`
编辑器纯数据状态（**无 DOM/Phaser 依赖，可单测**）：
- `createNewMap(name, width, height)`：新建地图（默认双阵营城市/出生点，保证可玩）。
- `createEditorStore(initialMap)`：`mapData` getter、`errors()`（复用 `validateMap`）、绘制/擦除地形（含 `paintSegment` 半格采样）、增删移/城市与出生点、`rename`、`loadMapData`。

### `src/editor/mapResize.js`
地图补齐到画布尺寸（**纯数据，可单测**）：
- `fitMapToCanvas(mapData, minWidth, minHeight)`：只扩不裁，把 `size` 与 `terrain` 一起补齐到至少画布尺寸，新增格为平原，原有地形逐格保留（宽度变化时按行重排），城市/出生点/占领点坐标不动。
- 为什么需要：游戏画布固定 1280×800，比它小的地图（编辑器预设里原本有 1280×720）会在画布上留下既点不动、试玩时也不渲染的空白带；命令目标虽然已被 `clampToMap` 夹住，但地图本身补齐才是根治。

---

## 十、构建与测试配置（项目根）

### `vite.config.js`
Vite 多页构建：
- `build.rollupOptions.input` = `{ home: index.html, game: game.html, editor: editor.html }`。
- `base: '/'`；开发模式由 Vite dev server 直接提供这些 `.html`。

### `vitest.config.js`
单元测试：`include: ['tests/unit/**/*.test.js']`，`environment: 'node'`（只测确定性逻辑）。

### `playwright.config.js`
e2e：`testDir: 'tests/e2e'`，`baseURL: 'http://localhost:5173'`，Chrome/Firefox 工程（Edge 预留），`webServer` 自动启动 `npm run dev`。

---

## 十一、开发脚本（`scripts/`）

### `scripts/tune.mjs`（阶段六，docs/ai-design.md §3.9）
离线调参基建，`npm run tune`：
- 复用 `tests/unit/helpers.js` 的造图/造世界工具（**不**复制第二套地图构造），双方都是 `ScriptedAI`，
  固定步长 1/60、无渲染 → 与 headless 复现一致（同场景跑两次逐位相同）；
- 4 个场景：`interdict`（走廊可压）/ `siege`（己城被围）/ `retreat`（撤退选城避围城）/ `open`（无走廊正面）；
- 12 个参数做 OAT 扫描（现值复用 baseline 结果），再对 `weights.interdiction × interdiction.minCuts` 做二维粗网格；
- 每格输出「敌掉血 / 我掉血 / 敌断补率 + 交换比」、fitness（启发式，仅排序用）、任务数、耗时；
- JSON 落到 `test-results/tune-*.json`（已被 gitignore）；**只给建议、不自动改源码**；
- 覆盖机制靠 `AI_TUNING_GROUPS`（见 `src/simulation/ai/presets.js`）：`ai.tuning` 可按子对象覆盖
  `weights` / `supply` / `interdiction` / `relief` 里的纯数字项，AI 侧统一从本局 `cfg` 读，不渗回 `values.js`。

---

## 十二、测试文件（`tests/`）

> 运行时代码之外，`tests/` 也全部是 JS 文件，汇总如下。

### `tests/unit/`（Vitest，18 个）
覆盖命令校验、战斗、补给存量、占领、补给、迷雾三态、胜负、地图 JSON 校验/迁移、固定步长确定性、脚本敌军、i18n、config↔gdd 镜像、空间分区、移动寻路、编辑器 store、性能基线等确定性规则。

### `tests/e2e/`（Playwright，7 个）
- `helpers.js`：`waitForGame`（打开 `/game.html`）、`clickWorld`/`dragWorld`（世界坐标→页面坐标）、`firstBlueUnit`/`firstRedUnit`。
- `smoke.spec.js`：页面加载、Phaser 启动、HUD 渲染、1920×1080 启动、主页双入口。
- `orders.spec.js`：右键移动/攻击、拖拽轨迹。
- `selection.spec.js`：单选/框选/Shift、点击不触发框选。
- `tutorial.spec.js`：教学关完整闭环、失败分支、补给存量标签、暂停与速度。
- `editor.spec.js`：编辑器闭环（新建/绘制/保存/载入/导入/导出/可玩性校验/一键试玩返回）。
- `performance.spec.js`：`#bench` 500 单位 tick 预算基线。
