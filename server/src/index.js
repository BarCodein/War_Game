import { createPvpServer } from './app.js';

// PvP 服务端进程入口。
// 生产：systemd 常驻（deploy/war-game.service），只监听 127.0.0.1，由 Nginx 反代 /api 与 /socket.io。
// 本地：npm run server                        → http://127.0.0.1:3001/api/health
// 本地"生产形态"（同源单进程，不需要 Nginx）：PVP_SERVE_STATIC=1 npm run server → http://127.0.0.1:3001/pvp.html
const server = createPvpServer();

const address = await server.listen();
const { config } = server;

console.log('──────────────────────────────────────────────');
console.log(` War of Dots · PvP 服务已启动  v${config.version}`);
console.log(`   监听      http://${address.host}:${address.port}（仅本机）`);
console.log(`   健康检查  GET  /api/health`);
console.log(`   WebSocket /socket.io/（socket.io 4.x）`);
console.log(`   容量上限  最多 ${config.maxRooms} 个并发对局 · 快照 ${config.snapshotHz} Hz`);
if (config.serveStatic) {
  console.log(`   静态托管  已开启（PVP_SERVE_STATIC=1）→ http://127.0.0.1:${address.port}/pvp.html`);
} else {
  console.log(`   静态托管  关闭（线上由 Nginx 托管 dist）`);
}
console.log(`   自检      curl -s http://127.0.0.1:${address.port}/api/health`);
console.log('──────────────────────────────────────────────');

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] ${signal} → 正在关闭…`);
  try {
    await server.close();
  } finally {
    process.exit(0);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
