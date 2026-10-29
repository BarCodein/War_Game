import { describe, expect, it } from 'vitest';
import { alphaFor, clampAlpha, interpolatePosition } from '../../src/pvp/interpolate.js';

// P4 验收：客户端 15Hz 快照 → 60FPS 渲染的插值数学。
// 关键性质（也是"客户端坐标与服务器快照误差 < 0.5px"的依据）：
//   alpha 到 1 时必须**精确等于**快照坐标；alpha=0 时保持上一帧位置。
describe('PvP 插值', () => {
  it('clampAlpha 把任意输入收敛到 [0,1]，非法值按 1 处理', () => {
    expect(clampAlpha(-3)).toBe(0);
    expect(clampAlpha(0)).toBe(0);
    expect(clampAlpha(0.42)).toBe(0.42);
    expect(clampAlpha(7)).toBe(1);
    expect(clampAlpha(Number.NaN)).toBe(1);
    expect(clampAlpha(undefined)).toBe(1);
  });

  it('alphaFor = 已流逝 / 快照间隔', () => {
    expect(alphaFor(0, 66)).toBe(0);
    expect(alphaFor(33, 66)).toBeCloseTo(0.5, 6);
    expect(alphaFor(66, 66)).toBe(1);
    expect(alphaFor(999, 66)).toBe(1);
    expect(alphaFor(10, 0)).toBe(1); // 间隔非法时直接到位，避免除零
  });

  it('interpolatePosition 线性插值，端点精确', () => {
    const prev = { x: 100, y: 200 };
    const next = { x: 140, y: 260 };
    expect(interpolatePosition(prev, next, 0)).toEqual({ x: 100, y: 200 });
    expect(interpolatePosition(prev, next, 1)).toEqual({ x: 140, y: 260 });
    expect(interpolatePosition(prev, next, 0.5)).toEqual({ x: 120, y: 230 });
  });

  it('静止单位在 alpha=1 时与快照完全一致（误差 0，远小于 0.5px）', () => {
    const snapshot = { x: 512.34, y: 288.91 };
    const prev = { x: 500.1, y: 300.2 };
    for (const alpha of [1, 1.2, Number.POSITIVE_INFINITY]) {
      const position = interpolatePosition(prev, snapshot, alpha);
      expect(position.x).toBe(snapshot.x);
      expect(position.y).toBe(snapshot.y);
      expect(Math.hypot(position.x - snapshot.x, position.y - snapshot.y)).toBeLessThan(0.5);
    }
  });

  it('缺数据时不产生 NaN（缺 prev 用 next，缺 next 保持 prev）', () => {
    expect(interpolatePosition(null, { x: 7, y: 8 }, 0.5)).toEqual({ x: 7, y: 8 });
    expect(interpolatePosition({ x: 1, y: 2 }, null, 0.5)).toEqual({ x: 1, y: 2 });
    expect(interpolatePosition({ x: 1, y: 2 }, { x: 3, y: 4 }, Number.NaN)).toEqual({ x: 3, y: 4 });
  });
});
