// 客户端插值（纯函数，便于单测）。
//
// 服务器 15 Hz 发快照，客户端 60 FPS 渲染：若直接把快照坐标赋给单位，会明显"跳格"。
// 做法：每收到一份快照，记下 (prev = 上一帧渲染位置, next = 快照位置)，
// 然后在下一个快照到达前，用 alpha 从 0→1 把位置拉到 next。
// 因为 alpha 会到 1，**静止单位最终必然精确等于快照坐标**（误差 0）——
// 这也是 P4 验收"客户端坐标与服务器快照误差 < 0.5px"的可测依据。
export function clampAlpha(alpha) {
  if (!Number.isFinite(alpha)) return 1;
  return Math.min(1, Math.max(0, alpha));
}

/** alpha = 已流逝时间 / 快照间隔（0→1） */
export function alphaFor(elapsedMs, intervalMs) {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return 1;
  return clampAlpha(elapsedMs / intervalMs);
}

/** 线性插值：alpha=0 取 prev，alpha=1 取 next */
export function interpolatePosition(prev, next, alpha) {
  const t = clampAlpha(alpha);
  if (!prev || !Number.isFinite(prev.x) || !Number.isFinite(prev.y)) {
    return { x: next?.x ?? 0, y: next?.y ?? 0 };
  }
  if (!next || !Number.isFinite(next.x) || !Number.isFinite(next.y)) {
    return { x: prev.x, y: prev.y };
  }
  return {
    x: prev.x + (next.x - prev.x) * t,
    y: prev.y + (next.y - prev.y) * t,
  };
}
