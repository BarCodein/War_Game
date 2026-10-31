import { describe, expect, it } from 'vitest';
import { coverZoomFor, clampZoom, clampScroll, scrollForPoint, worldAt } from '../../src/rendering/cameraView.js';
import { values } from '../../src/config/index.js';

// §11.26：PvP 相机改为 cover（按"填满视口"自动缩放，不拉伸），放不下的部分靠平移弥补。
describe('cover 缩放：地图始终铺满视口', () => {
  const MAP = { width: 1280, height: 800 };

  it('1920×1080 → 取较大比例（宽 1.5 / 高 1.35 → 1.5）', () => {
    const zoom = coverZoomFor({ width: 1920, height: 1080 }, MAP);
    expect(zoom).toBeCloseTo(1.5, 6);
    expect(zoom * MAP.width).toBeGreaterThanOrEqual(1920);
    expect(zoom * MAP.height).toBeGreaterThanOrEqual(1080);
  });

  it('1280×800（与地图同比例）→ 1', () => {
    expect(coverZoomFor(MAP, MAP)).toBeCloseTo(1, 6);
  });

  it('窗口比地图还小 → 小于 1（缩小而不是留黑边）', () => {
    const zoom = coverZoomFor({ width: 640, height: 400 }, MAP);
    expect(zoom).toBeCloseTo(0.5, 6);
  });

  it('任何尺寸下"缩放后的地图"都覆盖视口（不拉伸、无黑边）', () => {
    for (const [w, h] of [[1920, 1080], [2560, 1080], [1280, 800], [1024, 768], [800, 600], [3840, 2160]]) {
      const zoom = coverZoomFor({ width: w, height: h }, MAP);
      expect(zoom * MAP.width).toBeGreaterThanOrEqual(w - 1e-9);
      expect(zoom * MAP.height).toBeGreaterThanOrEqual(h - 1e-9);
    }
  });

  it('clampZoom 支持 cover 下限：低于下限会被抬上来', () => {
    const floor = coverZoomFor({ width: 1920, height: 1080 }, MAP);
    expect(clampZoom(1, values.camera, floor)).toBeCloseTo(floor, 6);
    expect(clampZoom(2, values.camera, floor)).toBeCloseTo(2, 6);
    expect(clampZoom(99, values.camera, floor)).toBeCloseTo(values.camera.zoomMax, 6);
  });
});

describe('cover 下的平移与对准', () => {
  const MAP = { width: 1280, height: 800 };
  const viewport = { width: 1920, height: 1080 };
  const zoom = coverZoomFor(viewport, MAP);

  it('可见范围不超过地图（平移被夹在边界内）', () => {
    const halfView = { x: viewport.width / (2 * zoom), y: viewport.height / (2 * zoom) };
    expect(halfView.x * 2).toBeLessThanOrEqual(MAP.width + 1e-9);
    expect(halfView.y * 2).toBeLessThanOrEqual(MAP.height + 1e-9);

    // 把视野推到极左/极右，都应落在合法区间里
    const left = clampScroll({ x: -9999, y: -9999 }, zoom, viewport, MAP);
    const right = clampScroll({ x: 9999, y: 9999 }, zoom, viewport, MAP);
    expect(left.x).toBeLessThanOrEqual(right.x);
    expect(left.y).toBeLessThanOrEqual(right.y);
    // 视野中心必须在地图内
    for (const scroll of [left, right]) {
      const center = { x: scroll.x + viewport.width / 2, y: scroll.y + viewport.height / 2 };
      expect(center.x).toBeGreaterThanOrEqual(0);
      expect(center.x).toBeLessThanOrEqual(MAP.width);
      expect(center.y).toBeGreaterThanOrEqual(0);
      expect(center.y).toBeLessThanOrEqual(MAP.height);
    }
  });

  it('对准某点：该世界点落在视野正中（且在边界内时精确）', () => {
    const focus = { x: 640, y: 400 };
    const screen = { x: viewport.width / 2, y: viewport.height / 2 };
    const scroll = scrollForPoint(focus, screen, zoom, viewport);
    const clamped = clampScroll(scroll, zoom, viewport, MAP);
    const back = worldAt(screen, clamped, zoom, viewport);
    expect(back.x).toBeCloseTo(focus.x, 6);
    expect(back.y).toBeCloseTo(focus.y, 6);
  });
});
