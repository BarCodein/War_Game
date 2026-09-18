import { values } from '../config/index.js';

// 战争迷雾渲染（gdd.md §9）：按玩家阵营（blue）叠加罩层；
// 当前可见透明；其余（未探索与已探索但当前不可见）统一叠加「浅色迷雾」——不再有深色遮蔽，
// 地形保持可见，仅以浅雾标识「当前不在视野」。
//
// 视野算法（simulation/systems/fog.js）的规则完全不变：可见区域 = 己方单位/城市/占领点的
// **视野圆**。这里的光滑是纯渲染手段，核心做法是**抛弃格子快照**：
//   旧版把三态格子烘焙成矩形纹理，格子状态只在跨格边界时翻面 → 移动时雾边缘一格一格跳。
//   新版把「雾浓度」定义为格心到最近视野圆的**有符号距离**的连续函数（SDF），
//   每帧按视野源（单位位置是连续坐标）重算一次低分辨率 alpha 纹理，
//   再拉伸到全图 + 双线性过滤 + GPU 模糊。单位每移动 1px，边缘浓度只变化一点点，
//   雾边缘连续滑动，不再有格子翻面的台阶感。
//
// 已探索但当前不可见的区域与未探索区域浓度相同（旧版同样如此，这里保持）；
// 三态网格（FOG_UNEXPLORED / FOG_EXPLORED / FOG_VISIBLE）仍由模拟层维护，本文件只读单位位置。

const FOG_COLOR = 0x0c1416;  // 迷雾颜色（与改动前一致）
const FOG_ALPHA = 0.5;       // 迷雾主体不透明度（与改动前一致）
const SOFT_PX = 30;          // 视野边缘平滑宽度（px，≈3 格）：从全透明到满雾的过渡带

// 高斯模糊参数（Phaser 3.60+ postFX，仅 WebGL）。低分辨率纹理拉伸后 blur 抹掉残余格感。
const BLUR_QUALITY = 1;
const BLUR_X = 2;
const BLUR_Y = 2;
const BLUR_STRENGTH = 1.5;
const BLUR_STEPS = 2;

/**
 * 雾浓度场（纯函数，供单测）：返回每格 0..1 的浓度（0 = 完全透明，1 = 满雾）。
 * 浓度 = clamp((d − 0) / softPx, 0, 1)，其中 d = 格心到最近视野圆的有符号距离
 * （圆内 ≤ 0 → 0；圆外渐增，softPx 处满雾）。多个视野圆重叠时取最近者。
 * @param {number} cols 网格列数
 * @param {number} rows 网格行数
 * @param {number} cellSize 格边长（px）
 * @param {Array<{x:number,y:number,r:number}>} sources 视野源（位置连续坐标 + 半径）
 * @param {number} softPx 平滑宽度（px）
 */
export function fogAlphaField(cols, rows, cellSize, sources, softPx) {
  const half = cellSize / 2;
  const n = cols * rows;
  const signed = new Float32Array(n);
  signed.fill(Infinity);

  for (const source of sources) {
    const reach = source.r + softPx;
    const r2 = source.r * source.r;
    const reach2 = reach * reach;
    const centerCx = Math.floor(source.x / cellSize);
    const centerCy = Math.floor(source.y / cellSize);
    const rCells = Math.ceil(reach / cellSize);
    const cxMin = Math.max(0, centerCx - rCells);
    const cxMax = Math.min(cols - 1, centerCx + rCells);
    const cyMin = Math.max(0, centerCy - rCells);
    const cyMax = Math.min(rows - 1, centerCy + rCells);
    for (let cy = cyMin; cy <= cyMax; cy += 1) {
      const dy = cy * cellSize + half - source.y;
      const dy2 = dy * dy;
      for (let cx = cxMin; cx <= cxMax; cx += 1) {
        const dx = cx * cellSize + half - source.x;
        const d2 = dx * dx + dy2;
        if (d2 > reach2) continue; // 超出平滑范围，不影响该格
        const i = cy * cols + cx;
        const d = d2 <= r2 ? 0 : Math.sqrt(d2) - source.r; // 圆内直接 0，省掉开方
        if (d < signed[i]) signed[i] = d;
      }
    }
  }

  const alpha = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const d = signed[i];
    if (d <= 0) alpha[i] = 0;
    else if (d >= softPx) alpha[i] = 1;
    else alpha[i] = d / softPx;
  }
  return alpha;
}

export function createFogRenderer(scene, world) {
  const terrain = world.terrain;
  const cols = terrain.cols;
  const rows = terrain.rows;
  const cellSize = terrain.cellSize;
  const mapWidth = cols * cellSize;
  const mapHeight = rows * cellSize;

  // 低分辨率 alpha 画布：每格 1 像素（128×72 量级），拉伸到全图后由双线性 + blur 平滑。
  const canvas = document.createElement('canvas');
  canvas.width = cols;
  canvas.height = rows;
  const context = canvas.getContext('2d');
  const imageData = context.createImageData(cols, rows);
  const rgba = imageData.data;

  let image = null;
  let lastSignature = null;

  // 视野源：与 fog.js 的 paintVision 同源同半径（蓝方 = 玩家阵营）。
  function visionSources() {
    const list = [];
    for (const unit of world.units) {
      if (unit.state === 'dead' || unit.faction !== 'blue') continue;
      list.push({ x: unit.x, y: unit.y, r: values.units[unit.type].vision });
    }
    for (const city of world.cities) {
      if (city.faction !== 'blue') continue;
      list.push({ x: city.x, y: city.y, r: values.cities.vision });
    }
    for (const point of world.capturePoints ?? []) {
      if (point.faction !== 'blue') continue;
      list.push({ x: point.x, y: point.y, r: values.capturePoints.vision });
    }
    return list;
  }

  // 源签名：位置（0.1px 精度）+ 半径。单位不动则签名不变，跳过重算。
  function signature(sources) {
    if (sources.length === 0) return '';
    let s = '';
    for (const source of sources) {
      s += `${source.x.toFixed(1)},${source.y.toFixed(1)},${source.r};`;
    }
    return s;
  }

  function sync() {
    const sources = visionSources();
    const sig = signature(sources);
    if (sig === lastSignature) return;
    lastSignature = sig;

    const alpha = fogAlphaField(cols, rows, cellSize, sources, SOFT_PX);
    const r = (FOG_COLOR >> 16) & 0xff;
    const g = (FOG_COLOR >> 8) & 0xff;
    const b = FOG_COLOR & 0xff;
    for (let i = 0; i < alpha.length; i += 1) {
      const o = i * 4;
      rgba[o] = r;
      rgba[o + 1] = g;
      rgba[o + 2] = b;
      rgba[o + 3] = Math.round(alpha[i] * FOG_ALPHA * 255);
    }
    context.putImageData(imageData, 0, 0);

    if (!image) {
      scene.textures.addCanvas('fog-smooth', canvas);
      const texture = scene.textures.get('fog-smooth');
      if (typeof texture.setFilter === 'function') {
        texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
      }
      image = scene.add.image(0, 0, 'fog-smooth').setOrigin(0).setDepth(1);
      image.setDisplaySize(mapWidth, mapHeight);
      // 高斯模糊是 WebGL 专属（postFX 需要 FX 管线）；Canvas 渲染器下跳过，
      // 双线性拉伸 + 30px 渐变依然平滑。
      if (scene.renderer && scene.renderer.pipelines) {
        image.postFX.addBlur(BLUR_QUALITY, BLUR_X, BLUR_Y, BLUR_STRENGTH, 0xffffff, BLUR_STEPS);
      }
    } else {
      scene.textures.get('fog-smooth').refresh();
    }
  }

  return { sync };
}
