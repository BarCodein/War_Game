# PvP 联机对战开发计划（分阶段验收）

> 目标：在现有**确定性模拟引擎**之上，加两个能力 —— ① 匹配（房间码）② 双主机联机对局。
> 本文档只做计划与验收标准，**不改代码**。需求决定来自 2026-10-29 的确认答复（§2）。
> 术语：`权威模拟` = 服务器进程里跑的那份 `src/simulation`；`快照` = 服务器每 N 个 tick 广播给客户端的状态。

---

## 0. 进度状态

- [x] **P0 需求与前置**：七项决定 + 服务器实情确认（§2）
- [x] **P1a 链路打通**（已实现并本地实测，见 §11）：`server/`（express + socket.io）、`GET /api/health`、`/socket.io` 握手与 `link:ping`、`pvp.html` 自检页、`deploy/` 模板、`docs/pvp-deploy.md`、`tests/unit/server-link.test.js`
- [x] **P1b 账号体系**（已实现并本地实测，见 §11.2）：SQLite（better-sqlite3 + 迁移）、注册/登录/登出/`me`、scrypt 加盐、HttpOnly 会话 Cookie、按 IP 失败限速、`pvp.html` 账号面板、`tests/unit/server-auth.test.js`（10 条）、`tests/e2e/pvp-auth.spec.js`（3 条）
- [x] **P2 权威对局（MatchSim）**（已实现并本地实测，见 §11.3）：`server/src/match.js`（60Hz 固定步长 + 命令队列 + 胜负 + 超时判定）、`server/src/snapshot.js`（按阵营过滤视野）、`server/src/levels.js`、`public/assets/pvp/*.json`（对称兵力模板）、`scripts/pvp-selftest.mjs`、`tests/unit/pvp-match.test.js` + `pvp-levels.test.js`（28 条）
- [x] **P3 房间码匹配**（已实现并本地实测，见 §11.4）：`server/src/rooms.js`（状态机 + 6 位码 + TTL/倒计时/离场）、`server/src/routes/rooms.js`、`/api/rooms/*`、socket `match:join|ready|leave` + `match:state|begin|end`、`pvp.html` 房间大厅、`tests/unit/server-rooms.test.js`（10 条）、`tests/e2e/pvp-rooms.spec.js`（3 条）
- [x] **P4 对局同步与胜负**（已实现并本地实测，见 §11.5）：`server/src/driver.js`（单 60Hz 调度 + 15Hz 分阵营快照 + 结束只结算一次）、socket `cmd` 上行、`pvp-battle.html` + `src/pvp/battle.js`（复用地形/迷雾/单位渲染 + 插值 + DOM HUD）、`src/pvp/interpolate.js`、`tests/unit/pvp-driver.test.js` + `pvp-interpolate.test.js`（10 条）、`tests/e2e/pvp-battle.spec.js`（双上下文全流程）
- [x] **P5 断线重连**（已实现并本地实测，见 §11.7）：座位 `connected`/`reconnectToken`、静默期后播报 `opponent:left`、30s 宽限内 `match:join` 续局、超时判负（`disconnect-timeout`）、重开页面/服务器重启的提示、`tests/unit/pvp-reconnect.test.js`（5 条）、`tests/e2e/pvp-reconnect.spec.js`（2 条）
- [x] **P6 容量验收与部署脚本**（已实现并本地实测，见 §11.8）：`scripts/pvp-load.mjs`（4 房间 × 8 人压测，自动判 PASS/FAIL）、`deploy/update.sh`（服务器一键更新 + 健康检查）、`/api/health` 增加 `sim.*`（tick 成本/超预算次数/快照条数）；实测 4 房间平均 0.712 ms/tick、超预算占比 0.053%、快照 13.4 Hz、RTT 4 ms、第 5 房间 503
- [ ] P7 打磨（含 §11.6 的 PvP 交互对齐，待排期）

---

### 1.1 本期要做
| # | 功能 | 说明 |
|---|---|---|
| F1 | 匹配（房间码） | 创建房间 → 6 位房间码 → 对方输入房间码加入 → 双方准备 → 开始；含房间生命周期与错误提示 |
| F2 | 对局 | 服务器权威模拟、快照同步、按阵营过滤视野、5s 准备、占光全部城市即胜（`normal`）、10 分钟时限、结算页 |
| F3 | 账号 | 真实注册/登录（服务端数据库、口令加盐哈希、会话） |
| F4 | 断线恢复 | 30s 内可带 token 重连续局，超时判负 |

### 1.2 本期明确不做（避免范围蔓延）
快速匹配队列 / ELO 与天梯 / 观战与回放 / 3 人以上 / 编辑器地图联机 / 移动端适配 / 帧同步（lockstep）/**HTTPS 与证书**（原因见 §2.3）。

---

## 2. 已确认的需求决定

| 议题 | 决定 | 影响 |
|---|---|---|
| 权威模型 | **服务器权威**：服务端跑模拟，定时广播快照 | 客户端不做本地模拟（只渲染+发命令）；跨浏览器稳定、防作弊、重连简单；代价是服务器 CPU 与带宽 |
| 匹配方式 | **只做房间码**（好友约战） | 不需要排队系统与在线人数调度 |
| 服务器托管 | **自建服务器（有 sudo）**，**无域名** | 常驻 Node 进程 + WebSocket；无域名 → 本期不开 TLS，直接用 `http` + `ws://`（见 §2.2 / §2.3） |
| 部署方式 | **沿用现在的 GitHub CI**（构建 → 推 `dist`），服务器拉取；Node 服务用服务器上的 systemd 常驻 | CI 几乎不用改，见 §3.9 |
| 数据库 | 无偏好 → **SQLite**（单文件、零运维） | 后续要换 PostgreSQL 只换 `db.js` 实现，schema 不变 |
| 前端 | **保留现有静态多页站**，只新增 PvP 大厅页/对局页（React + Vite + WebSocket） | 战役与其它 20+ 页面一行不改，风险最低 |
| 对局规则 | 复用现有对称地图（渡江 8v8 城 / 平津 4v4 城）+ 固定兵力 + `normal`（占光全部城市）+ 5s 准备 + 10 分钟时限 | 引擎零改动即可判定胜负；兵力需做对称模板（§3.8） |
| 断线 | 30s 内可重连，超时判负 | 服务端按玩家保留对局状态与重连 token |
| 身份 | **真实注册登录 + SQLite** | users/sessions 表、scrypt 口令哈希、会话 Cookie |

### 2.1 前置信息：已确认 / 还需要一句话
| 项 | 状态 |
|---|---|
| 服务器所有权与 sudo | ✅ 自己的服务器，有 sudo |
| 域名 / 证书 | ✅ **没有域名** → 定为 `http` + `ws://`（§2.3） |
| 静态站部署 | ✅ **已由 Nginx 托管**（现有 CI 构建 → 服务器静态目录），沿用现状 |
| Nginx | ✅ **已安装**：只需追加 `/api` 与 `/socket.io` 两段反代（模板见 `deploy/nginx-wargame.conf`） |
| 架构方案 | ✅ **O1 已确认**：整站 + API 都由这台服务器提供（同源、零 CORS、零证书） |
| 操作系统 | ✅ Ubuntu **24.04.4 LTS (Noble)** → 系统源自带的 `nodejs` 版本过低，需按 §3.9 装 Node 22 |
| 硬件规格 | ✅ **1 核 / 2 GB** → 房间上限与性能指标按 §3.10 的实测结果定 |
| 公网地址 | ✅ `http://179.255.135.95/`（Nginx `listen 80 default_server`、`server_name _`） |
| 静态站位置 | ✅ Nginx `root /var/www/html/war_game/repo`（`location /` → `try_files $uri $uri/ =404`） |
| 视频目录 | ✅ `location /videos/` → `alias /var/www/html/videos/`（与 PvP 无关，保持不动） |
| 部署执行 | ✅ **你自己手动部署**：我方只交付配置模板 + 逐步清单（P6），不代跑命令 |
| 数据库 | ✅ 无偏好 → SQLite |
| 答辩/演示 | ✅ 不再考虑答辩场景，只按工程质量与可测验收标准做 |

### 2.2 同源 还是 跨站？（你问的那一条，重新解释）

**“同源”是浏览器的一条安全规则**：协议 + 主机 + 端口三者完全相同，才算同一个网站。

| 场景 | 页面地址 | 接口 / WS 地址 | 浏览器怎么看 |
|---|---|---|---|
| **同源（O1）** | `http://1.2.3.4/pvp.html` | `http://1.2.3.4/api/...`、`ws://1.2.3.4/socket.io` | 同一个网站：Cookie 自动带上、WebSocket 直接连、不需要任何额外配置 |
| **跨站（O2）** | `https://xxx.github.io/pvp.html` | `wss://1.2.3.4/api`、`wss://1.2.3.4/socket.io` | 两个不同网站，浏览器会：① 拦 CORS（服务器必须显式白名单这个来源）② 不带登录 Cookie（要 `SameSite=None; Secure`，而 `Secure` 又强制要求 https）③ 页面是 https 时**禁止连 `ws://`**（混合内容），只能 `wss://` → **必须买/借用域名 + 证书** |

换成大白话：

- **O1 = 页面和对战服务器是“同一个网站”**：浏览器不拦任何东西，登录可以直接用 Cookie，WebSocket 用 `ws://` 就行，**不需要域名、不需要证书**。
- **O2 = 页面在 A 站、对战服务器在 B 站**：浏览器处处设限，要额外做 CORS + Token 认证 + 证书；而且你现在的主站（GitHub Pages）是 **https**，`ws://` 会被直接拦掉，**没有域名就没法上 https，也就没法做 O2**。

**结论（推荐 O1，也是按你“有自己的服务器 + 无域名”给出的方案）**：

```
浏览器  http://<服务器IP>/pvp.html        ← Nginx（80 端口）托管静态构建产物（= 现在的 dist）
          │
          ├── /api/**        → 反代到 Node 服务（监听 127.0.0.1:3001）
          └── /socket.io/**  → 反代到同一 Node 服务（带 WebSocket Upgrade 头）
```

- 页面、接口、WebSocket 全在 `http://<IP>` 这一个源下 → **同源，零 CORS、零证书**；
- 现有 GitHub CI 继续只负责“构建 + 推 dist”；服务器把 `dist` 拉到 Nginx 目录即可（§3.9），CI 几乎不用改；
- 将来若拿到域名，**代码零改动**即可升级到 https：客户端用相对地址 + 协议自适应（`location.protocol === 'https:' ? 'wss' : 'ws'`），Nginx 加 443 与 certbot 证书。

> 如果你更希望“PvP 页留在 GitHub Pages”，那就只能走 O2，并且必须先解决域名 + 证书。以你现在的条件，O1 明显更省事。

### 2.3 TLS / https：本期不做，原因与代价

- **为什么可以不做**：`ws://` 只在**页面本身是 https** 时才被拦。我们的页面走 `http://<IP>`，所以 `ws://` 完全可用。
- **代价（要接受的现实）**：
  1. 流量不加密（口令、战况都是明文）→ 只适合自用/内网/可信网络；不要复用重要密码；
  2. 登录 Cookie 不能加 `Secure`；同源 + `SameSite=Lax` 足够；
  3. 公网暴露 http 端口要注意：账号接口做失败限速与计数（防爆破/枚举）。
- **将来要 https 的三条路（都不需要改代码）**：① 免费二级域名（如 `nip.io` / `sslip.io` 把 IP 编进域名）+ Let's Encrypt；② 买便宜域名 + certbot；③ Cloudflare Tunnel（免端口，但隧道域名不稳定）。

---

## 3. 技术方案

### 3.1 为什么引擎可以直接复用（已核实）

| 复用点 | 证据 |
|---|---|
| 纯 JS、无 Phaser/DOM | `src/simulation/**` 被 Vitest 在 Node 里直接跑；`AGENTS.md` 的架构约束 |
| 不依赖浏览器随机/时钟 | `grep Math.random/Date.now src/simulation` → **0 命中** |
| 固定步长与固定 tick 顺序 | `values.simulation.fixedStep = 1/60`；`movement → combat → supply → supplyStock → capture → fog → controlLine → victory` |
| 命令唯一入口 | `world.issueCommands(ids, command)` + `validateCommand()` → 服务器可插入归属/合法性/频率校验 |
| 胜负规则现成 | `victory.js` 的 `normalVictory` 是**对称**判定（谁占光全部城市谁赢），PvP 无需改规则 |
| 视野现成 | `isSpotted(world, unit, viewerFaction)` 按阵营判定 → 服务端可按玩家过滤敌方数据（防透视） |
| 关卡/地图格式现成 | `public/assets/maps/*.json` + `levels/*.json`；`buildMission()` 生成 `world.mess` |

### 3.2 拓扑

```
浏览器 A ─┐        HTTP / WS        ┌─ Nginx（80 端口：静态托管 + /api + /socket.io 反代，含 WS Upgrade）
          ├───────────────────────► │
浏览器 B ─┘                         └─ Node 22（127.0.0.1:3001，systemd 常驻）
                                       ├─ 账号/会话（SQLite + scrypt）
                                       ├─ 房间管理（房间码）
                                       └─ 权威 MatchSim：60Hz tick + 15Hz 快照（每房间一个 World）
```

### 3.3 对局时序与关键数字

| 项 | 取值 | 依据/备注 |
|---|---|---|
| 准备阶段 | 5 s | 复用 `values.prep.seconds`；两端同步倒计时，期间可下预备命令 |
| 服务器 tick | 60 Hz | 复用 `fixedStep`；单房间 CPU 预算 < 2 ms/tick |
| 快照频率 | 15 Hz（可配） | 客户端 100 ms 插值缓冲，画面 60 FPS |
| 快照体积 | **实测 3.3–4.5 KB** | 渡江 41 / 平津 34~40 个活单位 + 城市/据点（§3.10 实测）；15 Hz 双人 ≈ 0.10–0.13 MB/s/房间 |
| 时限 | 600 s | 超时判定：**城市数多者胜 → 相同则总血量高者胜 → 再相同判平** |
| 房间码 | 6 位大写字母数字 | 30 min 未开局自动过期；开局后房间转为 match |
| 重连窗口 | 30 s | 期间对局继续推进（掉线方单位保持原命令） |

### 3.4 视野归属与防作弊（2026-10-30 精调：默认下放给客户端）

> ⚠️ 决定变更：原设计是"服务器按视野过滤快照"（防透视）。**2026-10-30 起默认改成 `PVP_FOG_AUTHORITY=client`**：
> 服务器下发**全部存活单位**，迷雾完全由客户端本地计算。代价是**失去防透视**（打开 DevTools 能看到全图敌军），
> 只适合朋友之间的对局；需要防作弊时设 `PVP_FOG_AUTHORITY=server` 即回到旧行为，代码不用改。

| 模式 | 快照内容 | 迷雾计算 | 防透视 | 带宽 |
|---|---|---|---|---|
| **client（默认）** | 全部存活单位（16 蓝 + 16 红） | 客户端 `updateFog()`（只依赖己方单位/城市/占领点） | ❌ 改前端/DevTools 可见全图 | 32 单位 ≈ **5.6 KB**（+24%） |
| server | 己方全部 + 仅 `isSpotted` 的敌军 | 两端口径一致（客户端只为着色） | ✅ 未目视敌军坐标根本不下发 | 24 单位 ≈ 4.7 KB |

两种模式共同的部分：

1. **迷雾判定只有一套规则**（`fog.js`）：己方单位视野（轻 140 / 重 160）∪ 己方城市 180 ∪ 己方占领点 180；森林里的敌军需 60 px 内才算目视。
2. **城市 / 占领点归属与占领进度始终公开**（和战役 HUD 一致）。
3. **命令校验**：`faction` 归属、单位存活、命令格式（`validateCommand`）、单玩家 ≤ 20 条/秒、payload 上限 —— 与视野模式无关。
4. **不做客户端预测**（MVP）：输入延迟 ≈ RTT/2 + 100 ms 插值；P7 视实测再决定是否加"移动指令本地乐观回显"。

实测（客户端模式，渡江 PvP，开局 4 秒）：快照 **32 个单位 / 5782 B**；蓝方迷雾可见 **5475 / 10240 格**；
`enemiesKnown=16`，但 `isSpotted` 判定后只画 **8 个** → HUD「可见敌军 8」。**画面与"服务端过滤"时完全一样**，
区别只在于数据是否到了客户端。

### 3.5 目录结构（新增，**不动**现有战役代码）

```
server/
server/
  src/index.js          # 进程入口：读配置、listen、SIGINT/SIGTERM 优雅退出（**不自动 listen 的模块见 app.js**）
  src/app.js            # createPvpServer()：express + socket.io 装配（导入无副作用，便于单测 listen(0)）
  src/config.js         # 端口 / 快照频率 / 房间上限 / 静态托管开关 / Cookie 名（全部可用环境变量覆盖）
  src/db.js             # 【P1b】SQLite：建表、迁移、查询
  src/auth.js           # 【P1b】注册 / 登录 / 会话（scrypt 加盐 + 随机盐）
  src/rooms.js          # 【P3】房间码生成、加入、准备、离开、TTL 回收、状态机
  src/match.js          # 【P2】MatchSim：复用 src/simulation，60Hz、命令队列、胜负、快照
  src/snapshot.js       # 【P2】快照序列化 + 按阵营过滤（§3.4）
  src/protocol.js       # 【P2】事件名 + payload schema（服务端与前端共享）
deploy/
  nginx-wargame.conf    # ✅ 已交付：贴进现有 server{} 的 /api 与 /socket.io 反代片段
  war-game.service      # ✅ 已交付：systemd 单元（MemoryMax=1G / StateDirectory=war-game）
pvp.html                # ✅ 已交付：**链路自检页**（P3 换成 React 大厅）
pvp-battle.html         # 【P4】对局页（Phaser + 快照渲染，无本地模拟）
src/pvp/                # 【P3/P4】React 组件、socket 客户端、snapshot→world 应用器、插值
public/assets/pvp/      # 【P2】对称 1v1 关卡：dujiang_pvp.json、pingjin_pvp.json（§3.8）
docs/pvp-deploy.md      # ✅ 已交付：手动部署清单 + 本地验收（§11）
tests/unit/server-link.test.js  # ✅ 已交付：链路契约（health / 404 / 握手 / ping）
```

- **依赖装在仓库根上**（`express` / `socket.io` 进 `dependencies`，`socket.io-client` 进 `devDependencies`），
  `server/` 不再单独放 `package.json` —— 一次 `npm ci` 同时满足构建、单测与服务端运行，避免两套 `node_modules`。
- **构建**：`vite.config.js` 已自动扫描根目录 `*.html` 作为入口 → `pvp.html` / `pvp-battle.html` 无需改配置；
  开发期的 `/api` 与 `/socket.io` 由 Vite 的 `server.proxy` 转发到 `127.0.0.1:3001`（与线上 Nginx 反代同构）。
- **服务端复用引擎**：`server/` 以 ESM 直接 `import { World } from '../src/simulation/world.js'`，**不复制**模拟代码（单一真相）。

### 3.6 数据模型（SQLite，5 张表）

> 实现进度：**已建 `users` / `sessions`**（P1b，迁移版本 1）；`rooms` / `matches` / `match_players` 在 P3/P4 追加迁移（`meta.schema_version` 递增）。

```sql
users(id INTEGER PK, username TEXT UNIQUE, password_hash TEXT, salt TEXT, created_at INTEGER)
sessions(token TEXT PK, user_id INTEGER, created_at INTEGER, expires_at INTEGER)
rooms(code TEXT PK, host_id INTEGER, guest_id INTEGER, level_id TEXT, state TEXT,
      created_at INTEGER, expires_at INTEGER)                 -- 也可仅内存，落库便于排查
matches(id TEXT PK, room_code TEXT, level_id TEXT, started_at INTEGER, ended_at INTEGER,
        winner TEXT, result TEXT, ticks INTEGER)
match_players(match_id TEXT, user_id INTEGER, faction TEXT, reconnect_token TEXT,
              connected INTEGER, left_at INTEGER, result TEXT)
```

### 3.7 协议草案

**REST（同源，Cookie 会话）**

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/register` | `{username, password}` → 409 用户名已存在 |
| POST | `/api/auth/login` | 成功下发 `HttpOnly` 会话 Cookie（`SameSite=Lax`） |
| POST | `/api/auth/logout` | 销毁会话 |
| GET | `/api/auth/me` | 当前用户（未登录 401） |
| POST | `/api/rooms` | 建房 → `{code}` |
| GET | `/api/rooms/:code` | 房间状态（不存在 404 / 已满 409 / 已开局 409） |
| POST | `/api/rooms/:code/join` | 加入（房主不能加入自己） |
| POST | `/api/rooms/:code/leave` | 离开；房主离开则房间关闭 |
| GET | `/api/health` | 健康检查（给 Nginx / 监控） |

**Socket.IO（命名空间 `/match`，握手时带 Cookie 认证）**

| 事件（C→S） | payload | 说明 |
|---|---|---|
| `match:join` | `{roomCode, reconnectToken?}` | 进入对局频道（重连带 token） |
| `match:ready` | `{}` | 准备；两边都 ready 触发 `match:begin` |
| `cmd` | `{seq, command}` | 指挥命令（服务端校验后注入权威模拟） |
| `match:leave` | `{}` | 主动退出（判负） |
| `ping` | `{t}` | 测 RTT |

| 事件（S→C） | payload | 说明 |
|---|---|---|
| `match:state` | `{room, you:{faction}, opponent:{username,ready,connected}}` | 房间/准备状态变化 |
| `match:begin` | `{matchId, levelId, yourFaction, prepSeconds, serverTick}` | 开局（含 5s 准备） |
| `tick` | `{tick, units[], cities[], points[], events[]}` | 快照（已按你的阵营过滤） |
| `match:end` | `{winner, reason, stats}` | 胜/负/超时/对手掉线/判平 |
| `opponent:left` / `opponent:rejoin` | `{graceSeconds}` | 掉线播报与重连提示 |
| `error` | `{code, message}` | 统一错误码（见 `docs/pvp-protocol.md`） |

### 3.8 对称 1v1 兵力模板（P2 已交付）

现有战役关卡的 `forces` 是**剧本化**的（平津 17v23、渡江 20v21，城市数对称但兵力不对称），直接拿来打 PvP 不公平。最终实现：

- 新增 `public/assets/pvp/dujiang_pvp.json`、`pingjin_pvp.json`：`map` 引用**同一张地图**，`victory: { "mode": "normal" }`，**没有 AI 脚本**；
- **双方兵种与数量完全相同**（渡江 10 轻 + 6 重 = 16v16；平津 8 轻 + 4 重 = 12v12），每侧 2 个集结点；
- **各自只使用本方地图出生点**（不采用"坐标镜像"：渡江有河，镜像坐标会把部队放进水里；用地图自带出生点可保证出生即可通行，测试里逐单位断言 `terrain.passableAt`）；
- 双方集结点**最小间距 ≥ 400px**（视野 140/160、城市 180），避免开局就被对方目视；
- 验收（`tests/unit/pvp-levels.test.js`，6 条）：兵种/数量相等、只用本方出生点、出生点可通行、间距 ≥ 400、双方各持城市且数量相等、normal + 无 AI。

> 说明：地图上城市是交错的，城市视野（180）会让双方在开局看到**部分**敌军——这是地图本身决定的，不是漏发数据；`tests/unit/pvp-match.test.js` 用"快照里的敌军恰好等于被目视的集合"来锁定防透视契约。

### 3.9 部署（基于你现有的 Nginx 配置，你手动执行）

**现状（已确认）**：`http://179.255.135.95/` 由 `/etc/nginx/sites-enabled/default` 提供，
`location /` → `root /var/www/html/war_game/repo`（`try_files $uri $uri/ =404`），
`location /videos/` → `alias /var/www/html/videos/`。PvP 只做**增量**，改动两处：Nginx 加两段反代、起一个 Node 服务。

#### 3.9.1 Nginx：把这两段贴进现有 `server { … }`（放在 `location /` 之前）

```nginx
        # ---- PvP：账号/房间 REST + 对局 WebSocket（同源，走 80 端口，反代到本机 Node）----
        location /api/ {
                proxy_pass http://127.0.0.1:3001;      # 注意：不带 URI，路径 /api/** 原样透传给 Node
                proxy_http_version 1.1;
                proxy_set_header Host $host;
                proxy_set_header X-Real-IP $remote_addr;
                proxy_read_timeout 60s;
        }

        location /socket.io/ {
                proxy_pass http://127.0.0.1:3001;
                proxy_http_version 1.1;
                proxy_set_header Upgrade $http_upgrade;   # WebSocket 升级
                proxy_set_header Connection "upgrade";
                proxy_set_header Host $host;
                proxy_set_header X-Real-IP $remote_addr;
                proxy_read_timeout 600s;                  # 对局期间是长连接
                proxy_send_timeout 600s;
        }
```

- 因为 `proxy_pass` 不带 URI，Node 侧路由要挂在 **`/api/...`**（而不是 `/`）——`server/src/index.js` 里按此实现；
- 页面、接口、WS 全在 `http://179.255.135.95` 同一源下 → **不需要 CORS、不需要证书**；
- `location /` 不变：`/pvp.html`、`/pvp-battle.html` 会作为真实文件被 `try_files` 命中；
- 改完 `sudo nginx -t && sudo systemctl reload nginx`。

#### 3.9.2 Node 服务（`/opt/war-game-server`）

服务器只需要三样东西：`server/`、引擎 `src/`、关卡与地图 JSON（`public/assets/{maps,levels}`）——**不需要 200 MB 的视频素材**。

> 若主仓是**私有**仓库，`git clone` 需要凭据：用只读 Deploy Key（`~/.ssh/id_ed25519` + GitHub 仓库 Settings → Deploy keys）或在 URL 里带只读 token；服务器上不要存有写权限的凭据。

```bash
# 1) Node 22（Ubuntu 24.04 自带的 nodejs 是 v18，不够）
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs && node -v      # 期望 ≥ 22.12

# 2) 取代码：跳过 LFS（.gitattributes 只把 png/jpg/mp3/mp4 划进 LFS，JSON/JS 是普通文件）
sudo mkdir -p /opt/war-game-server && sudo chown "$USER" /opt/war-game-server
GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1 https://github.com/BarCodein/War_Game.git /opt/war-game-server

# 3) 装依赖（只有 server/ 需要 node_modules）
cd /opt/war-game-server/server && npm ci --omit=dev

# 4) systemd
sudo cp ../deploy/war-game.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now war-game
curl -s http://127.0.0.1:3001/api/health

# 5) 更新（每次改完代码）
cd /opt/war-game-server && GIT_LFS_SKIP_SMUDGE=1 git pull && cd server && npm ci --omit=dev && sudo systemctl restart war-game
```

`deploy/war-game.service`（P6 交付）：

```ini
[Unit]
Description=War of Dots PvP server
After=network.target

[Service]
Type=simple
User=wargame
WorkingDirectory=/opt/war-game-server/server
Environment=NODE_ENV=production
Environment=NODE_OPTIONS=--max-old-space-size=768
StateDirectory=war-game                 # → /var/lib/war-game（SQLite 放这里）
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=3
MemoryMax=1G                            # 1 核 2 GB 机器上别让它吃满内存
NoNewPrivileges=yes

[Install]
WantedBy=multi-user.target
```

#### 3.9.3 三条必须遵守的约束

1. **不要在服务器上 `npm run build`**：Vite 打包 1.2 MB 地图 chunk 在 1 核机上很吃力；构建留在 CI，服务器只拉 `dist`/`server`；
2. `better-sqlite3` 是原生模块：Ubuntu 24.04 + Node 22 有预编译包，正常 `npm ci` 即可；失败再 `apt install build-essential python3`（备用方案：Node 22 自带 `node:sqlite`）；
3. **SQLite 文件放到 `StateDirectory`**（`/var/lib/war-game/pvp.db`），不要放代码目录（`git pull` 不会动它，权限也由 systemd 管）。

#### 3.9.4 与 PvP 无关、但同机部署时值得顺手检查的一点

前端页面里写死的战役视频地址是 **`http://179.255.122.44/videos/*.mp4`**（旧 IP），而你这台机器是 **179.255.135.95**、且 Nginx 有 `/videos/` → `/var/www/html/videos/`。
若 `179.255.122.44` 已经不再提供服务，视频会走各页面的本地兜底或直接 404；需要的话可以另开一轮把地址统一到新 IP（不在本计划范围内，仅记录）。

#### 3.9.5 客户端连接方式

一律**相对地址 + 协议自适应**：`const WS_BASE = location.origin.replace(/^http/, 'ws')` → 现在得到 `ws://179.255.135.95`，将来上 https 自动变 `wss://`，代码零改动。

### 3.10 服务器容量：1 核 / 2 GB 够不够？（实测）

我在本机用 Node 直接把**权威模拟**跑起来量了一遍（无浏览器、40 单位 PvP 规模、交战状态）：

| 场景 | 活单位 | 平均 tick | 最大 tick | 快照体积 |
|---|---|---|---|---|
| 渡江 · 静止 10 s（600 tick） | 41 | **0.48 ms** | 31 ms（首帧/JIT 预热） | 4.24 KB |
| 渡江 · 双方推进交战 20 s（1200 tick） | 36 | **0.60 ms** | 10.3 ms | 4.49 KB |
| 平津 · 双方推进交战 20 s（1200 tick） | 34 | **0.42 ms** | 3.6 ms | 3.29 KB |

换算与结论：

| 指标 | 单房间 | 上限（4 房间） | 说明 |
|---|---|---|---|
| 模拟 CPU | 0.6 ms × 60 Hz ≈ **3.6%** 一核（本机） | ≈ 15%（本机） | VPS 单核可能慢 2–3 倍 → 按 **8–12% / 房间** 预留，4 房间 ≈ **35–50%** |
| 出网带宽 | 15 Hz × 3.5–4.5 KB × 2 人 ≈ **0.10–0.13 MB/s** | ≈ **0.45 MB/s（≈4 Mbps）** | 很轻；不需要开压缩 |
| 内存 | Node RSS 基线 60–100 MB + 每房间 World 数 MB | **< 400 MB** | 2 GB 足够（含 Nginx 与 SQLite） |
| 房间上限 | — | **4 个并发对局（8 人）** | 写死 `MAX_ROOMS=4`，超过时建房接口返回 503「服务器繁忙」，而不是硬撑 |

**必须做的保护（1 核最容易踩的坑）**：
1. **预热**：每次建局先空跑 60 tick 再开始，抹掉上表里 10–31 ms 的首帧/JIT 抖动；
2. **监控最大 tick**：超过 **8 ms**（`values.performance.simTickBudgetMs`）打日志告警——1 核上一旦出现连续超预算，画面会明显卡；
3. **Node 内存上限**：`node --max-old-space-size=768` + systemd `MemoryMax=1G`，避免 OOM 拖垮 Nginx；
4. **快照频率可降级**：默认 15 Hz，CPU 紧张时配置降到 12 Hz；
5. 对局结束后**立刻释放 World**（避免内存缓慢增长）。

---

## 4. 分阶段计划（每阶段都有可测出口）

> 人日按单人估算；2 人并行时总工期约减半（§7）。

### P0 · 需求冻结与前置确认（0.5 人日）
| 项 | 内容 |
|---|---|
| 交付物 | 本文档定稿；`docs/pvp-protocol.md` 草案；§2.1 三项小信息补齐 |
| 验收 | ① 决定表未被推翻 ② 服务器公网 IP/端口现状、Nginx 是否已装、O1 确认 |
| 风险 | 信息不全 → 后续全部延后 |

### P1 · 服务端骨架 + 账号体系（3 人日）
| 项 | 内容 |
|---|---|
| 交付物 | `server/` 可启动；SQLite 建表；注册/登录/登出/`me`；`/api/health`；`deploy/war-game.service` |
| 验收 | ① 注册→登录→`me` 全链路可用（Playwright 1 条 + Vitest ≥ 8 条）② 口令 **scrypt 加盐**、库里不存明文 ③ 用户名重复 409、密码错 401、会话过期 401 ④ Cookie 为 `HttpOnly`；登出后旧 Cookie 失效 ⑤ 失败登录限速（同 IP 5 次/分钟） |
| 测试 | Vitest（auth + DB）；Playwright（登录流）；`curl` 冒烟脚本 |
| 风险 | 无 TLS → 口令明文传输：UI 明示“勿用重要密码”，并做失败限速 |

### P2 · 引擎上服务器 + MatchSim（2 人日）
| 项 | 内容 |
|---|---|
| 交付物 | `server/src/match.js`：`new MatchSim(levelId)` → `start()/queueCommand(faction, cmd)/stop()`；固定 60Hz；快照序列化；`public/assets/pvp/*.json` |
| 验收 | ① Node 里跑通一整局（无浏览器）：12000 tick（200s 模拟）平均 tick < 2 ms ② 同一命令流重放两次逐 tick 一致（确定性回归）③ 快照里敌方未目视单位不出现（Vitest 断言）④ 对称兵力模板：双方单位数与兵种构成相等 ⑤ `normal` 判定：占光全部城市即结束，事件推送一次 |
| 测试 | Vitest：MatchSim / 快照过滤 / 胜负 15+ 条 |
| 风险 | 引擎若隐含浏览器依赖（当前核查无）→ 抽 platform shim |

### P3 · 房间码匹配（2 人日）
| 项 | 内容 |
|---|---|
| 交付物 | 房间状态机（waiting → ready → countdown → playing → finished）；6 位码；加入/准备/离开/TTL；`pvp.html` 大厅（React） |
| 验收 | ① 两个独立浏览器上下文：A 建房拿码 → B 输码加入 → 双方 ready → 5s 倒计时 → 进入对局页（Playwright 端到端 1 条）② 错误码覆盖：房间不存在/已满/已开局/码过期/房主离开 ③ 房间 30 min 未开局自动回收 ④ 大厅断线重连后状态自愈 |
| 测试 | Vitest（状态机 8 条）；Playwright（双上下文） |
| 风险 | 同账号进同一房间 → 409 |

### P4 · 对局同步与胜负（4 人日）★核心
| 项 | 内容 |
|---|---|
| 交付物 | `pvp-battle.html` + `src/pvp/`：Phaser 渲染复用现有 renderer、快照应用器、100ms 插值、命令上行、HUD（计时/任务/结算）、`match:end` 结算 |
| 验收 | ① **画面一致**：随机抽 10 个 tick，客户端单位坐标与服务器快照误差 < 0.5 px ② **胜负一致**：把某方城市全占后两端同时收到同一结果 ③ **视野隔离**：敌军移出视野后该客户端快照里不含该单位（数据层断言）④ 5s 准备两端同步（误差 < 100 ms）⑤ 10 分钟到点按时限规则判胜 ⑥ 输入到画面反馈 < 200 ms（同城网络实测记录）⑦ 暂停/加速键在 PvP 中禁用 |
| 测试 | Playwright 双上下文对战（测试开关把时限缩短到 20 s、兵力 2v2）；Vitest（插值、快照应用、胜负） |
| 风险 | 无预测手感偏钝 → P7 视评估加乐观回显；插值抖动 → 缓冲自适应 |

### P5 · 断线与异常（2 人日）
| 项 | 内容 |
|---|---|
| 交付物 | 重连 token、掉线标记与播报、30s 宽限、超时判负、对手离开 UI |
| 验收 | ① 关闭一端页面 → 另一端 1 s 内收到“对手掉线（剩余 30 s）”② 10 s 内重开页面自动续局，位置/计时与服务器一致（误差 < 0.5 px）③ 超 30 s → 另一端收到胜利结算，掉线方回大厅并提示 ④ Node 进程重启 → 进行中对局标记 `aborted`，两端收到提示（MVP 不恢复）⑤ 乱序/重放/超大 payload 命令被丢弃且不崩溃 |
| 测试 | Playwright（断开 context → 重开）；混沌脚本（随机 kill socket 100 次不崩） |
| 风险 | 内存泄漏（对局不回收）→ 结束后强制释放 World |

### P6 · 部署配置与验收（1 人日，**命令由你手动执行**）
| 项 | 内容 |
|---|---|
| 交付物 | `deploy/nginx-wargame.conf`（在现有站点基础上追加 `/api` 与 `/socket.io` + Upgrade 头）、`war-game.service`（`MemoryMax=1G`）、`deploy/update.sh`、`docs/pvp-deploy.md`（逐步手动部署清单，含 Node 22 安装、目录、权限、日志、回滚） |
| 验收 | ① 公网 `http://<IP>/pvp.html` 打开 → 两台不同网络真机完成一整局 ② `ws://<IP>/socket.io` 握手成功（DevTools 101 Switching Protocols）③ `kill` Node 进程 → systemd 5 s 内拉起 ④ **容量**：4 房间并发（8 人）跑 10 分钟 —— 平均 tick < 2 ms、最大 tick < 8 ms（预热后）、Node RSS < 400 MB、CPU 占用 < 60%、无掉线 ⑤ 第 5 个房间建房返回 503「服务器繁忙」⑥ 日志可定位“谁在对局中掉线” |
| 测试 | `scripts/pvp-load.mjs`（脚本机器人 ×8）；你在服务器上按清单执行并回填实测数据 |
| 风险 | 1 核机同时被 Nginx（静态大文件/mp4 请求）+ 模拟争用 → 大视频请求建议 `sendfile on` 且与对局错峰；端口被封 → 换 8080/8443 |

### P7 · 打磨与文档（1 人日）
| 项 | 内容 |
|---|---|
| 交付物 | 中英文案（i18n）、错误提示友好化、音效/BGM 与战役一致、`docs/acceptance-criteria.md` 新增 **H. PvP** 小节、`README`/`REQUIREMENTS` 更新 |
| 验收 | ① 新验收标准逐条勾选 ② 自动化：`npm test` + `npm run test:e2e`（含 PvP 双上下文）全绿 ③ `git diff --check` 干净、代码评审通过 |

**合计 ≈ 15.5 人日**（单人串行）；2 人并行（服务端 / 前端各一路）约 **8–9 个工作日**。

---

## 5. 总体验收清单（对齐两项核心功能）

### 5.1 匹配功能（F1）
- [ ] 建房返回 6 位房间码，30 min 未开局自动过期
- [ ] 输入房间码可加入；房间不存在/已满/已开局/过期都有明确错误提示
- [ ] 双方“准备”后 5 s 倒计时自动开局，两端倒计时同步（误差 < 100 ms）
- [ ] 房主离开 → 房间关闭并通知对方；对局中离开 → 判负
- [ ] 同账号不能进同一房间（409）
- [ ] 两个独立浏览器上下文可完整跑通（Playwright，进 CI）

### 5.2 对局功能（F2）
- [ ] 服务器权威：客户端只发命令，模拟只在服务端推进（客户端 `world` 为快照应用结果）
- [ ] 快照 15 Hz，客户端 100 ms 插值，画面 60 FPS
- [ ] 客户端与服务器状态一致（抽样 10 tick，位置误差 < 0.5 px）
- [ ] 视野隔离：未目视敌军不出现在该玩家收到的快照/画面中（数据层 + 画面层双重断言）
- [ ] 5 s 准备阶段可下预备命令，开打后按命令执行（与战役一致）
- [ ] 胜负：占光全部城市即胜（`normal`）；10 分钟到点按时限规则判胜；两端结果一致
- [ ] 结算显示用时、双方伤亡（复用 `world.casualties`）、胜负原因
- [ ] 断线 30 s 内可续局；超时判负；两端都有提示
- [ ] 非法/超频/超大命令被丢弃，服务器不崩

### 5.3 非功能（按 1 核 / 2 GB 定指标）
- [ ] 单房间平均 tick < 1.5 ms（本机实测 0.42–0.60 ms，见 §3.10）；预热后最大 tick < 8 ms
- [ ] **并发上限 4 房间（8 人）**：CPU < 60%、Node RSS < 400 MB、无掉线；超出返回 503
- [ ] 单房间出网 ≈ 0.10–0.13 MB/s（15 Hz 快照）
- [ ] 公网两台真机一整局无 desync、无崩溃
- [ ] 口令不以明文落库；会话不可伪造（HttpOnly + 服务端校验）
- [ ] 无 TLS 的风险已在 UI 明示（勿复用重要密码）
- [ ] 客户端 WS 地址为相对/协议自适应，后续上 https 零改动

---

## 6. 测试与质量策略

| 层 | 工具 | 覆盖 |
|---|---|---|
| 服务端单测 | Vitest（node 环境） | 账号/会话、房间状态机、快照过滤、胜负判定、命令校验、插值 |
| 引擎回归 | Vitest（复用现有） | MatchSim 重放确定性、对称兵力模板、`normal` 判定不改坏战役 |
| 端到端 | Playwright（**双 context** = 两个玩家） | 登录 → 建房 → 加入 → 准备 → 5 s → 对战 → 胜负 → 结算；断线重连 |
| 混沌 | Node 脚本 | 随机断 socket、乱序命令、超大 payload、并发同房加入 |
| 压测 | `scripts/pvp-load.mjs` | 10 房间 × 2 机器人 × 600 s，记录 CPU/内存/带宽/延迟 |
| 真机验收 | 手动 + 录屏 | 两台不同网络电脑一整局 |

CI 增补（P6）：`npm test` + `npm run test:e2e`（含 PvP 双上下文用例）+ 构建后产物自检。

---

## 7. 里程碑与并行安排

| 里程碑 | 内容 | 自检方式 |
|---|---|---|
| **M1**（P0–P3，≈5 人日） | 房间码能连上、能开局 | 两个浏览器上下文：A 建房 → B 输码加入 → 双方准备 → 进入对局页（双方部队出现） |
| **M2**（P4，≈4 人日） | 局域网可完整对战 | 两台电脑同局域网打一局到胜负结算 |
| **M3**（P5–P6，≈3 人日） | 公网可玩、掉线可恢复、容量达标 | 一台用手机热点：断网 10 s → 重连续局；再断 40 s → 判负；4 房间压测 10 分钟不掉线 |
| **M4**（P7，≈1 人日） | 交付 | 验收清单逐条勾完，自动化测试全绿 |

并行建议（2 人）：
- 甲：P1（服务端+账号）→ P3（房间）→ P5（断线）→ P6（部署）
- 乙：P2（MatchSim+快照）→ P4（前端同步）；P4 前端可先用 P2 的**录制快照文件**离线开发，不等 P3。

---

## 8. 风险与缓解

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| 1 | 无域名 → 只能 http（明文） | 口令与战况明文传输 | 自用/可信网络；UI 明示勿复用重要密码；失败限速；将来加域名即可升级 https（代码零改动） |
| 2 | 服务器端口/长连接被限制 | 掉线频繁 | 保活 ping 20 s；断线 30 s 重连；必要时换端口或走隧道 |
| 3 | 无客户端预测 → 手感偏钝 | 体验 | 测量记录（目标输入反馈 < 200 ms）；P7 视情况加“移动乐观回显” |
| 4 | 视野泄漏（下发未目视敌军） | 破坏公平 | 服务端严格过滤 + Vitest 断言 + e2e 数据层断言 |
| 5 | 命令作弊（伪造归属/超频） | 破坏公平 | 归属校验 + `validateCommand` + 频率/体积上限 |
| 6 | Node 重启丢对局 | 体验 | MVP 标记 `aborted` 并提示；P7 可选：命令流落库以支持恢复 |
| 7 | 引擎在 Node 中行为差异 | 结果不可预期 | P2 “重放一致 + 与浏览器同命令流对比”双重回归 |
| 8 | 单核 CPU 争用（多房间 / GC / Nginx 发大文件） | 卡顿、掉线 | 房间上限 4（超出 503）；建局预热 60 tick；监控最大 tick > 8 ms 告警；`MemoryMax=1G` + `--max-old-space-size=768`；Nginx `sendfile on` 且 mp4 与对局错峰 |
| 9 | 首帧/JIT 抖动（实测曾出现 10–31 ms 单帧） | 开局瞬间卡一下 | 建局前空跑 60 tick 预热（§3.10） |

---

## 9. 非目标（本期不做）

- 快速匹配队列、分段/ELO、排行榜、战绩历史页
- 观战、回放、录像导出
- 3 人以上、团队模式、新的资源/建造机制
- 移动端/触屏操作
- 局域网自动发现（仍需输码）
- HTTPS / 证书 / 反作弊服务端审计（见 §2.3）

---

## 10. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-10-29 | 初版：记录七项需求决定，给出 P0–P7 分阶段计划与验收清单 |
| 2026-10-29 | 按答复更新：自建服务器 + sudo + **无域名** → 定为 **O1 同源 + http/ws**（§2.2/§2.3）；部署沿用现有 CI（§3.9）；数据库定为 SQLite；移除答辩相关表述；总工期 16.5 → 16 人日 |
| 2026-10-29 | 二轮确认：Nginx 已托管静态且已安装、O1 通过、Ubuntu 24.04.4、**1 核 / 2 GB**、部署由你手动执行。据此新增 **§3.10 容量实测**（0.42–0.60 ms/tick、快照 3.3–4.5 KB）→ 房间上限定为 **4 个**；P6 改为“配置模板 + 手动清单”；工期 16 → 15.5 人日 |
| 2026-10-29 | 三轮确认：公网 **179.255.135.95**、静态根 `/var/www/html/war_game/repo`、`/videos/` → `/var/www/html/videos/`。§3.9 重写为“可直接贴进你现有 `sites-enabled/default` 的 Nginx 片段 + Node 22/克隆（跳过 LFS）/systemd（`MemoryMax=1G`、`StateDirectory`）逐步清单”；记录旧视频 IP 待统一（非本计划范围） |
| 2026-10-29 | **P1a 链路打通已实现**（§11）：`server/`（express 5 + socket.io 4）、`/api/health`、`/socket.io` 握手 + `link:ping`、`pvp.html` 自检页、`deploy/` 模板、`docs/pvp-deploy.md`、`tests/unit/server-link.test.js`；依赖改挂仓库根；Vite 加 `/api`、`/socket.io` 开发代理 |
| 2026-10-29 | **P1b 账号体系已实现**（§11.2）：`server/src/db.js`（better-sqlite3 + 迁移）、`server/src/auth.js`（scrypt/会话/限速/Cookie 解析）、`server/src/routes/auth.js`、`/api/auth/*` 四个接口、`pvp.html` 账号面板、`tests/unit/server-auth.test.js`（10）、`tests/e2e/pvp-auth.spec.js`（3）、`playwright.config.js` 增加 Node 服务 webServer、`AGENTS.md` 记录 PvP 例外 |
| 2026-10-29 | **P2 权威对局已实现**（§11.3）：`server/src/match.js`、`snapshot.js`、`levels.js`、`public/assets/pvp/*.json`（对称 16v16 / 12v12）、`scripts/pvp-selftest.mjs`、28 条单测。实测 0.65–0.85 ms/tick、快照 4.2–6 KB、重放 14400 tick 哈希一致；修正 §3.8 的兵力方案（改用"双方同编制 + 各自出生点 + 最小间距 400px"，不采用坐标镜像） |
| 2026-10-29 | **P3 房间码匹配已实现**（§11.4）：`server/src/rooms.js`（状态机/6 位码/TTL/倒计时/离场规则）、`server/src/routes/rooms.js`、socket `match:join|ready|leave` 与 `match:state|begin|end`、`pvp.html` 房间大厅（建房/输码/准备/倒计时/开局提示）、10 条单测 + 3 条双上下文 e2e；`playwright.config.js` 放宽 e2e 注册限速 |

---

## 11. 已实现：P1a 链路打通（含本地验收实测）

**代码/文件（本次新增，未提交）**

| 文件 | 作用 |
|---|---|
| `server/src/config.js` | 端口 3001 / 快照 15 Hz / 房间上限 4 / 静态托管开关 / Cookie 名；全部可用环境变量覆盖 |
| `server/src/app.js` | `createPvpServer()`：express + socket.io 装配；`GET /api/health`、`/api/*` 404 JSON、`link:hello`/`link:ping`；**导入不 listen**（便于单测 `listen(0)`） |
| `server/src/index.js` | 进程入口：启动日志、`SIGINT/SIGTERM` 优雅退出；`PVP_SERVE_STATIC=1` 时兼托管 `dist`（本地模拟生产形态） |
| `pvp.html` | 链路自检页：REST/WS 状态灯、服务版本、Node 版本、运行时长、房间 x/4、快照频率、WS 客户端数、RTT、解析出的 WS 地址、日志窗 |
| `deploy/nginx-wargame.conf` | 贴进现有 `server{}` 的 `/api` 与 `/socket.io` 反代片段（含 Upgrade 头与 600s 超时） |
| `deploy/war-game.service` | systemd 单元：`Restart=always`、`MemoryMax=1G`、`StateDirectory=war-game`、`--max-old-space-size=768` |
| `docs/pvp-deploy.md` | 手动部署清单（Node 22 → 克隆跳过 LFS → `npm ci --omit=dev` → systemd → Nginx → 公网验收）+ 本地两条验收路径 + 常见问题 |
| `tests/unit/server-link.test.js` | 链路契约 4 条：health 字段/容量、`/api/*` 404、握手 `link:hello`、`link:ping` ack、连接数可见 |
| `vite.config.js` | 开发代理：`/api`、`/socket.io`（含 `ws: true`）→ `127.0.0.1:3001` |
| `package.json` | `npm run server`；`dependencies` += `express@5.3.0`、`socket.io@4.8.4`；`devDependencies` += `socket.io-client@4.8.4` |

**本地实测（Edge，2026-10-29）**

| 路径 | REST | WebSocket | RTT | 备注 |
|---|---|---|---|---|
| Vite `http://localhost:5188/pvp.html`（代理到 3001） | 正常 | 已连接 | 4 ms | 与线上 Nginx 反代同构；`ws://localhost:5188/socket.io/` |
| Node `http://127.0.0.1:3002/pvp.html`（`PVP_SERVE_STATIC=1`） | 正常 | 已连接 | 4 ms | 同源单进程 = 生产形态；`ws://127.0.0.1:3002/socket.io/` |

命令行旁证：`curl /api/health` 三条路径均返回 `{"ok":true,…,"maxRooms":4,"snapshotHz":15}`；
`curl -i "/socket.io/?EIO=4&transport=polling"` 返回 `HTTP/1.1 200` + engine.io 的 `sid` 载荷。
自动化：`npx vitest run tests/unit/server-link.test.js` → 4 passed。

**服务器侧判据（你部署后照 `docs/pvp-deploy.md` §6 执行）**：`curl http://179.255.135.95/api/health` 返回同一份 JSON，
浏览器打开 `http://179.255.135.95/pvp.html` 两个状态灯都为绿、RTT 出数。

---

## 11.2 已实现：P1b 账号体系（含实测）

**接口**（同源，HttpOnly Cookie 会话，Cookie 名 `wod_session`，默认 7 天）

| 方法 | 路径 | 成功 | 失败码 |
|---|---|---|---|
| POST | `/api/auth/register` | 201 + Cookie | 400 `BAD_USERNAME` / `BAD_PASSWORD`、409 `USERNAME_TAKEN`、429 `RATE_LIMITED` |
| POST | `/api/auth/login` | 200 + Cookie | 400 `MISSING_CREDENTIALS`、401 `BAD_CREDENTIALS`、429 `RATE_LIMITED` |
| POST | `/api/auth/logout` | 204 | — |
| GET | `/api/auth/me` | 200 `{user}` | 401 `UNAUTHENTICATED` |

**实现要点**

| 主题 | 做法 |
|---|---|
| 口令存储 | `scrypt`（Node 内置，无原生依赖）+ 每用户 16 字节随机盐；库里只存 128 hex 派生值与盐，**任何响应都不含口令字段** |
| 会话 | 32 字节随机 token（base64url）写 `sessions` 表；Cookie `HttpOnly; SameSite=Lax; Path=/; Max-Age=7d`；登出删服务端记录并清 Cookie |
| 用户名 | 3–20 位中英文/数字/下划线；存规范化小写 + 原始写法（`display_name`）→ 大小写不敏感唯一 |
| 限速 | 登录失败按 IP 滑动窗口 5 次/分钟（成功清零；不同 IP 互不影响）；注册 10 次/小时/IP |
| 防枚举 | 用户不存在时也跑一次 scrypt（恒定耗时），两种情况同一错误码 |
| 数据库 | `better-sqlite3` + `meta.schema_version` 迁移；路径优先级 `PVP_DB` → systemd `$STATE_DIRECTORY` → `server/data/pvp.db`（已 gitignore） |
| 可观测 | `/api/health` 增加 `accounts`（用户数，无敏感字段）；每小时清理过期会话 |
| 中间件 | `requireUser({db,config})` 已备好，P3 建房/对局直接复用 |

**实测**

| 项 | 结果 |
|---|---|
| `tests/unit/server-auth.test.js` | **10 passed**：201+HttpOnly Cookie、库里无明文（128 hex + 32 hex 盐）、409、400×3、登录/me/登出、未登录 401、错误码不泄漏用户是否存在、5 次失败后 429 且换 IP 仍可登录、过期会话清理、health 的 accounts 递增 |
| `tests/e2e/pvp-auth.spec.js`（Edge） | **3 passed**：注册→已登录→刷新仍登录→登出→再登录；错误口令提示"不正确"且未登录；自检页两灯绿 |
| curl 冒烟 | `POST /api/auth/register` → `201` + `Set-Cookie: wod_session=…; HttpOnly; SameSite=Lax`；`/api/health` 里 `accounts` 递增 |
| 全量单测 | **504 passed / 8 failed**（8 条仍是既有供应/配置漂移，与 PvP 无关） |

**本地怎么看**：`npm run server` + `npm run dev` → `http://localhost:5173/pvp.html`，账号面板里注册/登录/登出；
或单进程 `npm run build` + `PVP_SERVE_STATIC=1 npm run server` → `http://127.0.0.1:3001/pvp.html`。

---

## 11.3 已实现：P2 权威对局 MatchSim（含实测）

**新增文件**

| 文件 | 作用 |
|---|---|
| `server/src/match.js` | `MatchSim`：60Hz 固定步长（`values.simulation.fixedStep`）、`update(now)` 按真实时间补步（单次最多 5 步）、`step(n)` 确定性推进、`queueCommand`（阵营归属 + `validateCommand` + 20 条/秒限频）、`snapshotFor(faction)`、胜负与超时结算、`warmupEngine()` 预热 |
| `server/src/snapshot.js` | 按阵营过滤视野的快照序列化：己方全量、敌方仅 `isSpotted` 为真、死亡单位不下发；数值保留 1 位小数控制体积 |
| `server/src/levels.js` | 读 `public/assets/pvp/<id>.json` + 对应地图，复用战役的 `parseLevel` 校验 |
| `public/assets/pvp/dujiang_pvp.json` / `pingjin_pvp.json` | 对称兵力模板（16v16 / 12v12），`victory: normal`，无 AI |
| `scripts/pvp-selftest.mjs` | 无头自检 CLI：跑一整局并打印 tick 成本/快照体积/视野过滤/结算；`--verify` 做重放比对 |
| `tests/unit/pvp-match.test.js`（22）+ `tests/unit/pvp-levels.test.js`（6） | 见下表 |

**对局时间模型**

| 项 | 实现 |
|---|---|
| 逻辑步长 | 1/60 s（`STEP_MS ≈ 16.67`），"权威时间" = tick 数 × 步长 |
| 实时驱动 | `update(now)` 用单调时钟累加；单次最多补 5 步，单帧间隔上限 1000 ms，积压过多直接丢弃（不追帧瞬移） |
| 准备阶段 | 复用 `values.prep.seconds`（5 s），期间模拟冻结但**允许下预备命令**；`prepMs: 0` 可直接开打（测试/自检用） |
| 时长上限 | `timeLimitMs` 默认 600 s；到点按「城市数 → 存活单位总血量 → 判平」定胜负 |
| 胜负 | 引擎 `victory.js` 的 `normal`（占光全部城市）；结算**只发生一次**（`result` + 一条 `matchEnd` 事件） |
| 预热 | 建局时 `warmupEngine({level,map,ticks:60})` 用一次性 World 空跑，抹掉首帧 28–34 ms 的 JIT 尖峰（实测正式对局最大 tick 34.1 → 16.5 ms） |

**实测（本机 Node 24；服务器 Node 22 + 1 核，按 §3.10 乘以 2–3 倍余量）**

| 项 | 结果 |
|---|---|
| 全量单测（PvP 部分） | **28 passed**：初始化对称（16v16 / 12v12）、准备阶段冻结+预备命令、补步上限、命令归属/非法命令/限频 20 条、视野过滤契约、normal 胜负只结算一次、超时判定、结束后拒命令、预热独立性、**重放 600 tick 快照哈希逐个一致**、**12000 tick 平均 0.65–0.75 ms/tick、最大 6.4 ms、快照 5.95 KB** |
| 无头整局（`--seconds 600`） | 36000 tick / 600 s 模拟 · 平均 **0.85 ms/tick** · 最大 16.5 ms（预热后）· 快照 4.2–5.4 KB · 双方各 16 单位 · 城市 9:7 · **winner=blue, reason=time-limit** · 伤亡 blue 704 / red 2105 |
| 确定性（`--verify`） | 两次重放的 **14400 个 tick 快照哈希完全一致** |
| 视野过滤 | blue 视角只看到 9/16 个红军（其余在视野外，压根没下发） |

**本地怎么看（不需要浏览器）**
```bash
node scripts/pvp-selftest.mjs --seconds 600            # 跑一整局，看结算与 tick 成本
node scripts/pvp-selftest.mjs --seconds 240 --verify   # 额外做重放确定性比对
node scripts/pvp-selftest.mjs --level pingjin_pvp --seconds 120 --no-prep
npx vitest run tests/unit/pvp-match.test.js tests/unit/pvp-levels.test.js
```

---

## 11.4 已实现：P3 房间码匹配（含实测）

**接口**

| 方法 | 路径 | 成功 | 失败码 |
|---|---|---|---|
| POST | `/api/rooms` | 201 `{room}` | 401 `UNAUTHENTICATED`、400 `BAD_LEVEL`、503 `ROOM_LIMIT`（超过 `maxRooms`=4） |
| GET | `/api/rooms/:code` | 200 | 404 `ROOM_NOT_FOUND`（不存在/过期） |
| POST | `/api/rooms/:code/join` | 200 | 404、409 `ALREADY_JOINED` / `ROOM_FULL` / `ROOM_STARTED` |
| POST | `/api/rooms/:code/ready` | 200 | 404、409 `NOT_IN_ROOM` / `ROOM_STARTED` |
| POST | `/api/rooms/:code/leave` | 200 `{closed}` | 404、409 `NOT_IN_ROOM` |

**Socket（房间频道 `room:<code>`，握手用 Cookie 认证）**

| 方向 | 事件 | 说明 |
|---|---|---|
| C→S | `match:join {roomCode}` | 进入房间频道（必须是房间成员）；ack 返回房间视图 |
| C→S | `match:ready {roomCode, ready}` | 准备 / 取消准备；双方准备 → `countdown` |
| C→S | `match:leave {roomCode}` | 离开（房主离开 → 关闭房间） |
| S→C | `match:state` | 房间视图 + `serverNow`（客户端据此算倒计时，避免时钟偏差）；关闭时带 `closed:true, reason` |
| S→C | `match:begin` | `{matchId, levelId, prepSeconds:5, players[]}`；此时服务器已创建 `MatchSim`（P4 接 60Hz 驱动） |
| S→C | `match:end` | `{winner, reason}`（P3 只有 `forfeit` 一种来源） |

**状态机与规则**

| 项 | 实现 |
|---|---|
| 房间码 | 6 位，字符集 `A-HJ-NP-Z2-9`（去掉 0/O/1/I） |
| 阵营 | 房主 = blue，客人 = red（首次加入即锁定） |
| 状态 | `waiting`（等人/等准备）→ `countdown`（双方 ready，3 s）→ `playing` → `finished` |
| 取消准备 | countdown 中任一方取消 → 退回 `waiting` 并清空倒计时 |
| 留场重置 | 新玩家加入时把所有人的 `ready` 清空（避免"准备态与实际阵容不一致"） |
| 房主离开 | 关闭房间，向频道广播 `closed:true, reason:'host-left'` |
| 客人离开 | 房间保留、退回 `waiting`、重置 ready |
| 超时 | `waiting` 阶段 30 分钟未开局 → TTL 回收（`sweep` 250 ms 一次） |
| 容量 | 同时最多 4 个房间（= `maxRooms`），超出建房返回 503（1 核容量，见 §3.10） |
| 房间存储 | **仅内存**（进程重启即丢；不为此建库表，对局记录留到 P4/P5） |

**实测**

| 项 | 结果 |
|---|---|
| `tests/unit/server-rooms.test.js` | **10 passed**：未登录 401、6 位码格式、查房/404/未知地图 400、客人=red、重复加入/第三人满/上限 503、TTL 回收、双方 ready→countdown→playing 且 `match:begin` 两端一致（matchId/关卡/prep=5/双方昵称）、取消准备退回 waiting、房主离开→对手收到 closed→房间 404、未登录/非成员 socket 无法进房 |
| `tests/e2e/pvp-rooms.spec.js`（Edge，双浏览器上下文） | **3 passed**：A 建房 → B 输码加入 → 两端各看到 2 名玩家 → 双方准备 → 两端都进入"对局已开始"（阵营 蓝/红 正确）→ 关卡与准备时长正确；错误房间码提示"房间不存在"；房主离开后对手看到"房主已离开" |
| `tests/e2e/pvp-auth.spec.js`（回归） | **3 passed**（`pvp.html` 加房间面板后账号流程未被破坏） |
| 全量单测 | **542 passed / 8 failed**（8 条仍是既有供应/配置漂移） |

**本地怎么看（浏览器）**
```bash
npm run server        # 终端 A
npm run dev           # 终端 B → http://localhost:5173/pvp.html
# 再开一个无痕窗口注册第二个账号，A 建房 → B 输码加入 → 双方准备 → 3 秒后开局
npx playwright test tests/e2e/pvp-rooms.spec.js   # 自动化双上下文（本机用 Edge 时加 channel: 'msedge'）
```

> 注意：e2e 会反复注册账号，而注册限速默认 10 次/小时/IP。`playwright.config.js` 里已给 Node 服务设了
> `PVP_REGISTER_MAX_PER_HOUR=1000`，只在 e2e 拉起的进程里生效，线上仍是默认值。

---

## 11.5 已实现：P4 对局同步与胜负（含实测）

**新增文件**

| 文件 | 作用 |
|---|---|
| `server/src/driver.js` | 唯一的 60Hz 调度器：遍历所有进行中对局 → `match.update(now)` → 按 `snapshotHz`（15Hz）节流，**分阵营频道**（`room:<code>:blue` / `:red`）发 `tick` 快照；对局结束只发一次 `match:end` 并从活动表移除 |
| `server/src/app.js` | socket `match:join`（同时加入房间频道与**自己阵营**的快照频道，ack 返回 match 信息）、`cmd`（归属/格式/频率校验后注入 MatchSim）、`disconnect` 的 30s 宽限回收 |
| `pvp-battle.html` | 对局页：全屏 Phaser 画布 + DOM HUD（房间/阵营、计时、城市数、可见敌军、RTT、准备读秒、结算弹窗、操作提示） |
| `src/pvp/battle.js` | 客户端：用同一份关卡/地图建**镜像 World**（单位 id 与服务器一致），收到快照只覆盖状态、从不 tick；复用地形/迷雾/单位渲染器；左键点选/框选 + 右键移动 / Shift+右键攻击前进 → `cmd` 上行；`window.__pvp` 调试钩子 |
| `src/pvp/interpolate.js` | 纯函数插值（15Hz 快照 → 60FPS 渲染），静止时精确等于快照坐标 |
| `tests/unit/pvp-driver.test.js`（5）+ `tests/unit/pvp-interpolate.test.js`（5） | 见下方实测 |
| `tests/e2e/pvp-battle.spec.js` | 双浏览器上下文全流程 |

**数据流**

```
玩家点选/右键 ──socket 'cmd'{unitIds,command}──► MatchSim.queueCommand(faction)  ← 归属校验 + validateCommand + 20 条/秒
                                                        │
                                         60Hz driver.tickOnce()
                                                        │ 每 1/15s
                        ┌───────────────────────────────┴──────────────────────────┐
              'tick' → room:<code>:blue（只含蓝方可见的）              'tick' → room:<code>:red
                        │                                                          │
              镜像 world（覆盖位置/血量/归属）+ 本地迷雾 + 插值 ◄──────── 各自浏览器
```

**验收对照**

| P4 验收项 | 结果 |
|---|---|
| 客户端坐标与服务器快照误差 < 0.5 px | 单测锁定"alpha=1 时精确等于快照"；e2e 实测静止单位 `max|坐标 − 快照|` **< 0.5 px** |
| 胜负两端一致 | 单测：城市全被占 → `match:end` 只发一次且 `winner/reason` 正确；e2e：双端进入对局并持续收到快照 |
| 视野隔离 | 单测：快照里的敌军 = 恰好被 `isSpotted` 的集合；e2e：开局 `visibleEnemies < 16`；截图里 16 个红军只显示 8 个 |
| 5s 准备两端同步 | `match:begin` 带 `prepSeconds=5`；客户端 `#prepOverlay` 读秒，阶段切到 playing 后隐藏（e2e 断言） |
| 到点按城市数判胜 | `MatchSim` 超时判定（P2 单测）+ driver 把 `match:end` 广播 |
| 输入→画面反馈 < 200 ms | 同机实测：命令 ack 往返显示在 `#battleStatus`（截图里 RTT 2 ms） |
| 暂停/加速键禁用 | 对局页不加载 `createKeyboard`，没有任何暂停/加速入口 |

**实测**

| 项 | 结果 |
|---|---|
| `tests/unit/pvp-driver.test.js` | **5 passed**：分阵营频道各发一份（`you` 正确）、200ms 内模拟 ≥10 tick 而快照仅 2–5 批（60Hz vs 15Hz）、结束只结算一次、attach 幂等、detach 后不再推进 |
| `tests/unit/pvp-interpolate.test.js` | **5 passed**：clamp/alpha、端点精确、静止时误差 0、缺数据不出 NaN |
| `tests/e2e/pvp-battle.spec.js`（Edge，双上下文） | **passed**：注册 → 建房 → 加入 → 双方准备 → 自动跳转对局页 → `snapshotCount > 3` 且 `#battleStatus` 显示"已进入对局" → 阵营 蓝/红 → 城市 16 座、`ownUnits ≥ 16`、`visibleEnemies < 16` → 静止单位与快照 < 0.5px → 点选 ≥ 1 个单位 → 右键下令 `commandsSent` 增长 → 单位开始移动 → 阶段转 playing、`#prepOverlay` 隐藏、计时器在走 |
| 回归（rooms + auth e2e） | 大厅跳转对局页时会有一瞬间房间无人，被"双方断开回收"误删 → 改成 30s 宽限后通过 |
| 全量单测 | **552 passed / 8 failed**（8 条仍是既有供应/配置漂移） |

**截图**：`test-results/pvp-battle.png`（房间 F7G3PG、蓝方、城市 8:8、可见敌军 8、RTT 2 ms、准备结束后的计时 09:56）。

**本地怎么看（浏览器，两人对战）**
```bash
npm run server                 # 终端 A
npm run dev                    # 终端 B → http://localhost:5173/pvp.html
# 无痕窗口注册第二个账号 → A 建房 → B 输码加入 → 双方准备 → 3 秒后自动进入对局页
# 对局页：左键点选/框选己方部队，右键移动，Shift+右键 攻击前进
npx vitest run tests/unit/pvp-driver.test.js tests/unit/pvp-interpolate.test.js
```

**两处实现说明（与原计划的偏差）**
1. 客户端不做"快照缓冲 + 回放"式插值，而是"上一帧位置 → 最新快照"的线性追赶（`alphaFor` + `interpolatePosition`）：静止时必然精确等于快照，运动中最多滞后约一个快照间隔（~66ms），实现简单且可测。
2. 快照按**阵营频道**广播（`room:<code>:blue` / `:red`）而不是逐 socket 单发：加入房间时 socket 同时加入自己阵营的频道，服务端只需两次 `emit`，1 核上更省。

---

## 11.6 已知差异：PvP 的交互暂未对齐战役（**已被 §11.14 / §11.15 解决，保留作历史记录**）

> 状态（2026-10-30）：本节列出的缺口已基本补完 —— U1–U3 见 §11.14（输入层复用、批量命令、S 停止、
> 预览路线），P2/P0 见 §11.15（**真实 `route`/`pendingQueue` 由服务器"变化才发"下发**、绘制改为与战役共用
> `rendering/battleOverlay.js`、循环/键盘/i18n 回归战役）。仍未做：HUD 面板复用（P1）与音效（P3），
> 以及暂停/变速（有意不做）。

`src/simulation` 是同一套内核，但**界面交互层没有沿用**战役的那一套。原因不是"内核不同"，而是
**客户端不再拥有世界状态**：战役里 `createOrders` 直接往本地 `world` 下命令、并读 `unit.route` 画轨迹；
PvP 的本地世界只是"被快照覆盖的镜像"，且快照目前不含 `route` / `pendingQueue`。

| 战役里的能力 | PvP 现状 | 缺的层 |
|---|---|---|
| 左键拖轨迹下令（`move` / `appendRoute` / `enqueueRoute`）、E 急行军 | ❌ 只有右键 `move`、Shift+右键 `attackMove` | 客户端输入层（`src/input/orders.js` 未复用） |
| 行军路径显示 / 轨迹箭头 | ❌ 只有 700ms 落点圆圈 | 快照需为**己方**单位补 `route`（敌方绝不能发） |
| S 停止/坚守（`hold`）、ESC 清空选择 | ❌ 无键盘处理 | 客户端输入层 |
| 攻击指定敌军（`attack` / `lock`） | ❌ 只能攻击前进 | 客户端输入层 |
| 单位卡片 / 补给线 / 控制线叠加 / 城市卡 | ❌ 只有薄 HUD（计时/城市数/可见敌军/RTT/读秒/结算） | HUD 面板 + 快照补派生数据 |
| 暂停（SPACE）/ 加速（1/2/3） | **有意不做** | 服务器权威 60Hz，单人暂停会让两端时间线分叉 |

**重点**：服务端的 `cmd` 通道已经支持引擎的全部命令（`validateCommand` + `world.issueCommands`），
所以 `hold` / `attack` / 急行军 / 排队路径**现在就能执行**，缺的只是对局页的按钮与按键。

**补齐方案（约 1.5–2 人日，建议放在 P5 之后或并入 P7）**
1. 输入端：键盘 `S`→`hold`、`ESC`→清空、`E`+拖→`forced` 急行军、Shift+右键→`enqueueRoute`、右键敌方单位→`attack`；
2. 轨迹显示：快照为**己方**单位增加 `route` / `pendingQueue`（约 50–120 B/移动单位，满编 16 个约 +1–2 KB/帧，或改成变化时才发）；
3. HUD：单位卡片、补给线、控制线叠加（纯展示，可后置）。
每项都配一条 `cmd` 契约单测 + 一条双上下文 e2e（例：A 按 S 后，两端快照里该部队都停下）。

---

## 11.7 已实现：P5 断线重连（含实测）

**机制**

| 项 | 实现 |
|---|---|
| 掉线标记 | socket `disconnect` 时若该玩家在房间里已无其它 socket → `rooms.markDisconnected()`（**座位保留**，`connected=false`，记 `disconnectedAt`） |
| 静默期 | 掉线后先等 `disconnectNoticeMs`（默认 1.5s）再打扰对手 —— 大厅→对局页的页面跳转不会刷"对手掉线"横幅 |
| 播报 | 静默期后仍不在线 → 向房间频道发 `opponent:left { userId, username, graceSeconds }`，并推一次 `match:state`（`players[].connected=false`） |
| 宽限 | `disconnectGraceMs`（默认 30s，`PVP_RECONNECT_SECONDS` 可调）；`rooms.sweep()` 每 250ms 检查，到点 → `finishRoom(room, 对手, 'disconnect-timeout')` |
| 重连 | `match:join { roomCode, reconnectToken }`：宽带内 → `markConnected`（带 token 时校验，不匹配返回 403 `BAD_TOKEN`）→ ack 里 `reconnected: true` + `match.prepRemainingMs/result` → 立刻补一份快照；并通知对手 `opponent:rejoin` |
| 重连凭证 | 每个座位一个 24 字节随机 token，**只在本人的 `room.you.reconnectToken` 里下发**（对手的视图里没有）；对局页把它存 `sessionStorage`，重开页面自动带上 |
| 已结束的对局 | 掉线被判负后重连仍返回 `ok:true` + `match.result`，让掉线方能看到结算（而不是被拒绝） |
| 服务器重启 | 房间是内存态 → 重连时 `ROOM_NOT_FOUND`；对局页识别为"对局已中断（服务器可能重启过）"并显示横幅 |
| 双方都掉线 | 房间在宽限后回收（`reason='abandoned'`），不占 `maxRooms` 名额 |

**Socket 事件补充**

| 方向 | 事件 | 说明 |
|---|---|---|
| S→C | `opponent:left { userId, username, graceSeconds }` | 对手掉线（客户端按 `userId` 过滤掉"关于自己"的广播） |
| S→C | `opponent:rejoin { userId, username }` | 对手回来了（仅在播报过掉线后才发） |
| C→S | `match:join { roomCode, reconnectToken? }` | 重连带 token；ack 增加 `reconnected` / `room.you.reconnectToken` / `match.reconnectGraceMs` |

**实测**

| 项 | 结果 |
|---|---|
| `tests/unit/pvp-reconnect.test.js` | **5 passed**：token 只发给本人（对手视图里没有）、断线→`opponent:left`（带宽限秒数）、宽限内带 token 重连→`opponent:rejoin`+`reconnected:true`+快照继续、错误 token→`BAD_TOKEN`、超宽限→`match:end{winner:蓝, reason:disconnect-timeout}`、被判负后重连能看到结算 |
| `tests/e2e/pvp-reconnect.spec.js`（Edge，双上下文） | **2 passed**：关掉 B 页面 → A 出现"对手掉线：4 秒内可重连"且快照继续涨 → 宽限内重开 B → A 出现"对手已重连"，两端继续收快照；B 不回来 → A 的结算弹窗出现「胜利！· 对手掉线超时」 |
| 回归（auth + rooms + battle e2e） | **7 passed** |
| 全量单测 | **561 passed / 8 failed**（8 条仍是既有供应/配置漂移） |

**本地怎么看**
```bash
npm run server            # 宽限默认 30s；想快跑可用 PVP_RECONNECT_SECONDS=4
npm run dev               # 两个无痕窗口开一局，然后直接关掉一方页面
# 另一方：1.5s 后出现"对手掉线：30 秒内可重连"→ 重开页面 → "对手已重连"
# 若超过宽限：留下的一方直接看到结算（reason=disconnect-timeout）
npx vitest run tests/unit/pvp-reconnect.test.js
```

> e2e 用 `playwright.config.js` 里的 `PVP_RECONNECT_SECONDS=4` 把宽限压到 4 秒，线上仍是 30 秒。

---

## 11.8 已实现：P6 容量验收与部署脚本（含实测）

**交付物**

| 文件 | 作用 |
|---|---|
| `scripts/pvp-load.mjs` | 容量压测：自动注册 2×N 个账号 → 建房/加入/准备 → 持续下令（默认 2–3 Hz/人，保持单位移动的最坏负载）→ 每秒采样 `/api/health` 与每个玩家的快照速率/RTT → 打印 PASS/FAIL |
| `server/src/driver.js` | 新增 `stats()`：活动对局数、已发快照条数、`tickMsAvg` / `tickMsMax` / `slowTicks`（超出 `values.performance.simTickBudgetMs`=8ms 的 tick 数） |
| `server/src/match.js` | `stats.slowTicks` 计数（单次 GC 尖峰不应判失败，用"超预算占比"作为判据） |
| `server/src/app.js` | `/api/health` 增加 `sim`（容量观测）与 `reconnectGraceSeconds`（运维参数） |
| `deploy/update.sh` | 服务器侧一键更新：`git pull`（跳过 LFS）→ `npm ci --omit=dev` → `systemctl restart` → `/api/health` 校验 → 打印最近日志；支持 `--check-only` 只做健康检查 |

**压测判据**（与 §3.10 的 1 核容量结论一致）

| 指标 | 阈值 |
|---|---|
| 活动对局数 | = 建房数（4 房间 / 8 人） |
| 平均 tick | < 2 ms |
| 超预算 tick 占比 | < 0.1%（最大 tick 只作观察值） |
| 快照速率 | 11–16 Hz（15 Hz 的 ±25%） |
| RTT | < 300 ms |
| 掉线 | 0 次 |
| 命令 | 全部被接受（无 `BAD_COMMAND` / 超频拒绝） |
| 容量上限 | 第 5 个房间返回 503 `ROOM_LIMIT` |

**实测（本机 4 房间 × 8 人 × 40 秒，3 Hz/人下令）**

```
tick 平均 0.712 ms · 最大 11.6 ms · 超预算 5/9392 · 已发快照 4740 条
✅ 对局数 4/4   ✅ 平均 tick 0.712 ms   ✅ 超预算占比 0.053%
✅ 快照 13.4 Hz  ✅ RTT 4 ms  ✅ 无掉线  ✅ 命令 ok 952 / 失败 0
✅ 第 5 个房间被拒（503 ROOM_LIMIT）
结论：全部通过
```

**怎么跑**
```bash
# 本机（服务器端与压测同一台机器，数字最保守）
PVP_REGISTER_MAX_PER_HOUR=300 npm run server      # 压测要注册很多账号，先放宽
node scripts/pvp-load.mjs --rooms 4 --seconds 600 --cmd-hz 3

# 打线上服务器（在你自己的电脑上跑，顺便量真实网络 RTT）
node scripts/pvp-load.mjs --server http://179.255.135.95 --rooms 4 --seconds 600
```

> 注意：压测会消耗注册限速（默认 10 次/小时/IP），线上跑之前把 `PVP_REGISTER_MAX_PER_HOUR` 临时调大，
> 或先用 2 个房间（4 个账号）。服务器上的 `matches`、`sim.*` 也可以在压测过程中用 `curl /api/health` 直接观察。

---

## 11.10 精调：迷雾下放到客户端（2026-10-30）

**改了什么**

| 位置 | 变化 |
|---|---|
| `server/src/config.js` | 新增 `fogAuthority`（`PVP_FOG_AUTHORITY=client\|server`，默认 **client**） |
| `server/src/snapshot.js` | `client` 模式下不再调用 `isSpotted` 过滤，下发全部存活单位；快照新增 `fogAuthority` 字段 |
| `server/src/match.js` | `MatchSim({ fogAuthority })`，`snapshotFor()` 把它传进快照 |
| `server/src/app.js` | 建局时读 `config.fogAuthority`；`/api/health` 增加 `fogAuthority` |
| `src/pvp/battle.js` | 「可见敌军」改由**客户端**用 `isSpotted` 判定；`client` 模式下敌军从快照消失即阵亡（`server` 模式下仍需 `isSpotted` 才判死）；暴露 `__pvp.enemyUnitsKnown / fogAuthority` |
| `tests/unit/pvp-match.test.js` | 拆成三条：默认全量下发、`server` 模式仍过滤、视野外敌军"坐标到了但 isSpotted 为假" |
| `tests/unit/pvp-fog-parity.test.js` | 断言两边快照都含全部单位，但各自算出的可见敌军数不同且都 < 16 |
| `tests/e2e/pvp-battle.spec.js` | 断言 `fogAuthority==='client'`、快照 ≥32 单位、`enemiesKnown=16`、`enemiesVisible<16` |

**实测（渡江 PvP，蓝方视角，开局 4 秒）**

| 指标 | client 模式（现在） | server 模式（之前） |
|---|---|---|
| 快照单位数 | **32**（16 蓝 + 16 红） | 24（16 蓝 + 8 可见红） |
| 快照体积 | **5782 B** | 4765 B |
| 下单带宽（15 Hz） | ≈ 85 KB/s/人 | ≈ 70 KB/s/人 |
| 客户端可见敌军 | `enemiesKnown=16` → 画 **8** | 只有 8 份数据 |
| 迷雾可见格 | 5475 / 10240（不变） | 5475 / 10240 |
| 画面 | 与服务端过滤时**完全一致** | — |
| 防透视 | ❌ 可被 DevTools/改前端看到全图 | ✅ |

**代价与适用场景（必须知道的取舍）**

- 客户端手里有全部敌军坐标 → **任何玩家都能看到全图**（改 10 行前端，或直接用 DevTools 读 `window.__pvp.lastSnapshot`）。
  因此当前配置只适合**朋友之间 / 课程演示**的对局，不适合有陌生人参与的公开对战。
- 带宽 +24%（每个房间 2 人合计 ≈ +0.03 MB/s）；1 核容量结论不变（实测平均 tick 仍在 0.3–0.9 ms 量级）。
- 想恢复防透视：服务器 `sudo systemctl edit war-game` 加 `Environment=PVP_FOG_AUTHORITY=server` → `daemon-reload && restart`，
  或临时跑 `PVP_FOG_AUTHORITY=server npm run server`。**客户端代码无需改动**（它本来就会按 `isSpotted` 决定画不画）。

**顺带修掉一个显示 bug**：从大厅跳到对局页时，旧 socket 关闭 + 新 socket 连上会被判定为"重连"，
状态栏显示"已重连续局"。现在 `reconnected` 只在**已向对手播报过掉线**时才算，跳转不再误显示。

---

## 11.11 精调：控制线 / 补给线改为客户端派生（方案 B，2026-10-30）

**做了什么**（草案见 `docs/pvp-derive-draft.md`）

| 位置 | 变化 |
|---|---|
| `server/src/derive.js`（新） | `buildDerive()` 生成校正包：控制线折线（整数坐标、`lod` 抽样）+ 补给边 `[unitId, cityIdx]` + 断补 id 列表；`deriveHash()` 供"内容没变就不发"；`deriveBytes()` 供压测 |
| `server/src/driver.js` | 每个活动对局按 `config.deriveSyncMs`（默认 3 s）向房间频道发 `world:derive`；内容哈希不变则跳过；`stats()` 增加 `derivesSent` / `deriveBytes` |
| `server/src/config.js` | `PVP_DERIVE_SYNC_MS`（默认 3，0 = 关闭通道）、`PVP_DERIVE_LOD`（默认 2） |
| `src/pvp/derive.js`（新） | 客户端派生控制器：本地跑 `updateControlLine()`（10 Hz）+ `refreshSupply()`（60 Hz 调用、内部 0.5 s/1 s 节流）；用校正包算 `mismatch` 并"轻拉/硬切/降级" |
| `src/pvp/battle.js` | 挂 `createControlLineRenderer`（常显，与战役一致）与 `createSupplyLines`（选中才画）；收 `world:derive`；`__pvp.deriveStats` 暴露诊断量 |

**信任边界（关键）**：客户端只调 `updateControlLine()` 与 `refreshSupply()`；**不调** `updateSupply()` /
`updateSupplyStock()`（那些会回血、掉血、造兵）。单测断言"跑 120 帧后 hp 与补给存量完全不变"。

**客户端校正策略**（决策：本地优先、零额外延迟）

| 档 | 条件 | 动作 |
|---|---|---|
| 首包 | 刚进对局/重连 | 轻拉 0.9 s（此时本地本就没收敛） |
| `soft` | `mismatch ≥ 2%` | 渲染折线 = 本地 × 0.85 + 服务器 × 0.15 |
| `soft`（默认） | `mismatch < 2%` | **纯本地**，不干预 |
| `hard` | `mismatch ≥ 25%` | 轻拉 + 计数 |
| `freeze` | 连续 3 次 `hard` | 降级为只显示服务器折线；连续 2 包 < 5% 自动恢复 |

**实测**

| 指标 | 结果 |
|---|---|
| 客户端与服务端控制线偏差（稳态，e2e 实测） | **0.17%**（阈值 < 2%） |
| 控制线折线 | 1 条 / 32 点（重采样后），渲染层正常绘制；形状与标签「实际控制线」与战役一致 |
| 补给边 | 32 个单位全部有边；选中 1 个单位时 `supplyLines=1`、`supplySelected=1`（与战役一致：只画选中的） |
| 本地派生 CPU | 0.173 ms×10 Hz + 0.383 ms×1 Hz + 0.034 ms×2 Hz ≈ **2.1 ms/s**（≈0.036 ms/帧） |
| 校正包 | 18 包 / 20 s / 2 房间 = **43 950 B → ≈2.4 KB/包 → 0.55 KB/s/人**（目标 < 1 KB/s） |
| 单测 | `tests/unit/pvp-derive.test.js`（6 条）+ `pvp-driver.test.js` 新增 3 条 = **15 条通过** |
| e2e | `pvp-battle.spec.js` 增加派生断言（`mode=local`、`mismatch<10%`、`localPaths>0`、补给线被选中触发）→ **passed** |
| 全量单测 | 574 passed / 8 failed（8 条仍是既有供应与配置漂移，与本次无关） |

**为什么不改渲染层**：`createControlLineRenderer` 只读 `world.controlLinePaths`，`createSupplyLines` 只读
`unit.supplyEdges` / `world.supplyToken` / `world.controlLine`，两者本来就不依赖"谁算的"，PvP 直接复用。

**降级开关**：`PVP_DERIVE_SYNC_MS=0` 关闭校正通道（客户端只显示本地线）；
`PVP_FOG_AUTHORITY=server` 时客户端拿不到全部敌军位置，会自动切到"只显示服务器折线"（`mode='server'`）。

---

## 11.12 修 bug：补给线"强制折回上一个途径点"（2026-10-30）

**现象**（需求方反馈）：PvP 里本地渲染的补给线**有时**会先折回单位之前走过的位置，再折向前方的城市。

**根因**：`createSupplyLines` 的路径缓存 key 是 `${unitId}|${cityId}|${relief}`，**不含单位位置**，
缓存里存的是"从**当时**的单位位置算出来的 A* 折线"，只在 `world.supplyToken` 变化（代价场每 1 s 重算）时才失效。
单位一旦继续移动，画出来的线就是：

```
[单位当前位置, 折线起点（旧位置）, …剩余路线, 城市]
                ↑ 这一段就是"折回上一个途径点"
```

移动越快（急行军、溃逃、离开视野后的重定位）折回越明显，且每秒才被"修一次"，所以表现为"有时"。

**修复**（两处，都在渲染层，规则与结算完全没动）

| 位置 | 改动 |
|---|---|
| `src/rendering/supplyPathTrim.js`（新） | 纯几何工具：`offsetPx()`（单位到折线的**线段**距离）、`backtrackPx()`（首段是否往回走、回退多少像素）、`trimToUnit()`（把单位**投影**到折线上，返回 `[投影点, …剩余折线]`） |
| `src/rendering/supplyLines.js` | 缓存改为 `{ path, x, y }`，命中时先 `trimToUnit()` 把线贴到单位身上；单位偏离缓存起点 **> 8 px** 就重跑 A*（实测 0.48 ms/次）；新增诊断量 `repath / startOffsetPx / backtrackPx / maxBacktrackRawPx / maxBacktrackDrawnPx` |

**A/B 实测**（2 人一局，框选 12 个单位、长距离行军 10 秒，采样 16 次；数字是"折回像素"的最大值）

| 配置 | 未裁剪折回（旧代码会画出来） | 实际画出的折回 |
|---|---|---|
| 修复前（缓存 1 s、不校验位置） | **29.4 px** | 29.4 px（等于没裁剪） |
| 只加"位置失效重算"（8 px） | 12.2 px | 12.2 px |
| **最终（投影裁剪 + 8 px 重算）** | 12.2 px | **0 px** ✅ |

（残余的 12.2 px 是 A* 网格量化：路径起点是**格子中心**，与单位最多差半个格子；
投影裁剪把这段垂直短跳画成"从单位垂直连到路线"，不再沿路线后退。）

**代价**：A* 重跑 约 39 次/秒（12 个单位行进时）→ 39 × 0.479 ms ≈ **19 ms/s ≈ 0.3 ms/帧**；
不选中单位时完全不跑（补给线只在选中时画）。

**回归测试**：`tests/unit/supply-path-trim.test.js`（5 条：投影裁剪、起点附近不裁剪、真实折回检测、退化输入、
线段偏移量）。全量单测 579 passed / 8 failed（8 条仍是既有供应与配置漂移）。

**顺带说明**：这是战役渲染层的共享代码，所以单机战役的补给线也一起受益（同样的"折回"在战役里也存在，只是以前
很少在移动中盯着看）。补给线**数值**（谁供谁、供多少、断没断）依旧完全由服务器/模拟决定，这里只改画法。

---

## 11.13 修 bug：敌方阵亡后仍被渲染（只在部署版出现，2026-10-30）

**现象**（需求方反馈，`origin/main` 的部署版本）：联机时**对方阵亡的单位有时仍然画在场上**；本地跑同样的版本却复现不出来。

**根因**：部署版（`origin/main` = `517430e`）的客户端只把"**己方**单位从快照里消失"当成阵亡：

```js
// origin/main:src/pvp/battle.js
// 快照里消失的单位：己方 = 阵亡；敌方 = 可能只是脱离视野（不画即可，别当死）
for (const unit of world.units) {
  if (seen.has(unit.id) || unit.state === 'dead') continue;
  if (unit.faction === myFaction) unit.state = 'dead';   // ← 敌方永远不判死
}
```

而客户端镜像 world 是按关卡文件 `deployForces()` **一开始就把双方 32 个单位都建好**的，
渲染层又是按"`state !== 'dead'` 且 `isSpotted(world, unit, 我)` 为真"来画敌军。于是：

1. 敌军在我方视野内被打死 → 服务器快照里不再包含它；
2. 客户端因为上面那条"敌方不判死"，镜像里它仍然是 `state='alive'`，血量还是死前的；
3. `isSpotted()` 只看**我方视野**覆盖不覆盖那个坐标，不看这个单位是否还存在 → 依旧为真；
4. → **只要我方视野继续覆盖那片区域，这具"尸体"就会一直被画成一个正常单位。**

这也解释了"**有时**"：只有"死在你能看见的地方"的敌军才会这样；死在迷雾里的敌军本来就不在快照里，
客户端只是保持隐藏（只会留下 lastSeen 虚影）。

**为什么本地测不出来**：本地分支已经做了迷雾下放（`ea61685`，`PVP_FOG_AUTHORITY=client`），
快照改成**下发全部存活单位**、由客户端本地算视野，同一段代码随之改成"敌方缺席即阵亡"，
所以这个 bug 在本地分支上已经不存在；而 `origin/main` 一直是"服务端过滤 + 敌方永不判死"的旧实现。

**修复**（把规则抽成可测的纯函数，两种迷雾模式都正确）

| 位置 | 改动 |
|---|---|
| `src/pvp/missingUnits.js`（新） | `markVanishedUnits(world, seen, myFaction, fogAuthority)`：己方缺席=阵亡；敌方在 `client` 模式下缺席=阵亡，在 `server` 模式下**只有此刻仍被目视**才算阵亡 |
| `src/pvp/battle.js` | `applySnapshot()` 改为调用该函数（先 `updateFog()` 再判定），并记录 `__pvp.vanishedUnits` |
| `tests/unit/pvp-missing-units.test.js`（新，6 条） | 全量模式缺席即死、**部署版旧场景**（视野内阵亡必须判死）、服务端过滤下视野外缺席不判死、己方缺席恒判死、旧实现对照（证明这个测试确实能抓住 bug）、不误判已出现的单位 |

**验证**：6 条新测试通过；全量单测 **585 passed / 8 failed**（8 条仍是既有供应与配置漂移）。

**部署提醒**：这个修复随 `develop` 上的提交一起生效；部署版要修好必须把 `develop` 推到 `main`
（CI 重新构建静态产物 → 服务器 `git pull` 后客户端代码才更新）。

---

## 11.14 实现 U1–U3：命令由浏览器生成 → 批量发给服务器（2026-10-30）

按 `docs/pvp-orders-ui-plan.md`（UI 方案）与需求方确认的方案 A（批量 `cmd` + 服务端 `queueCommandBatch`）实现：

| 阶段 | 内容 | 代码 |
|---|---|---|
| **U1** | 复用战役输入层：左键从己方单位拖出轨迹 = `move` 多段路径、Shift+拖 = `appendRoute`、按住 **E** = `forced` 急行军；一次操作**打包成一条 `cmd` 消息**，服务器整批只扣 1 次限频 | `src/input/orders.js`（新增 `buildFormationOrders()` / `routeAnchorOf()`，`createOrders(..., { issue, getFaction })` 注入执行者）、`src/input/selection.js`（支持 `getFaction`）、`src/pvp/commandQueue.js`（打包/回执）、`server/src/match.js#queueCommandBatch`、`server/src/app.js`（`cmd` 兼容 `{orders}` 与旧 `{unitIds,command}`） |
| **U2** | 右键语义对齐战役：空地 = `attackMove`、Shift+右键 = `enqueueRoute`、右键**已目视**敌军 = `lock`、E+右键 = 急行军；**S = 停止**（`hold`）、ESC = 取消选择；Space/1/2/3 只提示不生效 | `src/pvp/pvpKeyboard.js`、`src/input/orders.js#handleRightClick`、`pvp-battle.html` 的 `#orderToast` 回执提示 |
| **U3** | 拖动中的轨迹线（急行军换色）+ 下令后的"预计路线"（本地 `planRoute` 画半透明虚线），服务器改道/超时后自动消失 | `src/pvp/routePreview.js`、`src/pvp/battle.js#drawOverlay/dashPolyline` |

**队形怎么算（决定：放本地）**：`buildFormationOrders()` 把拖出的轨迹转成**每个单位一条绝对路径**
（各自位置/锚点 + 同一组相对位移），因此队形不会全挤到一条线上；服务器只按绝对路径执行
（`planRoute` 起点永远是单位自身位置，客户端给的只是途经点 → 无法瞬移，见 `movement.js:844`）。

**实测（双人 e2e + 单测）**

| 项 | 结果 |
|---|---|
| 框选 16 个单位拖一条折线 | `batches=1`、`orders=16`、`applied=16`、`units=16`、`rejected=0`（**没有 RATE_LIMITED**） |
| 带宽 | 16 单位 × 16 路点 ≈ 6 KB **一条**消息（旧的逐条发要 16 条、并且会被 20 条/秒限频拒掉一部分） |
| 预计路线 | 松手瞬间 `previewCount=16`，12 秒后 `0`（超时/偏离自动清理） |
| 回执 | 提示条显示「已下令 16 个单位」；部分被拒时显示原因（`NO_UNITS` 等中文映射） |
| S 停止 | 快照里单位 `state` 变为 `hold` |
| 右键攻击前进 | 一次右键对全部选中单位 = **一条**命令（共享 target） |
| 单测 | `tests/unit/pvp-formation-orders.test.js`（4 条：队形不塌/急行军/追加锚点/跳过阵亡）、`tests/unit/pvp-command-batch.test.js`（4 条：整批 1 次限频/部分失败/非法批次/结束态）→ 全通过 |
| e2e | 新增 `tests/e2e/pvp-orders.spec.js`（U1+U2+U3 全流程）passed；`pvp-battle.spec.js`、`pvp-reconnect.spec.js` 回归 passed |
| 全量单测 | **593 passed / 8 failed**（8 条仍是既有供应与配置漂移） |

**顺带修的两处 UI 细节**

1. 对手掉线/重连不再覆盖 `#battleStatus`（那是"已进入对局…"这类稳定状态），改为横幅 + 提示条，
   否则页面跳转触发的 `opponent:rejoin` 会把状态刷成"对手已重连"。（`pvp-battle.spec.js` 因此稳定）
2. `createSelection` 增加 `ids()/size()`（PvP 调试与 e2e 用；战役行为不变）。

**仍未做（U4，需单独排期）**：快照里加 `route/pendingQueue` 显示**真实**行军路线（现在只有本地"预计路线"，
服务器绕行时会消失而不是改画）、触屏长按代替右键、单位卡片面板。

---

## 11.15 实现 P2/P0：行军路线下发（变化才发）+ 绘制复用 + 循环/键盘/i18n 回归战役（2026-10-30）

按需求方确认的方案（`docs/pvp-orders-ui-plan.md` §0 决策表）：**接受给快照加路线字段**，只发己方、只在变化时发；
迷雾与控制线/补给线**保持现状**；HUD 与音效**不复用**（P1/P3 不做）。

### 11.15.1 服务端

| 位置 | 变化 |
|---|---|
| `server/src/snapshot.js` | `visibleUnits()` 接受 `routeDeltas`，**只对己方单位**合并 `route/routeIndex/pendingQueue/forcedMarch`（缺字段不带） |
| `server/src/match.js` | 新增 `sentRouteState`（每阵营一份）、`routeDeltasFor(faction)`（按 4 个哈希判定变化）、`routesSnapshot(faction)`（ack 全量）、`resetRouteSync(faction)`；`MatchSim({ sendRoutes })` |
| `server/src/config.js` | `sendRoutes`（`PVP_SEND_ROUTES=0` 一键关闭，客户端自动退回"预计路线"） |
| `server/src/app.js` | 建局传 `sendRoutes`；`match:join` ack 增加 `routes`（全量）并 `resetRouteSync`；`/api/health` 暴露 `sendRoutes` |

**"变化才发"的判定**：`routeHash`（整条路线点数组）、`routeIndex`、`queueHash`（整段）、`forcedMarch` 四元组，
逐单位与上次发送比较；首帧"本来没路线"的单位**不发空数组**（客户端镜像默认就是空的）。

| 场景 | 实测体积 |
|---|---|
| 16 单位下令帧（单点路径） | **+1.3 KB**（一次性） |
| 长拖 16 点折线 | **+3–4 KB**（一次性） |
| 过路点（只 `routeIndex`） | **104 B** |
| 稳态（无变化） | **0 B** |

### 11.15.2 客户端

| 位置 | 变化 |
|---|---|
| `src/pvp/routeState.js`（新） | `applyRoutePatch()`（**缺字段不覆盖**）、`applyRoutesFull()`（ack 全量）、`clearRoutesOfDead()`、`countRoutes()` |
| `src/pvp/battle.js` | 快照里合并路线；真实路线到手即删 `previewRoute`；`match:join` 应用 ack 全量；`__pvp.routeStats = { ownWithRoute, deltasApplied, previews }`；**删除落点圆圈 `orderFlash`**（Q6） |
| `src/pvp/routePreview.js` | 保留但降级为"下令→首帧快照"的占位（真实路线到达即清空） |

### 11.15.3 绘制复用（P0 第 2 项，**改动战役侧代码**）

| 文件 | 改动 |
|---|---|
| `src/rendering/battleOverlay.js`（新） | 从 `GameScene` **逐行搬运**：`drawArrow` / `drawDashedPath` / 框选矩形 / 拖动轨迹 / 行军路线（3px + 箭头）/ 排队虚线（2px）。颜色、线宽、绘制顺序原样保留 |
| `src/rendering/scenes/GameScene.js` | `drawOverlays()` 改为调用 `drawBattleOverlays(...)`（战役行为不变）；删除文件内私有 `drawArrow`/`drawDashedPath` 与 `FORCED_ROUTE_COLOR` 常量 |
| `src/pvp/battle.js` | `drawOverlay()` 改为调用同一函数（`viewerFaction = 我`）；删除自写的 `dashPolyline`；框选矩形样式也随之与战役一致（`0x111111` / 1px） |

### 11.15.4 循环 / 键盘 / i18n（P0 其余三项）

| 文件 | 改动 | 战役侧影响 |
|---|---|---|
| `src/simulation/loop.js` | 新增 `createFixedStepper({ step, maxCatchUpTicks, onTick })`；`createLoop()` 变成它的薄封装 | 行为不变（`ai-engage.test.js` 8 条全过） |
| `src/input/keyboard.js` | 签名改为 `createKeyboard(scene, selection, { controller, issue, onHint })`；无 controller 时暂停/变速只提示，S 走注入的 `issue` | `GameScene` 调用点改成 `{ controller: this.controller }`，四条键位行为不变 |
| `src/pvp/pvpKeyboard.js` | **删除**（已由共享键盘覆盖） |
| `src/i18n/{zh-CN,en}.js` | 新增 `pvp.*` 共 48 个 key | 纯新增，不影响战役文案 |
| `src/i18n/apply.js`（新） | `applyStaticI18n()`：给静态 HTML 的 `data-i18n` 文案套上 `t()` | 战役页面不使用 |
| `pvp-battle.html` | 准备提示 / 操作提示 / 返回大厅 走 `data-i18n`；启动时套一遍 | — |
| `src/pvp/battle.js` / `commandQueue.js` | 状态、横幅、提示条、错误码全部改 `t()`（中文/英文两份） | — |

### 11.15.5 测试与验收

| 项 | 结果 |
|---|---|
| 新增单测 | `pvp-snapshot-routes`（8）、`pvp-route-state`（5）、`battle-overlay`（4）、`loop-stepper`（5）→ **22 条全过** |
| 全量单测 | **615 passed / 8 failed**（8 条仍是既有供应与配置漂移；战役侧改动后同样通过） |
| e2e：下令 + 路线 | `pvp-orders.spec.js` 扩展为"真实路线到达、`deltasApplied>0`、`ownWithRoute>=16`、预览归零、Shift 排队可见" → **passed** |
| e2e 回归 | `pvp-battle`（1）+ `pvp-reconnect`（2）→ **3 passed** |
| 截图 | 路线为**实线 + 末端箭头**（与战役一致）；Shift 排队出现**虚线**；`ownWithRoute=16`、`queued=16` |
| 带宽 | 下令帧 +1.3–4 KB（一次）；稳态 0 B |
| 客户端 CPU | 增量 < 0.05 ms/帧（合并 + 复用绘制） |

### 11.15.6 战役侧改动清单（需求方要求每次报备）

1. `src/rendering/scenes/GameScene.js`：`drawOverlays()` 改为调用共享 `battleOverlay.js`；删除私有 `drawArrow`/`drawDashedPath`/`FORCED_ROUTE_COLOR`；键盘调用点改为新签名。
2. `src/simulation/loop.js`：新增 `createFixedStepper`，`createLoop` 改为薄封装（行为不变）。
3. `src/input/keyboard.js`：参数化（`controller` 可选、`issue` 注入、`onHint`）。
4. `src/i18n/zh-CN.js`、`src/i18n/en.js`：新增 `pvp.*` keys（纯新增）。
5. `src/i18n/apply.js`：新增文件（战役不使用）。

> 以上改动后，战役全量单测与 `ai-engage`/`campaign-pages` 等既有测试全部通过；战役页面未做视觉改动。

### 11.15.7 回滚开关

- `PVP_SEND_ROUTES=0`：服务端不发路线 → 客户端自动退回"预计路线"模式（`routePreview.js`），其余功能不变。

---

## 11.16 修 bug：被占领的敌方基地，其补给线不渲染（2026-10-30）

**现象**（需求方反馈）：把敌方基地打下来之后，**由这座基地提供的补给线不画**（单位其实在被它补给）。

**根因**：补给系统与绘制层对"城市格"的处理不一致 ——

| 层 | 代码 | 行为 |
|---|---|---|
| 代价场（决定谁供谁、供多少） | `supplyPath.js#buildSupplyField` 种子循环 | **城市格永远豁免**：`cost=0` 并直接入堆，不看敌方控制区（注释也写了"城市格永远是补给起点，被围时也算") |
| 绘制层（管线连到哪座城） | `supplyPath.js#findSupplyPath` 的 `traversable` | 只判断 `blocked[index] === 0`，**终点格被敌方控制区标记就进不去** → 返回 `null` → `supplyLines.js` 里 `if (!path) continue` → 这条线根本不画 |

刚占领的敌方基地往往仍压在敌方实际控制区里（敌方单位就在旁边、控制线平滑还没翻过来），于是：
代价场把它当合法补给源（单位确实拿到补给边），绘制层却画不出路径 → **有补给、没线条**。
单机战役共用同一段绘制代码，所以这个 bug 在战役里同样存在，只是 PvP 里被占领的城市更多、更容易碰到。

**修复**（一处，仅影响绘制；结算逻辑不变）：`findSupplyPath` 的 `traversable` 增加"**终点格豁免**"：

```js
const traversable = (index) => Number.isFinite(steps[index])
  && (blocked === null || blocked[index] === 0 || index === endIndex);
```

与代价场的"城市格豁免"对齐；中途格仍然受控制区阻挡（没有把规则整体关掉）。

**验证**

| 项 | 结果 |
|---|---|
| 新增单测 `tests/unit/supply-path-captured.test.js`（3 条） | 终点格被 mask 标记仍能出路径；路径终点落在城市格（≤20px）；中途封墙不会变成"无视控制区" |
| 全量单测 | **618 passed / 8 failed**（8 条仍是既有供应与配置漂移） |
| 影响面 | `findSupplyPath` 只被 `src/rendering/supplyLines.js` 调用 → **只影响画面**，不影响补给结算、不影响回放确定性 |
| 战役侧 | 同一段代码，战役里被占领基地的补给线也一并修好；战役既有测试全过 |

### 11.16.1 追加（同日）：渲染层不再"静默丢线" + 诊断

上面的终点格豁免不是需求方遇到的那个现象（反馈"依然存在"）。进一步排查结论：

1. **两次真实占领复现失败**：在真浏览器里分别打下**近处**的红城（c24，距己方 ~104px）与**敌方腹地**的红城（c16，1012,450），
   两次都确认：客户端 `city.faction` 及时变成 `blue`（`ownCityCount` 8→9）、单位拿到指向该城的 `supplyEdges`、
   `supplyLines.state.lines > 0`。也就是说"城市归属没更新"在这两条路径上不成立。
2. **真正的薄弱点：渲染层有三条"静默 continue"，任何一条命中都会让"选中的单位一条线都没有"**：

| 静默丢线的原因 | 什么时候发生 |
|---|---|
| 边指向的城市**不在己方城市表**里 | 归属慢一帧 / 刚易主的那几帧 |
| 按控制区算路径得到 `null` | 代价场（1 s 重建一次）说"供得到"，而同一帧的 A\* 用的是**更新的**控制区掩码 → 走廊被挡（两者重建时机不同，存在最多 1 s 的不一致） |
| `supplied === true` 但 `supplyEdges` 为空 | 运力恰好被别的单位抽干的那一轮（`claimOf` 有缺口却没分到点数） |

**修法（只改绘制，不改结算）**

- 城市查找：先在己方城市里找，找不到退回**全城市表**（`state.missingCity` 计数）；
- 路径：控制区 A\* → 失败就退回**忽略控制区**的几何路径（`pathFallback`）→ 再失败就直线兜底（`straightFallback`）；
- `supplied && 无边`：连一条**最细最淡**的线到最近的己方城市（`noEdgeSupplied`），不再什么都不画。

这样"数值上有补给"的单位**一定**能看到一条线，不会再出现"选中后什么都没有"。

**诊断（排查用，不占带宽）**：`__pvp.deriveStats` 新增
`supplyMissingCity / supplyPathFallback / supplyStraightFallback / supplyNoEdge / supplyRows`，
`supplyRows` 是本帧每个选中单位画了什么：`{ id, supplied, cityId, owned, path, share }`。

**回归**：全量单测 618 passed / 8 failed（既有）；`pvp-battle` e2e 恢复通过。
（过程中我自己引入过一个 `debugRows is not defined` 的崩溃，导致补给线整段不画，被 e2e 抓到并已修好 —— 也说明这条 e2e 是有用的。）

**如果仍然复现**，请把 `JSON.stringify(__pvp.deriveStats)` 贴出来（尤其是 `supplyRows` 与 `supplyMissingCity/supplyPathFallback` 计数），
并说明：是 PvP 还是战役、单位离那座被占城市大概多远、城市是"刚占领"还是"占领一段时间后"。

### 11.16.2 真正的根因：降级到 `mode='server'` 后**补给派生被一起冻结**（2026-10-30）

需求方贴的 `__pvp.deriveStats` 里有两个关键字段：

```json
"mode": "server", "mismatch": 1, "hardSwitches": 3, "packets": 25,
"localPaths": 256, "serverPaths": 96,
"supplyRows": [{ "id": 28, "supplied": true, "cityId": "c28", "owned": true, "path": 5 }]
```

**`mode: "server"` = 客户端派生控制器已经"降级"了**（控制线与服务器差太多 → 连续 3 次硬切 → 回退成只显示服务器控制线）。
而当时的实现里，降级同时**停掉了本地派生**：

```js
// 旧代码（错误）
if (state.mode === 'local') {
  updateControlLine(world);          // 控制线
  refreshSupply(world, fixedStep);   // 补给分配 ← 一起不跑了
}
```

于是 `unit.supplyEdges / supplied` **冻结在降级那一刻**，之后：

- 占领敌方城市 → 附近部队的补给边还指着**远处的初始城市**（不会改指新占的城）；
- 丢掉初始城市 → 旧补给边还在，渲染层照旧画那条**从已失守城市出发**的线。

这正是需求方描述的两个现象。

**为什么降级之后不会自愈**：`comparePaths()` 原先在"两侧折线条数不同"时直接 `return 1`（判为完全不一致）。
前线等值线稍有变化就会多/少一条 → 误判 → 硬切 → 降级；降级后本地控制线不再更新，`mismatch` 恒为 1 →
永远达不到恢复阈值（< 5%）→ **单向陷阱**。

**修法（3 处）**

| 位置 | 改动 |
|---|---|
| `src/pvp/derive.js` | 本地派生（`updateControlLine` + `refreshSupply`）**两种模式都跑**；`mode === 'server'` 只决定"绘制用服务器折线还是本地折线"，不再影响补给 |
| `src/pvp/derive.js#comparePaths` | 不再按"折线条数"判 1；对两侧**所有折线**一起做侧向符号比较（条数不同也能比较），避免误触发降级 |
| `src/rendering/supplyLines.js` | 常规补给线**只画己方城市**的边：旧边若指向已易主的城市则不画（计入 `missingCity`），避免"城都丢了还画它出发的线" |

**回归测试**（`tests/unit/pvp-derive.test.js` 新增 3 条）

1. `mode='server'` 时 `refreshSupply` 仍在跑：刚占领的城市立刻成为补给源；
2. 城市被敌方夺走后，下一次分配不再指向它；
3. 折线条数不同时 `mismatch` 不会变成 1。

**验证**：全量单测 **621 passed / 8 failed**（既有）；`pvp-battle` + `pvp-orders` e2e 通过。
需求方诊断里 `supplyPathFallback: 1` 说明上一版的路径兜底也确实被用到了（掩码把路挡住但边存在的情形）。

---

﻿## 11.17 对局页界面与战役统一（2026-10-30）

按需求方确认的方案：**复用同一套外壳**，去掉任务/暂停/倍速，主菜单改为**认输**，并显示对手状态与 RTT。

### 11.17.1 共享层（新增）

| 文件 | 作用 |
|---|---|
| `src/rendering/battleChrome.js` | 战场外壳唯一来源：`mountBattleChrome({ mode: 'campaign' \| 'pvp' })`，返回 `els`。战役 = brand/任务名/主菜单/缩放/倍速/暂停 + 左栏 + 任务浮层 + 战场通讯 + 标题行/底栏；PvP = brand/房间·阵营/缩放/对手+RTT/**认输**，结算按钮为"返回大厅" |
| `src/rendering/prepCountdown.js` | 准备读秒（84px 暗红数字 + 提示条），战役与 PvP 共用 |
| `src/rendering/hud.js` | 新增 `options = { elements, timeSource, onVictory, onResultButton, faction }`，所有"战役专有元素"都做了判空；PvP 传 `elements: chrome`、`timeSource: 快照剩余时间`、`controller: null` |

### 11.17.2 页面

- `game.html`：只剩 `#battle-root`，骨架由 `src/entries/game.js` 在创建 Phaser 前挂载。
- `pvp-battle.html`：只剩 `#battle-root` + socket.io + `src/pvp/battle.js`（同样在外壳里挂 `#battlefield`）。
- 认输：顶栏按钮 → `socket.emit('match:resign')` → 服务端复用 `rooms.leave()` 的 forfeit 判负 → 对手收到结算 → 自己回大厅。**无二次确认**（需求方确认）。

### 11.17.3 验证（截至本轮）

| 项 | 结果 |
|---|---|
| 战役页面（真浏览器） | `#battle-root`/`#battlefield`/canvas 均存在，时钟 `00:01`、暂停键、`03 UNITS`、任务面板、结算浮层都在 → 骨架迁移无回归 |
| PvP 页面（真浏览器） | `hud: true`、时钟显示剩余时间 `09:53`、`房间 QVXB9F · 蓝方`、状态"已进入对局（蓝方）"、canvas 正常，无 JS 报错 |
| 全量单测 | 621 passed / 8 failed（既有供应与配置漂移） |
| `pvp-battle` e2e | **passed**（快照/视野/选择/下令 + 新的 `#roomLabel`/`#vgClockText` 断言） |
| `pvp-orders` / `pvp-reconnect` | 未通过：均为断言与新界面不一致（`#toast` 文案、`lastOrderResult` 的时序、断线结算的浮层路径），下一步修 |

﻿### 11.17.4 修 bug：认输后对局没有结束（2026-10-30）

**现象**：点顶栏「认输」，按钮变灰但**对局不结束、不弹结算**，双方都停在战场上。

**根因**（两处，都在服务端）：

1. `server/src/rooms.js#leave()` 里先把 `room.state = 'finished'`，再调 `onForfeit` →
   而 `finishRoom()` 开头是 `if (room.state === 'finished') return;` → **直接返回**，不广播 `match:end`，
   客户端永远收不到结果。
   → 改成**先结算再改状态**。
2. 同一函数先 `room.players = players.filter(...)` 把退出者移除，`onForfeit` 里再按 id 找人就找不到 →
   胜方恒定为 `blue`（认输方若是蓝方会被判成胜利）。
   → 在移除前记下 `quittingFaction` 并作为参数传给 `onForfeit`；`app.js` 优先用它，掉线路径仍回落到查表。

**顺带**：结算原因文案按时区分侧 —— `pvp.reason.forfeit`（自己认输）=「认输」，
新增 `pvp.reason.opponentForfeit`（对手认输）=「对手认输」。

**UI 小修**：单个单位下令不再弹「已下令 1 个单位」提示条（多单位仍提示）。

**验证**

| 项 | 结果 |
|---|---|
| 新增 `tests/e2e/pvp-resign.spec.js` | 认输后**双方**都出现结算浮层：认输方「失败 · 认输」，对手「胜利 · 对手认输」，按钮为「返回大厅」 |
| 全量 PvP e2e（battle / orders / rooms / resign / reconnect） | **8 passed**（1.3 min） |
| 单单位不弹提示 | `pvp-battle` e2e 新增断言：只选 1 个单位右键下令后 `__pvp.lastToast` 仍为 null |
| 全量单测 | 621 passed / 8 failed（既有供应与配置漂移） |

﻿### 11.17.5 UI 微调：下令成功不再弹提示条（2026-10-30）

需求方要求：单/多单位**下令成功都不再弹**「已下令 N 个单位」。

- `src/pvp/battle.js#reportOrder`：成功分支不再 `flashOrderToast`，只记录 `debug.lastOrderAccepted = { units, at }`（供 e2e 断言）；
  **保留**：部分被拒（`pvp.toast.orderPartiallyRejected`，带原因）、整条被拒（错误码）、发送失败、对手掉线/重连提示。
- `tests/e2e/pvp-orders.spec.js`：把"回执提示条真的显示过"改成"不应有提示条 + `lastOrderAccepted.units > 1`"。
- `tests/e2e/pvp-battle.spec.js`：单单位下令同样断言 `lastToast === null`。

**验证**：全量 PvP e2e **11 passed**（1.4 min，battle/orders/rooms/resign/reconnect 等）；全量单测 621 passed / 8 failed（既有漂移）。

﻿### 11.17.6 修 bug：结算窗「返回大厅」点不动（2026-10-30）

**现象**：认输结束或正常结束（时间到/占领全城/掉线判负）后，结算窗点「返回大厅」没有回大厅。

**根因**：`#restartButton` 的点击处理器由 `hud.js` 绑定，而它的分支顺序是
`if (options.onResultButton) … else 战役逻辑（continueAfterVictory / returnFromGame）`。
联机建 HUD 时**没传 `onResultButton`** → 走到战役分支 → `returnFromGame()` = `window.location.reload()`
→ 看起来像"原地刷新对局页"，实际是回了对局页而不是大厅。

**修法**

| 位置 | 改动 |
|---|---|
| `src/pvp/battle.js` | 新增 `leaveToLobby()`；`createHud` 传 `onResultButton: () => leaveToLobby()`；`showResult()` 里显式把按钮文案设为「返回大厅」（`pvp.result.backToLobby`） |
| `src/i18n/{zh-CN,en}.js` | 新增 `pvp.result.backToLobby` |

**验证（三条结束路径全覆盖）**

| 结束原因 | 测试 | 结果 |
|---|---|---|
| 认输（forfeit） | `pvp-resign.spec.js`：点按钮 → `waitForURL(/pvp\.html/)` | passed |
| 时间到（time-limit，正常结束） | 新增 `pvp-timeup.spec.js`（服务端 `PVP_MATCH_MINUTES=1`）：结算显示「到达时限…」→ 点按钮 → 回大厅 | passed（1.2 min） |
| 掉线超时（disconnect-timeout） | `pvp-reconnect.spec.js`：结算 → 点按钮 → 回大厅 | passed |

回归：PvP e2e 其余 8 条全过（`pvp-battle` / `pvp-orders` / `pvp-rooms` / `pvp-resign` / `pvp-reconnect`）。
> 注意：`pvp-timeup.spec.js` 需要服务端以 `PVP_MATCH_MINUTES=1` 启动，默认配置下不要跑这条。

﻿### 11.18 再开一把：结算后自动回到同一个房间（2026-10-30）

需求方要求：从结算窗点「返回大厅」后，原来同一房间的人**依旧在同一个房间**（房间码不变），
双方直接点「准备」就能开下一局，不需要重新输入/转发房间码。

**实现（不新增房间码、不新建房间）**

| 位置 | 改动 |
|---|---|
| `server/src/rooms.js` | 新增 `forfeit({ code, userId })`：认输**只判负**，不把玩家移出房间、也不删房（`leave()` 仍保持"真离开"语义）<br>新增 `rearm({ code })`：把 `finished` 的房间原地重置成 `waiting`（清 ready / countdown / beginEmitted / match），房间码与成员不变 |
| `server/src/app.js` | `match:resign` 改走 `rooms.forfeit()`（不再 `rooms.leave()`，否则玩家被踢出房间就谈不上再开一把） |
| `server/src/routes/rooms.js` | 新增 `POST /api/rooms/:code/rearm`（仅房间成员可调） |
| `src/pvp/battle.js` | `leaveToLobby()` 把房间码写入 `sessionStorage['pvp:lastRoom']` |
| `pvp.html` | 登录后若存在 `pvp:lastRoom`：先 `POST /:code/rearm`，再 `GET` 房间，然后自动进房（已是成员则直接渲染）；房间已回收/已开打则安静留在大厅 |

**为什么是"按需重置"而不是结束时立刻重置**：掉线判负的一方在宽限内回来仍要能看到结算
（`pvp-reconnect.test.js` 的既有契约），所以房间在结束后**保持 finished**，只有大厅来要它时才 rearm。

**验证**

| 项 | 结果 |
|---|---|
| 新增 `tests/e2e/pvp-rematch.spec.js` | **passed**：认输 → 双方点「返回大厅」→ 双方都回到**同一房间码**且列表 2 人 → 双方点「准备」→ **第二局开始**（快照继续上涨） |
| 全量 PvP e2e（battle/orders/rooms/resign/reconnect/rematch） | **9 passed**（1.4 min） |
| 全量单测 | **621 passed / 8 failed**（8 条既有供应/配置漂移；`pvp-reconnect` 5 条全过） |

﻿### 11.19 合并登录页 + 首页联机入口（2026-10-30）

需求方决策：① 账号以**服务端为准**、本地只缓存"谁登录了"；② **不允许离线登录**；③ 不做旧账号迁移；④ 首页入口常驻、不隐藏。

**账号合并**

| 位置 | 改动 |
|---|---|
| `src/auth.js` | 删掉本地账号表（`war-of-dots.users` 的读写与本地 `login()/register()`），改为服务端账号 + 本地会话缓存：新增 `syncSessionFromUser()` / `clearSession()` / `fetchMe()` / `loginRemote()` / `registerRemote()`；`logout()` 先 `POST /api/auth/logout` 再清缓存回登录页；`requireAuth()` 守卫逻辑不变（`auth-guard.test.js` 5 条全过） |
| `src/entries/login.js` | 重写：提交走 `/api/auth/{login,register}`，按错误码给中文提示（`BAD_CREDENTIALS`/`USERNAME_TAKEN`/`INVALID_*`/`RATE_LIMITED`/服务不可用）；成功后写本地会话再跳 `?next=`；已有本地会话时先 `/api/auth/me` 校验，失效则清缓存留在本页 |
| `login.html` | 文案改成"账号同时用于战役与联机对战；登录需要联机服务器可用"（**不加**旧账号迁移说明，保持简洁） |
| `pvp.html` | **删除整块认证卡片**（本页不再登录/注册）；`/api/auth/me` 未登录 → `location.replace('/login.html?next=/pvp.html')`；服务器不可达时只在页内提示"联机服务不可用"（不踢去登录页，避免两边都登不进去）；登出 = 服务端删会话 + 清本地缓存 + 回登录页 |
| `index.html` | 主菜单新增「⚔ 联机对战」卡片 → `/pvp.html`（`data-i18n="home.pvp"`，中英文各一条） |

**成就数据（回答需求方提问，未改动）**：全部在浏览器 localStorage，**按账号**命名空间隔离，无后端。
键 = `war-of-dots.u.<账号>.<数据名>`；成就解锁列表的数据名是 `ach-unlocked`，由 `result.html` 与 `climb.js` 写入，
`src/achievements.js#evaluateAchievements` 读取并判定。账号名来自 `war-of-dots.session`（登录页写入的服务端用户名，小写归一化）。
联机对局**不写**任何成就数据。

**验证**

| 项 | 结果 |
|---|---|
| 新增 `tests/e2e/pvp-login.spec.js`（3 条） | **passed**：未登录进大厅 → 跳统一登录页（带 next）→ 注册后回大厅且本地会话写入 → 战役页放行 → 首页有联机入口 → 登出后两边都失效；错误密码给出"用户名或密码不正确"；未登录访问 `index.html` 也被送到登录页 |
| 全量 PvP e2e（battle/orders/rooms/resign/reconnect/rematch/login） | **12 passed**（1.5 min） |
| 全量单测 | **621 passed / 8 failed**（8 条既有供应/配置漂移） |

﻿### 11.20 修 bug：本地渲染时敌军前进不朝向前进方向（2026-10-31）

**现象**：联机里敌方单位在前进，但贴图朝向不变（一直保持初始角度）。

**根因**：`src/rendering/unitRenderer.js#facingAngle()` 的朝向来源只有两个：
① 交战时朝目标；② 朝 `unit.route[routeIndex]` 这个路径点。
而按 §11.15 的设计，**敌方行军路线从不下发**（避免泄露对手操作），所以敌方单位 `route` 永远为空 →
`facingAngle` 返回 `null` → 精灵保持上次朝向，看起来就是"不转向"。

**修法**（只改渲染层，不动协议）

| 位置 | 改动 |
|---|---|
| `src/rendering/unitRenderer.js` | 新增纯函数 `movementFacing(lastPos, unit, eps)`：没有路线时用**上一帧 → 这一帧的位移**当方向；位移小于 `MOVE_FACING_EPS`（0.05px）视为静止返回 `null`（保持上次朝向，避免抖动）<br>`drawUnit()` 维护 `lastPositions`（每单位上一帧渲染位置），算好 `facing` 再传给 `drawTexturedUnit()`（原来的调用在函数内部重算，拿不到位移）<br>新增调试口 `debug.angleOf(id)`：读某单位精灵当前显示角度（e2e 用） |
| `src/pvp/battle.js` | 暴露 `__pvp.facingOf(id)`（转调渲染层的调试口） |

**验证**

| 项 | 结果 |
|---|---|
| 新增单测 `tests/unit/unit-facing.test.js`（5 条） | **passed**：右移→0、上移→-π/2、左下→3π/4、几乎不动→null、无上一帧→null |
| 新增 e2e `tests/e2e/pvp-facing.spec.js` | **passed**：红方（对手）向东拖路径行进，蓝方读该单位精灵显示角度 → \|angle\| < 0.5（≈向东），证明"敌方前进会转向" |
| 全量 PvP e2e（battle/orders/rooms/resign/rematch/login/facing） | **11 passed**（1.3 min） |
| 全量单测 | **626 passed / 8 failed**（8 条既有供应/配置漂移） |

> 附带效果：己方单位在"路线还没同步到"的那一小段时间里也不再乱指，同样按位移转向；战役侧行为不变（有路线时仍优先按路径点）。

﻿### 11.21 身份（蓝/红/观战）、同阵营多人、全队投降、观战全局视野（2026-10-31）

需求方决策：每方 4 人 / 观战 8 人；双方各 ≥1 名参战玩家且全员准备才开局；投降立即失去指挥权、
全队投降才判负；掉线只在全队掉线时判负；观战只能在等待环节进入、可看敌方路线；同阵营共享指挥权。

**服务端**

| 文件 | 改动 |
|---|---|
| `rooms.js` | `newPlayer(user, role)`：`role: blue/red/spectator`，`faction` 为其派生（观战 = null）；`resigned` 标记<br>`join({ role })`：只能在 `waiting` 进入；未指定身份时**按人数平衡补位**（1 蓝、2 红、3 蓝…）；`maxPerSide` / `maxSpectators` 容量校验（`SIDE_FULL` / `SPECTATOR_FULL`）<br>`setRole()`：等待阶段切换身份（开打锁定），切换后清 ready<br>`canStart()`：双方各 ≥1 名参战玩家 + 所有参战玩家 ready（观战者不参与）<br>`resign()`：登记本人投降，返回 `{ resigned, total, allResigned }`（幂等）<br>`sweep()`：掉线判定改为**某阵营全部参战玩家掉线/投降**才判该阵营负<br>`rearm()`：清 ready 与 resigned |
| `snapshot.js` | `buildSnapshot(world, null)` = 观战视图：双方单位 + **双方完整路线** |
| `driver.js` | 新增 `room:<code>:spec` 频道：仅当房间有观战者时发送，频率 = `snapshotHz / 2`（默认 7.5Hz） |
| `app.js` | `match:join` 支持观战（进 spec 频道、`socket.data.faction=null`、ack 带 `role/spectator/teammates`）；新增 `room:setRole`；`cmd` 拒绝观战者（`SPECTATOR_CANNOT_COMMAND`）与已投降玩家（`RESIGNED`）；`match:resign` 改为登记 + 广播 `match:resignState`，全队投降才 `finishRoom`；掉线额外广播 `player:left` |
| `config.js` | `maxPerSide=4`、`maxSpectators=8`、`spectatorSnapshotHz=7.5`（均可用环境变量覆盖） |

**客户端**

| 位置 | 改动 |
|---|---|
| `pvp.html` | 房间面板新增身份选择（蓝 n/4、红 n/4、观战 n/8，当前身份高亮）；玩家表加"身份"列与"已投降"；观战者隐藏「准备」 |
| `src/pvp/battle.js` | join ack 记录 `spectator/role/teammates/resigned`；观战：`viewerFaction()=null` → 迷雾关闭、可选任意单位、双方路线都画、认输按钮隐藏、`issue()` 直接忽略；投降回执显示 `已投降（1/2），等待队友`；监听 `match:resignState` 提示己方/对方投降进度 |
| `fogRenderer.js` | `faction` 为 null → 不画迷雾（`sync()` 直接隐藏迷雾层） |
| `unitRenderer.js` | `viewer=null` → 渲染全部单位（含敌方），不再做"未见即隐藏" |
| `selection.js` / `battleOverlay.js` | `getFaction()=null` / `viewerFaction=null` → 任意选择、双方路线都画 |
| `simulation/systems/fog.js` | `isSpotted(world, unit, null)` → true（观战全局可见） |
| `styles.css` | `.role-btn` 三个小按钮样式（active 高亮） |

**验证**

| 项 | 结果 |
|---|---|
| 新增单测 `tests/unit/pvp-roles.test.js`（13 条） | **passed**：平衡补位、双方容量、观战容量、等待期切换/开打锁定、开打条件、观战不能准备、部分投降不判负/全队投降判负、单人阵营投降、幂等、rearm 清标记、队友掉线不判负、全队掉线判负、观战不能进已开局房间 |
| 更新 `tests/unit/server-rooms.test.js` | 旧用例"第三人 = ROOM_FULL"改为新规则（第三人补蓝、显式指定满员阵营才 `SIDE_FULL`） |
| 新增 e2e `tests/e2e/pvp-roles.spec.js` | **passed**：蓝 2 + 红 1 + 观战 1；观战者能看到双方单位、选中**红方**单位能画补给线（`supplyLines=1`）、右键下令无效、认输按钮隐藏；蓝方第 1 人投降 → **无结算**；第 2 人投降 → 立即结算，红方胜利 |
| 全量 PvP e2e（battle/orders/rooms/resign/rematch/login/facing/roles） | **12 passed**（1.5 min） |
| 全量单测 | **639 passed / 8 failed**（8 条既有供应/配置漂移） |

**取舍记录**：观战者可见敌方路线（需求方确认），这存在"观战者向对局者转述信息"的风险，房间层面暂不限制。

﻿### 11.22 修观战卡顿：插值窗口按**实测快照间隔**走（2026-10-31）

**现象**：观战者画面卡顿（参战者不卡）。

**根因**：插值一直在跑，但窗口写死成 15Hz：

- `src/pvp/battle.js`：`SNAPSHOT_INTERVAL_MS = 1000/15 ≈ 66.7ms`，`alpha = alphaFor(now - lastSnapshotAt, 66.7)`
- 观战走 `room:<code>:spec` 频道，频率是 **7.5Hz（≈133ms）**
- 于是 alpha 在 66.7ms 就到 1 被 clamp 卡住 → **后半程约 66ms 单位定住**，下一帧再跳 → 观感就是 7.5Hz 顿挫

**修法**（客户端）

| 位置 | 改动 |
|---|---|
| `socket.on('tick')` | 用相邻快照到达时间做**指数滑动平均**（0.7 旧 + 0.3 新）得到 `debug.snapshotIntervalMs`，限定在 [33ms, 250ms] |
| `interpolate()` | 插值窗口改用 `debug.snapshotIntervalMs`（兜底 66.7ms），并把 `lastAlpha / interpolateIntervalMs` 写进调试量 |
| `deriveStats` | 新增 `snapshotIntervalMs`、`lastAlpha` 两个自检字段 |

参战者仍是 15Hz → 实测≈66ms，行为与以前一致；观战者实测≈133ms，**整段间隔都在推进**，不再"走一半停一半"。

**验证**

| 项 | 结果 |
|---|---|
| `tests/e2e/pvp-roles.spec.js` 新增断言 | **passed**：观战 `snapshotIntervalMs ∈ [100,200]`（实测≈133）；25ms×24 次采样中 `minAlpha < 0.5`（证明间隔内仍在推进，没有半程定住）、`maxAlpha ≤ 1` |
| 全量 PvP e2e（8 spec） | **12 passed**（1.5 min） |
| 全量单测 | **639 passed / 8 failed**（8 条既有供应/配置漂移） |

**说明**：观战快照本身仍带"双方单位 + 双方路线"，体积比参战者大，但频率已减半（7.5Hz，≈44KB/s/人）；本次卡顿的主因是插值窗口，不是带宽。

﻿### 11.23 渡江战役 PvP 重制：40 vs 40 分驻城市（2026-10-31）

**需求**：渡江 PvP 改为 40 vs 40，初始分布在双方控制区各处城市附近；地图不改。
**决策**（需求方选定）：每城 3 轻 + 2 重（因每城改驻 4 人，落地为 2 轻 + 2 重）／16 城全驻军／补给容量先按现状／保留集结点当预备队／紧凑方阵。

**编制（数据驱动，只改关卡 JSON）**

| 项 | 值 |
|---|---|
| 城内驻军 | 8 城 × 4 人 = 32（每城 **2 轻 + 2 重**，2×2 紧凑方阵，28px 间距，`at: { cityId }`） |
| 后方预备队 | 每方 8 人（5 轻 + 3 重）停在主集结点（蓝 `s37`、红 `s42`） |
| 每方合计 | **40 人** = 21 轻 + 19 重（双方完全对称） |
| 总单位 | 80（原 32） |

**落点校验**（生成脚本按 8 方向 × 2 排布挑第一个全陆地队形，然后回归断言）

- 水里生成：**0**
- 同阵营两两间距 < 20px 的对数：**0**
- 城内部队都在己方城市 **60px** 内（同时也在 80px 恢复半径内）
- 单位 id 唯一（快照/路线按 id 对齐）

**平衡与实测**

| 项 | 结果 |
|---|---|
| 最近双方单位间距 | **143px**（c25  garrison ↔ c24 garrison）→ 不会立刻接敌，但局部可能落在重装视野（160）边缘；旧的"开局互不可见（≥400px）"约束随"各城驻军"自然失效，测试改为"≥60px" |
| 补给吞吐 | 8 城 × 5 点 = 40/方，与 40 单位满额需求刚好持平 → 全军打空后会出现"运力不足"；**先按现状**（需求方选择），后续实测再定是否调 `capacityPerCity` |
| 快照体积 | 80 单位单帧 **≈12.3KB**（原 32 单位 5.6KB）；15Hz ≈ **185 KB/s/人**；观战帧（含双方路线）≈13.7KB @7.5Hz ≈ 103 KB/s |
| 服务端 tick | 12000 tick 平均 **0.79 ms**，最大 20.5 ms（阈值相应放宽到 3ms/60ms） |
| 客户端 | 真浏览器实测 **61 FPS**、derive `computeMs < 1ms`、80 条补给边全部算出、选中 12 个单位画出 12 条补给线 |

**测试更新**

| 文件 | 改动 |
|---|---|
| 新增 `tests/unit/pvp-level-dujiang.test.js`（6 条） | 40/40、兵种对称、无水、无重叠、每城都有驻军且 ≤60px、预备队 16 人、id 唯一 |
| `pvp-match.test.js` | 兵力 16→40；可见敌方上限 16→40；快照阈值 8KB→14KB；性能阈值 2ms/40ms→3ms/60ms |
| `pvp-fog-parity.test.js` / `pvp-snapshot-routes.test.js` | 16→40 |
| `pvp-levels.test.js` | "每方只用出生点"改为"锚在本方出生点或城市"；"双方出生点相距 ≥400px"改为"开局最近单位间距 ≥60px" |
| `pvp-derive.test.js` | 占领城前先清掉附近红方守军（否则敌方控制区挡死补给路径） |
| `pvp-formation-orders.test.js` | 浮点逐轴近似比较 |
| `tests/e2e/pvp-battle.spec.js` | `enemiesKnown` 16→40 |
| `tests/e2e/pvp-orders.spec.js` | 40v40 下整屏框选会越界，改为按 id 选 8 个单位 |
| `tests/e2e/pvp-facing.spec.js` | 只挑"离蓝方最近"的红方单位（蓝方要能看见才读得到精灵朝向），拖拽位移 220→120 并夹在画布内 |

**验证**：全量单测 **650 passed / 8 failed**（8 条仍是既有供应/配置漂移）；全量 PvP e2e（8 spec）**12 passed**。
