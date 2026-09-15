// 编辑器视图的纯函数部分（不依赖 Phaser / DOM，便于单元测试）。
//
// 背景：编辑器的画布缩放与地形烘焙纹理原先只在 create() 里算一次，
// 于是"新建 / 载入 / 导入一张不同尺寸的地图"之后，可编辑区域就和地图当前尺寸对不上了：
//   · 大地图（1920×1080）→ 缩放仍是 1，右侧/底部超出画布，点不到、画不了；
//   · 小地图（960×540）→ 四周大片留白；
//   · 烘焙纹理不会随尺寸重建（Phaser 的 Graphics.generateTexture 对已存在的 key
//     只会画到旧画布上，不会改变画布尺寸），新增区域被裁掉。
// 这两个判断抽成纯函数，既集中了规则，也能被 Vitest 覆盖。

// 让整张地图完整显示在画布内所需的缩放（取宽高比例的较小值）
export function fitZoom(mapWidth, mapHeight, canvasWidth, canvasHeight) {
  if (!(mapWidth > 0) || !(mapHeight > 0) || !(canvasWidth > 0) || !(canvasHeight > 0)) return 1;
  return Math.min(canvasWidth / mapWidth, canvasHeight / mapHeight);
}

// 地图像素尺寸（= 地形格数 × 格子大小）；size 与地形不一致时取较大的那个，
// 保证"能画到的范围"和"已经画出来的范围"都在视野内
export function mapPixelSize(mapData) {
  const gridCellSize = mapData?.gridCellSize ?? 0;
  const terrain = mapData?.terrain ?? {};
  const size = mapData?.size ?? {};
  return {
    width: Math.max(size.width ?? 0, (terrain.width ?? 0) * gridCellSize),
    height: Math.max(size.height ?? 0, (terrain.height ?? 0) * gridCellSize),
  };
}

// 烘焙纹理是否需要重建（尺寸变了就必须重建，否则新区域画不出来）
export function needsTerrainRebuild(current, next) {
  if (!current || !next) return true;
  return current.width !== next.width || current.height !== next.height;
}
