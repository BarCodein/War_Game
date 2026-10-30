// PvP 命令队列：把"一次玩家操作"产生的多条「单位组命令」**打包成一条 socket 消息**。
//
// 为什么需要打包：多选拖路径是"每个单位一条绝对路径"（保持队形），16–32 个单位逐条发会撞上
// 服务器 20 条/秒的限频；服务器对 `{orders:[…]}` 整批只扣 1 次额度（server/src/match.js#queueCommandBatch）。
//
// 一次拖拽/一次右键/一次 S 都在同一个事件循环里进队，`queueMicrotask` 合并后只发一条消息。
// 错误码 → 文案走 i18n（`pvp.reject.*`），与战役共用同一套 `t()`。
import { t } from '../i18n/index.js';

const REJECT_KEYS = {
  NO_UNITS: 'pvp.reject.NO_UNITS',
  BAD_COMMAND: 'pvp.reject.BAD_COMMAND',
  RATE_LIMITED: 'pvp.reject.RATE_LIMITED',
  MATCH_OVER: 'pvp.reject.MATCH_OVER',
  BAD_FACTION: 'pvp.reject.BAD_FACTION',
  BATCH_TOO_LARGE: 'pvp.reject.BATCH_TOO_LARGE',
  OFFLINE: 'pvp.reject.OFFLINE',
  NO_ACK: 'pvp.reject.NO_ACK',
};

/**
 * @param {{getSocket: () => any, onResult?: Function, onError?: Function, now?: () => number}} options
 * @returns {{enqueue: Function, flush: Function, stats: object, textFor: Function}}
 */
export function createCommandQueue({ getSocket, onResult, onError, now = () => performance.now() }) {
  let pending = [];
  let scheduled = false;
  const stats = {
    batches: 0,        // 发出的消息条数（一次操作 = 1）
    orders: 0,         // 累计命令条数（= 单位数级）
    units: 0,          // 服务器确认生效的单位数
    applied: 0,        // 服务器确认生效的命令条数
    rejected: 0,       // 被拒条数（含部分拒绝）
    lastError: null,
    lastAt: 0,
    lastResult: null,
  };

  function enqueue(unitIds, command) {
    if (!Array.isArray(unitIds) || unitIds.length === 0 || !command) return;
    pending.push({ unitIds: [...unitIds], command });
    schedule();
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(flush);
  }

  function flush() {
    scheduled = false;
    if (pending.length === 0) return;
    const orders = pending;
    pending = [];
    const socket = getSocket();
    if (!socket?.connected) {
      stats.lastError = 'OFFLINE';
      stats.lastResult = { ok: false, code: 'OFFLINE', rejected: [], orders };
      onError?.('OFFLINE', orders);
      return;
    }
    stats.batches += 1;
    stats.orders += orders.length;
    stats.lastAt = now();
    socket.emit('cmd', { orders, seq: stats.batches }, (response) => {
      if (!response) {
        stats.lastError = 'NO_ACK';
        stats.lastResult = { ok: false, code: 'NO_ACK', rejected: [], orders };
        onError?.('NO_ACK', orders);
        return;
      }
      if (!response.ok) {
        stats.rejected += 1;
        stats.lastError = response.code ?? 'REJECTED';
        stats.lastResult = { ok: false, code: response.code, rejected: response.rejected ?? [], orders };
        onResult?.(stats.lastResult);
        return;
      }
      const rejected = response.rejected ?? [];
      stats.applied += response.applied ?? 0;
      stats.units += response.units ?? 0;
      stats.rejected += rejected.length;
      stats.lastError = rejected.length ? rejected[0].code : null;
      stats.lastResult = { ok: true, applied: response.applied ?? 0, units: response.units ?? 0, rejected, orders };
      onResult?.(stats.lastResult);
    });
  }

  return {
    enqueue,
    flush,
    stats,
    textFor: (code) => (code && REJECT_KEYS[code] ? t(REJECT_KEYS[code]) : (code || t('pvp.reject.UNKNOWN'))),
  };
}
