import { describe, expect, it } from 'vitest';
import { values } from '../../src/config/index.js';
import { clampZoom, worldAt, scrollForPoint, clampScroll } from '../../src/rendering/cameraView.js';

// 地图缩放（gdd.md §11）：滚轮以光标为焦点缩放，视口始终夹在地图范围内。
// 这里只测不依赖 Phaser 的数学部分（Phaser 接线在 createMapCamera 里，靠浏览器实测）。
const CFG = values.camera;
const VIEWPORT = { width: 1280, height: 800 };
const MAP = { width: 1280, height: 800 };   // 与本项目现有地图一致（与视口同尺寸）
const BIG_MAP = { width: 2560, height: 1600 };

describe('缩放范围', () => {
  it('夹在 zoomMin ~ zoomMax 之间', () => {
    expect(clampZoom(0.2)).toBe(CFG.zoomMin);
    expect(clampZoom(1.5)).toBe(1.5);
    expect(clampZoom(99)).toBe(CFG.zoomMax);
    expect(clampZoom(CFG.zoomMin)).toBe(CFG.zoomMin);
  });

  it('配置本身自洽：只能放大、步长 > 1', () => {
    expect(CFG.zoomMin).toBe(1);          // 1× = 整图适配，不出现留白
    expect(CFG.zoomMax).toBeGreaterThan(CFG.zoomMin);
    expect(CFG.zoomStep).toBeGreaterThan(1);
  });
});

describe('以光标为焦点缩放', () => {
  it('worldAt 与 scrollForPoint 互为逆运算（焦点在缩放前后落在同一屏幕位置）', () => {
    const screen = { x: 900, y: 300 };
    const scroll = { x: 120, y: 60 };
    const focus = worldAt(screen, scroll, 2, VIEWPORT);
    // 反解出来的 scroll 必须让同一个 world 点回到同一个 screen
    const back = scrollForPoint(focus, screen, 2, VIEWPORT);
    expect(back.x).toBeCloseTo(scroll.x, 6);
    expect(back.y).toBeCloseTo(scroll.y, 6);
  });

  it('放大时光标下的世界点保持不动（视野中心位置不漂移）', () => {
    const screen = { x: 960, y: 200 };           // 右上角附近
    let zoom = 1;
    let scroll = { x: 0, y: 0 };
    const focus = worldAt(screen, scroll, zoom, VIEWPORT);

    for (const next of [1.1, 1.5, 2, 3]) {
      scroll = clampScroll(scrollForPoint(focus, screen, next, VIEWPORT), next, VIEWPORT, BIG_MAP);
      zoom = next;
      const stillThere = worldAt(screen, scroll, zoom, VIEWPORT);
      expect(stillThere.x).toBeCloseTo(focus.x, 6);
      expect(stillThere.y).toBeCloseTo(focus.y, 6);
    }
  });

  it('地图与视口同尺寸时：1× 必须完全对齐（scroll = 0）', () => {
    const scroll = clampScroll({ x: 999, y: -999 }, 1, VIEWPORT, MAP);
    expect(scroll).toEqual({ x: 0, y: 0 });
  });
});

describe('视口夹在地图范围内', () => {
  const visibleRange = (scroll, zoom, viewport) => ({
    left: scroll.x + viewport.width / 2 - viewport.width / (2 * zoom),
    right: scroll.x + viewport.width / 2 + viewport.width / (2 * zoom),
    top: scroll.y + viewport.height / 2 - viewport.height / (2 * zoom),
    bottom: scroll.y + viewport.height / 2 + viewport.height / (2 * zoom),
  });

  it('任意缩放与任意方向的越界请求都被夹回地图内', () => {
    for (const zoom of [1, 1.3, 2, 3]) {
      for (const requested of [
        { x: -5000, y: -5000 }, { x: 5000, y: 5000 },
        { x: -5000, y: 5000 }, { x: 5000, y: -5000 },
      ]) {
        const scroll = clampScroll(requested, zoom, VIEWPORT, BIG_MAP);
        const view = visibleRange(scroll, zoom, VIEWPORT);
        expect(view.left).toBeGreaterThanOrEqual(-1e-6);
        expect(view.top).toBeGreaterThanOrEqual(-1e-6);
        expect(view.right).toBeLessThanOrEqual(BIG_MAP.width + 1e-6);
        expect(view.bottom).toBeLessThanOrEqual(BIG_MAP.height + 1e-6);
      }
    }
  });

  it('地图比视口小时居中（兜底：正常配置下不会出现）', () => {
    const small = { width: 640, height: 400 };
    const scroll = clampScroll({ x: 0, y: 0 }, 1, VIEWPORT, small);
    expect(scroll.x).toBeCloseTo((small.width - VIEWPORT.width) / 2, 6);
    expect(scroll.y).toBeCloseTo((small.height - VIEWPORT.height) / 2, 6);
  });

  it('放大后可见世界范围变小：3× 时只有原来的三分之一', () => {
    const at1 = visibleRange({ x: 0, y: 0 }, 1, VIEWPORT);
    const at3 = visibleRange({ x: 0, y: 0 }, 3, VIEWPORT);
    expect(at3.right - at3.left).toBeCloseTo((at1.right - at1.left) / 3, 6);
    expect(at3.bottom - at3.top).toBeCloseTo((at1.bottom - at1.top) / 3, 6);
  });
});
