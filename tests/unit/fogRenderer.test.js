import { describe, expect, it } from 'vitest';
import { FOG_EXPLORED, FOG_VISIBLE } from '../../src/simulation/systems/fog.js';
import { distanceToVisible } from '../../src/rendering/fogRenderer.js';

// 迷雾渲染的边缘渐变契约：distanceToVisible 是纯函数，只读三态网格，
// 计算每格到最近「可见格」的距离（格），渲染层据此把硬边矩形降透明度。
// 底层算法（simulation/systems/fog.js 的视野/三态）不参与、不被改动。
function distMap(grid, cols, rows) {
  return distanceToVisible(grid, cols, rows, new Float64Array(cols * rows));
}

const EXPLORED = FOG_EXPLORED;
const VISIBLE = FOG_VISIBLE;

describe('迷雾渲染距离变换', () => {
  it('可见格自身距离为 0', () => {
    const grid = [VISIBLE, EXPLORED];
    const d = distMap(grid, 2, 1);
    expect(d[0]).toBe(0);
  });

  it('紧邻可见格的迷雾格距离为 1，向内逐格递增', () => {
    const rows = 1;
    const cols = 5;
    const grid = [EXPLORED, EXPLORED, VISIBLE, EXPLORED, EXPLORED];
    const d = distMap(grid, cols, rows);
    expect(d[2]).toBe(0);
    expect(d[1]).toBe(1); // 左邻
    expect(d[3]).toBe(1); // 右邻
    expect(d[0]).toBe(2);
    expect(d[4]).toBe(2);
  });

  it('对角方向距离按 2 计（接近欧氏距离）', () => {
    const cols = 3;
    const rows = 3;
    const grid = [
      EXPLORED, EXPLORED, EXPLORED,
      EXPLORED, VISIBLE, EXPLORED,
      EXPLORED, EXPLORED, EXPLORED,
    ];
    const d = distMap(grid, cols, rows);
    expect(d[4]).toBe(0);
    expect(d[0]).toBe(2); // 左上对角
    expect(d[2]).toBe(2); // 右上对角
    expect(d[1]).toBe(1); // 正上方
  });

  it('远离可见区域的迷雾格距离很大（保持完整雾量，不透明渐变不误伤深处）', () => {
    const cols = 10;
    const rows = 1;
    const grid = new Array(cols).fill(EXPLORED);
    grid[0] = VISIBLE;
    const d = distMap(grid, cols, rows);
    expect(d[9]).toBe(9);
    expect(d[6]).toBe(6);
  });

  it('全图无可视格时所有距离都保持无穷（整图完整迷雾）', () => {
    const cols = 4;
    const rows = 4;
    const grid = new Array(cols * rows).fill(EXPLORED);
    const d = distMap(grid, cols, rows);
    expect(d.every(v => v >= 1e6)).toBe(true);
  });
});
