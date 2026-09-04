import { FOG_EXPLORED, FOG_UNEXPLORED, FOG_VISIBLE } from '../simulation/systems/fog.js';

// 战争迷雾渲染（gdd.md §9）：按玩家阵营（blue）的三态网格叠加罩层；
// 当前可见透明、已探索半暗、从未探索更暗。仅在网格变化时重绘（逐格比较）。
export function createFogRenderer(scene, world) {
  const graphics = scene.add.graphics().setDepth(1);
  let last = null;

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
    const terrain = world.terrain;
    for (let cy = 0; cy < terrain.rows; cy += 1) {
      for (let cx = 0; cx < terrain.cols; cx += 1) {
        const state = grid[terrain.cellIndex(cx, cy)];
        if (state === FOG_VISIBLE) continue;
        graphics.fillStyle(0x0c1416, state === FOG_UNEXPLORED ? 0.82 : 0.42);
        graphics.fillRect(cx * terrain.cellSize, cy * terrain.cellSize, terrain.cellSize, terrain.cellSize);
      }
    }
  }

  return { sync };
}
