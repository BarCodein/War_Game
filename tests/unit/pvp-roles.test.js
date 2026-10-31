import { describe, expect, it, vi } from 'vitest';
import { RoomRegistry } from '../../server/src/rooms.js';
import { values } from '../../server/src/config.js';

// §11.21：身份（蓝/红/观战）、每方多人、全队投降、观战只读
const CONFIG = {
  ...values,
  maxPerSide: 4,
  maxSpectators: 8,
  disconnectGraceMs: 4000,
  roomCountdownMs: 3000,
  roomTtlMs: 60_000,
  maxRooms: 4,
  pvpLevels: ['dujiang_pvp'],
};

function makeRegistry(overrides = {}) {
  const forfeits = [];
  const starts = [];
  let nowMs = 1000;
  const registry = new RoomRegistry({
    config: { ...CONFIG, ...overrides },
    now: () => nowMs,
    onBegin: (room) => { starts.push(room.code); return { matchId: 'm1', match: {} }; },
    onStateChange: () => {},
    onForfeit: (room, userId, reason, faction) => forfeits.push({ userId, reason, faction }),
  });
  return { registry, forfeits, starts, tick: (ms) => { nowMs += ms; } };
}

const user = (name) => ({ id: `u_${name}`, username: name, displayName: name });

describe('§11.21 身份与容量', () => {
  it('第一人蓝、第二人红，第三人自动补蓝（不是 ROOM_FULL）', () => {
    const { registry } = makeRegistry();
    const room = registry.create({ user: user('a') });
    registry.join({ code: room.code, user: user('b') });
    registry.join({ code: room.code, user: user('c') });
    const roles = room.players.map((player) => player.role);
    expect(roles).toEqual(['blue', 'red', 'blue']);
  });

  it('指定身份 + 容量上限：每方 4 人，超出报 SIDE_FULL', () => {
    const { registry } = makeRegistry();
    const room = registry.create({ user: user('a') });
    for (let i = 0; i < 3; i += 1) registry.join({ code: room.code, user: user(`b${i}`), role: 'blue' });
    expect(() => registry.join({ code: room.code, user: user('x'), role: 'blue' })).toThrow(/阵营已满/);
  });

  it('观战席上限：超出报 SPECTATOR_FULL；观战者 faction 为 null', () => {
    const { registry } = makeRegistry({ maxSpectators: 1 });
    const room = registry.create({ user: user('a') });
    registry.join({ code: room.code, user: user('s1'), role: 'spectator' });
    expect(room.players[1].role).toBe('spectator');
    expect(room.players[1].faction).toBeNull();
    expect(() => registry.join({ code: room.code, user: user('s2'), role: 'spectator' })).toThrow(/观战席已满/);
  });

  it('waiting 阶段可以切换身份；开到 countdown 后锁定', () => {
    const { registry } = makeRegistry();
    const room = registry.create({ user: user('a') });
    registry.join({ code: room.code, user: user('b') });
    registry.setRole({ code: room.code, userId: user('b').id, role: 'blue' });
    expect(room.players[1].role).toBe('blue');
    room.state = 'countdown';
    expect(() => registry.setRole({ code: room.code, userId: user('b').id, role: 'red' })).toThrow(/开始/);
  });

  it('开打条件：双方各≥1 名参战玩家 + 所有参战玩家准备（观战者不参与）', () => {
    const { registry } = makeRegistry();
    const room = registry.create({ user: user('a') });              // blue
    registry.join({ code: room.code, user: user('s'), role: 'spectator' });
    // 只有蓝方一人：即使准备了也不能开
    registry.setReady({ code: room.code, userId: user('a').id, ready: true });
    expect(room.state).toBe('waiting');
    // 补一个红方（加入会重置所有人的 ready）→ 双方都准备 → countdown
    registry.join({ code: room.code, user: user('b') });            // red
    registry.setReady({ code: room.code, userId: user('a').id, ready: true });
    registry.setReady({ code: room.code, userId: user('b').id, ready: true });
    expect(room.state).toBe('countdown');
  });

  it('观战者不能准备', () => {
    const { registry } = makeRegistry();
    const room = registry.create({ user: user('a') });
    registry.join({ code: room.code, user: user('s'), role: 'spectator' });
    expect(() => registry.setReady({ code: room.code, userId: user('s').id, ready: true })).toThrow(/观战/);
  });
});

describe('§11.21 全队投降', () => {
  it('部分投降不判负，全队投降才判负', () => {
    const { registry, forfeits } = makeRegistry();
    const room = registry.create({ user: user('a') });               // blue
    registry.join({ code: room.code, user: user('a2'), role: 'blue' });
    registry.join({ code: room.code, user: user('b'), role: 'red' });
    room.state = 'playing';

    const first = registry.resign({ code: room.code, userId: user('a').id });
    expect(first).toMatchObject({ resigned: 1, total: 2, allResigned: false });
    expect(forfeits).toHaveLength(0);

    const second = registry.resign({ code: room.code, userId: user('a2').id });
    expect(second).toMatchObject({ resigned: 2, total: 2, allResigned: true });
  });

  it('单人阵营投一次就算全队投降', () => {
    const { registry } = makeRegistry();
    const room = registry.create({ user: user('a') });
    registry.join({ code: room.code, user: user('b'), role: 'red' });
    room.state = 'playing';
    expect(registry.resign({ code: room.code, userId: user('a').id })).toMatchObject({ resigned: 1, total: 1, allResigned: true });
  });

  it('重复投降是幂等的；观战者不能投降', () => {
    const { registry } = makeRegistry();
    const room = registry.create({ user: user('a') });
    registry.join({ code: room.code, user: user('b'), role: 'red' });
    registry.join({ code: room.code, user: user('s'), role: 'spectator' });
    room.state = 'playing';
    registry.resign({ code: room.code, userId: user('a').id });
    expect(registry.resign({ code: room.code, userId: user('a').id })).toMatchObject({ resigned: 1, total: 1 });
    expect(() => registry.resign({ code: room.code, userId: user('s').id })).toThrow(/观战/);
  });

  it('rearm 会清掉投降标记（再开一把）', () => {
    const { registry } = makeRegistry();
    const room = registry.create({ user: user('a') });
    registry.join({ code: room.code, user: user('b'), role: 'red' });
    room.state = 'playing';
    registry.resign({ code: room.code, userId: user('a').id });
    room.state = 'finished';
    registry.rearm({ code: room.code });
    expect(room.players.every((player) => player.resigned === false)).toBe(true);
    expect(room.state).toBe('waiting');
  });
});

describe('§11.21 掉线判定（多人同阵营）', () => {
  it('同阵营还有人在线 → 不判负', () => {
    const { registry, forfeits, tick } = makeRegistry();
    const room = registry.create({ user: user('a') });
    registry.join({ code: room.code, user: user('a2'), role: 'blue' });
    registry.join({ code: room.code, user: user('b'), role: 'red' });
    room.state = 'playing';
    registry.markDisconnected({ code: room.code, userId: user('a').id });
    tick(5000);
    registry.sweep();
    expect(forfeits).toHaveLength(0);
  });

  it('全阵营掉线超过宽限 → 判该阵营负', () => {
    const { registry, forfeits, tick } = makeRegistry();
    const room = registry.create({ user: user('a') });
    registry.join({ code: room.code, user: user('a2'), role: 'blue' });
    registry.join({ code: room.code, user: user('b'), role: 'red' });
    room.state = 'playing';
    registry.markDisconnected({ code: room.code, userId: user('a').id });
    registry.markDisconnected({ code: room.code, userId: user('a2').id });
    tick(5000);
    registry.sweep();
    expect(forfeits).toHaveLength(1);
    expect(forfeits[0]).toMatchObject({ reason: 'disconnect-timeout', faction: 'blue' });
  });
});

describe('§11.21 观战者不能加入已开局房间', () => {
  it('playing 阶段 join 一律 ROOM_STARTED', () => {
    const { registry } = makeRegistry();
    const room = registry.create({ user: user('a') });
    room.state = 'playing';
    expect(() => registry.join({ code: room.code, user: user('s'), role: 'spectator' })).toThrow(/已经开始/);
  });
});
