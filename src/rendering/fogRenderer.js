import { FOG_EXPLORED, FOG_UNEXPLORED, FOG_VISIBLE } from '../simulation/systems/fog.js';

// 战争迷雾渲染（gdd.md §9）：按玩家阵营（blue）的三态网格叠加罩层；
// 当前可见透明、已探索半暗、从未探索更暗。仅在网格变化时重绘并重新烘焙纹理，
// 平时以单个 Image 显示（阶段 6 性能优化）。
export function createFogRenderer(scene, world) {
  const terrain = world.terrain;
  const width = terrain.cols * terrain.cellSize;
  const height = terrain.rows * terrain.cellSize;
  const graphics = scene.make.graphics({ x: 0, y: 0, add: false });
  let last = null;
  let image = null;

  function bake() {
    graphics.generateTexture('fog-static', width, height);
    if (!image) {
      image = scene.add.image(0, 0, 'fog-static').setOrigin(0).setDepth(1);
    } else {
      image.setTexture('fog-static');
    }
  }

  function sync() {
    const grid = world.fog.blue;
    if (last) {
      let changed = false;
      for (let i = 0; i < grid.length; i += 1) {
        if (grid[i] !== last[i]) {
          changed = true;
          break;
        }
      }
      if (!changed) return;
    }
    last = Uint8Array.from(grid);
    graphics.clear();
    for (let cy = 0; cy < terrain.rows; cy += 1) {
      for (let cx = 0; cx < terrain.cols; cx += 1) {
        const state = grid[terrain.cellIndex(cx, cy)];
        if (state === FOG_VISIBLE) continue;
        graphics.fillStyle(0x0c1416, state === FOG_UNEXPLORED ? 0.82 : 0.42);
        graphics.fillRect(cx * terrain.cellSize, cy * terrain.cellSize, terrain.cellSize, terrain.cellSize);
      }
    }
    bake();
  }

  return { sync };
}
