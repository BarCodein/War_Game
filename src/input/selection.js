import { values } from '../config/index.js';

// 单位选择（gdd.md §11）：左键单选、拖动框选、Shift 增减选。
// 只维护选择状态（单位 id 集合），不直接修改模拟；命令由 orders.js 下发。
// 轨迹绘制期间由 orders 置位 routeBlocked，避免框选干扰。
export function createSelection(scene, world) {
  const selected = new Set();
  const listeners = new Set();
  let dragging = false;
  let dragStart = null;
  let dragEnd = null;
  let routeBlocked = false;

  function notify() {
    for (const listener of listeners) listener();
  }

  scene.input.on('pointerdown', (pointer) => {
    if (pointer.rightButtonDown() || routeBlocked) return;
    dragging = true;
    dragStart = { x: pointer.worldX, y: pointer.worldY };
    dragEnd = { ...dragStart };
  });

  scene.input.on('pointermove', (pointer) => {
    if (dragging) dragEnd = { x: pointer.worldX, y: pointer.worldY };
  });

  scene.input.on('pointerup', (pointer) => {
    if (pointer.button !== 0 || routeBlocked || !dragging) return;
    dragging = false;
    const p = { x: pointer.worldX, y: pointer.worldY };
    const box = {
      left: Math.min(dragStart.x, p.x),
      right: Math.max(dragStart.x, p.x),
      top: Math.min(dragStart.y, p.y),
      bottom: Math.max(dragStart.y, p.y),
    };
    const isBox = Math.abs(p.x - dragStart.x) > values.input.dragBoxThreshold
      || Math.abs(p.y - dragStart.y) > values.input.dragBoxThreshold;
    const hits = world.units.filter(unit => unit.state !== 'dead' && unit.faction === 'blue'
      && (isBox
        ? unit.x > box.left && unit.x < box.right && unit.y > box.top && unit.y < box.bottom
        : Math.hypot(unit.x - p.x, unit.y - p.y) <= values.input.clickHitRadius));
    if (!pointer.event.shiftKey) selected.clear();
    for (const unit of hits) selected.add(unit.id);
    notify();
  });

  return {
    selected,
    isSelected(id) {
      return selected.has(id);
    },
    clear() {
      selected.clear();
      notify();
    },
    onChange(listener) {
      listeners.add(listener);
    },
    setRouteBlocked(value) {
      routeBlocked = value;
    },
    // 框选矩形（渲染层绘制用）
    getDragRect() {
      if (!dragging || !dragStart || !dragEnd) return null;
      return {
        left: Math.min(dragStart.x, dragEnd.x),
        right: Math.max(dragStart.x, dragEnd.x),
        top: Math.min(dragStart.y, dragEnd.y),
        bottom: Math.max(dragStart.y, dragEnd.y),
      };
    },
  };
}
