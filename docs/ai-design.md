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
| 薄弱点/接近轴（阶段二） | `src/simulation/ai/front.js` | `frontPointsNear`（复用控制线 0 等值线定位战线）、`pointStrength`、`chooseWeakSpot`、`approachAxes`、`chooseApproach`、`terrainPreference`、`feintAxis`、`approachWaypoint` |
| 档位（阶段二） | `src/simulation/ai/presets.js` | `AI_PRESET_NAMES`、`AI_TUNING_KEYS`、`resolveAiConfig(preset, tuning)`、`validateAiTuning` |
| 战术调度 | `src/simulation/ai.js` | `engage` 动作、意图表 `intents`、`runTactics()`、休整状态机、预备队/佯动/急行军、换目标迟滞、命令签名去重 |
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

## 3. 阶段二已实现

### 3.1 薄弱点进攻（B）

```
world.controlLineSegments（控制线 0 等值线 = 实际战线，模拟层 10Hz 已算好）
        │ 目标周围 frontSearchRadius 内的战线点（40px 去重、pointLimit 上限）
        ▼
pointStrength(每点)：sampleRadius 内双方战力占比（空点记 1 = 没有部队挡路）
        ▼
chooseWeakSpot：取"敌方最弱 × 离目标最近"的一段（权重 0.7 / 0.3）
        ▼
approachAxes：围绕目标生成 axisCount 条接近轴（正面 + 左右侧翼，standoff 停在目标前）
        ▼
chooseApproach：三条轴里挑"敌方最弱 + 离自己近 + 地形合本档口味"的一条
        ▼
approachWaypoint：先到轴线端点集结，越过停战线后压向脚本目标
```

**权限边界（本轮确认）**：脚本给的**目标点不变**，AI 只决定"从哪个方向接近"。没有战线（没接触/无据点影响力）时自动退回直冲目标。

### 3.2 难度/性格三档（F）

| 档位 | 预备队 | 追击半径 | 急行军 | 地形偏好 | 佯动分兵 |
|---|---|---|---|---|---|
| `cautious` 谨慎 | 30 % | 180 px | 否 | 防守（森林/城镇） | 否 |
| `standard` 标准 | 15 % | 320 px | 是 | 均衡 | 否 |
| `sly` 狡诈 | 0 % | 520 px | 是 | 机动（道路） | 是（1 个单位走侧翼） |

- 关卡写法：`"ai": { "preset": "sly", "tuning": { "pursuitRadius": 420 } }`——`tuning` 只能覆盖
  `reserveRatio / pursuitRadius / useForcedMarch / terrainBias / feint` 这 5 个键（写错会被校验拦下）。
- **预备队**：按比例把离推进点最远的那几名留在主力后方 `rallyBehind` 处；投入条件 = 主力战力掉到开战基线
  `commitMainRatio` 以下，或目标方向我方相对优势已达 `commitWeaknessRatio`（扩大战果）。
- **佯动分兵（sly）**：派 1 个单位走相邻的侧翼轴，作为牵制（接触后按 attack-forward 自动交火）。
- **急行军**：档位允许且距推进点 ≥ `march.minDistance` 才下令（代价是士气 −10/s、掉血 1.5/s）。
  实测发现 400px 就触发太浪费（见 §5），已调到 650px。

### 3.3 回城休整

```
engage --(小队平均血量 < hpRatio 或士气 < morale)--> regroup（逐单位 move 到最近己城）
regroup --(进入己城恢复半径 100px)--> recover（原地 hold，靠 +3hp/s、+5 士气/s 恢复）
recover --(血量 ≥ recoverHpRatio 且士气 ≥ recoverMorale)--> engage（带 cooldownSeconds 冷却）
```
无己方城市时不撤退（继续打），避免"无城可退却站着不动"。

## 4. 确定性、性能与验收

- **确定性**：AI 每个固定 tick 收到 `1/60` 的 `dt`（与 headless `runSimulation` 同一节奏）；决策节奏由累加器控制（0.5 s），与渲染帧率无关 —— `tests/unit/ai-engage.test.js` 里"60fps 与 240fps 决策次数相同"与"createLoop 与逐 tick 驱动结果逐位一致"两条用例守护这一点。
- **性能**：只走 `world.spatial` 与半径截断（`pursuitRadius` / `localForceRadius` / `weakSpot.sampleRadius`），每单位每决策 O(候选数)；战线采样按 `pointLimit` 封顶；无意图时不跑任何战术代码（纯脚本关卡零开销）。
- **测试**：`ai-squad.test.js`（12 条队形/窄口/就位度）、`ai-tactics.test.js`（11 条战力/兵力比/价值/易伤/集火）、`ai-engage.test.js`（8 条接入/队形/不添油/集火/脚本优先/节奏/确定性）、`ai-presets.test.js`（7 条档位与校验）、`ai-front.test.js`（10 条战线/薄弱点/接近轴/地形偏好）、`ai-phase2.test.js`（8 条接近轴/预备队/佯动/急行军/休整）。

## 5. 实测（headless，双方各 12 轻装对撞：蓝方推进，红方固守，180 s）

阶段一（单档，基线对比）：

| 指标 | 基线 `attackMove` | 战术层 `engage` |
|---|---|---|
| 首次接触 | 12.2 s | 13.9 s（先整队） |
| 蓝方伤亡（HP） | 418 | 488 |
| 红方伤亡（HP） | 302 | 455 |
| **交换比（敌方伤亡/我方伤亡）** | 0.72 | **0.93（+29%）** |
| 交战时间占比 | 3.9 % | 7.6 % |
| 平均每目标受攻人数 | 1.19 | 1.11 |

阶段二（三档性格，同场景）：

| 档位 | 蓝方存活 | 蓝方伤亡 | 红方伤亡 | 交换比 | 首次接触 |
|---|---|---|---|---|---|
| 谨慎 cautious | 10 | 487 | 420 | **0.86** | — |
| 标准 standard | 10 | 487 | 420 | 0.86 | — |
| 狡诈 sly | 8 | 532 | 420 | 0.79 | 78.4 s |

观察与结论：
1. **急行军很贵**：`march.minDistance` 原为 400px 时，标准档在 760px 开进路上全程急行军（1.5 HP/s），
   交换比被拖到 0.33、蓝方伤亡翻倍；调到 650px 后与谨慎档持平。说明"急行军"应留给真正的长途奔袭
   （或只用于救火），不能当作默认行军方式——这是下一步可以细化成"仅在增援/救火时急行军"的点。
2. **性格 ≠ 难度**：谨慎档因为保留预备队、不烧血赶路，在这个对称场景里反而最难被吃掉；
   档位提供的是"行为风格"，难度仍取决于关卡兵力与地形。
3. 三档在预备队数量（30% / 15% / 0%）、接触时间（狡诈 78 s 就压上）、是否佯动上确实不同（见 §6 测试）。


结论：战术层让部队**更持续地压上并打出更好的交换比**，代价是接触更久、自身伤亡也上升（这是"敢打"的必然结果）。

**已知限制**：`maxAttackersPerTarget` 只约束 AI 的**派单**；已接触的单位由战斗系统按"最近敌人"自动接战（`combat.js` 的 `resolveTarget`），所以实测最大同目标受攻人数仍可能到 3。要严格限制需要改战斗目标选择规则，属于规则层改动，本轮明确不做。

## 6. 阶段划分与未做项

| 阶段 | 内容 | 状态 |
|---|---|---|
| 一 | 效用打分 + 编队协同 | ✅ 已实现 |
| 二 | 薄弱点进攻（复用战线 + 兵力比采样）+ 难度/性格三档 + 回城休整 | ✅ 已实现 |
| 三 | 侦察与信息公平（迷雾内决策 + 前沿探索 + `lastSeen` 记忆） | 未做（本轮确认不提前，仍全图可见） |
| 四 | 离线调参：headless 批量对局 + 参数搜索，把最优权重写回 `values.js` | 未做 |
| — | 急行军触发时机细化（只在增援/救火时）——见 §5 观察 1 | 未做（建议下一轮） |
| — | 严格封顶同目标受攻人数（要改战斗目标选择规则） | 本轮明确不做 |

## 7. 决策记录

**阶段一**

1. 开启方式：**新增 `engage` 动作 + 关卡显式选用**（旧行为默认不变）。
2. AI 挂载：**固定步长循环** `createLoop(world, [ai])`。
3. 信息公平：**保持全图可见**（阶段三再收）。
4. 队形来源：**按已有 `group` 标签自动生成**，关卡无需改字段。
5. 行为：集结点/不添油、集中火力、追击溃逃、窄口纵队。
6. 允许重新标定测试（塔山 press 规则已从 `attackMove` 切到 `engage`）。

**阶段二**

7. 薄弱点数据：**复用影响力场的 0 等值线定位战线，再沿战线采样局部兵力比**。
8. 权限边界：**只在脚本目标周围选接近方向/侧翼，目标点不变**。
9. 预备队：**按档位比例保留**，投入条件 = 主力受损或我方优势已成。
10. 档位落地：**`values.ai.presets` 三套基线 + 关卡 `ai.preset` + `ai.tuning` 覆盖 5 个键**。
11. 三档差异维度：预备队比例、追击距离、是否急行军、地形偏好、多轴佯动/分兵
    （**决策节奏与休整阈值为全局**，未做成档位差异）。
12. 回城休整：本阶段做。
13. 迷雾公平：不提前。
14. 验收：对撞指标对比 + 真实关卡跑分 + 允许重新标定关卡测试；**不改战斗目标选择规则**。
15. 本文档存档于 `docs/ai-design.md`。
