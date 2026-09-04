import { FOG_VISIBLE } from '../simulation/systems/fog.js';

// 战争迷雾渲染（gdd.md §9）：按玩家阵营（blue）的网格叠加罩层；
// 当前可见透明；其余（未探索与已探索但当前不可见）统一叠加「浅色迷雾」——不再有深色遮蔽，
// 地形保持可见，仅以浅雾标识「当前不在视野」。仅在网格变化时重绘并重新烘焙纹理，
// 平时以单个 Image 显示（阶段 6 性能优化）。
export function createFogRenderer(scene, world) {
  const terrain = world.terrain;
  const width = terrain.cols * terrain.cellSize;
  const height = terrain.rows * terrain.cellSize;
  const graphics = scene.make.graphics({ x: 0, y: 0, add: false });
  let last = null;
  let image = null;

  function bake() {
    // 重新烘焙前先清空画布：generateTexture 会在已有画布上叠加绘制，
    // 若不清理，正在变为可见的格子会残留上一帧的迷雾（bugfix：迷雾不随移动更新）。
    const sys = scene.sys;
    if (sys.textures.exists('fog-static')) {
      const tex = sys.textures.get('fog-static');
      if (tex) tex.clear();
    }
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
    // 浅色迷雾：所有当前不可见的格子统一盖一层浅雾（未探索与已探索不再区分深浅）
    for (let cy = 0; cy < terrain.rows; cy += 1) {
      for (let cx = 0; cx < terrain.cols; cx += 1) {
        const state = grid[terrain.cellIndex(cx, cy)];
        if (state === FOG_VISIBLE) continue;
        graphics.fillStyle(0x0c1416, 0.5);
        graphics.fillRect(cx * terrain.cellSize, cy * terrain.cellSize, terrain.cellSize, terrain.cellSize);
      }
    }
    bake();
  }

  return { sync };
}
