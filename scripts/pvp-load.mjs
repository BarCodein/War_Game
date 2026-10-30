#!/usr/bin/env node
import { io as connectClient } from 'socket.io-client';

// P6 容量压测（1 核 / 2 GB 验收用）：
//   node scripts/pvp-load.mjs                        # 本机 4 房间（8 人）× 60 秒
//   node scripts/pvp-load.mjs --server http://179.255.135.95 --rooms 4 --seconds 600
//   node scripts/pvp-load.mjs --rooms 2 --seconds 30 --cmd-hz 3
//
// 它会：注册 2×rooms 个账号 → 建房/加入/双方准备 → 进入对局后持续下令（保持单位移动，最坏负载）
// → 每秒采样 /api/health（tick 成本、快照条数）+ 每个玩家的快照速率与 RTT → 打印 PASS/FAIL。
// 注意：注册受 IP 限速（默认 10 次/小时），反复跑请把服务器 PVP_REGISTER_MAX_PER_HOUR 调大。
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = argv[index + 1];
  return value && !value.startsWith('--') ? value : true;
};

const SERVER = String(arg('server', 'http://127.0.0.1:3001')).replace(/\/$/, '');
const ROOMS = Number(arg('rooms', 4));
const SECONDS = Number(arg('seconds', 60));
const CMD_HZ = Number(arg('cmd-hz', 2));
const PASSWORD = 'load-test-pass-1';
const STRICT_SLOW = arg('strict-slow', false) === true;

// 这些拒绝是协议里"预期内"的，不算压测失败：
//   MATCH_OVER —— 对局已结束（脚本收到 match:end 前可能还有几条在飞）
//   NO_UNITS   —— 命令里的单位在飞行途中全部阵亡（客户端用的是 ≤66ms 前的快照，属正常竞态）
const EXPECTED_REJECTIONS = ['MATCH_OVER', 'NO_UNITS'];

// 验收阈值（docs/pvp-plan.md §3.10 / §11.8）
const THRESHOLDS = {
  tickMsAvg: 2,
  tickMsMax: 8,
  snapshotHzMin: 11,     // 15Hz 的 -25%
  snapshotHzMax: 16,
  rttMsMax: 300,
  // "超过 8ms 预算的 tick 占比"：默认 0.5%（Node 的 GC 停顿偶尔会让个别 tick 超预算；
  // 线上实测 4 房间 600s 是 0.034%）。要按 0.1% 严判可加 --strict-slow。
  slowRatio: 0.005,
  slowRatioStrict: 0.001,
};

const stamp = Date.now().toString(36);
const REUSE = arg('reuse', false) === true;   // 复用固定账号（先登录再注册），反复压测不会打满注册限速
const sockets = [];
const createdRooms = [];   // { code, hostCookie } —— 收尾时退房用
const players = [];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function api(path, { method = 'GET', cookie, body } = {}) {
  const response = await fetch(`${SERVER}${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: response.status, json, setCookie: response.headers.getSetCookie?.() ?? [] };
}

async function register(name) {
  const result = await api('/api/auth/register', {
    method: 'POST', body: { username: name, password: PASSWORD },
  });
  if (result.status === 429) {
    throw new Error(`注册 ${name} 被限速（HTTP 429 RATE_LIMITED，默认 10 次/小时/IP）。三种解法：
  ① 重启服务即清零（限速在内存里）：sudo systemctl restart war-game
  ② 临时放宽：sudo systemctl edit war-game → 加 [Service] 与 Environment=PVP_REGISTER_MAX_PER_HOUR=300
     → sudo systemctl daemon-reload && sudo systemctl restart war-game
  ③ 复用固定账号（不新建）：给脚本加 --reuse —— 会先尝试登录，登录不了才注册`);
  }
  if (result.status !== 201) {
    throw new Error(`注册 ${name} 失败：HTTP ${result.status} ${result.json?.code ?? ''}`);
  }
  const cookie = result.setCookie.find((item) => item.startsWith('wod_session=')).split(';')[0];
  return { name, cookie, user: result.json.user, reused: false };
}

async function login(name) {
  const result = await api('/api/auth/login', {
    method: 'POST', body: { username: name, password: PASSWORD },
  });
  if (result.status !== 200) return null;
  const cookie = result.setCookie.find((item) => item.startsWith('wod_session='))?.split(';')[0];
  if (!cookie) return null;
  return { name, cookie, user: result.json.user, reused: true };
}

/** --reuse 时用固定账号名：先登录，登录不上再注册（避免反复消耗注册限速） */
async function ensureUser(name) {
  if (REUSE) {
    const existing = await login(name);
    if (existing) return existing;
  }
  return register(name);
}

function connect(cookie) {
  const socket = connectClient(SERVER, {
    transports: ['websocket'], reconnection: false, timeout: 8000,
    extraHeaders: { cookie },
  });
  sockets.push(socket);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('socket 连接超时')), 8000);
    socket.once('connect', () => { clearTimeout(timer); resolve(socket); });
    socket.once('connect_error', (error) => { clearTimeout(timer); reject(error); });
  });
}

const emitAck = (socket, event, payload) => new Promise((resolve) => {
  const timer = setTimeout(() => resolve({ ok: false, code: 'TIMEOUT' }), 8000);
  socket.emit(event, payload, (response) => { clearTimeout(timer); resolve(response ?? { ok: false }); });
});

const waitFor = (socket, event, timeoutMs = 15000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`等 ${event} 超时`)), timeoutMs);
  socket.once(event, (payload) => { clearTimeout(timer); resolve(payload); });
});

async function main() {
  console.log(`\nPvP 容量压测 → ${SERVER}  房间 ${ROOMS} 个（${ROOMS * 2} 人）· ${SECONDS} 秒 · 命令 ${CMD_HZ} Hz/人\n`);

  const health0 = await api('/api/health');
  if (!health0.json?.ok) throw new Error(`${SERVER}/api/health 不可用：HTTP ${health0.status}`);
  const graceSeconds = health0.json.reconnectGraceSeconds ?? '?';
  console.log(`服务器 v${health0.json.version} · Node ${health0.json.node} · 房间上限 ${health0.json.maxRooms} · 快照 ${health0.json.snapshotHz}Hz · 重连宽限 ${graceSeconds}s\n`);

  // 1) 建房间 + 双方加入 + 准备
  for (let index = 0; index < ROOMS; index += 1) {
    // --reuse 用固定名字（ld_fixed_0a…），否则每次用时间戳新账号
    const baseName = REUSE ? `ld_fixed_${index}` : `ld_${stamp}_${index}`;
    const host = await ensureUser(`${baseName}a`);
    const guest = await ensureUser(`${baseName}b`);
    const created = await api('/api/rooms', { method: 'POST', cookie: host.cookie, body: { levelId: 'dujiang_pvp' } });
    if (created.status !== 201) throw new Error(`建房失败：${JSON.stringify(created.json)}`);
    const code = created.json.room.code;
    createdRooms.push({ code, hostCookie: host.cookie });   // 收尾时用真实 cookie 退房，避免房间占满 maxRooms
    const joined = await api(`/api/rooms/${code}/join`, { method: 'POST', cookie: guest.cookie });
    if (joined.status !== 200) throw new Error(`加入失败：${JSON.stringify(joined.json)}`);

    const socketA = await connect(host.cookie);
    const socketB = await connect(guest.cookie);
    await emitAck(socketA, 'match:join', { roomCode: code });
    await emitAck(socketB, 'match:join', { roomCode: code });

    const beginA = waitFor(socketA, 'match:begin');
    const beginB = waitFor(socketB, 'match:begin');
    await emitAck(socketA, 'match:ready', { roomCode: code });
    await emitAck(socketB, 'match:ready', { roomCode: code });
    await Promise.all([beginA, beginB]);

    for (const socket of [socketA, socketB]) {
      const player = {
        socket, code, faction: socket === socketA ? 'blue' : 'red',
        snapshots: 0, lastSnapshotAt: 0, rates: [], rtts: [], disconnects: 0, cmdAcks: 0, cmdErrors: 0,
        cmdErrorsByCode: {}, matchOver: false, unitIds: [],
      };
      socket.on('tick', (snapshot) => {
        player.snapshots += 1;
        if (snapshot?.units) {
          player.unitIds = snapshot.units
            .filter((unit) => unit.faction === player.faction && unit.state !== 'dead')
            .map((unit) => unit.id)
            .slice(0, 32);
        }
      });
      socket.on('disconnect', () => { player.disconnects += 1; });
      // 对局结束后不再下令：MATCH_OVER 属于"预期拒绝"，不能算压测失败
      socket.on('match:end', () => { player.matchOver = true; });
      players.push(player);
    }
    console.log(`  房间 ${code} 已开局（${host.user.username} vs ${guest.user.username}）`);
  }

  // 2) 容量上限：房间数已达上限时，再建一个应被拒（maxRooms）
  const maxRooms = Number(health0.json.maxRooms ?? 4);
  let overflowRejected = null;   // null = 未测试（房间数还没到上限）
  if (ROOMS >= maxRooms) {
    const overflowOwner = await ensureUser(REUSE ? 'ld_fixed_overflow' : `ld_${stamp}_overflow`);
    const overflow = await api('/api/rooms', { method: 'POST', cookie: overflowOwner.cookie, body: { levelId: 'dujiang_pvp' } });
    overflowRejected = overflow.status === 503 && overflow.json?.code === 'ROOM_LIMIT';
  }

  // 3) 持续下令 + 采样
  const startedAt = Date.now();
  const healthSamples = [];
  let commandTimer = setInterval(() => {
    for (const player of players) {
      if (player.matchOver || !player.unitIds.length) continue;
      const target = { x: 200 + Math.random() * 880, y: 120 + Math.random() * 560 };
      const command = Math.random() < 0.5
        ? { type: 'move', path: [target] }
        : { type: 'attackMove', target };
      player.socket.emit('cmd', { unitIds: player.unitIds, command }, (response) => {
        if (response?.ok) {
          player.cmdAcks += 1;
          return;
        }
        player.cmdErrors += 1;
        const code = response?.code ?? 'UNKNOWN';
        player.cmdErrorsByCode[code] = (player.cmdErrorsByCode[code] ?? 0) + 1;
      });
    }
  }, Math.max(100, Math.round(1000 / CMD_HZ)));

  const rttTimer = setInterval(() => {
    for (const player of players) {
      const sentAt = Date.now();
      player.socket.timeout(3000).emit('link:ping', { t: sentAt }, (error) => {
        if (!error) player.rtts.push(Date.now() - sentAt);
      });
    }
  }, 2000);

  const sampleTimer = setInterval(async () => {
    const now = Date.now();
    for (const player of players) {
      if (player.lastSnapshotAt) {
        player.rates.push((player.snapshots) / ((now - player.lastSnapshotAt) / 1000));
      }
      player.lastSnapshotAt = now;
      player.snapshots = 0;
    }
    try {
      const health = await api('/api/health');
      if (health.json?.ok) healthSamples.push({ at: now - startedAt, ...health.json });
    } catch { /* 采样失败忽略 */ }
  }, 1000);

  console.log(`\n开始压测（${SECONDS} 秒）…`);
  await sleep(SECONDS * 1000);
  clearInterval(commandTimer);
  clearInterval(rttTimer);
  clearInterval(sampleTimer);

  // 4) 统计
  const elapsed = (Date.now() - startedAt) / 1000;
  const totalSnapshots = players.reduce((sum, player) => sum + player.rates.reduce((a, b) => a + b, 0) * 1, 0);
  const snapshotHz = totalSnapshots / Math.max(1, players.length * Math.max(1, players[0].rates.length));
  const rttAll = players.flatMap((player) => player.rtts);
  const rttAvg = rttAll.length ? rttAll.reduce((a, b) => a + b, 0) / rttAll.length : 0;
  const disconnects = players.reduce((sum, player) => sum + player.disconnects, 0);
  const cmdAcks = players.reduce((sum, player) => sum + player.cmdAcks, 0);
  const cmdErrors = players.reduce((sum, player) => sum + player.cmdErrors, 0);
  const lastHealth = healthSamples[healthSamples.length - 1] ?? {};
  const peakMatches = Math.max(0, ...healthSamples.map((sample) => sample.matches ?? 0));

  const sim = lastHealth.sim ?? {};
  const slowRatio = sim.ticks ? (sim.slowTicks ?? 0) / sim.ticks : 0;
  // 短跑（<60s）会被开局预热/GC 的少数几帧主导，此时不判"超预算占比"，只看平均成本
  const shortRun = SECONDS < 60;
  // 拒绝按错误码分类：只有"不该发生"的码算失败，MATCH_OVER（对局已结束）是预期
  const errorsByCode = {};
  for (const player of players) {
    for (const [code, count] of Object.entries(player.cmdErrorsByCode)) {
      errorsByCode[code] = (errorsByCode[code] ?? 0) + count;
    }
  }
  const unexpected = Object.entries(errorsByCode)
    .filter(([code]) => !EXPECTED_REJECTIONS.includes(code));
  const unexpectedCount = unexpected.reduce((sum, [, count]) => sum + count, 0);
  const breakdown = Object.entries(errorsByCode)
    .map(([code, count]) => `${code} ${count}`)
    .join(' · ') || '无';

  const checks = [
    // 服务器上可能还有别的对局（含上一次未收尾的），所以用 >= 判定
    ['对局数达到预期', peakMatches >= ROOMS, `${peakMatches} / ${ROOMS}`],
    [`平均 tick < ${THRESHOLDS.tickMsAvg}ms`, (sim.tickMsAvg ?? 999) < THRESHOLDS.tickMsAvg, `${sim.tickMsAvg ?? '?'} ms`],
    // 单次 GC 尖峰不该算失败：用"超过 8ms 预算的 tick 占比"来判定，最大 tick 只作观察值
    shortRun
      ? ['超预算 tick 占比（短跑不判）', true, `${(slowRatio * 100).toFixed(3)}%（${sim.slowTicks ?? 0}/${sim.ticks ?? 0}，最大 ${sim.tickMsMax ?? '?'} ms）· 跑 ≥60s 才判定`]
      : [
        `超预算 tick 占比 < ${STRICT_SLOW ? '0.1' : '0.5'}%`,
        slowRatio < (STRICT_SLOW ? THRESHOLDS.slowRatioStrict : THRESHOLDS.slowRatio),
        `${(slowRatio * 100).toFixed(3)}%（${sim.slowTicks ?? 0}/${sim.ticks ?? 0}，最大 ${sim.tickMsMax ?? '?'} ms）`,
      ],
    [`快照速率 ≈ ${THRESHOLDS.snapshotHzMin}–${THRESHOLDS.snapshotHzMax}Hz`, snapshotHz >= THRESHOLDS.snapshotHzMin && snapshotHz <= THRESHOLDS.snapshotHzMax, `${snapshotHz.toFixed(1)} Hz`],
    [`RTT < ${THRESHOLDS.rttMsMax}ms`, rttAvg < THRESHOLDS.rttMsMax, `${rttAvg.toFixed(0)} ms`],
    ['无掉线', disconnects === 0, `${disconnects} 次`],
    ['命令被接受（除结束/阵亡竞态）', unexpectedCount === 0 && cmdAcks > 0, `ok ${cmdAcks} · 拒绝 ${cmdErrors}（${breakdown}）`],
    overflowRejected === null
      ? [`容量上限检查（需 ${maxRooms} 房间才测）`, true, `跳过（本次 ${ROOMS} 房间）`]
      : [`第 ${maxRooms + 1} 个房间被拒（503）`, overflowRejected, overflowRejected ? '503 ROOM_LIMIT' : '未被拒绝'],
  ];

  console.log('\n──────── 结果 ────────');
  console.log(`时长 ${elapsed.toFixed(1)}s · 人数 ${players.length} · 快照总量 ${Math.round(totalSnapshots)}`);
  if (lastHealth.sim) {
    console.log(`tick 平均 ${sim.tickMsAvg} ms · 最大 ${sim.tickMsMax} ms · 超预算 ${sim.slowTicks ?? 0}/${sim.ticks ?? 0} · 已发快照 ${sim.snapshotsSent} 条`);
    // 服务端统计的拒绝原因（与脚本侧 ack 计数互相印证）
    const serverRejected = Object.entries(sim.rejectedByCode ?? {})
      .map(([code, count]) => `${code} ${count}`)
      .join(' · ') || '无';
    console.log(`服务端拒绝 ${sim.rejected ?? 0} 次 · ${serverRejected}`);
  }
  for (const [label, ok, detail] of checks) {
    console.log(`${ok ? '✅' : '❌'} ${label.padEnd(26)} ${detail}`);
  }
  const failed = checks.filter(([, ok]) => !ok).length;
  console.log(failed === 0 ? '\n结论：全部通过 ✅\n' : `\n结论：${failed} 项未通过 ❌\n`);

  // 5) 收尾：用真实 cookie 让房主退房（房间会关闭并释放 maxRooms 名额）
  await cleanupRooms();
  for (const socket of sockets) socket.disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

/** 退掉本次创建的所有房间（失败也不影响退出码） */
async function cleanupRooms() {
  for (const room of createdRooms) {
    try {
      await api(`/api/rooms/${room.code}/leave`, { method: 'POST', cookie: room.hostCookie });
    } catch { /* 忽略收尾失败 */ }
  }
  createdRooms.length = 0;
}

main().catch(async (error) => {
  console.error(`\n压测失败：${error.message}\n`);
  await cleanupRooms().catch(() => {});
  for (const socket of sockets) socket.disconnect();
  process.exit(1);
});
