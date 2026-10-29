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
};
