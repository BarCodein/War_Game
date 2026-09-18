import { describe, expect, it } from 'vitest';
import { fogAlphaField } from '../../src/rendering/fogRenderer.js';

// 迷雾渲染的连续边缘契约：fogAlphaField 是纯函数，把「雾浓度」定义为
// 格心到最近视野圆（位置为连续坐标）的有符号距离的线性映射——
// 圆内 0（完全透明）、softPx 外 1（满雾）、之间线性渐变。
// 因此单位每移动 1px，格子的浓度只连续变化一点点，雾边缘不再随格子翻面跳变。
// 底层算法（simulation/systems/fog.js 的视野/三态）不参与、不被改动。
function field(cols, rows, cellSize, sources, softPx = 30) {
  return fogAlphaField(cols, rows, cellSize, sources, softPx);
}

const CELL = 10;

describe('迷雾渲染浓度场', () => {
  it('视野圆内（含圆上）完全透明', () => {
    const alpha = field(20, 20, CELL, [{ x: 100, y: 100, r: 50 }]);
    // 圆心的格（格心 105,105 距圆心 ~7px < 50）
    expect(alpha[10 * 20 + 10]).toBe(0);
    // 距圆心 50px 的格（格心 145,105）恰好在圆上 → 0
    expect(alpha[10 * 20 + 14]).toBe(0);
  });

  it('远离视野处满雾（浓度 1）', () => {
    const alpha = field(40, 20, CELL, [{ x: 100, y: 100, r: 50 }], 30);
    // 格 (29,10) 格心 (295,105)，距圆心 195px，远超 50+30 → 满雾
    expect(alpha[10 * 40 + 29]).toBe(1);
  });

  it('边缘平滑宽度内浓度线性递增（0 → 1）', () => {
    const alpha = field(40, 1, CELL, [{ x: 100, y: 5, r: 40 }], 30);
    // 同排采样：x=10..390。半径 40，格心距圆心 d：
    // 圆内(≤40) → 0；40..70 → 线性；≥70 → 1
    const valueAt = (x) => alpha[Math.floor(x / CELL)]; // rows=1：index = 列号
    expect(valueAt(100)).toBe(0);            // 圆心
    const a140 = valueAt(140);               // 格心 145, d=45 → 5/30 ≈ 0.167
    expect(a140).toBeGreaterThan(0);
    const a150 = valueAt(150);               // d=55 → 0.5
    expect(a150).toBeGreaterThan(a140);
    const a160 = valueAt(160);               // d=65 → 0.833
    expect(a160).toBeGreaterThan(a150);
    expect(valueAt(170)).toBe(1);            // d=75 ≥ 70 → 满雾
  });

  it('多个视野圆重叠时取最近者（内层圆内的格不受外层影响）', () => {
    const alpha = field(40, 20, CELL, [
      { x: 100, y: 100, r: 50 },
      { x: 200, y: 100, r: 80 },
    ], 30);
    // 内层圆心附近：两个圆都覆盖，最近距离 = 内层 → 0
    expect(alpha[10 * 40 + 10]).toBe(0);
    // 格 (24,10) 格心 (245,105)：在内层圆范围外、外层圆内 → 0
    expect(alpha[10 * 40 + 24]).toBe(0);
  });

  it('无视野源时整图满雾', () => {
    const alpha = field(4, 4, CELL, []);
    expect(alpha.every(v => v === 1)).toBe(true);
  });

  it('浓度场随源连续移动而连续变化（不翻格）', () => {
    // 同一格，在源移动 1px 前后浓度变化应远小于翻格时的跳变（旧版：0 → 1 一步）
    const cellSize = 10;
    const cols = 20;
    const rows = 20;
    const targetX = 5; // 格心 (55, 105) 处观察
    const targetY = 10;
    const before = fogAlphaField(cols, rows, cellSize, [{ x: 150, y: 105, r: 90 }], 30);
    const after = fogAlphaField(cols, rows, cellSize, [{ x: 151, y: 105, r: 90 }], 30);
    const a = before[targetY * cols + targetX];
    const b = after[targetY * cols + targetX];
    expect(Math.abs(b - a)).toBeLessThan(0.1);
  });
});
