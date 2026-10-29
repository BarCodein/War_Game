import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { io as connectClient } from 'socket.io-client';
import { createPvpServer } from '../../server/src/app.js';

// PvP 第一阶段：**链路契约**。
// 这一层只守"浏览器/运维能不能连上服务"，不涉及对局：
//   1. GET /api/health             → REST 链路（Nginx/Vite 反代的 /api 前缀）
//   2. GET /api/<不存在>            → 404 + JSON 错误码（不要掉进静态回退）
//   3. socket.io 握手 + link:hello  → WebSocket 链路（Nginx 的 Upgrade 反代）
//   4. link:ping 往返 ack          → 事件通道可用（对局命令走同一条通道）
// 服务端模块导入不监听端口（见 server/src/app.js 顶部注释），所以这里可以随意 listen(0)。
let server;
let baseUrl;

beforeAll(async () => {
  server = createPvpServer({ quiet: true, port: 0 });
  const { url } = await server.listen(0, '127.0.0.1');
  baseUrl = url;
});

afterAll(async () => {
  await server?.close();
});

describe('PvP 链路：REST', () => {
  it('GET /api/health 返回服务信息与容量各项', async () => {
    const response = await fetch(`${baseUrl}/api/health`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    const body = await response.json();
    expect(body).toMatchObject({
      ok: true,
      service: 'war-of-dots-pvp',
      maxRooms: 4,       // 1 核 / 2 GB 的容量上限（docs/pvp-plan.md §3.10）
      snapshotHz: 15,
    });
    expect(typeof body.version).toBe('string');
    expect(body.node).toMatch(/^v\d+/);
    expect(Number.isFinite(body.uptimeSeconds)).toBe(true);
    // P6：容量观测字段（压测脚本 scripts/pvp-load.mjs 据此判定 1 核是否够用）
    expect(body.sim).toMatchObject({ matches: expect.any(Number), snapshotsSent: expect.any(Number) });
    expect(Number.isFinite(body.sim.tickMsAvg)).toBe(true);
    expect(Number.isFinite(body.reconnectGraceSeconds)).toBe(true);
  });

  it('/api 下的未知路径给出 404 JSON（而不是 HTML 或静态回退）', async () => {
    const response = await fetch(`${baseUrl}/api/does-not-exist`);
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.code).toBe('NOT_FOUND');
  });
});

describe('PvP 链路：WebSocket', () => {
  it('socket.io 能连上，收到 link:hello 并能 ping-pong', async () => {
    const socket = connectClient(baseUrl, {
      transports: ['websocket'],
      reconnection: false,
      timeout: 5000,
    });

    const hello = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('5s 内没收到 link:hello')), 5000);
      socket.once('link:hello', (payload) => {
        clearTimeout(timer);
        resolve(payload);
      });
      socket.once('connect_error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });

    expect(hello.ok).toBe(true);
    expect(typeof hello.version).toBe('string');
    expect(hello.snapshotHz).toBe(15);
    expect(Number.isFinite(hello.serverTime)).toBe(true);

    // ping-pong（对局命令以后走同一个通道）
    const ack = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('ping 3s 内没有 ack')), 3000);
      socket.emit('link:ping', { t: Date.now() }, (payload) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });
    expect(ack.ok).toBe(true);
    expect(Number.isFinite(ack.serverTime)).toBe(true);

    socket.disconnect();
  });

  it('连接数会反映在 /api/health 里（运维可见）', async () => {
    const socket = connectClient(baseUrl, { transports: ['websocket'], reconnection: false });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('连接超时')), 5000);
      socket.once('connect', () => { clearTimeout(timer); resolve(); });
      socket.once('connect_error', (error) => { clearTimeout(timer); reject(error); });
    });

    // engine 的连接计数是异步更新的，给它一点点时间
    let clients = 0;
    for (let i = 0; i < 20; i += 1) {
      const body = await (await fetch(`${baseUrl}/api/health`)).json();
      clients = body.socketClients;
      if (clients >= 1) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(clients).toBeGreaterThanOrEqual(1);
    socket.disconnect();
  });
});
