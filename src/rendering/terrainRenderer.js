import { values } from '../config/index.js';

// 地形 / 背景渲染（静态，depth 0）：
// - 地图 JSON 指定 background 时，直接以该图片铺满地图（拉伸到地图尺寸），不再绘制逻辑地形；
// - 未指定 background 时保持原逻辑地形烘焙（基准页、旧地图等）；
// - 背景图加载失败时回退到逻辑地形烘焙，避免地图整片空白。
// 注意：逻辑地形仍照常参与寻路/通行/视野判定，这里只改变「背景长什么样」。

const CELL_COLORS = {
  0: 0xa7c942, // 平原
  1: 0x536426, // 森林
  2: 0x2798ed, // 水域
  3: 0x8a8a92, // 桥梁
  4: 0x8f6b45, // 山地
  5: 0x4b3d32, // 高山
  6: 0xd6b35a, // 道路
};

const BACKGROUND_KEY_PREFIX = 'map-background::';

export function createTerrainRenderer(scene, world) {
  const background = world.map.background;
  let image = null;
  let fallback = null;

  if (!background) {
    fallback = bakeTerrain(scene, world);
    return { get image() { return image ?? fallback; } };
  }

  // BootScene 预加载时还拿不到地图里的路径，因此这里按需在运行时加载并写入纹理管理器。
  const key = `${BACKGROUND_KEY_PREFIX}${background}`;
  if (scene.textures.exists(key)) {
    image = addBackground(scene, world, key);
  } else {
    loadTexture(scene, key, background, () => {
      if (!isSceneAlive(scene)) return;
      image = addBackground(scene, world, key);
      if (fallback) {
        fallback.destroy();
        fallback = null;
      }
    }, () => {
      if (!isSceneAlive(scene) || image) return;
      fallback = bakeTerrain(scene, world); // 仅加载失败才回退
    });
  }

  return { get image() { return image ?? fallback; } };
}

function isSceneAlive(scene) {
  return Boolean(scene?.sys?.isActive?.());
}

function addBackground(scene, world, key) {
  return scene.add.image(0, 0, key)
    .setOrigin(0)
    .setDepth(0)
    .setDisplaySize(world.size.width, world.size.height);
}

// 运行时加载图片纹理（同源，无需 CORS）
function loadTexture(scene, key, url, onReady, onError) {
  const img = new Image();
  img.onload = () => {
    if (!isSceneAlive(scene)) return;
    if (!scene.textures.exists(key)) scene.textures.addImage(key, img);
    onReady();
  };
  img.onerror = () => {
    if (isSceneAlive(scene)) onError();
  };
  img.src = url;
}

// 逻辑地形烘焙：无 background 时使用；背景加载失败时作为兜底。
// 烘焙为纹理一次后以单个 Image 显示，避免每帧重放数千矩形的 Graphics 命令。
function bakeTerrain(scene, world) {
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
  return scene.add.image(0, 0, 'terrain-static').setOrigin(0).setDepth(0);
}
