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
│  │  ├─ ai.js                 #    脚本敌军
│  │  └─ systems/              #    tick 内的规则系统
│  │     ├─ movement.js        #      移动/寻路/软排斥/溃逃撤退
│  │     ├─ combat.js          #      接触交战/伤害/目标选择
│  │     ├─ morale.js          #      士气修正/阈值/溃逃
│  │     ├─ supply.js          #      补给分配/恢复/生产/损耗
│  │     ├─ capture.js         #      城市占领进度
│  │     ├─ fog.js             #      战争迷雾三态/目视/最后已知位置
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
│     └─ editorStore.js        # 编辑器纯数据状态
└─ tests/
   ├─ unit/                    # 18 个 Vitest 测试文件（规则确定性）
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
- `tick(dt)`：固定系统顺序执行 `movement → combat → morale → supply → capture → fog → victory`，保证确定性；tick 未把事件推入 `history`。
- `applyCommand`：把命令写进单位并规划路径（`planRoute`，A* 绕行水域）；`move`/`attackMove` 都真实显示绕行路径。

### `src/simulation/map.js`
地图 JSON 模型与校验：
- `MAP_VERSION`、`migrations`、`migrateMap`（版本迁移链，机制就绪）。
- `validateMap`：结构 + 可玩性校验（尺寸、地形格、双阵营城市/出生点）。
- `makeTerrain`：地形访问层（`terrainAt`、`passableAt`、`moveMultiplierAt`、`defenseModifierAt`、格子索引）。
- `parseMap`：迁移 + 校验 + 规范化输出。

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

### `src/simulation/ai.js`
脚本敌军（`ScriptedAI`）：
- 只读世界状态，通过 `world.issueCommands` 下发（与人类共用统一命令接口）。
- 支持**驻守、定时增援、条件触发进攻、周期重选目标、向 fallbackTarget（敌方城市）进军**。
- `nearestEnemy` 用空间区扩张半径查询，避免全图扫描。

### `src/simulation/systems/movement.js`
移动系统：
- `updateMovement`：沿路径行进；交战中冻结；溃逃单位不受指挥、向最近己方城市全速撤退、无路可退/被困超时投降。
- `findPath`：A*（4 方向，水域不可通行，森林代价更高；终点不可通行就近取格），含模块级 `pathCache` 确定性共享。
- `planRoute`：下达命令时对每个途经点逐段 A*，返回去掉共线点的真实路径（`move`/`attackMove` 共用）。
- `segmentBlocked`、`simplify`、`separateOverlaps`（软排斥）。

### `src/simulation/systems/combat.js`
战斗系统：
- 交战判定：距离 ≤ 双方半径和 + `contactTolerance`（**接触才开打**，比按攻击距离更严格）。
- 目标选择：优先当前目标直至死亡，否则取接触范围内最近（`config.combat.targetPriority`）。
- 伤害 = 基础 × 士气削弱 × 防御者地形修正；每单位独立攻击冷却，首次接触立即攻击。
- **attack-forward**：`move` 与 `attackMove` 都沿路线行军，接敌停下交战，敌军清空后恢复行军。

### `src/simulation/systems/morale.js`
士气系统：
- 每秒修正（友军/城市/补给/交战）；友军阵亡瞬间 −10。
- 阈值效果（削弱/动摇 → 伤害与速度倍率 `effectsFor`）。
- 归零即溃逃；溃逃恢复、无城可退立即投降、被困超时投降。

### `src/simulation/systems/supply.js`
补给与城市维护：
- 每单位就近分配到一座己方城市，每城容量 5，超出者补给不足。
- 己方城市附近恢复生命 +3/s；城市自动生产（12s/轻型，补给满或被围暂停）；补给不足损耗。

### `src/simulation/systems/capture.js`
城市占领：
- 每单位 5%/s、上限 15%/s；守方在场冻结；攻方全部离开后 3%/s 衰减；达到 100% 易主（记录 `cityCaptured` 事件）。

### `src/simulation/systems/fog.js`
战争迷雾：
- 每格三态 `FOG_UNEXPLORED=0` / `FOG_EXPLORED=1` / `FOG_VISIBLE=2`。
- 可见 = 己方单位视野圆 ∪ 己方城市视野圆；森林中敌军仅 `forestSpotDistance` 内可目视。
- `isSpotted` 判定；维护敌方 `lastSeen` 最后已知位置。

### `src/simulation/systems/victory.js`
胜负判定：一方失去全部城市即告负，另一方获胜（`cityCaptured`/`victory` 事件、`winner`/`endTime`）。

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
- 只维护选中 id 集合（`selected`），`isSelected`、`clear`、`onChange`。
- 交互判定（bugfix）：**按下即命中己方单位 → 本次为点击单选，绝不进入框选**；只有按下空地并拖动超过阈值才框选。
- `getDragRect()` 供渲染层画选框；轨迹绘制期间由 `setRouteBlocked` 复位。

### `src/input/orders.js`
指挥输入：
- 右键空地 → `attackMove`；右键目视敌军 → `attack`。
- 从已选单位左键拖动 → 采样多路径点 `move` 轨迹（单位间按 `routeUnitOffset` 错开）。
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
- **toast 顶部弹窗已移除**（`showToast` 为 no-op），进度只保留在右侧战场通讯日志。
- `returnFromGame`：`fromEditor` 时跳转 `/editor.html?fromPlaytest=1`，否则 `reload` 重开教学关。

### `src/rendering/editorToolbar.js`
DOM 编辑器工具栏：
- 保存/载入（localStorage）、导出（下载 JSON）、导入（文件 API）、新建对话框、试玩入口、校验状态栏。
- `createEditorToolbar(scene, store, callbacks)` 采集 `#editorToolbar` 等 DOM，按 `[data-i18n]` 填充文案。
- 操作只改 `editorStore`，画布刷新由 EditorScene 回调完成。

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
实际控制线：
- 按双方存活单位纵深位置插值出战线采样点，用二次贝塞尔采样平滑连线（Phaser Graphics 无贝塞尔 API）。
- 来自原型遗留视觉表现（`gdd.md §9` 暂定保留）。

### `src/rendering/scenes/BootScene.js`
游戏页启动场景：
- 读 URL 参数 `?fromEditor=1` → 从 `sessionStorage` 取试玩地图；`#bench` → 性能基准；否则 fetch 教学地图。
- `scene.start('Game', { mapData, fromEditor })`。

### `src/rendering/scenes/GameScene.js`
游戏主场景：
- `create()`：构造 `World`、`ScriptedAI`（非试玩）、控制器、循环、输入层（selection/orders/keyboard）、渲染层、HUD。
- **编辑器试玩**：`fromEditor` 时仅按地图出生点部署、无脚本敌军、显示"返回编辑器"。
- `spawnTutorialForces()`：教学关兵力（蓝 3 轻 + 1 重，红 2 轻 + 2 重）。
- `update()`：固定步长推进（暂停/胜负时跳过），每帧重绘单位/迷雾/控制线/覆盖层 + 更新 HUD。
- `drawOverlays()`：盒选矩形、拖拽轨迹、行军/攻击前进轨迹含末端箭头（加深颜色 `0x1f2b24`）。

### `src/rendering/scenes/EditorScene.js`
编辑器主场景：
- `init()`：读 `?fromPlaytest=1` → 从 `sessionStorage` 恢复试玩前的编辑地图，否则 null。
- `create()`：载入/新建地图、建 store、画地形（烘焙纹理）/对象、建工具栏、绑指针事件。
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
