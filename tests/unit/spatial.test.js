import { describe, expect, it } from 'vitest';
import { SpatialGrid } from '../../src/simulation/spatial.js';
import { makeUnit } from '../../src/simulation/entities.js';
import { values } from '../../src/config/index.js';

function unitsAt(points) {
  return points.map(([x, y], i) => makeUnit({ id: i + 1, faction: 'blue', type: 'light', x, y }));
}

describe('spatial grid', () => {
  it('rebuild 后 query 能找到范围内的单位', () => {
    const grid = new SpatialGrid(1280, 720);
    grid.rebuild(unitsAt([[100, 100], [300, 300], [100, 110]]));
    expect(grid.query(100, 100, 15).map(u => u.id).sort()).toEqual([1, 3]);
    expect(grid.query(300, 300, 5).map(u => u.id)).toEqual([2]);
    expect(grid.query(1000, 600, 50)).toEqual([]);
  });

  it('跨格子边界查询完整', () => {
    const grid = new SpatialGrid(1280, 720);
    const cell = values.spatial.cellSize; // 64
    grid.rebuild(unitsAt([[63, 63], [65, 65], [10, 63]]));
    // 以 (64, 64) 为圆心半径 10：覆盖 4 个相邻格
    const found = grid.query(64, 64, 10).map(u => u.id).sort();
    expect(found).toContain(1);
    expect(found).toContain(2);
  });

  it('跳过死亡单位', () => {
    const grid = new SpatialGrid(1280, 720);
    const [unit] = unitsAt([[50, 50]]);
    unit.state = 'dead';
    grid.rebuild([unit]);
    expect(grid.query(50, 50, 10)).toEqual([]);
  });

  it('500 单位重建与 100 次范围查询性能基线（宽松上界）', () => {
    const grid = new SpatialGrid(1280, 720);
    const units = [];
    for (let i = 0; i < 500; i += 1) {
      units.push(makeUnit({ id: i, faction: 'blue', type: 'light', x: (i * 37) % 1280, y: (i * 53) % 720 }));
    }
    const start = performance.now();
    grid.rebuild(units);
    for (let i = 0; i < 100; i += 1) grid.query((i * 97) % 1280, (i * 61) % 720, 60);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(2000); // 正常应远小于此（毫秒级）
  });
});
