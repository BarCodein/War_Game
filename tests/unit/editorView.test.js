import { describe, expect, it } from 'vitest';
import { fitZoom, mapPixelSize, needsTerrainRebuild } from '../../src/rendering/editorView.js';
import { createNewMap } from '../../src/editor/editorStore.js';

// 回归保护：编辑器改了「地图尺寸」之后，相机缩放与烘焙纹理必须跟着当前尺寸走。
// 原 bug —— 两者都只在 create() 里算一次，于是新建/载入/导入不同尺寸的地图后，
// 可编辑区域与地图当前尺寸不匹配（大地图点不到右侧底部、小地图四周留白、新区域画不出来）。
describe('editor view：尺寸适配', () => {
  const CANVAS = { width: 1280, height: 800 };

  it('fitZoom：地图完整放进画布（取宽高比例的较小值）', () => {
    expect(fitZoom(1280, 800, CANVAS.width, CANVAS.height)).toBe(1);
    expect(fitZoom(1920, 1080, CANVAS.width, CANVAS.height)).toBeCloseTo(1280 / 1920, 6);
    expect(fitZoom(960, 540, CANVAS.width, CANVAS.height)).toBeCloseTo(1280 / 960, 6);
    // 非法尺寸不产生 NaN / 0 缩放
    expect(fitZoom(0, 0, CANVAS.width, CANVAS.height)).toBe(1);
  });

  it('fitZoom：每种画布尺寸下，缩放后的地图都不超出画布', () => {
    for (const [width, height] of [[1920, 1080], [1280, 720], [960, 540], [1600, 900]]) {
      const zoom = fitZoom(width, height, CANVAS.width, CANVAS.height);
      expect(width * zoom).toBeLessThanOrEqual(CANVAS.width + 1e-6);
      expect(height * zoom).toBeLessThanOrEqual(CANVAS.height + 1e-6);
    }
  });

  it('mapPixelSize：取「声明的 size」与「地形格子实际覆盖范围」的较大值', () => {
    expect(mapPixelSize(createNewMap('新地图', 1280, 800))).toEqual({ width: 1280, height: 800 });
    // size 与地形不一致（手改 JSON）时，视野要能覆盖两者，否则漏掉可编辑区域
    const inconsistent = createNewMap('不一致', 960, 540);
    inconsistent.size = { width: 1280, height: 800 };
    expect(mapPixelSize(inconsistent)).toEqual({ width: 1280, height: 800 });
  });

  it('needsTerrainRebuild：尺寸不变不重建，尺寸变化必须重建', () => {
    expect(needsTerrainRebuild({ width: 1280, height: 800 }, { width: 1280, height: 800 })).toBe(false);
    expect(needsTerrainRebuild({ width: 1280, height: 800 }, { width: 1920, height: 1080 })).toBe(true);
    expect(needsTerrainRebuild({ width: 1280, height: 800 }, { width: 1280, height: 720 })).toBe(true);
    expect(needsTerrainRebuild(null, { width: 1280, height: 800 })).toBe(true); // 首次生成
  });
});
