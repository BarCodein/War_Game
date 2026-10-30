import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// PvP 服务端配置。全部可用环境变量覆盖（systemd 里设 Environment= 即可）。
// 这台服务器是 **1 核 / 2 GB**（见 docs/pvp-plan.md §3.10），默认值按容量实测结果给：
//   · maxRooms = 4（4 个并发对局 = 8 人），超过时建房接口返回 503
//   · snapshotHz = 15（客户端 100ms 插值缓冲）
const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');

function readVersion() {
  try {
    return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const number = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/**
 * SQLite 文件位置，优先级：
 *   1. PVP_DB（显式指定，测试用 ':memory:'）
 *   2. systemd 的 StateDirectory=war-game → 环境变量 $STATE_DIRECTORY === '/var/lib/war-game'
 *   3. 仓库内 server/data/pvp.db（本地开发；已被 .gitignore 忽略）
 */
function resolveDbPath() {
  if (process.env.PVP_DB) return process.env.PVP_DB;
  const stateDir = process.env.STATE_DIRECTORY?.trim();
  if (stateDir) return join(stateDir, 'pvp.db');
  return join(root, 'server', 'data', 'pvp.db');
}

export const config = {
  // 只监听本机，由 Nginx（80 端口）反代 /api 与 /socket.io；不要直接对公网开这个端口
  host: process.env.PVP_HOST ?? '127.0.0.1',
  port: number(process.env.PVP_PORT, 3001),
  version: readVersion(),
  snapshotHz: number(process.env.PVP_SNAPSHOT_HZ, 15),
  maxRooms: number(process.env.PVP_MAX_ROOMS, 4),
  // 本地"生产形态"自检用：PVP_SERVE_STATIC=1 时由 Node 自己托管 dist，
  // 这样不用 Nginx 也能验证"同源 + /api + WebSocket"整条链路（线上仍由 Nginx 托管静态）
  serveStatic: process.env.PVP_SERVE_STATIC === '1',
  staticDir: resolve(root, 'dist'),

  // ---- 账号体系（P1b）----
  dbPath: resolveDbPath(),
  sessionCookie: 'wod_session',
  sessionTtlMs: number(process.env.PVP_SESSION_HOURS, 24 * 7) * 60 * 60 * 1000, // 默认 7 天
  // 登录失败限速：同一 IP 5 次 / 分钟（成功即清零）。scrypt 单次 ~40ms，限速是防爆破也是防打满 1 核
  loginMaxFailures: number(process.env.PVP_LOGIN_MAX_FAILURES, 5),
  loginWindowMs: number(process.env.PVP_LOGIN_WINDOW_MINUTES, 1) * 60 * 1000,
  // 注册限速：同一 IP 每小时 10 次
  registerMaxPerHour: number(process.env.PVP_REGISTER_MAX_PER_HOUR, 10),

  // ---- 房间码匹配（P3）----
  // 房间码 30 分钟有效（只在"等待开局"阶段计时，开局后由对局自己管时长）
  roomTtlMs: number(process.env.PVP_ROOM_TTL_MINUTES, 30) * 60 * 1000,
  // 双方 ready 后的倒计时（之后创建对局；对局内还有 values.prep.seconds 的准备阶段）
  roomCountdownMs: number(process.env.PVP_ROOM_COUNTDOWN_SECONDS, 3) * 1000,
  // 对局时长上限（到点按城市数 → 总血量判胜）
  matchTimeLimitMs: number(process.env.PVP_MATCH_MINUTES, 10) * 60 * 1000,
  // 房间里一个人都不剩时的宽限（P5 用它做 30s 重连窗口；从大厅跳到对局页也有 1s 左右空档）
  disconnectGraceMs: number(process.env.PVP_RECONNECT_SECONDS, 30) * 1000,
  // 掉线播报的"静默期"：短暂闪断（例如大厅→对局页的页面跳转）不打扰对手
  disconnectNoticeMs: number(process.env.PVP_DISCONNECT_NOTICE_SECONDS, 1.5) * 1000,
  // 迷雾归属（2026-10-30 精调）：
  //   'client'（默认）→ 快照下发全部存活单位，客户端本地算迷雾（表现完整、可调参；**无防透视**，带宽约 +20%）
  //   'server'        → 服务器只下发目视到的敌军（防透视；客户端拿不到未目视敌军坐标）
  fogAuthority: process.env.PVP_FOG_AUTHORITY === 'server' ? 'server' : 'client',
  // 派生数据校正包（方案 B，见 docs/pvp-derive-draft.md）：控制线/补给线由客户端本地算，
  // 服务器每隔 deriveSyncMs 发一份最小校正数据（0 = 关闭该通道，客户端将只显示本地线）
  deriveSyncMs: number(process.env.PVP_DERIVE_SYNC_MS, 3) * 1000,
  // 控制线折线抽样步长（越小越精确、越大越省流量）
  deriveLod: number(process.env.PVP_DERIVE_LOD, 2),
  // 行军路线下发（docs/pvp-plan.md §11.15）：默认开；`PVP_SEND_ROUTES=0` 一键关闭
  // （客户端会自动退回"预计路线"模式，便于线上出问题时降级）
  sendRoutes: process.env.PVP_SEND_ROUTES !== '0',
  // 可选择的对战地图（对称兵力模板，见 public/assets/pvp/）
  pvpLevels: String(process.env.PVP_LEVELS ?? 'dujiang_pvp,pingjin_pvp')
    .split(',').map((item) => item.trim()).filter(Boolean),
};
