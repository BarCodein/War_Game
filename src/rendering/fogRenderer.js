import { FOG_VISIBLE } from '../simulation/systems/fog.js';

// 战争迷雾渲染（gdd.md §9）：按玩家阵营（blue）的网格叠加罩层；
// 当前可见透明；其余（未探索与已探索但当前不可见）统一叠加「浅色迷雾」——不再有深色遮蔽，
// 地形保持可见，仅以浅雾标识「当前不在视野」。
//
// 三态网格与视野算法（simulation/systems/fog.js）完全不变，这里的「光滑」只是渲染手段：
//   1) 边缘渐变：对三态网格做一次距离变换（只读），离可见格越近的迷雾格透明度越低，
//      硬边矩形退化成约 SOFT_CELLS 格宽的软过渡带，边界不再是直角台阶；
//   2) GPU 模糊：WebGL 下对烘焙好的迷雾纹理再做一次高斯模糊，抹掉格子步进，
//      边界呈连续圆滑过渡；Canvas 渲染器自动退化为仅用渐变（仍比原来的硬边平滑）。
// 仅在网格变化时重绘并重新烘焙纹理，平时以单个 Image 显示（阶段 6 性能优化）。

const FOG_COLOR = 0x0c1416;  // 迷雾颜色（与改动前一致）
const FOG_ALPHA = 0.5;       // 迷雾主体不透明度（与改动前一致）
const SOFT_CELLS = 2;        // 从可见边界向迷雾内渐变的宽度（格）
const DIST_INF = 1e6;        // 距离变换初始值（表示「到可见格不可达」）

// 高斯模糊参数（Phaser 3.60+ postFX，仅 WebGL）。quality 1 = 9 抽头高斯核，
// offset/strength/steps 合起来约 1 格（10px）量级：只抹平格子棱角，不糊化迷雾主体。
const BLUR_QUALITY = 1;
const BLUR_X = 2;
const BLUR_Y = 2;
const BLUR_STRENGTH = 1.2;
const BLUR_STEPS = 2;

// 两趟 Chamfer 距离变换：计算每个格子到最近「可见格」的距离（单位：格）。
// 只读 grid，不修改任何三态；结果写入 dist（0 = 该格本身可见）。4 邻域权重 1、对角权重 2，
// 是欧氏距离的良好近似，且纯整数运算，在网格变化时才跑一次，开销可忽略。
export function distanceToVisible(grid, cols, rows, dist) {
  const n = cols * rows;
  for (let i = 0; i < n; i += 1) dist[i] = grid[i] === FOG_VISIBLE ? 0 : DIST_INF;
  for (let cy = 0; cy < rows; cy += 1) {
    for (let cx = 0; cx < cols; cx += 1) {
      const i = cy * cols + cx;
      if (dist[i] === 0) continue;
      let best = dist[i];
      if (cx > 0 && dist[i - 1] + 1 < best) best = dist[i - 1] + 1;
      if (cy > 0 && dist[i - cols] + 1 < best) best = dist[i - cols] + 1;
      if (cx > 0 && cy > 0 && dist[i - cols - 1] + 2 < best) best = dist[i - cols - 1] + 2;
      if (cx < cols - 1 && cy > 0 && dist[i - cols + 1] + 2 < best) best = dist[i - cols + 1] + 2;
      dist[i] = best;
    }
  }
  for (let cy = rows - 1; cy >= 0; cy -= 1) {
    for (let cx = cols - 1; cx >= 0; cx -= 1) {
      const i = cy * cols + cx;
      if (dist[i] === 0) continue;
      let best = dist[i];
      if (cx < cols - 1 && dist[i + 1] + 1 < best) best = dist[i + 1] + 1;
      if (cy < rows - 1 && dist[i + cols] + 1 < best) best = dist[i + cols] + 1;
      if (cx < cols - 1 && cy < rows - 1 && dist[i + cols + 1] + 2 < best) best = dist[i + cols + 1] + 2;
      if (cx > 0 && cy < rows - 1 && dist[i + cols - 1] + 2 < best) best = dist[i + cols - 1] + 2;
      dist[i] = best;
    }
  }
  return dist;
}

export function createFogRenderer(scene, world) {
  const terrain = world.terrain;
  const width = terrain.cols * terrain.cellSize;
  const height = terrain.rows * terrain.cellSize;
  const graphics = scene.make.graphics({ x: 0, y: 0, add: false });
  const dist = new Float64Array(terrain.cols * terrain.rows);
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
      // 高斯模糊是 WebGL 专属（postFX 需要 FX 管线，与 Phaser 内部 enable() 同判据）；
      // Canvas 渲染器下跳过，距离渐变依然提供平滑边界。
      if (scene.renderer && scene.renderer.pipelines) {
        image.postFX.addBlur(BLUR_QUALITY, BLUR_X, BLUR_Y, BLUR_STRENGTH, 0xffffff, BLUR_STEPS);
      }
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
    distanceToVisible(grid, terrain.cols, terrain.rows, dist);
    graphics.clear();
    // 浅色迷雾：所有当前不可见的格子统一盖一层浅雾（未探索与已探索不再区分深浅），
    // 但靠近可见边界的格子按距离渐变减淡，硬边变成软过渡。
    for (let cy = 0; cy < terrain.rows; cy += 1) {
      for (let cx = 0; cx < terrain.cols; cx += 1) {
        const i = terrain.cellIndex(cx, cy);
        if (grid[i] === FOG_VISIBLE) continue;
        const fade = Math.min(1, (dist[i] - 0.5) / SOFT_CELLS);
        if (fade <= 0) continue;
        graphics.fillStyle(FOG_COLOR, FOG_ALPHA * fade);
        graphics.fillRect(cx * terrain.cellSize, cy * terrain.cellSize, terrain.cellSize, terrain.cellSize);
      }
    }
    bake();
  }

  return { sync };
}
