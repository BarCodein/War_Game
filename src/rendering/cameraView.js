import { values } from '../config/index.js';

// 地图相机（gdd.md §11）：鼠标滚轮以**光标为焦点**缩放，视口始终夹在地图范围内。
//
// 坐标约定：`screen` 是相机内部像素（0..viewport.width/height，也就是游戏分辨率 1280×800 那一套），
// `world` 是世界坐标。Phaser 的相机变换为：
//   world = scroll + viewport/2 + (screen - viewport/2) / zoom
// 因此"让 world 点停在 screen 处"就是反解 scroll。数学部分全是纯函数，便于单测
// （tests/unit/cameraView.test.js），Phaser 接线在 createMapCamera 里。

export function clampZoom(zoom, cfg = values.camera) {
  return Math.min(cfg.zoomMax, Math.max(cfg.zoomMin, zoom));
}

// 相机像素 → 世界坐标
export function worldAt(screen, scroll, zoom, viewport) {
  return {
    x: scroll.x + viewport.width / 2 + (screen.x - viewport.width / 2) / zoom,
    y: scroll.y + viewport.height / 2 + (screen.y - viewport.height / 2) / zoom,
  };
}

// 让 focus 这个世界点仍然落在 screen 处所需的 scroll（未做边界限制）
export function scrollForPoint(focus, screen, zoom, viewport) {
  return {
    x: focus.x - viewport.width / 2 - (screen.x - viewport.width / 2) / zoom,
    y: focus.y - viewport.height / 2 - (screen.y - viewport.height / 2) / zoom,
  };
}

// 把视口夹进地图：可见范围 = [scroll + viewport/2 - viewport/(2·zoom), scroll + viewport/2 + viewport/(2·zoom)]
// 地图比视口还小时（理论上不会，因为 zoomMin = 1）居中显示。
export function clampScroll(scroll, zoom, viewport, mapSize) {
  const halfView = { x: viewport.width / (2 * zoom), y: viewport.height / (2 * zoom) };
  const min = { x: halfView.x - viewport.width / 2, y: halfView.y - viewport.height / 2 };
  const max = {
    x: mapSize.width - viewport.width / 2 - halfView.x,
    y: mapSize.height - viewport.height / 2 - halfView.y,
  };
  const axis = (value, lo, hi, mapLength, viewLength) => {
    if (hi < lo) return (mapLength - viewLength) / 2; // 地图比视口小：居中
    return Math.min(hi, Math.max(lo, value));
  };
  return {
    x: axis(scroll.x, min.x, max.x, mapSize.width, viewport.width),
    y: axis(scroll.y, min.y, max.y, mapSize.height, viewport.height),
  };
}

/**
 * 创建游戏页的地图相机。对外暴露：
 * - `update(dt)`：每帧推进平滑缩放（由 GameScene 调用）
 * - `reset()`：缩放复位到 zoomMin（HUD 的"复位"按钮）
 * - `zoom` / `zoomPercent` / `isZoomed`
 */
export function createMapCamera(scene, world, cfg = values.camera) {
  const camera = scene.cameras.main;
  const viewport = { width: scene.scale.width, height: scene.scale.height };
  const mapSize = { width: world.size.width, height: world.size.height };

  let zoom = clampZoom(cfg.zoomMin, cfg);
  let targetZoom = zoom;
  // 缩放过程中保持不动的世界点，以及它在屏幕上的位置（默认取视口中心 = 地图中心）
  let focus = { x: viewport.width / 2, y: viewport.height / 2 };
  let screen = { x: viewport.width / 2, y: viewport.height / 2 };

  function apply() {
    camera.setZoom(zoom);
    const next = clampScroll(scrollForPoint(focus, screen, zoom, viewport), zoom, viewport, mapSize);
    camera.setScroll(next.x, next.y);
  }

  scene.input.on('wheel', (pointer, gameObjects, deltaX, deltaY) => {
    if (!deltaY) return;
    // 记录当前光标下的世界点与它的屏幕位置：整个平滑过程都让它停在原处
    const scroll = { x: camera.scrollX, y: camera.scrollY };
    screen = { x: pointer.x, y: pointer.y };
    focus = worldAt(screen, scroll, zoom, viewport);
    const next = clampZoom(deltaY < 0 ? targetZoom * cfg.zoomStep : targetZoom / cfg.zoomStep, cfg);
    if (next !== targetZoom) targetZoom = next;
  });

  apply();

  return {
    update(dt) {
      if (zoom === targetZoom) return;
      // 按 60fps 标定的系数换算成与帧率无关的逼近速度
      const k = 1 - Math.pow(1 - cfg.zoomSmoothing, Math.max(0, dt) * 60);
      zoom += (targetZoom - zoom) * k;
      if (Math.abs(targetZoom - zoom) < 0.001) zoom = targetZoom;
      apply();
    },
    reset() {
      // 以"当前视野中心"为焦点回到 1×，避免复位时视野乱跳
      const scroll = { x: camera.scrollX, y: camera.scrollY };
      screen = { x: viewport.width / 2, y: viewport.height / 2 };
      focus = worldAt(screen, scroll, zoom, viewport);
      targetZoom = clampZoom(cfg.zoomMin, cfg);
      if (zoom === targetZoom) apply();
    },
    get zoom() {
      return zoom;
    },
    get zoomPercent() {
      return zoom * 100;
    },
    get isZoomed() {
      return Math.abs(zoom - cfg.zoomMin) > 0.001;
    },
  };
}
