import { values } from '../config/index.js';

// 地图相机（gdd.md §11）：鼠标滚轮以**光标为焦点**缩放，视口始终夹在地图范围内。
//
// 坐标约定：`screen` 是相机内部像素（0..viewport.width/height，也就是游戏分辨率 1280×800 那一套），
// `world` 是世界坐标。Phaser 的相机变换为：
//   world = scroll + viewport/2 + (screen - viewport/2) / zoom
// 因此"让 world 点停在 screen 处"就是反解 scroll。数学部分全是纯函数，便于单测
// （tests/unit/cameraView.test.js），Phaser 接线在 createMapCamera 里。

export function clampZoom(zoom, cfg = values.camera, minZoom = cfg.zoomMin) {
  return Math.min(cfg.zoomMax, Math.max(minZoom, zoom));
}

/**
 * "填满视口"的最小缩放：max(宽比, 高比)。
 * 不拉伸地图 —— 取较大的那个比例保证两个方向都铺满，代价是较短的方向会被裁掉一部分，
 * 靠平移弥补（PvP 用 cover；战役仍是 1:1 的 contain）。
 */
export function coverZoomFor(viewport, mapSize) {
  if (!mapSize?.width || !mapSize?.height) return 1;
  return Math.max(viewport.width / mapSize.width, viewport.height / mapSize.height);
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

  const cover = cfg.cover === true;
  const minZoom = () => (cover ? Math.max(cfg.zoomMin, coverZoomFor(viewport, mapSize)) : cfg.zoomMin);
  let zoom = clampZoom(cfg.zoomMin, cfg, minZoom());
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
    const next = clampZoom(deltaY < 0 ? targetZoom * cfg.zoomStep : targetZoom / cfg.zoomStep, cfg, minZoom());
    if (next !== targetZoom) targetZoom = next;
  });

  apply();

  // 平移：屏幕像素位移 → 世界位移（方向与"抓住地图拖动"一致）
  function panByScreen(dxScreen, dyScreen) {
    const scroll = { x: camera.scrollX - dxScreen / zoom, y: camera.scrollY - dyScreen / zoom };
    const next = clampScroll(scroll, zoom, viewport, mapSize);
    camera.setScroll(next.x, next.y);
  }

  // 把某个世界点摆到视野正中
  function centerOn(point) {
    if (!point) return;
    screen = { x: viewport.width / 2, y: viewport.height / 2 };
    focus = { x: point.x, y: point.y };
    const scroll = clampScroll(scrollForPoint(focus, screen, zoom, viewport), zoom, viewport, mapSize);
    camera.setScroll(scroll.x, scroll.y);
  }

  const edgePan = cfg.edgePan ?? null;

  return {
    /** @param {number} dt 秒；@param {{x:number,y:number}|null} pointer 屏幕坐标（可选，传了才做边缘推屏） */
    update(dt, pointer = null) {
      if (edgePan && pointer) {
        const margin = edgePan.margin ?? 28;
        const speed = (edgePan.speed ?? 1000) / Math.max(zoom, 0.0001) * Math.max(0, dt);
        let dx = 0;
        let dy = 0;
        if (pointer.x < margin) dx = -(margin - pointer.x) / margin * speed;
        else if (pointer.x > viewport.width - margin) dx = (pointer.x - (viewport.width - margin)) / margin * speed;
        if (pointer.y < margin) dy = -(margin - pointer.y) / margin * speed;
        else if (pointer.y > viewport.height - margin) dy = (pointer.y - (viewport.height - margin)) / margin * speed;
        if (dx || dy) panByScreen(-dx, -dy);
      }
      if (zoom === targetZoom) return;
      // 按 60fps 标定的系数换算成与帧率无关的逼近速度
      const k = 1 - Math.pow(1 - cfg.zoomSmoothing, Math.max(0, dt) * 60);
      zoom += (targetZoom - zoom) * k;
      if (Math.abs(targetZoom - zoom) < 0.001) zoom = targetZoom;
      apply();
    },
    reset() {
      // 以"当前视野中心"为焦点回到最小缩放（战役 1×；PvP = 填满视口的 cover 值）
      const scroll = { x: camera.scrollX, y: camera.scrollY };
      screen = { x: viewport.width / 2, y: viewport.height / 2 };
      focus = worldAt(screen, scroll, zoom, viewport);
      targetZoom = clampZoom(minZoom(), cfg, minZoom());
      if (zoom === targetZoom) apply();
    },
    panByScreen,
    centerOn,
    /** 视口尺寸变化后调用：重算 cover 下限，并保持"当前视野中心"不跳 */
    setViewport(width, height) {
      const center = worldAt({ x: viewport.width / 2, y: viewport.height / 2 },
        { x: camera.scrollX, y: camera.scrollY }, zoom, viewport);
      viewport.width = width;
      viewport.height = height;
      const floor = minZoom();
      if (zoom < floor) { zoom = floor; targetZoom = Math.max(targetZoom, floor); }
      screen = { x: width / 2, y: height / 2 };
      focus = center;
      apply();
    },
    get minZoom() {
      return minZoom();
    },
    get zoom() {
      return zoom;
    },
    get zoomPercent() {
      return zoom * 100;
    },
    get isZoomed() {
      return Math.abs(zoom - minZoom()) > 0.001;
    },
  };
}
