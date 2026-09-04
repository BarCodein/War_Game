import { values } from '../config/index.js';

// 地形渲染（静态）：四类地形按逻辑网格着色（gdd.md §5），仅创建时绘制一次。
const CELL_COLORS = {
  0: 0xa7c942, // 平原
  1: 0x536426, // 森林
  2: 0x2798ed, // 水域
  3: 0x8a8a92, // 桥梁
};

export function createTerrainRenderer(scene, world) {
  const graphics = scene.add.graphics().setDepth(0);
  const terrain = world.terrain;
  for (let cy = 0; cy < terrain.rows; cy += 1) {
    for (let cx = 0; cx < terrain.cols; cx += 1) {
      const code = terrain.cells[terrain.cellIndex(cx, cy)];
      graphics.fillStyle(CELL_COLORS[code] ?? CELL_COLORS[0], 1);
      graphics.fillRect(cx * terrain.cellSize, cy * terrain.cellSize, terrain.cellSize, terrain.cellSize);
    }
  }
  // 桥面纹理：横纹标记
  graphics.lineStyle(2, 0x6a6a72, 0.9);
  for (let cy = 0; cy < terrain.rows; cy += 1) {
    for (let cx = 0; cx < terrain.cols; cx += 1) {
      if (terrain.cells[terrain.cellIndex(cx, cy)] !== values.terrain.codes.bridge) continue;
      const x = cx * terrain.cellSize;
      const y = cy * terrain.cellSize;
      graphics.lineBetween(x, y + terrain.cellSize / 2, x + terrain.cellSize, y + terrain.cellSize / 2);
    }
  }
  return { graphics };
}
