import { randomBytes, randomInt, randomUUID } from 'node:crypto';

// 房间码匹配（P3）：只做"好友约战"的 6 位房间码，不做快速匹配队列。
//
// 状态机：
//   waiting（等人/等准备） → countdown（双方 ready，3 秒倒计时） → playing（已创建对局） → finished
//   · 房主 = blue，客人 = red（第一次加入的人决定阵营）
//   · 房主离开 → 房间直接关闭；客人离开 → 回到 waiting（房主 ready 重置）
//   · 30 分钟没开局 → TTL 回收
//   · 同一账号不能占两个座位；房间满/已开局/码过期 都返回明确错误码
//
// 房间只存在内存里（进程重启即丢；这符合"对局本身就是内存态"的设计，
// 也避免为临时数据写库表）。对局记录（胜负/伤亡）在 P4/P5 再落库。
export const ROOM_STATES = ['waiting', 'countdown', 'playing', 'finished'];

// 去掉容易读错的 0/O/1/I
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_CODE_ATTEMPTS = 50;

const PUBLIC_FIELDS = ['code', 'state', 'levelId', 'createdAt', 'expiresAt', 'countdownEndsAt', 'matchId', 'players'];

export class RoomError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function generateRoomCode(length = 6) {
  let code = '';
  for (let i = 0; i < length; i += 1) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

export class RoomRegistry {
  constructor({ config, now = () => Date.now(), onBegin = null, onStateChange = null, onForfeit = null }) {
    this.config = config;
    this.now = now;
    this.onBegin = onBegin;          // (room) => { matchId, match }
    this.onStateChange = onStateChange; // (room) => void  —— 由 app.js 负责推送给房间成员
    this.onForfeit = onForfeit;      // (room, userId) => void —— P5 的判负钩子（先留空）
    this.rooms = new Map();
    this.timer = null;
  }

  // ---------- 生命周期 ----------
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.sweep(), 250);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** 定期推进：倒计时到点 → 开局；过期的等待房间 → 回收；掉线超过宽限 → 判负 */
  sweep(nowMs = this.now()) {
    let changed = false;
    for (const room of [...this.rooms.values()]) {
      if (room.state === 'waiting' && room.expiresAt <= nowMs) {
        room.state = 'finished';
        room.reason = 'expired';
        this.rooms.delete(room.code);
        changed = true;
        continue;
      }
      if (room.state === 'countdown' && room.countdownEndsAt <= nowMs) {
        this.begin(room);
        changed = true;
        continue;
      }
      // P5：对局中有人掉线超过宽限（默认 30s）→ 判他负
      if (room.state === 'playing') {
        const absent = room.players.find((player) => player.connected === false
          && player.disconnectedAt !== null
          && nowMs - player.disconnectedAt >= this.config.disconnectGraceMs);
        if (absent) {
          this.onForfeit?.(room, absent.id, 'disconnect-timeout');
        }
      }
    }
    if (changed) this.notifyAll();
  }

  begin(room) {
    const { matchId, match } = this.onBegin?.(room) ?? {};
    room.matchId = matchId ?? randomUUID();
    room.match = match ?? null;
    room.state = 'playing';
    room.startedAt = this.now();
    return room;
  }

  notifyAll() {
    for (const room of this.rooms.values()) this.onStateChange?.(room);
  }

  // ---------- 查询 ----------
  get(code) {
    return this.rooms.get(normalizeCode(code)) ?? null;
  }

  require(code) {
    const room = this.get(code);
    if (!room) throw new RoomError('ROOM_NOT_FOUND', '房间不存在或已过期（房间码 30 分钟有效）', 404);
    return room;
  }

  playerOf(room, userId) {
    return room.players.find((player) => player.id === userId) ?? null;
  }

  // ---------- 房间操作 ----------
  create({ user, levelId }) {
    if (this.countActive() >= this.config.maxRooms) {
      throw new RoomError('ROOM_LIMIT', `服务器忙碌：同时最多 ${this.config.maxRooms} 个房间，请稍后再试`, 503);
    }
    if (levelId && !this.config.pvpLevels.includes(levelId)) {
      throw new RoomError('BAD_LEVEL', `未知地图：${levelId}`, 400);
    }
    const nowMs = this.now();
    let code = generateRoomCode();
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS && this.rooms.has(code); attempt += 1) {
      code = generateRoomCode();
    }
    const room = {
      code,
      // 房主离开 → 房间直接关闭（gdd 之外的产品决定：避免留下一个"没有房主"的孤儿房间）
      hostId: user.id,
      state: 'waiting',
      levelId: levelId ?? this.config.pvpLevels[0],
      createdAt: nowMs,
      expiresAt: nowMs + this.config.roomTtlMs,
      countdownEndsAt: null,
      matchId: null,
      match: null,
      players: [this.newPlayer(user, 'blue')],
    };
    this.rooms.set(code, room);
    this.onStateChange?.(room);
    return room;
  }

  join({ code, user }) {
    const room = this.require(code);
    if (room.state === 'playing' || room.state === 'finished') {
      throw new RoomError('ROOM_STARTED', '该房间已经开始对局', 409);
    }
    if (this.playerOf(room, user.id)) {
      throw new RoomError('ALREADY_JOINED', '你已在这个房间里', 409);
    }
    if (room.players.length >= 2) {
      throw new RoomError('ROOM_FULL', '房间已满（2 人）', 409);
    }
    const taken = room.players.map((player) => player.faction);
    const faction = ['blue', 'red'].find((item) => !taken.includes(item)) ?? 'red';
    room.players.push(this.newPlayer(user, faction));
    // 有人进来 → 之前的 ready 作废（避免"准备状态和实际阵容不一致"）
    for (const player of room.players) player.ready = false;
    room.expiresAt = this.now() + this.config.roomTtlMs;
    this.onStateChange?.(room);
    return room;
  }

  leave({ code, userId }) {
    const room = this.require(code);
    const player = this.playerOf(room, userId);
    if (!player) throw new RoomError('NOT_IN_ROOM', '你不在这个房间里', 409);

    const wasPlaying = room.state === 'playing';
    const wasHost = room.hostId === userId;
    room.players = room.players.filter((item) => item.id !== userId);
    player.ready = false;

    if (wasPlaying) {
      // 主动退出 = 直接判负（被动掉线走 markDisconnected + 宽限，见 sweep）
      room.state = 'finished';
      room.reason = 'forfeit';
      this.onForfeit?.(room, userId, 'forfeit');
      this.rooms.delete(room.code);
      this.onStateChange?.(room);
      return { room, closed: true };
    }

    if (wasHost || room.players.length === 0) {
      room.state = 'finished';
      room.reason = wasHost ? 'host-left' : 'empty';
      this.rooms.delete(room.code);
      this.onStateChange?.(room);   // 让还在频道里的对手收到 closed 状态
      return { room, closed: true };
    }

    // 客人离开 / 只剩房主继续等：重置准备状态，房间保留
    room.state = 'waiting';
    room.countdownEndsAt = null;
    for (const item of room.players) item.ready = false;
    room.expiresAt = this.now() + this.config.roomTtlMs;
    this.onStateChange?.(room);
    return { room, closed: false };
  }

  setReady({ code, userId, ready = true }) {
    const room = this.require(code);
    if (room.state !== 'waiting' && room.state !== 'countdown') {
      throw new RoomError('ROOM_STARTED', '该房间已经开始对局', 409);
    }
    const player = this.playerOf(room, userId);
    if (!player) throw new RoomError('NOT_IN_ROOM', '你不在这个房间里', 409);
    player.ready = Boolean(ready);

    const bothReady = room.players.length === 2 && room.players.every((item) => item.ready);
    if (bothReady) {
      room.state = 'countdown';
      room.countdownEndsAt = this.now() + this.config.roomCountdownMs;
    } else if (room.state === 'countdown') {
      room.state = 'waiting';
      room.countdownEndsAt = null;
    }
    this.onStateChange?.(room);
    return room;
  }

  // ---------- 断线重连（P5） ----------
  /** 标记掉线：由 socket disconnect 调用（同一玩家可能还有别的 socket，调用方负责判断） */
  markDisconnected({ code, userId, nowMs = this.now() }) {
    const room = this.get(code);
    const player = room ? this.playerOf(room, userId) : null;
    if (!player) return null;
    if (player.connected === false) return room;   // 已经在掉线状态
    player.connected = false;
    player.disconnectedAt = nowMs;
    return room;
  }

  /** 首次进入 / 重复进入：只清理掉线标记，不校验 token */
  ensureConnected({ code, userId }) {
    const room = this.require(code);
    const player = this.playerOf(room, userId);
    if (!player) throw new RoomError('NOT_IN_ROOM', '你不在这个房间里', 409);
    player.connected = true;
    player.disconnectedAt = null;
    return room;
  }

  /** 重连：把座位标记为在线（宽限内续局）。token 若提供则必须匹配（防止串座） */
  markConnected({ code, userId, token }) {
    const room = this.require(code);
    const player = this.playerOf(room, userId);
    if (!player) throw new RoomError('NOT_IN_ROOM', '你不在这个房间里', 409);
    if (token && player.reconnectToken && player.reconnectToken !== token) {
      throw new RoomError('BAD_TOKEN', '重连凭证不匹配（可能不是同一局）', 403);
    }
    player.connected = true;
    player.disconnectedAt = null;
    return room;
  }

  /** 玩家是否在宽限内可重连 */
  canReconnect(room, player, nowMs = this.now()) {
    if (!player || player.connected !== false) return false;
    return nowMs - (player.disconnectedAt ?? 0) < this.config.disconnectGraceMs;
  }

  newPlayer(user, faction) {
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName ?? user.username,
      faction,
      ready: false,
      connected: true,          // P5：socket 是否在线（掉线后 30s 内可重连）
      disconnectedAt: null,
      leftNotified: false,      // 是否已向对手播报过"掉线"（避免页面跳转刷横幅）
      reconnectToken: randomBytes(24).toString('base64url'),
    };
  }

  countActive() {
    return [...this.rooms.values()].filter((room) => room.state !== 'finished').length;
  }

  size() {
    return this.rooms.size;
  }
}

export function normalizeCode(code) {
  return String(code ?? '').trim().toUpperCase();
}

/** 对外安全视图：不含内部字段（match 实例、socketId 等）；reconnectToken 只发给本人 */
export function roomView(room, viewerId = null) {
  if (!room) return null;
  const view = {};
  for (const key of PUBLIC_FIELDS) view[key] = room[key];
  view.players = room.players.map((player) => ({
    id: player.id,
    username: player.username,
    displayName: player.displayName,
    faction: player.faction,
    ready: player.ready,
    connected: player.connected !== false,
  }));
  if (viewerId !== null) {
    const mine = room.players.find((player) => player.id === viewerId) ?? null;
    view.you = mine
      ? {
        id: mine.id,
        faction: mine.faction,
        ready: mine.ready,
        connected: mine.connected !== false,
        reconnectToken: mine.reconnectToken ?? null,   // 只给本人（重连凭证）
      }
      : null;
    const opponent = room.players.find((player) => player.id !== viewerId) ?? null;
    view.opponent = opponent
      ? {
        id: opponent.id,
        username: opponent.username,
        displayName: opponent.displayName,
        faction: opponent.faction,
        ready: opponent.ready,
        connected: opponent.connected !== false,
      }
      : null;
  }
  return view;
}
