# 控制线 / 补给线客户端派生渲染（方案 B）· 草案 v1.0

> 状态：**已实现（B1–B4，2026-10-30）**，实测记录见 `docs/pvp-plan.md` §11.11。
> 关联：`docs/pvp-plan.md` §3.4（迷雾归属）、§11.10（迷雾下放到客户端）。

## 0. 决策

| # | 决策 | 含义 |
|---|---|---|
| 1 | **与战役完全一致** | 控制线**常显**（无开关，与 `GameScene` 相同）；补给线**只在选中单位时**画（≤12 个，含"断裂"标记与 `noPath` 提示） |
| 2 | **校正包不按需** | 服务器**固定周期**推送（默认 3 s），与玩家是否打开叠加层无关 |
| 3 | **本地优先（零额外延迟）** | 线始终是本地算的；校正只做"短暂缓拉 / 必要时硬切"，不做"永远以服务器为准" |
| 4 | **不加 `supplied` 字段** | "断补"标记与文案也用本地计算；HUD 的存量/血量继续用服务器快照 |

三个默认值（已确认）：校正周期 **3 s**、缓拉系数 **α=0.15**、`freeze` 触发 **连续 3 包**。

## 1. 信任边界

客户端**只允许**调用：

- `updateControlLine(world)`（`src/simulation/systems/controlLine.js`）
- `refreshSupply(world, dt)`（`src/simulation/systems/supply.js`）

客户端**禁止**调用（会写 hp / 存量 / 造兵 / 触发溃逃）：

- `updateSupply()`、`updateSupplyStock()`、`recoverNearCity()`、`applyWaterDamage()`、`produceUnits()`

派生量只写入 `world.controlLinePaths`、`unit.supplyEdges`、`unit.supplied`、`world.supplyToken`，
**不参与**任何数值显示与命令决策。

## 2. 客户端管线（每帧）

```
rAF
 ├─ tick 累加（values.simulation.fixedStep = 1/60），用 snapshot.tick 校准相位（偏差 > 3 直接对齐）
 ├─ if (phase === 'playing' && fogAuthority === 'client')
 │    ├─ 每 6 tick（10 Hz）：updateControlLine(world)   → localPaths
 │    └─ 每 tick：refreshSupply(world, dtSeconds)      → unit.supplyEdges / supplied / world.supplyToken
 ├─ 合成：world.controlLinePaths = renderPaths（本地 + 校正，见 §4）
 └─ 渲染：controlLineRenderer.draw()（常显）+ supplyLines.draw()（选中才画）
```

边界情况：

- **快照跳变**（重连、`tick` 跳 > 30）：清空 `controlLine / controlLinePaths / supplyFields / supplyMasks /
  supplyScratch`，清空服务器折线，等下一份校正包；这期间只画本地线、不做缓拉。
- **`fogAuthority !== 'client'`**：不计算控制线，直接用服务器折线（降级模式 `server`）。
- **准备阶段**（`phase='prep'`）：不计算。

## 3. 校正包协议

事件 `world:derive`（服务器 → 房间频道 `room:<code>`，两个阵营内容相同），3 s 一次：

```jsonc
{
  "seq": 42,                                   // 单调递增；客户端丢弃旧包
  "atTick": 18320,                             // 与快照同一 tick 域
  "controlLine": { "lod": 2, "paths": [[x, y], ...] },      // 整数坐标，约 226 点
  "supply": { "cityIds": ["c12"], "edges": [[unitId, cityIdx], ...], "off": [unitId, ...] }
}
```

| 字段 | 体积 | 用途 |
|---|---|---|
| `controlLine.paths` | ≈1.2 KB | 折线校正（几何） |
| `supply.edges` / `off` / `cityIds` | ≈0.4 KB | 偏差度量与 `freeze` 降级 |

- **无变化跳过**：折线 + 边集合的哈希与上次相同 → 不发（`seq` 不增）。
- 客户端按 `atTick` 丢弃过期包。
- 相比"塞进 15 Hz 快照"的 6.4 KB/帧（96 KB/s/人），本方案 ≈ **0.55 KB/s/人**。

## 4. 校正算法（本地优先）

**偏差度量** `mismatch`：在 64×64 网格上采样，比较采样点相对"本地折线"与"服务器折线"的最近段左右侧符号，
统计不一致比例。

| 档 | 条件 | 动作 |
|---|---|---|
| `soft`（默认） | `mismatch < 2%` | 不干预，线 = 纯本地 |
| `soft+bias` | `2% ≤ mismatch < 25%` | **1 秒内**把渲染折线按 α=0.15 缓拉向服务器折线，之后回到纯本地 |
| `hard` | `mismatch ≥ 25%`，或重连/开局后的第一份包 | 立即采用服务器折线 1 秒，并 `hardCount++` |
| `freeze` | 连续 3 份包都是 `hard` | 永久切到 `server` 模式（只显示服务器折线），HUD/调试记录 `deriveMode='server'`；`mismatch` 连续 2 包 < 5% 时自动恢复 |

折线比较前按**弧长重采样为 64 点**（两条折线点数不同，不能按索引插值）。

## 5. 降级

| 触发 | 行为 |
|---|---|
| `fogAuthority === 'server'` | 启动即 `mode='server'`：不计算、只画服务器折线 |
| `freeze` | 同上，可自动恢复（见 §4） |
| 3 个周期没收到包 | 继续用本地线（本地优先），`deriveStats.stale = true` |

## 6. 验收口径

| # | 指标 | 阈值 | 测法 |
|---|---|---|---|
| 1 | 控制线 `mismatch`（稳态 ≥3 s） | **< 2%** | e2e 读 `__pvp.deriveStats.mismatch`，30 s 采样 P95 |
| 2 | 折线几何差异 | Hausdorff **< 6 px** | 单测（同一 world 双算） |
| 3 | 补给边 `cityId` 一致率 | **> 98%** | 单测（服务器 vs 客户端 `distribute`） |
| 4 | `supplied` 一致率 | **> 99%** | 单测 |
| 5 | `hard` 切换 | **< 1 次/分钟** | e2e 计数 |
| 6 | 客户端 CPU | **< 0.1 ms/帧** | 实测 0.036 ms/帧（0.173 ms×10 Hz + 0.383 ms×1 Hz + 0.034 ms×2 Hz） |
| 7 | 校正包带宽 | **< 1 KB/s/人** | 压测统计 `world:derive` 字节 |
| 8 | 4 房间压测 | 平均 tick 与快照体积不回归 | `scripts/pvp-load.mjs` |

## 7. 实施步骤

| 阶段 | 内容 | 验收 |
|---|---|---|
| **B1** | 服务器 `world:derive`（控制线 + 补给边 + 断补列表，哈希跳过）；客户端用服务器折线渲染 | 协议通、体积/频率达标 |
| **B2** | 客户端本地算控制线 + mismatch 统计 + soft/bias/hard 校正 | `mismatch` < 2%，`hard` < 1/分钟 |
| **B3** | 客户端本地算补给分配，挂 `createSupplyLines`（选中才画） | 一致率 > 98%，视觉与战役一致 |
| **B4** | 降级（`server` / `freeze`）+ 文档 + 压测回归 | 两种模式都能跑 |

## 8. 不做的事

- 不改 `src/simulation/systems/*` 的规则代码（只调用两个安全函数）。
- 不改 `createControlLineRenderer` / `createSupplyLines`（PvP 直接复用，已验证只读 `world.controlLinePaths` /
  `unit.supplyEdges` / `world.supplyToken` / `world.controlLine`）。
- 不在客户端跑任何写数值的系统；不加 `supplied` 快照字段。

## 9. 已知风险

| 风险 | 缓解 |
|---|---|
| 开局 ~1 s 内控制线略偏 | 首份校正走 `hard`（此刻本地本就没收敛） |
| 临界单位"供/断"抖动 | 断裂标记 200 ms 去抖；几何仍走本地 |
| 浏览器节拍相位漂移 | 每 5 s 用 `snapshot.tick` 强制对齐 |
| 弱机器掉帧 | 控制线降到 3 Hz；补给线只在选中时画 |
