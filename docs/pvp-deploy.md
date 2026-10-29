# PvP 部署与本地验收（手动执行）

> 本文件对应 `docs/pvp-plan.md` 的 **P0 →（链路打通）** 阶段：目标只有一个 ——
> **浏览器 → Nginx → Node（REST + WebSocket）这条链路通**。
> 对局与账号还没做，所以现在能验证的是 `/api/health`、`/socket.io` 握手、`pvp.html` 自检页。
> 全部命令都是**你自己执行**，本文只给顺序与判据。

服务器：`179.255.135.95`，Ubuntu 24.04.4，1 核 / 2 GB，Nginx 已托管静态（`root /var/www/html/war_game/repo`）。

---

## 0. 搞清楚改了哪些东西

| 位置 | 变化 | 是否必须 |
|---|---|---|
| Nginx `/etc/nginx/sites-enabled/default` | 追加 `/api/` 与 `/socket.io/` 两段反代（模板 `deploy/nginx-wargame.conf`） | 必须 |
| 服务器 `/opt/war-game-server` | 拉主仓代码 + 安装依赖 + systemd 常驻（`deploy/war-game.service`） | 必须 |
| 静态目录 `/var/www/html/war_game/repo` | 多了 `pvp.html`（P0 的自检页）+ `server/`、`deploy/` 不进静态目录 | CI 正常发布即可 |
| 端口 | Node 只听 `127.0.0.1:3001`，**不对外开放**；公网只开 80 | — |

---

## 1. Node 22（系统自带的是 v18，不够）

```bash
node -v                                   # 如果已是 v22.12+ 可跳过本节
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v                                   # 期望 v22.x
```

## 2. 取代码（跳过 LFS 大文件）

`.gitattributes` 只把 `png/jpg/mp3/mp4` 划进 LFS，`js/json` 都是普通文件；
服务器跑 PvP 只需要 `server/` + 引擎 `src/` + 关卡/地图 JSON，**不需要 200 MB 视频**：

```bash
sudo useradd --system --home /opt/war-game-server --shell /usr/sbin/nologin wargame || true
sudo mkdir -p /opt/war-game-server && sudo chown wargame:wargame /opt/war-game-server

# 主仓是私有仓库 → 用只读 Deploy Key（GitHub 仓库 Settings → Deploy keys），不要放写权限凭据
sudo -u wargame GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1 \
  https://github.com/BarCodein/War_Game.git /opt/war-game-server

cd /opt/war-game-server
sudo -u wargame npm ci --omit=dev          # 只装运行时依赖（express / socket.io / phaser 等）
```

## 3. 先手工跑一次，确认能起来

```bash
sudo -u wargame env PVP_PORT=3001 node server/src/index.js
# 期望输出：
#   War of Dots · PvP 服务已启动
#   监听 http://127.0.0.1:3001（仅本机）
#   健康检查 GET /api/health
```

另开一个终端：

```bash
curl -s http://127.0.0.1:3001/api/health | head -c 300; echo
```

**判据：** 返回 JSON，包含 `"ok":true`、`"service":"war-of-dots-pvp"`、`"maxRooms":4`、`"snapshotHz":15`、`"accounts":0`、`"node":"v22…"`。
用 `Ctrl+C` 停掉手工进程，确保 3001 端口没有被占用（后面交给 systemd）。

> **数据库在哪**：默认跟随 systemd 的 `StateDirectory=war-game` → `/var/lib/war-game/pvp.db`（首次启动自动建表，
> 迁移版本记在 `meta.schema_version`）。手工前台跑（第 3 步）时因为还没进 systemd，会落到
> `/opt/war-game-server/server/data/pvp.db`；两者互不影响，正式数据以 `/var/lib/war-game/pvp.db` 为准。
> 备份：`sudo cp /var/lib/war-game/pvp.db /root/pvp-backup-$(date +%F).db`；
> 重置（清空所有账号）：`sudo systemctl stop war-game && sudo rm -f /var/lib/war-game/pvp.db* && sudo systemctl start war-game`。

## 4. systemd 常驻

```bash
sudo cp /opt/war-game-server/deploy/war-game.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now war-game
systemctl status war-game --no-pager          # 期望 active (running)
curl -s http://127.0.0.1:3001/api/health | head -c 200; echo
journalctl -u war-game -n 30 --no-pager       # 期望看到 [http] GET /api/health 200
```

## 5. Nginx 反代 + 重载

把 `deploy/nginx-wargame.conf` 里的两段 `location`（`/api/` 与 `/socket.io/`）贴进
`/etc/nginx/sites-enabled/default` 的 `server { … }` 中（放在 `location /` 之前），然后：

```bash
sudo nginx -t                 # 必须 syntax is ok / test is successful
sudo systemctl reload nginx
```

## 6. 从公网验收（这一步才算"链路打通"）

在**任意一台能上网的机器**上：

```bash
# ① REST：应该返回和本机一样的 JSON（说明 /api/ → Node 生效）
curl -s http://179.255.135.95/api/health | head -c 300; echo

# ② WebSocket 握手：应返回 200 且 body 里带 sid（说明 /socket.io/ 反代 + Upgrade 生效）
curl -s -i "http://179.255.135.95/socket.io/?EIO=4&transport=polling" | head -n 12
```

浏览器打开 **`http://179.255.135.95/pvp.html`**：

| 自检页显示 | 含义 |
|---|---|
| REST **正常** + 服务版本(Node)/运行时长/房间 x/4/快照 15 Hz | `/api` 反代通了 |
| WebSocket **已连接**，并在 2 秒内出现 RTT（个位数~几十 ms） | `/socket.io` 反代与 Upgrade 通了 |
| 页面底部「解析出的 WS 地址」= `ws://179.255.135.95/socket.io/` | 同源、无证书、无 CORS |

任一项红叉时按报错定位：`REST 失败` → 查 `systemctl status war-game`、`journalctl -u war-game`、`curl 127.0.0.1:3001`；
`WS 连接失败` → 十有八九是 Nginx 少了 `Upgrade`/`Connection` 头或 `proxy_read_timeout` 太短（见模板注释）。

### 6.1 账号体系（P1b）验收

```bash
# 注册：应返回 201，并下发 HttpOnly + SameSite=Lax 的 wod_session Cookie
curl -s -i -X POST http://179.255.135.95/api/auth/register \
  -H 'content-type: application/json' \
  -d '{"username":"probe_001","password":"probe-password-1"}' | head -n 12

# 未登录访问 me：应返回 401 + UNAUTHENTICATED
curl -s -o /dev/null -w '%{http_code}\n' http://179.255.135.95/api/auth/me

# 登录（带 Cookie 再查 me）：200 + {"ok":true,"user":{...}}
curl -s -c /tmp/wod.txt -X POST http://179.255.135.95/api/auth/login \
  -H 'content-type: application/json' -d '{"username":"probe_001","password":"probe-password-1"}'
curl -s -b /tmp/wod.txt http://179.255.135.95/api/auth/me

# 健康检查里 accounts 应为 1（每注册一个 +1）
curl -s http://179.255.135.95/api/health | head -c 300; echo
```

浏览器打开 `http://179.255.135.95/pvp.html`：账号面板里输入用户名/密码 → 「注册」→ 面板变成「已登录：xxx」，刷新后仍登录；
点「登出」→ 回到未登录；再用同一账号「登录」。错误口令会提示「用户名或密码不正确 [BAD_CREDENTIALS]」。

> 判据一览：注册 201、重复用户名 409、口令 <8 位 400、错口令 401、同一 IP 连错 5 次后 429、登出后 `/me` 401。
> 若这些全对，说明 REST 反代 + SQLite + 会话 Cookie 在生产环境都正常。

### 6.2 房间码匹配（P3）验收

先准备两个账号（浏览器里注册两个，或用 curl），然后：

```bash
# A 建房（用 A 的 Cookie 文件）
curl -s -c /tmp/a.txt -X POST http://179.255.135.95/api/auth/login \
  -H 'content-type: application/json' -d '{"username":"probe_001","password":"probe-password-1"}'
curl -s -b /tmp/a.txt -X POST http://179.255.135.95/api/rooms \
  -H 'content-type: application/json' -d '{"levelId":"dujiang_pvp"}'
# → {"ok":true,"room":{"code":"AB3D7K",...}}   记下 code

# B 用房间码加入（B 先登录）
curl -s -c /tmp/b.txt -X POST http://179.255.135.95/api/auth/login \
  -H 'content-type: application/json' -d '{"username":"probe_002","password":"probe-password-1"}'
curl -s -b /tmp/b.txt -X POST http://179.255.135.95/api/rooms/AB3D7K/join
# → 200 + room.you.faction = "red"

# 错误码抽查
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://179.255.135.95/api/rooms/ZZZZZZ/join -b /tmp/b.txt   # 404
```

浏览器（两个窗口 / 一个无痕）打开 `http://179.255.135.95/pvp.html`：
A 登录 → 「创建房间」→ 页面显示 6 位房间码；B 登录 → 输入房间码 → 「加入房间」→
两端都出现 2 名玩家（蓝方/红方）→ 双方点「准备」→ **3 秒倒计时** → 两端自动跳转到
`pvp-battle.html?room=<码>&level=dujiang_pvp`（对局页）。
若卡在"等待对手加入"→ 检查 B 是否真的加入了（房间满/已开局会提示）；
若准备后不进入倒计时 → 检查 `/socket.io` 反代（`match:state` 推送走 WebSocket）。

### 6.3 对局页（P4）验收

两个窗口都进入对局页后，判据：

| 位置 | 期望 |
|---|---|
| 左上 HUD | `房间 <码> · 蓝方` / `· 红方`；⏱ 倒计时从 10:00 开始；🏳 `城市 8 : 8`；👁 `可见敌军 N`（N 明显小于 16 —— 敌人没全暴露）；`RTT < 200 ms` |
| 右上状态 | `已进入对局（蓝方/红方）`，命令往返后会短暂显示"已下令 N 个单位（往返 X ms）" |
| 画面 | 地图/城市（旗帜颜色=归属）/部队贴图；未见区域是暗的（**客户端本地算迷雾**）；拖动可平移、滚轮缩放 |
| 操作 | 左键点选或框选己方部队（脚下出现选中圈）→ 右键移动 → 该部队开始朝目标移动，**对手那边也能看到它移动**（如果他看得见） |
| 准备阶段 | 中央 5 秒读秒，结束后自动进入计时对局 |
| 结束 | 任一时刻占光对方全部城市或到 10 分钟 → 中央弹窗显示 胜利/失败/平局 + 原因 + 伤亡，可「返回大厅」 |

命令行旁证（对局是否真的在 60Hz 推进、快照是否在发）：

```bash
curl -s http://179.255.135.95/api/health | python3 -c "import json,sys;d=json.load(sys.stdin);print('matches=',d['matches'],'rooms=',d['rooms'])"
# 对局进行中 matches 应为 1
```

> 掉线行为（P5 会做成 30 秒重连窗口）：现在若**双方**都断开，房间会在 `PVP_RECONNECT_SECONDS`（默认 30 秒）
> 后被回收；只断开一方时对局继续推进，对手会看到画面静止。

---

## 7. 本地怎么检验（不碰服务器，两条路）

### 7.1 两个进程（等价线上的 Nginx 反代）

```bash
# 终端 A：Node 服务
npm run server                        # → http://127.0.0.1:3001/api/health

# 终端 B：Vite（已配好 /api 与 /socket.io 的代理，见 vite.config.js）
npm run dev                           # → http://localhost:5173/
```

浏览器打开 **`http://localhost:5173/pvp.html`**，判据同 §6 的表格（WS 地址会显示 `ws://localhost:5173/socket.io/`，因为走 Vite 代理）。
也可以用命令行验证：

```bash
curl -s http://localhost:5173/api/health | head -c 200; echo
curl -s -i "http://localhost:5173/socket.io/?EIO=4&transport=polling" | head -n 6
```

### 7.2 一个进程（最接近生产形态：Node 同时托管静态 + API，不需要 Nginx）

```bash
npm run build                                        # 生成 dist/（含 pvp.html）
PVP_SERVE_STATIC=1 npm run server                    # Windows PowerShell：
                                                     #   $env:PVP_SERVE_STATIC=1; npm run server
# 打开 http://127.0.0.1:3001/pvp.html
```

这条路线之所以值得跑，是因为它和线上**同源结构完全一致**（页面与 `/api`、`/socket.io` 同主机同端口），
能提前排除"跨源、Cookie、路径前缀"这类只有在部署后才暴露的问题。

### 7.3 自动化测试（每次改完代码跑）

```bash
npx vitest run tests/unit/server-link.test.js     # 链路契约（4 条）
npx vitest run tests/unit/server-auth.test.js     # 账号契约（10 条）
npx vitest run tests/unit/pvp-match.test.js tests/unit/pvp-levels.test.js   # 权威对局 + 对称兵力（28 条）
node scripts/pvp-selftest.mjs --seconds 600       # 无头跑一整局，打印 tick 成本与结算
node scripts/pvp-selftest.mjs --seconds 240 --verify   # 重放确定性比对（逐 tick 快照哈希）
```

覆盖：`/api/health` 字段与容量、`/api/*` 未知路径 404 JSON、socket.io 握手 `link:hello`、
`link:ping` 往返 ack、连接数出现在 `/api/health` 里；账号全链路；对局初始化/准备/命令校验/视野/胜负/超时/确定性/性能。

---

## 8. 日常更新（改完代码之后）

```bash
cd /opt/war-game-server
sudo -u wargame GIT_LFS_SKIP_SMUDGE=1 git pull
sudo -u wargame npm ci --omit=dev
sudo systemctl restart war-game
curl -s http://127.0.0.1:3001/api/health | head -c 120; echo
```

若这次改动包含**前端页面**，还要让静态目录更新（CI 构建产物）——按你现有的发布方式发布 `dist` 即可。

---

## 9. 常见问题

| 现象 | 原因 / 处理 |
|---|---|
| `/api/health` 返回 404 HTML | Nginx 没重载，或 `location /api/` 没贴进 `server{}`；`sudo nginx -t` 检查 |
| `/api/health` 502 | Node 没起：`systemctl status war-game`；或 `proxy_pass` 端口与 `PVP_PORT` 不一致 |
| `systemctl start` 失败、日志里有 `EADDRINUSE` | 3001 被之前的**手工 `node server/src/index.js`** 占着：`ss -lntp \| grep 3001` 找到 PID 后 `sudo kill <PID>`，再 `systemctl restart war-game` |
| 注册返回 500 且日志有 `SQLITE_CANTOPEN` | 数据库目录不可写：确认 `StateDirectory=war-game` 生效（`ls -ld /var/lib/war-game` 属主应为 `wargame`） |
| 自检页 REST 正常、WS 一直"连接中→失败" | `location /socket.io/` 少了 `proxy_set_header Upgrade/Connection`，或 `proxy_read_timeout` 太短 |
| `journalctl` 里内存被杀 | 1 核 2 GB：确认没在服务器上跑 `npm run build`；检查 `MemoryMax=1G` 与 `PVP_MAX_ROOMS` |
| `npm ci` 在服务器上很慢/失败 | 只装运行时依赖（`--omit=dev`）；主仓私有则先配好 Deploy Key |

---

## 10. 压测与容量验收（P6）

服务器是 1 核 / 2 GB，容量结论见 `docs/pvp-plan.md` §3.10：**同时最多 4 个对局（8 人）**，第 5 个房间返回 503。
压测脚本在本地跑（也能打线上）：

```bash
# ① 服务器上先把注册限速放宽（压测要注册 2×房间数 个账号）
sudo systemctl stop war-game
sudo env PVP_REGISTER_MAX_PER_HOUR=300 node /opt/war-game-server/server/src/index.js   # 临时前台跑，或改 unit 的 Environment=
# ② 在任意机器上压测（4 房间 × 8 人 × 10 分钟）
node scripts/pvp-load.mjs --server http://179.255.135.95 --rooms 4 --seconds 600 --cmd-hz 3
```

判据（脚本会自己打 ✅/❌）：

| 指标 | 阈值 |
|---|---|
| 活动对局数 | = 建房数（4） |
| 平均 tick | < 2 ms |
| 超预算 tick 占比（>8ms） | < 0.1% |
| 快照速率 | 11–16 Hz |
| RTT | < 300 ms |
| 掉线 | 0 次 |
| 命令 | 全部接受 |
| 第 5 个房间 | 503 `ROOM_LIMIT` |

压测过程中也可以直接看服务器：

```bash
curl -s http://127.0.0.1:3001/api/health | python3 -m json.tool | head -30
# matches=4、sim.tickMsAvg、sim.slowTicks、sim.snapshotsSent
top -b -n1 | head -12        # 看 node 的 CPU%
systemctl status war-game --no-pager
```

### 10.1 验收记录（填这里）

| 日期 | 房间数 | 时长 | 平均 tick | 超预算占比 | 快照 Hz | RTT | CPU% | RSS | 结论 |
|---|---|---|---|---|---|---|---|---|---|
| 2026-10-29（本机） | 4 | 40s | 0.712 ms | 0.053%（5/9392） | 13.4 Hz | 4 ms | — | — | 全部通过 |
| 待填（服务器） | 4 | 600s |  |  |  |  |  |  |  |

### 10.2 日常更新（P6 交付）

```bash
sudo /opt/war-game-server/deploy/update.sh              # 拉代码 + 装依赖 + 重启 + 健康检查
sudo /opt/war-game-server/deploy/update.sh --check-only # 只做健康检查
```

---

## 11. 静态站仓库损坏的恢复（`git status` 显示 No commits yet）

### 11.1 症状与含义

在 `/var/www/html/war_game/repo` 里执行 `git status` 得到：

```
On branch master
No commits yet
Untracked files: ...
```

含义：**这个目录里的 `.git` 是一个空仓库**（没有任何提交、分支还是 `master`），所有页面文件都被当成"未跟踪文件"。
所以 `git pull` 无法工作（它没有可合并的历史），自动更新脚本自然失败；站点还能打开是因为 Nginx 直接读这些文件。

常见成因（按可能性排序）：

1. 更新脚本里写了 `git init` / `git clone`，在失败后用空仓库覆盖了原来的 `.git`；
2. `rsync --delete` 之类的同步把 `.git` 删掉了，脚本再 `git init` 补了一个空仓库；
3. 有人手动改过 `battlebackground.html` / `battlechoose.html` / `ending.html`（旁边有 `*.bak-20261028`），
   `git pull` 因"本地改动会被覆盖"失败，后续步骤把仓库搞成了空仓库。

> 注意：`.bak-20261028` 说明这些文件**在服务器上被手改过**。如果这些改动没有同步回仓库，重新同步会丢掉它们 ——
> 先按 11.2 对一下差异，必要时先把文件备份到 `/root/`。

### 11.2 先诊断（只读，不改任何东西）

```bash
cd /var/www/html/war_game/repo
# ① 现在是谁的 .git、远程是什么
ls -la .git | head -5
cat .git/config
git remote -v
# ② 备份文件与当前文件的差异（如果有手改，会在这里体现）
diff -u battlechoose.html.bak-20261028 battlechoose.html | head -40
diff -u battlebackground.html.bak-20261028 battlebackground.html | head -40
diff -u ending.html.bak-20261028 ending.html | head -40
```

把 `cat .git/config` 的输出留着（看 origin 地址和分支），后面要用。

### 11.3 恢复方案 A（推荐：原地复原，不用重新克隆）

```bash
cd /var/www/html/war_game/repo
# 0) 保险：把当前目录整体备份一份（出问题可以回滚）
sudo cp -a /var/www/html/war_game/repo /root/repo-backup-$(date +%F-%H%M)

# 1) 丢掉损坏的空仓库，换成指向部署仓库的正常仓库（保留工作区文件）
sudo rm -rf .git
sudo -u www-data git init -b main
sudo -u www-data git remote add origin https://github.com/BarCodein/war_game_deploy_repo.git
#   私有仓库请改用（把 TOKEN 换成有 read 权限的 token）：
#   sudo -u www-data git remote set-url origin https://x-access-token:<TOKEN>@github.com/BarCodein/war_game_deploy_repo.git

# 2) 拉远端并让工作区与远端完全一致（会删除远端没有的多余文件，保留 *.bak-*）
sudo -u www-data git fetch --prune --depth 1 origin main
sudo -u www-data git reset --hard origin/main
sudo -u www-data git clean -fdx -e '*.bak-*'

# 3) 校验
sudo -u www-data git log --oneline -1
ls index.html game.html pvp.html pvp-battle.html members/member.html climb/climb.html
curl -sI http://127.0.0.1/ | head -3
```

> 如果 `git fetch` 报 `couldn't find remote ref main`，把 `main` 换成 `master` 再试（部署仓库由 CI 创建，分支名以实际为准）。

### 11.4 恢复方案 B（最干净：整目录换成新克隆）

```bash
cd /var/www/html/war_game
sudo mv repo repo.broken-$(date +%F-%H%M)          # 保留旧目录，随时可回滚
sudo -u www-data git clone --depth 1 https://github.com/BarCodein/war_game_deploy_repo.git repo
#   私有仓库：git clone https://x-access-token:<TOKEN>@github.com/...
sudo chown -R www-data:www-data repo
curl -sI http://127.0.0.1/ | head -3
```

方案 B 会**丢掉服务器上的手改文件**（包括 `*.bak-*`），但它们都还在 `repo.broken-*` 里，需要时拷回去即可。

### 11.5 以后怎么更新（不要再手写 git init/clone）

仓库里已经放了幂等脚本 `deploy/update-static.sh`，它就是为这种场景写的：

```bash
# 只看看会删掉什么（不动手）
sudo ./deploy/update-static.sh --dry-run

# 正式同步（fetch + reset --hard + clean，保留 *.bak-*）
sudo ./deploy/update-static.sh

# 私有仓库 / 首次换远端时指定地址
sudo REMOTE_URL=https://x-access-token:<TOKEN>@github.com/BarCodein/war_game_deploy_repo.git \
     ./deploy/update-static.sh
```

它做的事：自检 `.git`（没有就 `init -b main`）→ 校验 origin → 自动识别 `main`/`master` →
打印将被删除的未跟踪文件 → `reset --hard` + `clean -fdx`（保留 `*.bak-*`）→ 校验关键页面与首页 HTTP。

**建议把它挂到定时任务里**（替代旧的拉取脚本）：

```bash
# 每 5 分钟同步一次静态站
echo '*/5 * * * * root /opt/war-game-server/deploy/update-static.sh >> /var/log/war-game-static.log 2>&1' \
  | sudo tee /etc/cron.d/war-game-static
sudo chmod 644 /etc/cron.d/war-game-static
```

> 若你更希望"CI 一推就生效"，也可以在 GitHub Actions 里加一步 `rsync`/`ssh`（需要部署密钥）；
> 但定时 `update-static.sh` 已经足够，且不需要在 CI 里存 secret。
