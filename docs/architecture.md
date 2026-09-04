# War of Dots 技术架构文档

> 定义从浏览器原型演进到 MVP 的技术方案。原则来源：`REQUIREMENTS.md` §3/§5、`AGENTS.md`（模拟/渲染/输入/控制器分离、配置化、i18n）。与 `gdd.md` 中数值的一致性由 `src/config/` 与 Vitest 保障。

## 1. 技术栈

- Phaser 3（渲染与场景管理）、Vite、原生 JavaScript ES Modules、npm
- Vitest（确定性规则单元测试）、Playwright（关键浏览器流程）
- Node.js ≥ 22.12 仅用于开发/构建/测试；成品为纯静态 Web 应用，无后端

## 2. 工程结构

```
src/
  main.js                    # 入口：创建 Phaser Game，注册场景
  config/
    values.js                # 全部数值的唯一权威来源（gdd.md §12 数值总表为镜像）
    index.js                 # 聚合导出
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
    hud.js                   # 侧栏/顶栏/toast（DOM 或 Phaser 容器，阶段 3 定）
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
  "size": { "width": 1280, "height": 720 },
  "gridCellSize": 20,
  "terrain": { "width": 64, "height": 36, "cells": [0, 0, 2, "…"] },
  "cities": [ { "id": "c1", "x": 200, "y": 560, "faction": "blue" } ],
  "spawns": [ { "faction": "blue", "x": 200, "y": 560 } ],
  "objectives": [ { "id": "o1", "type": "captureCity", "cityId": "c2", "holdSeconds": 0 } ]
}
```

- `cells`：0 平原 / 1 森林 / 2 水域 / 3 桥梁（`gdd.md` §5），行优先。
- 读取流程：**结构校验（schema）→ 可玩性校验（双方至少 1 出生点与 1 城市、尺寸/格子一致）→ 版本迁移链（version < 当前版本时逐级升级）**，失败即拒绝载入并报错。
- 编辑器与运行时共享同一地图模型与校验代码（`REQUIREMENTS.md` §4.6）。
- 存档：`localStorage` 存设置/进度/自定义地图，文件 API 导入导出。

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
- `EditorScene`（阶段 5）：复用 map 模型与校验，一键试玩 = 用当前编辑地图构造 world 进入 `GameScene`，返回时回到编辑器。

## 11. 测试策略

| 层级 | 内容 | 工具 |
|---|---|---|
| 单元 | 战斗结算、士气、占领、补给、迷雾三态、胜负、地图 JSON 校验/迁移、命令分发、固定步长确定性、脚本敌军 | Vitest |
| 端到端 | 选择/框选/Shift、右键指挥、教学关完整闭环、暂停与速度、编辑器闭环 | Playwright（Chrome/Firefox/Edge 工程，1280×720 与 1920×1080） |
| 性能 | 500 单位 tick/渲染耗时基线，两两检测禁令 | 基准页 + 手动三浏览器 |

验收细则见 `acceptance-criteria.md`；开发顺序见 `development-plan.md`。
