// 对局驱动（P4）：唯一的 60Hz 调度器，驱动所有进行中的 MatchSim 并把快照推给两位玩家。
//
// 设计要点（1 核服务器，见 docs/pvp-plan.md §3.10）：
//   · 只有一个 setInterval，避免"每局一个定时器"在 CPU 紧张时互相踩踏
//   · 模拟 60Hz 固定步长（MatchSim.update 自己按单调时钟补步、最多 5 步）
//   · 快照按 config.snapshotHz（默认 15 Hz）节流，**按阵营分频道**发送：
//       room:<code>:blue / room:<code>:red
//     这样每个玩家只收到"自己能看到的那一份"，不必做逐 socket 的过滤
//   · 每局结束只结算一次（发 match:end + 从 active 表移除并通知房间管理器）
export const SNAPSHOT_CHANNEL = (code, faction) => `room:${code}:${faction}`;

export function createMatchDriver({ io, config, roomChannel, onMatchEnd = null, now = () => Date.now() }) {
  const active = new Map();          // code → { room, lastSnapshotAt }
  const snapshotMs = Math.max(16, Math.round(1000 / config.snapshotHz));
  const totals = { snapshots: 0, frames: 0, tickMsTotal: 0, tickMsMax: 0 };
  let timer = null;

  function attach(room) {
    if (!room?.match || active.has(room.code)) return;
    active.set(room.code, { room, lastSnapshotAt: 0 });
    // 开局立刻给一次快照，客户端不用等到第一个 1/15s
    emitSnapshots(room);
  }

  function detach(code) {
    active.delete(code);
  }

  function emitSnapshots(room) {
    const match = room.match;
    if (!match) return;
    for (const faction of ['blue', 'red']) {
      io.to(SNAPSHOT_CHANNEL(room.code, faction)).emit('tick', match.snapshotFor(faction));
    }
    totals.snapshots += 2;   // 两个阵营各一份
  }

  function finish({ room }) {
    const match = room.match;
    if (!match) return;
    const result = match.result ?? {
      winner: 'draw',
      reason: 'unknown',
      atMs: match.elapsedMs(),
      cities: { blue: match.cityCount('blue'), red: match.cityCount('red') },
      casualties: { blue: 0, red: 0 },
    };
    // 最后一帧快照（含 result），让客户端能立刻画出终局状态
    emitSnapshots(room);
    io.to(roomChannel(room.code)).emit('match:end', { ...result, matchId: room.matchId });
    active.delete(room.code);
    onMatchEnd?.(room, result);
  }

  function tickOnce(nowMs = now()) {
    totals.frames += 1;
    for (const entry of active.values()) {
      const { room } = entry;
      if (!room.match) continue;
      if (room.match.phase === 'finished') { finish(entry); continue; }

      room.match.update(nowMs);

      if (room.match.phase === 'finished') { finish(entry); continue; }

      if (nowMs - entry.lastSnapshotAt >= snapshotMs) {
        entry.lastSnapshotAt = nowMs;
        emitSnapshots(room);
      }
    }
  }

  /**
   * 容量观测（/api/health 用）：活动对局数、快照条数、tick 平均成本与"超出 8ms 预算"的次数。
   * 注意 tickMsAvg 是**所有活动对局以来的累计平均**（不是瞬时值），便于压测时看整体水平。
   */
  function stats() {
    let ticks = 0;
    let total = 0;
    let max = 0;
    let slowTicks = 0;
    let rejected = 0;
    const rejectedByCode = {};
    for (const { room } of active.values()) {
      const match = room.match;
      if (!match) continue;
      ticks += match.ticks;
      total += match.stats?.tickMsTotal ?? 0;
      slowTicks += match.stats?.slowTicks ?? 0;
      rejected += match.stats?.rejected ?? 0;
      for (const [code, count] of Object.entries(match.stats?.rejectedByCode ?? {})) {
        rejectedByCode[code] = (rejectedByCode[code] ?? 0) + count;
      }
      if ((match.stats?.tickMsMax ?? 0) > max) max = match.stats.tickMsMax;
    }
    return {
      matches: active.size,
      snapshotsSent: totals.snapshots,
      frames: totals.frames,
      ticks,
      slowTicks,
      rejected,
      rejectedByCode,
      tickMsAvg: ticks ? Number((total / ticks).toFixed(3)) : 0,
      tickMsMax: Number(max.toFixed(2)),
    };
  }

  return {
    attach,
    detach,
    emitSnapshots,
    stats,
    /** 单步推进（测试用；生产由 start() 的定时器调用） */
    tickOnce,
    start() {
      if (timer) return;
      timer = setInterval(() => {
        try {
          tickOnce();
        } catch (error) {
          console.error('[driver] tick 失败:', error);
        }
      }, 1000 / 60);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    get size() {
      return active.size;
    },
  };
}
