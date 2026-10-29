import { afterEach, describe, expect, it } from 'vitest';
import { io as connectClient } from 'socket.io-client';
import { createPvpServer } from '../../server/src/app.js';

// P3 房间码匹配契约：REST（建房/查房/加入/准备/离开）+ Socket（match:state / match:begin）。
// 每个用例独立起一个服务器实例（:memory: 数据库、极短倒计时），互不干扰。
const servers = [];

async function startServer(overrides = {}) {
  const server = createPvpServer({
    quiet: true,
    dbPath: ':memory:',
    roomCountdownMs: 120,
    roomTtlMs: 60_000,
    maxRooms: 8,
    ...overrides,
  });
  const { url } = await server.listen(0, '127.0.0.1');
  servers.push(server);
  return { server, baseUrl: url };
}

afterEach(async () => {
  while (servers.length) {
    const server = servers.pop();
    await server.close().catch(() => {});
  }
});

let seq = 0;
const uniqueName = (prefix) => {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
};

async function registerUser(baseUrl, username = uniqueName('p')) {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'room-password-1' }),
  });
  expect(response.status).toBe(201);
  const cookie = response.headers.getSetCookie()
    .find((item) => item.startsWith('wod_session='))
    .split(';')[0];
  const body = await response.json();
  return { user: body.user, cookie, username };
}

async function api(baseUrl, path, { method = 'GET', body, cookie } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: response.status, json };
}

async function connectSocket(baseUrl, cookie) {
  const socket = connectClient(baseUrl, {
    transports: ['websocket'],
    reconnection: false,
    timeout: 5000,
    extraHeaders: cookie ? { cookie } : {},
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('socket 连接超时')), 5000);
    socket.once('connect', () => { clearTimeout(timer); resolve(); });
    socket.once('connect_error', (error) => { clearTimeout(timer); reject(error); });
  });
  return socket;
}

function emitAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} ack 超时`)), 5000);
    socket.emit(event, payload, (response) => { clearTimeout(timer); resolve(response); });
  });
}

function waitFor(socket, event, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`等 ${event} 超时`)), timeoutMs);
    socket.once(event, (payload) => { clearTimeout(timer); resolve(payload); });
  });
}

describe('房间：REST', () => {
  it('未登录不能建房（401）', async () => {
    const { baseUrl } = await startServer();
    const response = await api(baseUrl, '/api/rooms', { method: 'POST' });
    expect(response.status).toBe(401);
    expect(response.json.code).toBe('UNAUTHENTICATED');
  });

  it('建房返回 6 位码（大写、不含易混字符），房主是 blue', async () => {
    const { baseUrl } = await startServer();
    const alice = await registerUser(baseUrl);
    const created = await api(baseUrl, '/api/rooms', { method: 'POST', cookie: alice.cookie });
    expect(created.status).toBe(201);
    const room = created.json.room;
    expect(room.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(room.state).toBe('waiting');
    expect(room.levelId).toBe('dujiang_pvp');
    expect(room.players).toHaveLength(1);
    expect(room.players[0]).toMatchObject({ id: alice.user.id, faction: 'blue', ready: false });
  });

  it('查房 / 房间不存在 404 / 未知地图 400', async () => {
    const { baseUrl } = await startServer();
    const alice = await registerUser(baseUrl);
    const created = await api(baseUrl, '/api/rooms', { method: 'POST', cookie: alice.cookie });
    const code = created.json.room.code;

    const found = await api(baseUrl, `/api/rooms/${code}`, { cookie: alice.cookie });
    expect(found.status).toBe(200);
    expect(found.json.room.code).toBe(code);

    const missing = await api(baseUrl, '/api/rooms/ZZZZZZ', { cookie: alice.cookie });
    expect(missing.status).toBe(404);
    expect(missing.json.code).toBe('ROOM_NOT_FOUND');

    const badLevel = await api(baseUrl, '/api/rooms', { method: 'POST', cookie: alice.cookie, body: { levelId: 'nope' } });
    expect(badLevel.status).toBe(400);
    expect(badLevel.json.code).toBe('BAD_LEVEL');
  });

  it('加入：客人是 red；重复加入 / 第三人 / 同账号 各自有明确错误码', async () => {
    const { baseUrl } = await startServer();
    const alice = await registerUser(baseUrl);
    const bob = await registerUser(baseUrl);
    const carol = await registerUser(baseUrl);
    const code = (await api(baseUrl, '/api/rooms', { method: 'POST', cookie: alice.cookie })).json.room.code;

    const joined = await api(baseUrl, `/api/rooms/${code}/join`, { method: 'POST', cookie: bob.cookie });
    expect(joined.status).toBe(200);
    expect(joined.json.room.players).toHaveLength(2);
    expect(joined.json.room.you.faction).toBe('red');
    expect(joined.json.room.opponent.faction).toBe('blue');

    const again = await api(baseUrl, `/api/rooms/${code}/join`, { method: 'POST', cookie: bob.cookie });
    expect(again.status).toBe(409);
    expect(again.json.code).toBe('ALREADY_JOINED');

    const full = await api(baseUrl, `/api/rooms/${code}/join`, { method: 'POST', cookie: carol.cookie });
    expect(full.status).toBe(409);
    expect(full.json.code).toBe('ROOM_FULL');
  });

  it('房间数量上限：超过 maxRooms 建房返回 503', async () => {
    const { baseUrl } = await startServer({ maxRooms: 1 });
    const alice = await registerUser(baseUrl);
    const bob = await registerUser(baseUrl);
    expect((await api(baseUrl, '/api/rooms', { method: 'POST', cookie: alice.cookie })).status).toBe(201);
    const blocked = await api(baseUrl, '/api/rooms', { method: 'POST', cookie: bob.cookie });
    expect(blocked.status).toBe(503);
    expect(blocked.json.code).toBe('ROOM_LIMIT');
  });

  it('等待 30 分钟未开局会被 TTL 回收（这里用 50ms 验证）', async () => {
    const { baseUrl } = await startServer({ roomTtlMs: 50 });
    const alice = await registerUser(baseUrl);
    const code = (await api(baseUrl, '/api/rooms', { method: 'POST', cookie: alice.cookie })).json.room.code;
    await new Promise((resolve) => setTimeout(resolve, 500)); // 等 sweep 跑过
    const after = await api(baseUrl, `/api/rooms/${code}`, { cookie: alice.cookie });
    expect(after.status).toBe(404);
  });
});

describe('房间：Socket 状态流转', () => {
  it('双方 ready → countdown → playing，并收到 match:begin（阵营/关卡/准备时长一致）', async () => {
    const { baseUrl } = await startServer();
    const alice = await registerUser(baseUrl);
    const bob = await registerUser(baseUrl);
    const code = (await api(baseUrl, '/api/rooms', { method: 'POST', cookie: alice.cookie })).json.room.code;
    await api(baseUrl, `/api/rooms/${code}/join`, { method: 'POST', cookie: bob.cookie });

    const socketA = await connectSocket(baseUrl, alice.cookie);
    const socketB = await connectSocket(baseUrl, bob.cookie);
    try {
      const joinA = await emitAck(socketA, 'match:join', { roomCode: code });
      const joinB = await emitAck(socketB, 'match:join', { roomCode: code });
      expect(joinA.ok).toBe(true);
      expect(joinB.ok).toBe(true);
      expect(joinA.room.you.faction).toBe('blue');
      expect(joinB.room.you.faction).toBe('red');

      const beginA = waitFor(socketA, 'match:begin');
      const beginB = waitFor(socketB, 'match:begin');

      const readyA = await emitAck(socketA, 'match:ready', { roomCode: code });
      expect(readyA.ok).toBe(true);
      expect(readyA.room.state).toBe('waiting'); // 只有一方 ready 时不倒计时

      const readyB = await emitAck(socketB, 'match:ready', { roomCode: code });
      expect(readyB.ok).toBe(true);
      expect(readyB.room.state).toBe('countdown');

      const [beginForA, beginForB] = await Promise.all([beginA, beginB]);
      expect(beginForA.matchId).toBe(beginForB.matchId);
      expect(beginForA.levelId).toBe('dujiang_pvp');
      expect(beginForA.prepSeconds).toBe(5);
      expect(beginForA.players.map((player) => player.faction).sort()).toEqual(['blue', 'red']);
      expect(beginForA.players.map((player) => player.username).sort())
        .toEqual([alice.username.toLowerCase(), bob.username.toLowerCase()].sort());

      // 开局后 socket 侧再 ready 会被拒
      const late = await emitAck(socketA, 'match:ready', { roomCode: code });
      expect(late.ok).toBe(false);
      expect(late.code).toBe('ROOM_STARTED');
    } finally {
      socketA.disconnect();
      socketB.disconnect();
    }
  });

  it('取消准备会从 countdown 退回 waiting', async () => {
    const { baseUrl } = await startServer({ roomCountdownMs: 10_000 });
    const alice = await registerUser(baseUrl);
    const bob = await registerUser(baseUrl);
    const code = (await api(baseUrl, '/api/rooms', { method: 'POST', cookie: alice.cookie })).json.room.code;
    await api(baseUrl, `/api/rooms/${code}/join`, { method: 'POST', cookie: bob.cookie });

    const socketA = await connectSocket(baseUrl, alice.cookie);
    const socketB = await connectSocket(baseUrl, bob.cookie);
    try {
      await emitAck(socketA, 'match:join', { roomCode: code });
      await emitAck(socketB, 'match:join', { roomCode: code });
      await emitAck(socketA, 'match:ready', { roomCode: code });
      const counting = await emitAck(socketB, 'match:ready', { roomCode: code });
      expect(counting.room.state).toBe('countdown');

      const cancelled = await emitAck(socketB, 'match:ready', { roomCode: code, ready: false });
      expect(cancelled.room.state).toBe('waiting');
      expect(cancelled.room.countdownEndsAt).toBeNull();
    } finally {
      socketA.disconnect();
      socketB.disconnect();
    }
  });

  it('房主离开 → 房间关闭，对手收到 closed 状态', async () => {
    const { baseUrl } = await startServer();
    const alice = await registerUser(baseUrl);
    const bob = await registerUser(baseUrl);
    const code = (await api(baseUrl, '/api/rooms', { method: 'POST', cookie: alice.cookie })).json.room.code;
    await api(baseUrl, `/api/rooms/${code}/join`, { method: 'POST', cookie: bob.cookie });

    const socketB = await connectSocket(baseUrl, bob.cookie);
    try {
      await emitAck(socketB, 'match:join', { roomCode: code });
      const closedState = waitFor(socketB, 'match:state');
      const left = await api(baseUrl, `/api/rooms/${code}/leave`, { method: 'POST', cookie: alice.cookie });
      expect(left.status).toBe(200);

      const state = await closedState;
      expect(state.closed ?? state.state).toBeTruthy();
      expect(state.state === 'finished' || state.closed === true).toBe(true);

      const after = await api(baseUrl, `/api/rooms/${code}`, { cookie: bob.cookie });
      expect(after.status).toBe(404);
    } finally {
      socketB.disconnect();
    }
  });

  it('未登录的 socket 不能进房间；不在房间的人也不能进', async () => {
    const { baseUrl } = await startServer();
    const alice = await registerUser(baseUrl);
    const stranger = await registerUser(baseUrl);
    const code = (await api(baseUrl, '/api/rooms', { method: 'POST', cookie: alice.cookie })).json.room.code;

    const anonymous = await connectSocket(baseUrl, null);
    const strangerSocket = await connectSocket(baseUrl, stranger.cookie);
    try {
      const noAuth = await emitAck(anonymous, 'match:join', { roomCode: code });
      expect(noAuth.ok).toBe(false);
      expect(noAuth.code).toBe('UNAUTHENTICATED');

      const notMember = await emitAck(strangerSocket, 'match:join', { roomCode: code });
      expect(notMember.ok).toBe(false);
      expect(notMember.code).toBe('NOT_IN_ROOM');
    } finally {
      anonymous.disconnect();
      strangerSocket.disconnect();
    }
  });
});
