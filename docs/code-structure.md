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
│  │  ├─ loop.js               #    固定时间步长累积器
│  │  ├─ commands.js           #    统一命令接口与校验
│  │  ├─ spatial.js            #    均匀网格空间分区
│  │  ├─ influence.js          #    影响力场 + 0 等值线（实际控制线，纯函数）
│  │  ├─ ai.js                 #    脚本敌军（解释关卡的事件→动作脚本）
│  │  ├─ level.js              #    关卡标准格式：校验 / 兵力部署 / 锚点与目标解析
│  │  └─ systems/              #    tick 内的规则系统
│  │     ├─ movement.js        #      移动/寻路/软排斥/溃逃撤退
│  │     ├─ combat.js          #      接触交战/伤害/目标选择
│  │     ├─ morale.js          #      士气修正/阈值/溃逃
│  │     ├─ supply.js          #      补给分配/恢复/生产/损耗
│  │     ├─ capture.js         #      城市占领进度
│  │     ├─ fog.js             #      战争迷雾三态/目视/最后已知位置
│  │     ├─ controlLine.js     #      影响力场重算（10 Hz）+ 分界线线段
│  │     └─ victory.js         #      胜负判定
│  ├─ controllers/             # 交互状态控制器
│  │  └─ gameController.js     #    暂停/游戏速度
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
│  │  └─ scenes/               #    Phaser 场景
│  │     ├─ BootScene.js       #      游戏页启动/路由
│  │     ├─ GameScene.js       #      游戏主场景（组装各层）
│  │     ├─ EditorScene.js     #      编辑器主场景
│  │     └─ BenchScene.js      #      性能基准场景
│  └─ editor/
│     ├─ editorStore.js        # 编辑器纯数据状态
│     └─ mapResize.js          # 地图补齐到画布尺寸（纯数据）
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
- `morale`：初始/范围、每秒修正、阈值、削弱效果、溃逃恢复。
- `cities`：占领半径/速率、生产、恢复、视野。
- `supply`：每城容量、损耗速率。
- `fog`：森林目视距离、最后已知位置虚影开关。
- `spatial`：格子边长 `64`。
- `performance`：目标帧率/单位、tick/渲染预算、HUD 节流。
- `input`：点击半径、框选阈值、轨迹采样/偏移。
- `ui`、`tutorial`：UI 节流、教学关兵力/增援等规则数值。

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
- `tick(dt)`：固定系统顺序执行 `movement → combat → morale → supply → capture → fog → controlLine → victory`，保证确定性；tick 未把事件推入 `history`。
- `applyCommand`：把命令写进单位并规划路径（`planRoute`，A* 绕行水域）；`move`/`attackMove` 都真实显示绕行路径。

### `src/simulation/map.js`
地图 JSON 模型与校验：
- `MAP_VERSION`、`migrations`、`migrateMap`（版本迁移链，机制就绪）。
- `validateMap`：结构 + 可玩性校验（尺寸、地形格、双阵营城市/出生点），并检查**城市 id / 出生点 id 唯一**。
- `makeTerrain`：地形访问层（`terrainAt`、`passableAt`、`moveMultiplierAt`、`defenseModifierAt`、格子索引）。
- `parseMap`：迁移 + 校验 + 规范化输出；`normalizeSpawns` 给缺 id 的出生点补 `s1`、`s2`…（跳过已占用的名字），使关卡能用 `{ spawnId }` 精确引用手写地图的出生点。

### `src/simulation/entities.js`
实体工厂，返回**纯数据对象**：
- `makeUnit({id, faction, type, x, y})`：从 `values.units` 取类型属性，初始化 hp/morale/状态/路径/目标/冷却/补给/士气效果/最后目视等。
- `makeCity({id, x, y, faction})`：城市 + 占领进度 + 生产计时。

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

### `src/simulation/influence.js`
**影响力场与实际控制线的纯计算**（`gdd.md §9`）：不依赖 `World` / Phaser / DOM，输入是影响力源数组、输出是网格与线段，可 headless 单测。
- `influenceAt(distance, source, curve)`：单个源的影响力。**核心圈 `source.coreRadius` 是绝对值**（单位 = 碰撞体积、城市/占领点 = 占领半径），圈内满强度；出圈按原型手感掉到 20%（`coreExitRatio`），之后中圈/外圈两段线性衰减（断点按 `influenceRadius / curve.maxDistance` 等比缩放），到影响力半径归零。
- `createField(width, height, cellSize)` → `{ cols, rows, values, raw, scratch, ready }`；`values` 是平滑后的影响力（对外），`raw` 是本次重算结果。
- `rebuildField(field, sources, cfg)`：清零 → 按半径框（**只遍历源影响力覆盖到的格子**，不扫全图）累加带符号影响力（蓝 +、红 −）→ 按 `temporalSmoothing` 与上一次做指数平滑 → 可选 3×3 均值模糊（`fieldBlurPasses`，**必须为 0**：模糊会把邻格的敌方影响力混进单位脚下，实测让「单位所在格归自己阵营」的失败率从 0.000% 涨到 5.3%）→ 可选 `partitionMap`。
- `partitionField(field, epsilon, fillValue)`：多源 BFS（曼哈顿 Voronoi）把"双方影响力都够不到"的格子按**最近的阵营**填上 ±`fillValue`。填充值远小于真实影响力下限（2.5），所以只决定归属、不挪动真实战线。作用：控制线铺满整张地图（含迷雾与从未探索区），否则战线会在没有部队的旷野断开——看起来像"迷雾把控制线吃掉了"。
- `guaranteeUnitCells(field, marks, minMagnitude)`：**单位所在格的硬保证**——每个存活单位脚下那一格若符号不对，就按原量级翻转回自己阵营（最小扰动）。补上核心圈挡不住的三种情况：城市/占领点核心圈 60px、强度 120 压过单位身体的 100（攻城时脚下被判给敌方）；格心落在碰撞半径之外；多个敌军贴身叠加。
- `contour(field, epsilon, out)`：marching squares 取 **0 等值线**，即实际控制线线段（`{x1,y1,x2,y2}`）。只有 2×2 格块里**同时存在正格与负格**才输出线段——否则「只有蓝方影响力」的区域会沿着自己影响范围的外沿画出一条假分界线。鞍点（`code 5/10`）用格心值拆分。
- `chainSegments(segments)`：按端点把线段串成折线（端点量化到 0.01 px 再匹配——相邻格块共享边上的过零点是同一对格值按同一公式算出来的，浮点结果一致）。一条战线 / 一个包围圈 = 一条折线，闭合的包围圈首尾同点。
- `smoothPath(points, iterations)`：Chaikin 切角平滑（每轮保留首尾、每段取 1/4 与 3/4 两点）。**只磨几何、不动影响力场**——所以它不会像空间模糊那样破坏「单位所在格归自己阵营」。
- `buildPaths(segments, iterations, out)`：串联 + 平滑，产出渲染用的折线数组。

### `src/simulation/systems/controlLine.js`
实际控制线系统（`gdd.md §9`，**纯视觉**）：
- `updateControlLine(world)`：每 `refreshTicks`（默认 6 tick = 10 Hz）重算一次影响力场，写 `world.controlLine`（网格）、`world.controlLineSegments`（原始线段）与 `world.controlLinePaths`（串联 + 平滑后的折线）；非重算 tick 直接返回，保持上一次结果。
- `collectSources(world)`：影响力源 = 存活单位 + 城市 + 占领点；蓝 `sign=+1`、红 `−1`，中立（`'neutral'` / 未占领）不产生影响力。**核心圈取绝对值**：单位用 `unit.radius`（碰撞体积），城市/占领点用 `cities.capture.radius` / `capturePoints.capture.radius`（占领半径 60）——所以核心圈只覆盖「脚下这块地」，单位始终在自己阵营的控制区内；城市不享受该保证（被占领时可以处在敌方控制区）。
- **不读战争迷雾**：影响力源是双方全部存活单位（含迷雾里的敌军），战线反映的是真实分界、不受视野限制。
- **铺满全图**（`partitionMap`）：无影响力的格子按最近阵营归属，控制线会延伸到地图边界，因此在迷雾/未探索区也能看到战线随战况更新。
- **单位所在格的硬保证**（`guaranteeUnitCell`）：重算后对每个存活单位脚下那一格做最小幅度符号纠正，保证"自己的兵不会站在敌方控制区里"（攻城、被贴身都成立）。
- 城市与占领点在争夺中（`captureProgress > 0`）按进度线性削弱现属方强度。
- 放在 tick 顺序末尾（`victory` 之前）：它只读位置/归属/占领进度，任何规则系统都不读它。

### `src/simulation/level.js`
关卡（Level）标准格式 v1——**"一局游戏"的完整规格**（`architecture.md` §7.1）：
- 字段：`id` / `name` / `subtitle` / `type`（`offensive` 进攻 | `defensive` 防守 | `annihilative` 歼灭，白名单见 `LEVEL_TYPES`）/ `difficulty` / `map`（引用地图路径）/ `anchors`（命名锚点表）/ `forces`（编队式兵力）/ `ai`（事件→动作脚本）/ `victory`（胜负条件，见 `buildMission`）。
- `validateLevel()` 结构 + 语义校验（阵营、单位类型、坐标引用与锚点定义、触发条件与动作类型、`repeatEvery > 0`）；`parseLevel()` 失败即抛错并聚合原因。
- **坐标引用 PointRef**：`{ x, y }` / `{ spawn }` / `{ spawnId }` / `{ city }` / `{ cityId }` / `{ capturePointId }` / `{ anchor }`，统一由 `resolvePoint(ref, world, anchors)` 解析（顺序：绝对坐标 → 命名锚点 → spawnId → spawn → cityId → capturePointId → city；解析不到返回 `null`）。`resolveAnchor` / `resolveTarget` 为同一函数的历史别名。
- `parseAnchors()` 校验命名锚点表（禁止锚点引用锚点）；`validateLevelReferences(level, mapData)` 在地图载入后交叉校验 `spawnId` / `cityId` / `capturePointId` / `anchor` 是否真实存在（`BootScene` 调用，仅告警）。
- `deployForces(world, forces, anchors)` 按数据部署：落点 = 锚点 + `offset` + `spacing × i`；编队的 `objective` 会写到单位上（`unit.objective`），供歼灭胜负条件识别「指定单位」。
- `buildMission(level, world)` 把 `victory` 解析成运行时任务规则（`world.mess`）：`{ mode, faction, time, points }`；`captureAll` / 未声明 → `null`。
- 常量：`LEVEL_VERSION`、`LEVEL_TYPES`、`VICTORY_MODES`、`OBJECTIVE_ANNIHILATE`、`FORCE_OBJECTIVES`、`AI_ACTION_TYPES`、`FACTIONS`、`LEVELS_INDEX_PATH`、`levelPath(id)`。

### `src/simulation/ai.js`
脚本敌军（`ScriptedAI`）：**解释关卡 JSON 里的「事件 → 动作」脚本**，引擎不含关卡特例：
- 只读世界状态，通过 `world.issueCommands` 下发（与人类共用统一命令接口）。
- 触发条件：`{ time }`（经过秒数）、`{ enemyCrossX }`（任一敌军越过该 x）；首次满足**立即执行一次**动作，`repeatEvery` 存在时此后周期重复。
- 动作：`spawn`（可按 `order` 逐单位下令）、`attackNearest`（各打最近敌军，无敌人时转向 `fallback`）、`attackMove`、`hold`；所有点位经 `resolvePoint(ref, world, this.anchors)` 解析，构造时传入关卡 `anchors`。
- `nearestEnemy` 用空间区扩张半径查询，避免全图扫描。

### `src/simulation/systems/movement.js`
移动系统：
- `updateMovement`：沿路径行进；交战中冻结；溃逃单位不受指挥、向最近己方城市全速撤退、无路可退/被困超时投降。
- `findPath`：A*（4 方向，水域不可通行，森林代价更高；终点不可通行就近取格），含模块级 `pathCache` 确定性共享。
- `planRoute`：下达命令时对每个途经点逐段 A*，返回去掉共线点的真实路径（`move`/`attackMove` 共用）。
- `forcedMarchMultiplier(world, unit)`：急行军速度倍率——除水域之外的地形 `values.movement.forcedMarch.speedMultiplier`（1.5，与地形/士气倍率叠乘），水面上返回 1（不给加成）。
- 急行军代价在 `moveAlongRoute` 里结算：每秒 `hpPerSecond` 掉血（走 `world.damageUnit`，计入伤亡），掉光即 `killUnit(unit, 'forcedMarch')`。溃逃（`ignoreMoraleEffects`）不参与。
- `clampToMap`：把目标点夹进地图矩形——`terrain.passableAt()` 会把格子索引夹到边缘格，因此**地图外的坐标看起来也可通行**，不夹取的话单位会走出地图、进入画布上未渲染的区域。
- `segmentBlocked`、`simplify`、`separateOverlaps`（软排斥）。

### `src/simulation/systems/combat.js`
战斗系统：
- 交战判定：距离 ≤ 双方半径和 + `contactTolerance`（**接触才开打**，比按攻击距离更严格）。
- 目标选择：优先当前目标直至死亡，否则取接触范围内最近（`config.combat.targetPriority`）。
- 伤害 = 基础 × 士气削弱 × 防御者地形修正 × 血量比例 × **攻方地形修正**（`values.terrain.attackMultiplier`，站在水里 ×0.5）× 防御姿态（`combat.defend`，防御者原地不动时 ×0.75）× **溃逃/失序易伤**（`combat.disorderedDamageTaken`，目标处于 `rout`/`unordered` 时 ×1.5）；每单位独立攻击冷却，首次接触立即攻击。
- **attack-forward**：`move` 与 `attackMove` 都沿路线行军，接敌停下交战，敌军清空后恢复行军。

### `src/simulation/systems/morale.js`
士气系统：
- 每秒修正（友军/城市/补给/交战）；友军阵亡瞬间 −10。
- 交战消耗分两档：**正被敌方瞄准**（`underFire`）吃全额 `inCombat`（−8/s）；**参战但没被瞄准**（`state = 'combat'` 且未被打，例如两个单位打同一个敌人时只有前排被还击）吃较少的 `inCombatSupport`（−3/s）——两者都乘进攻因子 `mode`。
- 阈值效果（削弱/动摇 → 伤害与速度倍率 `effectsFor`）。
- 归零即溃逃；溃逃恢复、无城可退立即投降、被困超时投降。

### `src/simulation/systems/supply.js`
补给与城市维护：
- 每单位就近分配到一座己方城市，每城容量 5，超出者补给不足。
- 己方城市附近恢复生命 +3/s；城市生产当前**关闭**（`values.cities.production.enabled = false`；逻辑保留：12s/轻型，补给满或被围暂停）；补给不足损耗。
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
胜负判定（写 `winner`/`endTime`，推 `victory` 事件）：
- **基础规则（始终生效）**：一方失去全部城市即告负，另一方获胜。
- **关卡任务规则（可选，读 `world.mess`）**：`defendVictory`（据点全丢立即判负；到时限结算——仍有据点不在手里则防守失败，全部守住即胜）、`attackVictory`（时限内拿下全部据点）、`annihilationVictory`（**消灭全部指定单位**——`unit.objective === 'annihilate'` 的敌军；未标记的敌军不计入；声明了 `time` 则超时判负）。`world.mess` 为 `null` 时直接跳过——未声明任务的关卡只走基础规则。
- `world.mess` 由 `GameScene` 用 `level.js` 的 `buildMission(level, world)` 写入（来源是关卡 JSON 的 `victory`）。

---

## 五、控制器（`src/controllers/`）

### `src/controllers/gameController.js`
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
  `result` / `level` / `t` / `casualtiesBlue` / `casualtiesRed`（伤亡取整）；`renderVictory` 用它跳转 `result.html`。
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
- 血条/士气条：仅己方显示，尺寸≈圆点直径，黑色框底；HP≥50% 绿、<50% 黄、<20% 橘红，士气青蓝；固定于单位真实位置不跟随震动。
- 血量裂纹：<50% 轻破碎(6 条)、<20% 重破碎(13 条)，`mulberry32(unit.id)` 确定性种子。
- 交战震动：沿「自身→敌人」连线方向的低频小幅度位移（仅渲染层，不影响模拟坐标）。

### `src/rendering/controlLineRenderer.js`
实际控制线（`gdd.md §9`）：**只描线，不做判断**——影响力统计与归属判定在 `simulation/influence.js` + `systems/controlLine.js`。
- 每帧读 `world.controlLinePaths`（已串联 + Chaikin 平滑的折线），用 `values.controlLine.style`（4 px / `0x101414` / 0.82）每条折线一次 `moveTo` 起头再 `lineTo`，最后一次性 `strokePath`（Phaser 的 `MOVE_TO` 会开新子路径，多条战线不会连错）。
- **永远可见**：底衬 / 主线两个图形 depth = 2、标签 depth = 3，都高于迷雾罩层的 depth = 1（`fogRenderer`）；且用 `style.haloWidth/haloColor/haloAlpha`（9 px 浅色）垫在 `style.lineWidth`（4 px 深色）之下做**双色描边**——深色线单独叠在迷雾/森林上对比度会归零，看起来像被迷雾盖住。
- 可能在多段（包围、多个战场）时把「实际控制线」标签贴在**最靠上**的那条战线旁边。

### `src/rendering/scenes/BootScene.js`
游戏页启动场景：把 URL 解析为**关卡**再启动游戏。
- `?level=<id>` → 加载 `/assets/levels/<id>.json`（标准关卡格式）→ 再加载其 `map` 指向的地图。
- `#bench` → 性能基准；`?fromEditor=1` → 编辑器试玩（地图取 `sessionStorage`，无关卡脚本）。
- 无参数 → 取关卡索引 `/assets/levels/index.json` 的第一关；索引同时供「下一关」导航使用。
- 载入地图后调用 `validateLevelReferences()` 交叉校验关卡的 `spawnId` / `cityId` / `anchor`，有误仅 `console.warn`（不致命）。
- `scene.start('Game', { level, mapData, fromEditor, levelIndex })`。

### `src/rendering/scenes/GameScene.js`
游戏主场景：
- `create()`：构造 `World`、`ScriptedAI`（关卡模式下）、控制器、循环、输入层（selection/orders/keyboard）、渲染层、HUD。
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

## 十一、测试文件（`tests/`）

> 运行时代码之外，`tests/` 也全部是 JS 文件，汇总如下。

### `tests/unit/`（Vitest，18 个）
覆盖命令校验、战斗、士气、占领、补给、迷雾三态、胜负、地图 JSON 校验/迁移、固定步长确定性、脚本敌军、i18n、config↔gdd 镜像、空间分区、移动寻路、编辑器 store、性能基线等确定性规则。

### `tests/e2e/`（Playwright，7 个）
- `helpers.js`：`waitForGame`（打开 `/game.html`）、`clickWorld`/`dragWorld`（世界坐标→页面坐标）、`firstBlueUnit`/`firstRedUnit`。
- `smoke.spec.js`：页面加载、Phaser 启动、HUD 渲染、1920×1080 启动、主页双入口。
- `orders.spec.js`：右键移动/攻击、拖拽轨迹。
- `selection.spec.js`：单选/框选/Shift、点击不触发框选。
- `tutorial.spec.js`：教学关完整闭环、失败分支、士气标签、暂停与速度。
- `editor.spec.js`：编辑器闭环（新建/绘制/保存/载入/导入/导出/可玩性校验/一键试玩返回）。
- `performance.spec.js`：`#bench` 500 单位 tick 预算基线。
