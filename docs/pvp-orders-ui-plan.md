# PvP 对局页交互方案（U1–U3，方案 A 批量命令）

> 状态：**U1/U2/U3 已实现**（2026-10-30），实测见 `docs/pvp-plan.md` §11.14。
> 关联：§3.4（迷雾归属）、§11.10（迷雾下放）、§11.11（控制线/补给线本地派生）、§11.6（交互对齐缺口）。

## 0. 目标

PvP 对局页的输入与战役**同一套语义**：浏览器端用 `src/simulation/commands.js` 的工厂造命令，
经 socket `cmd` 发给服务器；服务器继续做权威校验（`validateCommand` + 阵营归属 + 限频）与执行。
差异只在"谁执行"：战役 `world.issueCommands`（本地），PvP `socket.emit('cmd')`（远端）。

## 1. 输入 → 命令映射

| 手势 / 按键 | 命令 | 备注 |
|---|---|---|
| 左键点己方单位 | — | 选中；Shift = 追加 |
| 左键**从己方单位拖出轨迹** | 每单位一条 `move(path)` | 轨迹只提供相对位移，套到各单位自身位置 → **保持队形**；按住 E → `forced:true` |
| Shift + 拖出轨迹 | `appendRoute(path)` | 锚点 = `pendingQueue` 尾 → `route` 尾 → 自身坐标 |
| 右键空地 | `attackMove(target)` | E → `forced:true` |
| Shift + 右键 | `enqueueRoute(target)` | 排队 |
| 右键**已目视**敌军 | `lock(targetId)` | `isSpotted` 判定，点迷雾里的敌人按空地处理 |
| S | `hold()` | 停止全部选中 |
| ESC | — | 只清选择 |
| Space / 1 / 2 / 3 | **忽略** | 联机由服务器统一节奏，仅提示 |

## 2. 协议：一次操作 = 一条消息（方案 A）

```js
// 客户端 → 服务器
{ orders: [ { unitIds:[12], command:{type:'move', path:[…]} }, … ] }
// 服务器 ack
{ ok:true, applied:16, units:16, rejected:[{code:'NO_UNITS', unitIds:[7]}] }
```

- 服务器 `queueCommandBatch()`：逐条 `validateCommand` + 归属校验 + `world.issueCommands`；
  **整批只扣 1 次限频**（一次玩家操作），上限 `MAX_BATCH_ORDERS = 64`、单条 `unitIds ≤ 200`；
- 旧 payload `{unitIds, command}` 仍按单条处理（向后兼容）；
- 实测：16 单位 × 16 路点 ≈ 6 KB 一条消息；逐条发会被 20 条/秒限频拒掉一部分。

## 3. 客户端模块

| 文件 | 职责 |
|---|---|
| `src/input/orders.js` | 交互 + `buildFormationOrders()`（纯函数，队形偏移）；`options.issue/getFaction` 注入执行者与阵营 |
| `src/input/selection.js` | 选择框（`getFaction` 支持双方；`ids()/size()` 便利方法） |
| `src/pvp/commandQueue.js` | 同一事件循环内合并成一条 `cmd`；ack → 中文回执/错误码映射；统计 `batches/orders/units/applied/rejected` |
| `src/pvp/pvpKeyboard.js` | `S` / `ESC`；Space & 1/2/3 只提示 |
| `src/pvp/routePreview.js` | 本地 `planRoute` 算"预计路线"；偏离 > 48 px 或超 5 s 丢弃 |
| `src/pvp/battle.js` | 装配以上模块；画拖动轨迹（急行军换色）、预计路线虚线、落点闪圈；`#orderToast` 回执 |

## 4. 队形算在哪：**本地**（已确认）

理由：命令格式不变（服务器只认绝对路径，`planRoute` 起点是单位自身位置 → 不可能瞬移）；
所见即所得（预览与发送同一组数值，队形两端不可能不一致）；逻辑只存在一份（战役与 PvP 共用纯函数）；
队形属于输入习惯而非规则。若将来要"有裁判意义的队形规则"或出现第二客户端，把 `buildFormationOrders`
上移成共享纯函数即可（本身无副作用）。

## 5. 验收（已达成）

| 项 | 口径 | 结果 |
|---|---|---|
| 一次拖拽 | 一条消息、`applied` = 选中数、无 `RATE_LIMITED` | 16/16 ✅ |
| 队形 | 每个单位路径 = 自身位置 + 同一相对位移 | ✅（单测 + e2e 打印） |
| 停止 | 快照里 `state='hold'` | ✅ |
| 右键 | 空地 attackMove / Shift enqueueRoute / 敌人 lock | ✅ |
| 预览 | 松手后 `previewCount>0`，超时/偏离归零 | 16 → 0 ✅ |
| 回归 | `pvp-battle`、`pvp-reconnect` e2e | passed ✅ |

## 6. 未做（U4）

快照加 `route/pendingQueue`（真实路线，替代"预计路线"）、触屏长按、单位卡片面板、HUD 命令状态条。
