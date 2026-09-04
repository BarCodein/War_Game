import { values } from '../config/index.js';

// 地形渲染（静态）：四类地形按逻辑网格着色（gdd.md §5）。
// 烘焙为纹理一次后以单个 Image 显示，避免每帧重放数千矩形的 Graphics 命令
// （性能基线见 acceptance G3；阶段 6 优化）。
const CELL_COLORS = {
  0: 0xa7c942, // 平原
  1: 0x536426, // 森林
  2: 0x2798ed, // 水域
  3: 0x8a8a92, // 桥梁
};

export function createTerrainRenderer(scene, world) {
  const terrain = world.terrain;
  const graphics = scene.make.graphics({ x: 0, y: 0, add: false });
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
  graphics.generateTexture('terrain-static', terrain.cols * terrain.cellSize, terrain.rows * terrain.cellSize);
  graphics.destroy();
  const image = scene.add.image(0, 0, 'terrain-static').setOrigin(0).setDepth(0);
  return { image };
}
