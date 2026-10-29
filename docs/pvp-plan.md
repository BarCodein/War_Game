# PvP 联机对战开发计划（分阶段验收）

> 目标：在现有**确定性模拟引擎**之上，加两个能力 —— ① 匹配（房间码）② 双主机联机对局。
> 本文档只做计划与验收标准，**不改代码**。需求决定来自 2026-10-29 的确认答复（§2）。
> 术语：`权威模拟` = 服务器进程里跑的那份 `src/simulation`；`快照` = 服务器每 N 个 tick 广播给客户端的状态。

---

## 0. 进度状态

- [x] **P0 需求与前置**：七项决定 + 服务器实情确认（§2）
- [x] **P1a 链路打通**（已实现并本地实测，见 §11）：`server/`（express + socket.io）、`GET /api/health`、`/socket.io` 握手与 `link:ping`、`pvp.html` 自检页、`deploy/` 模板、`docs/pvp-deploy.md`、`tests/unit/server-link.test.js`
- [x] **P1b 账号体系**（已实现并本地实测，见 §11.2）：SQLite（better-sqlite3 + 迁移）、注册/登录/登出/`me`、scrypt 加盐、HttpOnly 会话 Cookie、按 IP 失败限速、`pvp.html` 账号面板、`tests/unit/server-auth.test.js`（10 条）、`tests/e2e/pvp-auth.spec.js`（3 条）
- [ ] P2 引擎上服务器（MatchSim）→ P3 房间码 → P4 对局同步 → P5 断线 → P6 部署配置与验收 → P7 打磨

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

### 3.4 视野与防作弊（重点）

1. **服务端过滤**：发给蓝军的快照里，只有当 `isSpotted(world, redUnit, 'blue')` 为真才含该红军单位；未目视的敌军**完全不下发**（客户端伪造也刷不出来）。
2. **迷雾着色**：客户端用 `fog.js` 结合自己可见的数据本地计算三态与已探索区域（不下发 10240 字节/次的迷雾网格）。
3. **命令校验**：`faction` 归属、单位存活、命令格式（`validateCommand`）、单玩家命令频率上限（≤ 20 条/秒）、payload 大小上限。
4. **不做客户端预测**（MVP）：输入延迟 ≈ RTT/2 + 100 ms 插值；P7 视实测再决定是否加“移动指令本地乐观回显”。

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

### 3.8 对称 1v1 兵力模板（P2 交付）

现有战役关卡的 `forces` 是**剧本化**的（平津 17v23、渡江 20v21，城市数对称但兵力不对称）。PvP 需要：

- 新增 `public/assets/pvp/dujiang_pvp.json`、`pingjin_pvp.json`：`map` 引用**同一张地图**，`forces` 左右镜像（取较少一方为基准复制给双方，出生点/朝向镜像），`victory: { "mode": "normal" }`；
- 验收：蓝/红兵力数量与兵种构成完全相等（单测断言），出生点到最近城市距离对称（±5%）。

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
