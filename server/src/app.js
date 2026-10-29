import express from 'express';
import { createServer as createHttpServer } from 'node:http';
import { Server as SocketServer } from 'socket.io';
import { config as defaultConfig } from './config.js';
import { createDb, countUsers, purgeExpiredSessions } from './db.js';
import { createAuthRouter } from './routes/auth.js';

// PvP 服务端。
//   · REST  GET  /api/health          —— 给 Nginx / 监控 / 自检页用
//   · REST  /api/auth/*               —— 注册 / 登录 / 登出 / me（P1b）
//   · WS    /socket.io                —— 自检用 link:hello / link:ping（对局事件在 P3/P4 加）
//
// 重要：本模块**不自动 listen**（导入无副作用），
//   · 生产入口：server/src/index.js 里 listen
//   · 单测：createPvpServer({ dbPath: ':memory:' }) 后自己 listen(0) 再 fetch
export function createPvpServer(overrides = {}) {
  const config = { ...defaultConfig, ...overrides };
  const startedAt = Date.now();
  const db = overrides.db ?? createDb(config.dbPath);
  const ownsDb = !overrides.db;

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' })); // 指挥命令很小；给个上限防滥用

  // 请求日志：生产环境由 journald 收（systemd），本地直接打在终端
  app.use((req, res, next) => {
    const begin = Date.now();
    res.on('finish', () => {
      if (config.quiet) return;
      console.log(`[http] ${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - begin}ms`);
    });
    next();
  });

  const health = () => ({
    ok: true,
    service: 'war-of-dots-pvp',
    version: config.version,
    node: process.version,
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    rooms: 0,                     // 房间管理器接入后改成真实值（P3）
    maxRooms: config.maxRooms,
    snapshotHz: config.snapshotHz,
    accounts: countUsers(db),     // 注册用户数（运维可观测，不含任何敏感字段）
    socketClients: io?.engine?.clientsCount ?? 0,
    time: new Date().toISOString(),
  });

  app.get('/api/health', (req, res) => {
    res.json(health());
  });

  app.use('/api/auth', createAuthRouter({ db, config }));

  // /api 下的其它路径统一 404（而不是掉进静态文件回退）
  app.use('/api', (req, res) => {
    res.status(404).json({ ok: false, code: 'NOT_FOUND', message: `接口不存在：${req.originalUrl}` });
  });

  // 本地"生产形态"自检：PVP_SERVE_STATIC=1 时由 Node 托管构建产物（线上由 Nginx 托管）
  if (config.serveStatic) {
    app.use(express.static(config.staticDir, { extensions: ['html'] }));
    app.get('/', (req, res) => res.redirect('/pvp.html'));
  }

  const httpServer = createHttpServer(app);
  const io = new SocketServer(httpServer, {
    serveClient: true,                    // 提供 /socket.io/socket.io.js
    // 同源部署（O1）：不需要 CORS；这里显式关掉跨源，避免被别的站点白嫖
    cors: { origin: false },
    pingInterval: 20000,
    pingTimeout: 25000,
    maxHttpBufferSize: 64 * 1024,         // 命令很小，别让人塞大包
  });

  io.on('connection', (socket) => {
    if (!config.quiet) console.log(`[ws] connected ${socket.id}`);
    socket.emit('link:hello', {
      ok: true,
      version: config.version,
      node: process.version,
      serverTime: Date.now(),
      snapshotHz: config.snapshotHz,
      maxRooms: config.maxRooms,
    });

    // 自检用的往返：客户端 emit('link:ping', {t}) → ack({t, serverTime})，RTT 由客户端算
    socket.on('link:ping', (payload, ack) => {
      const echoed = { t: payload?.t ?? null, serverTime: Date.now(), ok: true };
      if (typeof ack === 'function') ack(echoed);
      else socket.emit('link:pong', echoed);
    });

    socket.on('disconnect', (reason) => {
      if (!config.quiet) console.log(`[ws] disconnected ${socket.id} (${reason})`);
    });
  });

  // 每小时清一次过期会话（1 核机器上这点开销可忽略）
  const sweep = setInterval(() => {
    try {
      purgeExpiredSessions(db);
    } catch (error) {
      console.error('[db] purgeExpiredSessions failed:', error.message);
    }
  }, 60 * 60 * 1000);
  sweep.unref?.();

  return {
    app,
    httpServer,
    io,
    db,
    config,
    health,
    /** 显式启动；返回真实地址（端口 0 时可用于测试） */
    listen(port = config.port, host = config.host) {
      return new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(port, host, () => {
          httpServer.off('error', reject);
          const address = httpServer.address();
          resolve({
            port: address.port,
            host: address.address,
            url: `http://${host}:${address.port}`,
          });
        });
      });
    },
    close() {
      clearInterval(sweep);
      return new Promise((resolve) => {
        io.close(() => {
          httpServer.close(() => {
            if (ownsDb) db.close();
            resolve();
          });
        });
      });
    },
  };
}
