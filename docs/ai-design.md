# 敌军 AI 设计（战术层）

> 本文是 AI 扩展的设计与实施记录。战略层（关卡 JSON 脚本）见 `architecture.md §7.1`；
> 数值全部在 `src/config/values.js` 的 `ai` 域（gdd.md §12 镜像表同步）。

## 1. 分层：脚本管"打哪"，战术层管"怎么打"

```
关卡 JSON 脚本（战略层）        何时增援 / 夺哪个点 / 何时撤 —— 作者控制，未改动
      │ 目标 + 约束（engage 到 p3、hold、retreat…）
      ▼
战术层 ai.js + ai/tactics.js + ai/squad.js（阶段一新增）  队形、节奏、选谁打、追击
      │ 逐单位命令（统一命令接口 world.issueCommands）
      ▼
simulation（movement / combat / morale / supply…）        完全未改动
```

**铁律**
1. 战术层只在脚本使用 `engage` 动作时生效——旧的 `attackNearest` / `attackMove` 行为与关卡平衡不变（向后兼容）。
2. 脚本意图优先：`hold` / `retreat` / `attackMove` 会清掉对应编队的战术意图（`clearIntents`）。
3. 战术层只读世界状态、只通过统一下令接口行动，不直接改坐标/血量。
4. AI 不按渲染帧调用，而是挂在固定步长上（`createLoop(world, [ai])`），保证与 headless 复现一致。

## 2. 阶段一已实现

| 组件 | 文件 | 内容 |
|---|---|---|
| 效用打分 | `src/simulation/ai/tactics.js` | `combatPower` / `localBalance` / `targetValue` / `scoreAttack` / `chooseTarget` / `enemiesWithin` |
| 编队协同 | `src/simulation/ai/squad.js` | `formationSlots`（line / column / wedge）、`squadAnchor`、`needsColumn`、`cohesionRatio`、`isRushingAhead`、`assignSlots` |
| 战术调度 | `src/simulation/ai.js` | `engage` 动作、意图表 `intents`、`runTactics()`、换目标迟滞、命令签名去重 |
| 固定步长接线 | `src/simulation/loop.js`、`GameScene` | `createLoop(world, controllers)` 每 tick 驱动 AI；GameScene 不再按帧调 AI |

### 2.1 效用打分（选谁打）

每个单位在候选敌人中取加权最高分（权重见 `values.ai.weights`，全部归一化到 0~1）：

```
score = threat      × 局部兵力比 P(me)/(P(me)+P(enemy))     // 0.30
      + kill        × (1 - hp/maxHp)                        // 0.15  残血优先
      + distance    × (1 - d/engageRadius)                  // 0.15
      + value       × 目标价值（指定歼灭 1.0 / 重型 0.8 / 据点守军 0.7 / 普通 0.5）  // 0.15
      + vulnerability × (目标 rout/unordered ? 1 : 0)        // 0.10  承受伤害 ×1.5
      + chase       × (溃逃 ? 距离项 : 0)                    // 0.15  追击收益
      + terrain     × attackMultiplierAt(自己)               // 0.15  在水里输出减半
P(unit) = dps × effectsFor(morale).damageMultiplier × calcDamageRatio(unit) × (hp / 地形防御修正)
```

- **战力估算刻意复用真实伤害公式的成分**（`calcDamageRatio` 由 `combat.js` 导出），避免 AI 与战斗两套数值打架。
- **集中火力上限**：`values.ai.squad.maxAttackersPerTarget`（默认 2）——达到上限的目标直接从候选里剔除，避免多人围殴一个残血单位造成过杀浪费。
- **换目标迟滞**：新目标分数必须超过旧目标 `(1 + hysteresis)`（0.15）才换，防止每 0.5 秒横跳。
- **命令签名去重**：同一决策重复下发同样的命令会重置行军路线，因此只有签名变化时才真下单。

### 2.2 编队协同（怎么打）

- **小队 = 编队标签**：复用 `forces[].group` / `spawn.group`（`unit.group`），没有标签的归入默认小队。关卡 JSON 无需改字段。
- **队形推进**：锚点 = 小队形心向目标推进 `advanceStep`，每个单位按模板拿一个槽位（`line` 横向排开 / `column` 纵队 / `wedge` 楔形），并按朝向旋转；命令是"推进到自己的槽位"而不是"全部挤向同一个点"。
- **不添油（cohesion pacing）**：队形就位度 < `cohesionRatio`（0.7）且某单位"脱离队形又比形心更靠前"时，该单位原地 `hold` 等主力，主力的推进不中断。
- **窄口纵队**：沿"形心 → 目标"采样地形，遇到水域/桥梁/不可通行即切换 `column`，队伍排队通过。
- **追击溃逃**：`rout` / `unordered` 目标在打分里同时吃到易伤与追击两项权重，优先被点掉。
- **推进命令是 attack-forward**：接触敌军会自动停下交战（gdd §4），所以"按槽位推进"与"接敌"不冲突。

## 3. 确定性、性能与验收

- **确定性**：AI 每个固定 tick 收到 `1/60` 的 `dt`（与 headless `runSimulation` 同一节奏）；决策节奏由累加器控制（0.5 s），与渲染帧率无关 —— `tests/unit/ai-engage.test.js` 里"60fps 与 240fps 决策次数相同"与"createLoop 与逐 tick 驱动结果逐位一致"两条用例守护这一点。
- **性能**：只走 `world.spatial` 与半径截断（`engageRadius` 320 / `localForceRadius` 180），每单位每决策 O(候选数)；无意图时不跑任何战术代码（纯脚本关卡零开销）。
- **测试**：`ai-squad.test.js`（12 条队形/窄口/就位度）、`ai-tactics.test.js`（11 条战力/兵力比/价值/易伤/集火）、`ai-engage.test.js`（8 条接入/队形/不添油/集火/脚本优先/节奏/确定性）。

## 4. 实测（headless，双方各 10 轻装对撞：蓝方推进，红方固守）

| 指标 | 基线 `attackMove` | 战术层 `engage` |
|---|---|---|
| 首次接触 | 12.2 s | 13.9 s（先整队） |
| 蓝方伤亡（HP） | 418 | 488 |
| 红方伤亡（HP） | 302 | 455 |
| **交换比（敌方伤亡/我方伤亡）** | 0.72 | **0.93（+29%）** |
| 交战时间占比 | 3.9 % | 7.6 % |
| 平均每目标受攻人数 | 1.19 | 1.11 |

结论：战术层让部队**更持续地压上并打出更好的交换比**，代价是接触更久、自身伤亡也上升（这是"敢打"的必然结果）。

**已知限制**：`maxAttackersPerTarget` 只约束 AI 的**派单**；已接触的单位由战斗系统按"最近敌人"自动接战（`combat.js` 的 `resolveTarget`），所以实测最大同目标受攻人数仍可能到 3。要严格限制需要改战斗目标选择规则，属于规则层改动，未做。

## 5. 阶段划分与未做项

| 阶段 | 内容 | 状态 |
|---|---|---|
| 一 | 效用打分 + 编队协同（本文） | ✅ 已实现 |
| 二 | 薄弱点进攻（复用影响力场找战线弱点）+ 难度/性格三档（`ai.preset`） | 未做（字段已留） |
| 三 | 侦察与信息公平（迷雾内决策 + 前沿探索 + `lastSeen` 记忆） | 未做（阶段一保持全图可见） |
| 四 | 离线调参：headless 批量对局 + 参数搜索，把最优权重写回 `values.js` | 未做 |
| — | 低血/低士气回城休整 | 本轮未选，未做 |

## 6. 决策记录（本轮确认）

1. 开启方式：**新增 `engage` 动作 + 关卡显式选用**（旧行为默认不变）。
2. AI 挂载：**固定步长循环** `createLoop(world, [ai])`。
3. 信息公平：阶段一**保持全图可见**。
4. 队形来源：**按已有 `group` 标签自动生成**，关卡无需改字段。
5. 本轮行为：集结点/不添油、集中火力、追击溃逃、窄口纵队（未做回城休整）。
6. 难度档：只留 `ai.preset` 字段。
7. 允许重新标定测试（塔山 press 规则已从 `attackMove` 切到 `engage`）。
8. 本文档存档于 `docs/ai-design.md`。
