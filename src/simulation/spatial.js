import { values } from '../config/index.js';

// 均匀网格空间分区：每 tick 重建一次（O(n)），邻居查询 O(1)/单位。
// 禁止全单位两两检测（REQUIREMENTS.md §5）；格子边长 ≥ 最大攻击距离（config.spatial.cellSize）。
export class SpatialGrid {
  constructor(width, height) {
    this.cellSize = values.spatial.cellSize;
    this.cols = Math.ceil(width / this.cellSize);
    this.rows = Math.ceil(height / this.cellSize);
    this.buckets = new Map();
  }

  rebuild(units) {
    this.buckets.clear();
    for (const unit of units) {
      if (unit.state === 'dead') continue;
      const key = this.cellKeyAt(unit.x, unit.y);
      const bucket = this.buckets.get(key);
      if (bucket) bucket.push(unit);
      else this.buckets.set(key, [unit]);
    }
  }

  cellKeyAt(x, y) {
    const cx = Math.min(this.cols - 1, Math.max(0, Math.floor(x / this.cellSize)));
    const cy = Math.min(this.rows - 1, Math.max(0, Math.floor(y / this.cellSize)));
    return `${cx},${cy}`;
  }

  // 返回以 (x, y) 为圆心、radius 为半径内的存活单位（按桶序，确定性）。
  query(x, y, radius) {
    const results = [];
    const minCx = Math.max(0, Math.floor((x - radius) / this.cellSize));
    const maxCx = Math.min(this.cols - 1, Math.floor((x + radius) / this.cellSize));
    const minCy = Math.max(0, Math.floor((y - radius) / this.cellSize));
    const maxCy = Math.min(this.rows - 1, Math.floor((y + radius) / this.cellSize));
    for (let cy = minCy; cy <= maxCy; cy += 1) {
      for (let cx = minCx; cx <= maxCx; cx += 1) {
        const bucket = this.buckets.get(`${cx},${cy}`);
        if (!bucket) continue;
        for (const unit of bucket) {
          if (Math.hypot(unit.x - x, unit.y - y) <= radius) results.push(unit);
        }
      }
    }
    return results;
  }
}
