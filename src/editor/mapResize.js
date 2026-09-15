// 编辑器画布尺寸适配（纯数据操作，无 DOM/Phaser 依赖，可单测）。
//
// 为什么需要：游戏画布固定 1280×800，而地图可以更小（编辑器预设里就有 1280×720）。
// 地图比画布小时会出现两个问题：
//   · 编辑器里画布多出来的那条区域不属于地图，点了没用（"边缘无法编辑"）；
//   · 试玩时画布那条区域既没有渲染，又可能被点击下令（单位会走过去）。
// 因此编辑器打开/新建/导入地图时，把地图**补齐**到至少等于画布尺寸（只扩不裁），
// 新增格为平原，已有地形与城市/出生点/占领点坐标原样保留。

import { values } from '../config/index.js';

/**
 * 把地图补齐到至少 minWidth × minHeight（只扩不裁）。
 * @returns {{ mapData: object, resized: boolean }} resized=false 时返回原对象引用
 */
export function fitMapToCanvas(mapData, minWidth, minHeight) {
  const gridCellSize = mapData?.gridCellSize ?? values.terrain.gridCellSize;
  const size = mapData?.size ?? { width: 0, height: 0 };
  const terrain = mapData?.terrain ?? { width: 0, height: 0, cells: [] };

  const width = Math.max(size.width, minWidth);
  const height = Math.max(size.height, minHeight);
  if (width === size.width && height === size.height) return { mapData, resized: false };

  const cols = Math.round(width / gridCellSize);
  const rows = Math.round(height / gridCellSize);
  const cells = new Array(cols * rows).fill(values.terrain.codes.plain);
  for (let cy = 0; cy < terrain.height; cy += 1) {
    for (let cx = 0; cx < terrain.width; cx += 1) {
      if (cx >= cols || cy >= rows) continue; // 只扩不裁，越界格丢弃（正常不会发生）
      cells[cy * cols + cx] = terrain.cells[cy * terrain.width + cx];
    }
  }

  return {
    mapData: {
      ...mapData,
      size: { width: cols * gridCellSize, height: rows * gridCellSize },
      terrain: { width: cols, height: rows, cells },
    },
    resized: true,
  };
}
