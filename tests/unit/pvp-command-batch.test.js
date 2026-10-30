import { describe, expect, it } from 'vitest';
import { MatchSim } from '../../server/src/match.js';
import { loadPvpLevel } from '../../server/src/levels.js';
import { moveCommand } from '../../src/simulation/commands.js';

// U1 验收：批量下令（一次玩家操作 = 一条消息 = 整批 1 次限频）。
function makeMatch(levelId = 'dujiang_pvp') {
  const { level, map } = loadPvpLevel(levelId);
  const match = new MatchSim({ level, map, prepMs: 0 });
  match.start(0);
  match.startPlaying();
  match.step(1);
  return match;
}

const ownIds = (match, faction = 'blue') => match.world.units
  .filter((unit) => unit.faction === faction && unit.state !== 'dead')
  .map((unit) => unit.id);

describe('queueCommandBatch：整批 1 次限频', () => {
  it('16 个单位一次下令：全部生效，且只消耗 1 次限频额度', () => {
    const match = makeMatch();
    const ids = ownIds(match);
    const orders = ids.map((id) => ({
      unitIds: [id],
      command: moveCommand([{ x: 640, y: 400 }]),
    }));

    const result = match.queueCommandBatch('blue', orders);
    expect(result.ok).toBe(true);
    expect(result.applied).toBe(ids.length);
    expect(result.units).toBe(ids.length);
    expect(result.rejected).toEqual([]);

    // 关键：16 条命令只占了 1 个 token（否则 20 条/秒的限频会被打满）
    expect(match.commandWindows.blue.count).toBe(1);
    expect(match.stats.commands.blue).toBe(ids.length);
    expect(match.stats.batches).toBe(1);

    // 紧接着再来一批仍然可以（同一秒内 2 个 token << 20）
    const again = match.queueCommandBatch('blue', orders.slice(0, 4));
    expect(again.ok).toBe(true);
    expect(again.applied).toBe(4);
    expect(match.commandWindows.blue.count).toBe(2);
  });

  it('部分失败：不属于自己的单位 → NO_UNITS，其余照常生效', () => {
    const match = makeMatch();
    const mine = ownIds(match).slice(0, 2);
    const enemy = ownIds(match, 'red').slice(0, 1);

    const result = match.queueCommandBatch('blue', [
      { unitIds: mine, command: moveCommand([{ x: 500, y: 300 }]) },
      { unitIds: enemy, command: moveCommand([{ x: 500, y: 300 }]) },
    ]);
    expect(result.ok).toBe(true);
    expect(result.applied).toBe(1);
    expect(result.rejected).toEqual([{ code: 'NO_UNITS', unitIds: enemy }]);
    expect(match.stats.rejectedByCode.NO_UNITS).toBe(1);
  });

  it('非法命令/空批次/超大批次/阵营错误都被拒绝（且不抛异常）', () => {
    const match = makeMatch();
    const ids = ownIds(match).slice(0, 1);

    expect(match.queueCommandBatch('blue', []).code).toBe('BAD_COMMAND');
    expect(match.queueCommandBatch('blue', undefined).code).toBe('BAD_COMMAND');
    expect(match.queueCommandBatch('purple', [{ unitIds: ids, command: moveCommand([{ x: 1, y: 1 }]) }]).code)
      .toBe('BAD_FACTION');

    const huge = Array.from({ length: 65 }, () => ({ unitIds: ids, command: moveCommand([{ x: 10, y: 10 }]) }));
    expect(match.queueCommandBatch('blue', huge).code).toBe('BATCH_TOO_LARGE');

    const bad = match.queueCommandBatch('blue', [{ unitIds: ids, command: { type: 'teleport' } }]);
    expect(bad.ok).toBe(false);
    expect(bad.code).toBe('BAD_COMMAND');
  });

  it('对局结束后批量命令一律 MATCH_OVER', () => {
    const match = makeMatch();
    const ids = ownIds(match).slice(0, 1);
    for (const city of match.world.cities) city.faction = 'blue';
    match.step(1);
    expect(match.phase).toBe('finished');
    expect(match.queueCommandBatch('blue', [{ unitIds: ids, command: moveCommand([{ x: 1, y: 1 }]) }]).code)
      .toBe('MATCH_OVER');
  });
});
