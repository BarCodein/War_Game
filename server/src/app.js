import express from 'express';
import { createServer as createHttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Server as SocketServer } from 'socket.io';
import { values } from '../../src/config/index.js';
import { config as defaultConfig } from './config.js';
import { createDb, countUsers, purgeExpiredSessions } from './db.js';
import { findSessionUser, readCookie } from './auth.js';
import { createAuthRouter } from './routes/auth.js';
import { createRoomRouter } from './routes/rooms.js';
import { RoomError, RoomRegistry, normalizeCode, roomView } from './rooms.js';
import { loadPvpLevel } from './levels.js';
import { MatchSim, warmupEngine } from './match.js';

// PvP 服务端。
//   · REST  GET  /api/health                —— 给 Nginx / 监控 / 自检页用
//   · REST  /api/auth/*                     —— 注册 / 登录 / 登出 / me（P1b）
//   · REST  /api/rooms/*                    —— 建房 / 查房 / 加入 / 准备 / 离开（P3）
//   · WS    /socket.io                     —— link:* 自检 + match:* 房间状态与对局（P3/P4）
//
// 重要：本模块**不自动 listen**（导入无副作用），
//   · 生产入口：server/src/index.js 里 listen
//   · 单测：createPvpServer({ dbPath: ':memory:' }) 后自己 listen(0) 再 fetch/连 socket
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

  const httpServer = createHttpServer(app);
  const io = new SocketServer(httpServer, {
    serveClient: true,                    // 提供 /socket.io/socket.io.js
    // 同源部署（O1）：不需要 CORS；这里显式关掉跨源，避免被别的站点白嫖
    cors: { origin: false },
    pingInterval: 20000,
    pingTimeout: 25000,
    maxHttpBufferSize: 64 * 1024,         // 命令很小，别让人塞大包
  });

  const roomChannel = (code) => `room:${code}`;

  // 房间管理器：开局时在这里创建权威对局（P4 再接 60Hz 驱动与快照广播）
  const rooms = new RoomRegistry({
    config,
    onBegin: (room) => {
      const { level, map } = loadPvpLevel(room.levelId);
      warmupEngine({ level, map, ticks: 60 });   // 抹掉首帧 JIT 尖峰（docs/pvp-plan.md §3.10）
      const match = new MatchSim({ level, map, timeLimitMs: config.matchTimeLimitMs });
      match.start(Date.now());
      return { matchId: randomUUID(), match };
    },
    onStateChange: (room) => emitState(room),
    onForfeit: (room, userId) => {
      const quitter = room.players.find((player) => player.id === userId);
      const winner = quitter?.faction === 'blue' ? 'red' : 'blue';
      io.to(roomChannel(room.code)).emit('match:end', { winner, reason: 'forfeit' });
    },
  });

  function emitState(room) {
    if (!room) return;
    if (room.state === 'finished') {
      io.to(roomChannel(room.code)).emit('match:state', {
        ...roomView(room, null),
        serverNow: Date.now(),
        closed: true,
        reason: room.reason ?? null,
      });
      return;
    }
    io.to(roomChannel(room.code)).emit('match:state', { ...roomView(room, null), serverNow: Date.now() });
    if (room.state === 'playing' && !room.beginEmitted) {
      room.beginEmitted = true;
      io.to(roomChannel(room.code)).emit('match:begin', {
        matchId: room.matchId,
        levelId: room.levelId,
        prepSeconds: values.prep.seconds,
        serverTime: Date.now(),
        players: room.players.map((player) => ({
          userId: player.id, username: player.username, displayName: player.displayName, faction: player.faction,
        })),
      });
    }
  }

  const health = () => ({
    ok: true,
    service: 'war-of-dots-pvp',
    version: config.version,
    node: process.version,
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    rooms: rooms.size(),
    activeRooms: rooms.countActive(),
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
  app.use('/api/rooms', createRoomRouter({ db, config, rooms }));

  // /api 下的其它路径统一 404（而不是掉进静态文件回退）
  app.use('/api', (req, res) => {
    res.status(404).json({ ok: false, code: 'NOT_FOUND', message: `接口不存在：${req.originalUrl}` });
  });

  // 本地"生产形态"自检：PVP_SERVE_STATIC=1 时由 Node 托管构建产物（线上由 Nginx 托管）
  if (config.serveStatic) {
    app.use(express.static(config.staticDir, { extensions: ['html'] }));
    app.get('/', (req, res) => res.redirect('/pvp.html'));
  }

  io.on('connection', (socket) => {
    const user = findSessionUser(db, readCookie(socket.handshake.headers.cookie, config.sessionCookie));
    socket.data.user = user;
    if (!config.quiet) console.log(`[ws] connected ${socket.id}${user ? ` (user ${user.id})` : ''}`);

    socket.emit('link:hello', {
      ok: true,
      version: config.version,
      node: process.version,
      serverTime: Date.now(),
      snapshotHz: config.snapshotHz,
      maxRooms: config.maxRooms,
      authenticated: Boolean(user),
    });

    // 自检用的往返：客户端 emit('link:ping', {t}) → ack({t, serverTime})，RTT 由客户端算
    socket.on('link:ping', (payload, ack) => {
      const echoed = { t: payload?.t ?? null, serverTime: Date.now(), ok: true };
      if (typeof ack === 'function') ack(echoed);
      else socket.emit('link:pong', echoed);
    });

    const requireAuth = () => {
      if (!socket.data.user) throw new RoomError('UNAUTHENTICATED', '请先登录', 401);
      return socket.data.user;
    };

    // 进入房间频道（REST 加入成功后调用；已加入者重连也走这里）
    socket.on('match:join', (payload, ack) => {
      try {
        const me = requireAuth();
        const code = normalizeCode(payload?.roomCode);
        const room = rooms.require(code);
        if (!rooms.playerOf(room, me.id)) throw new RoomError('NOT_IN_ROOM', '你不在这个房间里', 409);
        socket.join(roomChannel(code));
        socket.data.roomCode = code;
        ack?.({ ok: true, room: roomView(room, me.id) });
        emitState(room);
      } catch (error) {
        replyError(socket, ack, error);
      }
    });

    socket.on('match:ready', (payload, ack) => {
      try {
        const me = requireAuth();
        const code = normalizeCode(payload?.roomCode ?? socket.data.roomCode);
        const room = rooms.setReady({ code, userId: me.id, ready: payload?.ready !== false });
        ack?.({ ok: true, room: roomView(room, me.id) });
      } catch (error) {
        replyError(socket, ack, error);
      }
    });

    socket.on('match:leave', (payload, ack) => {
      try {
        const me = requireAuth();
        const code = normalizeCode(payload?.roomCode ?? socket.data.roomCode);
        const result = rooms.leave({ code, userId: me.id });
        socket.leave(roomChannel(code));
        if (socket.data.roomCode === code) socket.data.roomCode = null;
        ack?.({ ok: true, closed: result.closed });
        if (result.room.players.length) emitState(result.room);
      } catch (error) {
        replyError(socket, ack, error);
      }
    });

    socket.on('disconnect', (reason) => {
      if (!config.quiet) console.log(`[ws] disconnected ${socket.id} (${reason})`);
      // P5 会在这里开启 30s 重连窗口；P3 只记录（房间座位保留，等待对手重连）
    });
  });

  // 只对 HTTP 握手做一些基础防护（Nginx 已做限流；这里兜底超大 cookie 头）
  httpServer.on('clientError', (error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });

  rooms.start();

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
    rooms,
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
      rooms.stop();
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

function replyError(socket, ack, error) {
  const payload = error instanceof RoomError
    ? { ok: false, code: error.code, message: error.message }
    : { ok: false, code: 'INTERNAL', message: '服务器内部错误' };
  if (!(error instanceof RoomError)) console.error('[ws] 未预期错误:', error);
  if (typeof ack === 'function') ack(payload);
  else socket.emit('error', payload);
}
