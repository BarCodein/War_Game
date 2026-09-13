# War of Dots 技术架构文档

> 定义从浏览器原型演进到 MVP 的技术方案。原则来源：`REQUIREMENTS.md` §3/§5、`AGENTS.md`（模拟/渲染/输入/控制器分离、配置化、i18n）。与 `gdd.md` 中数值的一致性由 `src/config/` 与 Vitest 保障。

## 1. 技术栈

- Phaser 3（渲染与场景管理）、Vite、原生 JavaScript ES Modules、npm
- Vitest（确定性规则单元测试）、Playwright（关键浏览器流程）
- Node.js ≥ 22.12 仅用于开发/构建/测试；成品为纯静态 Web 应用，无后端

## 2. 工程结构

```
src/
  entries/
    home.js                  # 主页入口（index.html）：仅填充 i18n 文案的落地页
    game.js                  # 游戏页入口（game.html）：创建 Phaser Game，注册场景
    editor.js                # 编辑器页入口（editor.html）：创建 Phaser Game，注册场景
  config/
    values.js                # 全部数值的唯一权威来源（gdd.md §12 数值总表为镜像）
    index.js                 # 聚合导出
  editor/
    editorStore.js           # 地图编辑器状态：纯数据操作，复用 map.js 校验
  i18n/
    index.js                 # t(key) 查表
    zh-CN.js                 # 中文文案（默认）
    en.js                    # 英文（预留，未启用）
  simulation/
    loop.js                  # 固定时间步长累积器
    world.js                 # 世界状态容器：units/cities/terrain/fog + tick 编排
    entities.js              # unit/city 工厂与状态结构
    commands.js              # 统一命令接口 + 命令队列
    map.js                   # 地图 JSON 解析、结构校验、版本迁移
    spatial.js               # 均匀网格空间分区（邻居查询）
    ai.js                    # 脚本敌军指令生成器（走统一命令接口）
    systems/
      movement.js            # 移动、寻路、碰撞软排斥
      combat.js              # 目标选择、攻击冷却、伤害结算
      morale.js              # 士气修正、阈值效果、溃逃/投降
      supply.js              # 补给分配与损耗
      capture.js             # 城市占领进度
      fog.js                 # 战争迷雾三态与最后已知位置
      victory.js             # 胜负判定
  rendering/
    scenes/BootScene.js      # 资源加载、配置装配
    scenes/GameScene.js      # 游戏主场景：组装 sim + input + HUD
    scenes/EditorScene.js    # 地图编辑器（阶段 5）
    unitRenderer.js          # 单位/血条/士气条/选中圈/虚影
    terrainRenderer.js       # 地形与网格
    fogRenderer.js           # 迷雾三态罩层
    hud.js                   # 侧栏/顶栏/toast（DOM）
    editorToolbar.js         # 编辑器工具栏（DOM）：存储/导入导出/校验状态
  input/
    selection.js             # 左键单选/框选/Shift 增减选
    orders.js                # 右键移动/攻击移动/攻击、轨迹绘制 → 命令
    keyboard.js              # 空格暂停、Esc 取消选择
  controllers/
    gameController.js        # 暂停/游戏速度、任务链、场景切换
public/assets/               # 图片/音频（经 Vite 处理，Phaser 加载）
tests/
  unit/                      # Vitest：combat/morale/capture/supply/fog/map-json/
                             # victory/commands/loop/spatial/ai.test.js
  e2e/                       # Playwright：selection/orders/tutorial/editor.spec.js
```

## 3. 模块职责与依赖方向

```
                 ┌─────────── config ───────────┐
                 └─────────── i18n ─────────────┘   （叶子模块，被所有层引用）

 input ──命令──▶ simulation ◀──脚本── ai
  ▲                 │ 世界状态（只读）
  │                 ▼
  └────── rendering（Phaser 场景 + HUD）
                   ▲
             controllers（组装/暂停/速度/任务）
```

- **单向数据流**：`input → commands → simulation tick → world state → rendering`。
- **simulation 不依赖** Phaser、DOM、input、rendering——可在 Node 环境 headless 运行整个对局（这是 Vitest 覆盖规则的基础）。
- **rendering 只读世界状态**，不直接修改模拟数据。
- 人类、脚本敌军（`ai.js`）、未来 AI 全部通过 `commands.js` 下发指令（`REQUIREMENTS.md` §4.5 硬性要求）。

## 4. 核心循环与固定时间步长

- **模拟步长 1/60 s**，与渲染帧率无关（`REQUIREMENTS.md` §5）。
- 渲染用 `requestAnimationFrame`：每帧 `accumulator += dt`；`while (accumulator ≥ step)` 执行 tick；**每帧最多补 5 个 tick**（掉帧时降速而非螺旋追赶）。
- tick 内系统执行顺序固定，保证确定性：`movement → combat → morale → supply → capture → fog → victory`。
- 暂停：不执行 tick；游戏速度：×0.5 / ×1 / ×2 通过每帧 tick 次数控制（暂定）。
- 渲染层按世界状态绘制；HUD 更新节流（如 100 ms）避免每 tick 重建 DOM。

## 5. 统一命令接口

```js
// 所有命令对象统一形如（人类输入与脚本敌军共用）：
{ type: 'move',       path: [{ x, y }, ...] }   // 沿路径点行进（含轨迹绘制）
{ type: 'attackMove', target: { x, y } }        // 移动并在途中自动接敌
{ type: 'attack',     targetId: 7 }             // 攻击指定单位
{ type: 'hold' }                                // 驻守原地，不追击

world.issueCommands(unitIds, command)           // 唯一入口，附带校验
```

- 命令进入每 tick 清空的队列，由 movement/combat 系统消费。
- 脚本敌军（`ai.js`）是纯指令生成器：读世界状态（同玩家可见信息或全量，关卡配置决定）→ 定时/条件触发 → 产出上述命令对象。它不直接改状态。

## 6. 实体与状态

- 状态为**纯数据对象**（可序列化），渲染层不持有实体类。
- `unit`：`{ id, faction, type, x, y, hp, morale, state, command, cooldown, vision, … }`
- `city`：`{ id, faction, x, y, captureProgress, productionTimer, … }`
- `world`：`{ time, units, cities, terrainGrid, fogGrid, winner, … }`
- 类型参数（hp/伤害/速度…）一律从 `config` 取，实体只存实例值。

## 7. 地图 JSON schema（v1，带版本与迁移）

```json
{
  "version": 1,
  "name": "断裂峡谷",
  "size": { "width": 1280, "height": 800 },
  "gridCellSize": 10,
  "terrain": { "width": 128, "height": 80, "cells": [0, 0, 2, "…"] },
  "background": "/assets/map_pics/mp.png",
  "cities": [ { "id": "c1", "x": 200, "y": 560, "faction": "blue" } ],
  "spawns": [ { "id": "s1", "faction": "blue", "x": 200, "y": 560 } ],
  "capturePoints": [ { "id": "p1", "x": 640, "y": 300, "faction": "neutral" } ],
  "objectives": [ { "id": "o1", "type": "captureCity", "cityId": "c2", "holdSeconds": 0 } ]
}
```

- `cells`：0 平原 / 1 森林 / 2 水域 / 3 桥梁 / 4 山地 / 5 高山 / 6 道路（`gdd.md` §5），行优先。
- `cities[].id` / `capturePoints[].id` 必填且**全局唯一**（重复会被校验拦截）；`spawns[].id` 可选——缺省时 `parseMap()` 自动补 `s1`、`s2`…（跳过已占用的名字），因此旧地图无需改动即可被关卡用 `{ spawnId }` 精确引用（编辑器新增的出生点也遵循同一命名）。
- `capturePoints`（可选）：占领点数组，`faction` 为 `neutral` | `blue` | `red`；被占领后**仅提供视野**，不提供补给/士气/生产/恢复，也不计入胜负（`gdd.md` §7.1）。缺省为空数组。
- 读取流程：**结构校验（schema）→ 可玩性校验（双方至少 1 出生点与 1 城市、尺寸/格子一致）→ 版本迁移链（version < 当前版本时逐级升级）**，失败即拒绝载入并报错。
- 编辑器与运行时共享同一地图模型与校验代码（`REQUIREMENTS.md` §4.6）。
- 存档：`localStorage` 存设置/进度/自定义地图，文件 API 导入导出。

## 7.1 关卡 JSON schema（v1）

**关卡（Level）是「一局游戏」的完整规格**：地图、兵力部署、增援、关卡类型与敌方 AI 脚本。引擎（`GameScene`）不含任何具体关卡的特例代码，只按 `simulation/level.js` 的接口消费数据。

```json
{
  "version": 1,
  "id": "fracture-canyon",
  "name": "断裂峡谷",
  "subtitle": "FRACTURE CANYON",
  "type": "offensive",
  "difficulty": "教学",
  "description": "教学战役。……",
  "map": "/assets/maps/fracture-canyon.json",
  "anchors": {
    "eastGate": { "x": 1230, "y": 400 },
    "redBase": { "cityId": "c2" }
  },
  "forces": [
    {
      "faction": "blue",
      "at": { "spawnId": "s1" },
      "units": [
        { "type": "light", "count": 1 },
        { "type": "light", "count": 2, "offset": { "x": -30, "y": 30 }, "spacing": { "x": -20, "y": 0 } },
        { "type": "heavy", "count": 1, "offset": { "x": 40, "y": -40 }, "spacing": { "x": 30, "y": 0 } }
      ]
    }
  ],
  "ai": {
    "faction": "red",
    "fallback": { "city": "blue" },
    "triggers": [
      {
        "id": "reinforcement",
        "at": { "time": 60 },
        "actions": [{
          "type": "spawn", "unitType": "light", "count": 2,
          "at": { "anchor": "eastGate" }, "spacing": { "x": 18, "y": 0 },
          "order": { "type": "attackMove", "target": { "anchor": "redBase" } }
        }]
      },
      {
        "id": "counterattack",
        "at": { "enemyCrossX": 640 },
        "repeatEvery": 5,
        "actions": [{ "type": "attackNearest" }]
      }
    ]
  },
  "victory": { "type": "captureAll" }
}
```

- **URL 约定**：`game.html?level=<id>` → 读取 `/assets/levels/<id>.json`；无参数时取索引 `/assets/levels/index.json` 的第一关。索引同时供战役选择页与「下一关」导航使用（单一数据源）。
- **地图分离**：关卡通过 `map` 引用地图文件，因此编辑器产出的地图可被多个关卡复用；引擎不把地图内联进关卡。
- **坐标引用 PointRef**：`at` / `target` / `fallback` / `anchors` 的值都是同一种「坐标引用」，六选一，全部由 `resolvePoint(ref, world, anchors)` 解析：

  | 写法 | 含义 |
  | --- | --- |
  | `{ x, y }` | 绝对坐标 |
  | `{ spawn: 'blue' \| 'red' }` | 该阵营在地图中的**第一个**出生点（兼容写法） |
  | `{ spawnId: 's1' }` | 指定 id 的出生点（**多出生点地图用这个**，顺序无关） |
  | `{ city: 'blue' \| 'red' }` | 该阵营**当前**拥有的第一座城市（调用时解析，跟随城市易主） |
  | `{ cityId: 'c2' }` | 指定 id 的城市（城市 id 必填且唯一） |
  | `{ anchor: 'eastGate' }` | 引用本关 `anchors` 表里的命名锚点 |

  解析顺序为 绝对坐标 → 命名锚点 → `spawnId` → `spawn` → `cityId` → `city`；解析不到时返回 `null`，调用方跳过该点位而不是崩溃。`anchors` 用来给常用坐标起名（可复用同一坐标、改一处即全局生效），**不允许锚点引用锚点**（无链式引用）。
- **兵力部署（编队式）**：`at` 为任意 PointRef；第 *i* 个单位的落点 = 锚点 + `offset` + `spacing × i`（两者缺省为 0）。可读性好且移动出生点后无需逐单位改坐标。
- **AI 脚本（事件 → 动作）**：`at` 支持 `{ time }`（经过秒数）与 `{ enemyCrossX }`（任一敌军越过该 x）；条件**首次满足时立即执行一次** `actions`，若给了 `repeatEvery` 则此后每 *n* 秒再执行一次。动作类型：`spawn` / `attackNearest` / `attackMove` / `hold`；所有目标同样是 PointRef（如 `{ city: 'blue' }` 在**调用时**解析，跟随城市易主）。新增行为只需扩展动作类型与 `level.js` 的校验，引擎其余部分不变。
- **`type`（进攻 / 防守）**：当前仅作元数据与 UI 展示。
- **`victory`**：**预留字段，当前引擎不读取**；胜负判定仍按 `gdd.md` §10（失去全部城市即负）。若要改成数据驱动，接入点见 `simulation/systems/victory.js`。
- 校验分两层：`validateLevel()` 做结构 + 语义校验（阵营、单位类型、坐标引用与锚点定义、条件与动作类型、`repeatEvery > 0` 等），`parseLevel()` 校验失败即抛错并聚合原因；`validateLevelReferences(level, mapData)` 在地图载入后交叉校验 `spawnId` / `cityId` / `anchor` 是否真实存在（`BootScene` 调用，仅告警不致命）；`deployForces()` 负责按数据部署。测试见 `tests/unit/level.test.js`。

## 8. 空间分区（性能）

- **均匀网格**：格子 64 px（≥ 最大攻击距离 55），`spatial.js` 每 tick 重建（O(n)），战斗/迷雾/士气/补给的邻居查询 O(1)/单位。
- 禁止全单位两两检测（`REQUIREMENTS.md` §5）；`spatial.test.js` 用 500 单位断言查询复杂度与正确性。
- 性能预算（500 活动单位、60 FPS）：模拟 tick ≤ 8 ms，渲染 ≤ 8 ms；`tests/e2e` 提供带性能标记的基准页，建立可测量基线。

## 9. 配置与 i18n

- `config/values.js`：**全部数值的唯一权威来源**——深度冻结的嵌套对象，覆盖规则（单位/战斗/地形/士气/城市/补给/迷雾）、交互与 UI、教学关卡、性能预算四类数值，与 `gdd.md` §12 镜像表一一对应。任何模块禁止硬编码数值，新增数值先入 config。
- 同步测试：Vitest 断言 `config/values.js` 与 `gdd.md` §12 镜像表一致（防文档漂移）。
- `i18n/index.js`：`t('hud.pause')` 查表，缺键在开发模式报 warning；中文默认，`en.js` 预留。原型 `index.html`/`game.js` 中的硬编码文案在阶段 3 全部迁入。

## 10. 场景与状态机

- `BootScene`：加载资源 → 解析地图 JSON → 构造 world → 进入 `GameScene`。
- `GameScene`：创建模拟层 + 输入层 + HUD，注册渲染循环；结算界面（胜利/失败）为场景内覆盖层。
- `EditorScene`：复用 map 模型与校验，一键试玩 = 把当前编辑地图写入 `sessionStorage` 并跳转到游戏页（`/game.html?fromEditor=1`），由 `BootScene` 读取地图、以无脚本敌军按出生点部署；试玩结束后“返回编辑器”跳回编辑器页。游戏、编辑器、主页各自为独立页面（`index.html`/`game.html`/`editor.html`，Vite 多页构建）。

## 11. 测试策略

| 层级 | 内容 | 工具 |
|---|---|---|
| 单元 | 战斗结算、士气、占领、补给、迷雾三态、胜负、地图 JSON 校验/迁移、命令分发、固定步长确定性、脚本敌军 | Vitest |
| 端到端 | 选择/框选/Shift、右键指挥、教学关完整闭环、暂停与速度、编辑器闭环 | Playwright（Chrome/Firefox/Edge 工程，1280×720 与 1920×1080） |
| 性能 | 500 单位 tick/渲染耗时基线，两两检测禁令 | 基准页 + 手动三浏览器 |

验收细则见 `acceptance-criteria.md`；开发顺序见 `development-plan.md`。
