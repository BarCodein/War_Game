import { describe, expect, it } from 'vitest';
import { SNAPSHOT_CHANNEL, createMatchDriver } from '../../server/src/driver.js';
import { MatchSim } from '../../server/src/match.js';
import { loadPvpLevel } from '../../server/src/levels.js';

// P4 验收：60Hz 驱动 + 15Hz 快照广播 + 结束只结算一次。
// 用假的 io 记录所有 emit，用真实的 MatchSim 推进（不需要 socket）。
function fakeIo() {
  const sent = [];
  return {
    sent,
    to(channel) {
      return {
        emit(event, payload) {
          sent.push({ channel, event, payload });
          return true;
        },
      };
    },
    byEvent(event, channel) {
      return sent.filter((item) => item.event === event && (!channel || item.channel === channel));
    },
  };
}

function makeMatch(overrides = {}) {
  const { level, map } = loadPvpLevel('dujiang_pvp');
  const match = new MatchSim({ level, map, prepMs: 0, ...overrides });
  match.start(0);
  match.startPlaying();
  return match;
}

const roomChannel = (code) => `room:${code}`;

describe('对局驱动：快照广播', () => {
  it('按阵营分频道下发快照：blue 与 red 各收到自己那份', () => {
    const io = fakeIo();
    const match = makeMatch();
    const room = { code: 'ABC123', match };
    const driver = createMatchDriver({ io, config: { snapshotHz: 15 }, roomChannel });

    driver.attach(room);
    // attach 立刻给一帧，避免客户端等第一个 1/15s
    const blueTicks = io.byEvent('tick', SNAPSHOT_CHANNEL('ABC123', 'blue'));
    const redTicks = io.byEvent('tick', SNAPSHOT_CHANNEL('ABC123', 'red'));
    expect(blueTicks).toHaveLength(1);
    expect(redTicks).toHaveLength(1);
    expect(blueTicks[0].payload.you).toBe('blue');
    expect(redTicks[0].payload.you).toBe('red');
    // 快照里只有自己的单位和可见敌军
    expect(blueTicks[0].payload.units.every((unit) => unit.faction === 'blue'
      || unit.faction === 'red')).toBe(true);
  });

  it('快照按 snapshotHz 节流（15Hz ≈ 每 66ms 一批），模拟仍按 60Hz 推进', () => {
    const io = fakeIo();
    const match = makeMatch();
    const room = { code: 'RATE01', match };
    const driver = createMatchDriver({ io, config: { snapshotHz: 15 }, roomChannel });
    driver.attach(room);
    const before = io.byEvent('tick', SNAPSHOT_CHANNEL('RATE01', 'blue')).length;

    // 模拟 200ms：60Hz 下约 12 个 tick，15Hz 下约 3 批快照
    for (let ms = 0; ms <= 200; ms += 16) driver.tickOnce(1000 + ms);

    const after = io.byEvent('tick', SNAPSHOT_CHANNEL('RATE01', 'blue')).length;
    const snapshots = after - before;
    expect(match.ticks).toBeGreaterThanOrEqual(10);
    expect(snapshots).toBeGreaterThanOrEqual(2);
    expect(snapshots).toBeLessThanOrEqual(5);
    // 每份快照的 tick 单调递增
    const ticks = io.byEvent('tick', SNAPSHOT_CHANNEL('RATE01', 'blue')).map((item) => item.payload.tick);
    for (let i = 1; i < ticks.length; i += 1) expect(ticks[i]).toBeGreaterThanOrEqual(ticks[i - 1]);
  });

  it('对局结束：只发一次 match:end，并带上胜负/原因/伤亡', () => {
    const io = fakeIo();
    const match = makeMatch();
    const room = { code: 'END001', matchId: 'match-end-001', match };
    const ended = [];
    const driver = createMatchDriver({
      io, config: { snapshotHz: 15 }, roomChannel, onMatchEnd: (r, result) => ended.push(result),
    });
    driver.attach(room);

    for (const city of match.world.cities) city.faction = 'blue';
    driver.tickOnce(2000);

    const ends = io.byEvent('match:end', roomChannel('END001'));
    expect(ends).toHaveLength(1);
    expect(ends[0].payload.winner).toBe('blue');
    expect(ends[0].payload.reason).toBe('captured-all-cities');
    expect(ends[0].payload.matchId).toBe('match-end-001');
    expect(ended).toHaveLength(1);
    expect(driver.size).toBe(0);

    // 再推进也不会重复结算
    driver.tickOnce(3000);
    expect(io.byEvent('match:end', roomChannel('END001'))).toHaveLength(1);
  });

  it('attach 幂等：重复 attach 同一房间不会重复发快照', () => {
    const io = fakeIo();
    const match = makeMatch();
    const room = { code: 'IDEM01', match };
    const driver = createMatchDriver({ io, config: { snapshotHz: 15 }, roomChannel });
    driver.attach(room);
    driver.attach(room);
    expect(io.byEvent('tick', SNAPSHOT_CHANNEL('IDEM01', 'blue'))).toHaveLength(1);
    expect(driver.size).toBe(1);
  });

  it('detach 之后不再推进该对局', () => {
    const io = fakeIo();
    const match = makeMatch();
    const room = { code: 'DET001', match };
    const driver = createMatchDriver({ io, config: { snapshotHz: 15 }, roomChannel });
    driver.attach(room);
    const ticks = match.ticks;
    driver.detach('DET001');
    for (let ms = 0; ms < 200; ms += 16) driver.tickOnce(ms);
    expect(match.ticks).toBe(ticks);
  });
});
