import { values } from '../config/index.js';

// 单位选择（gdd.md §11）：左键单选、拖动框选、Shift 增减选。
// 只维护选择状态（单位 id 集合），不直接修改模拟；命令由 orders.js 下发。
// 交互判定（bugfix）：按下即命中己方单位 → 本次是点击单选，绝不进入框选；
// 只有按下空地并拖动超过阈值才进入框选，避免点击单位时的微小抖动触发框选。
// 轨迹绘制期间由 orders 置位 routeBlocked，框选状态随之复位，不留悬挂拖动态。
export function createSelection(scene, world) {
  const selected = new Set();
  const listeners = new Set();
  let pressPoint = null;   // 左键按下位置（尚未判定为框选）
  let pressedUnit = null;  // 按下位置命中的己方存活单位（点击单选目标）
  let dragging = false;    // 拖动超过阈值，进入框选模式
  let dragStart = null;
  let dragEnd = null;
  let routeBlocked = false;

  function notify() {
    for (const listener of listeners) listener();
  }

  function unitAt(p) {
    return world.units.find(unit => unit.state !== 'dead' && unit.faction === 'blue'
      && Math.hypot(unit.x - p.x, unit.y - p.y) <= values.input.clickHitRadius) ?? null;
  }

  function resetPress() {
    pressPoint = null;
    pressedUnit = null;
    dragging = false;
    dragStart = null;
    dragEnd = null;
  }

  scene.input.on('pointerdown', (pointer) => {
    if (pointer.rightButtonDown() || routeBlocked) return;
    resetPress();
    pressPoint = { x: pointer.worldX, y: pointer.worldY };
    pressedUnit = unitAt(pressPoint); // 点在单位上：本次为点击单选
  });

  scene.input.on('pointermove', (pointer) => {
    if (routeBlocked) {
      resetPress(); // 轨迹绘制期间不参与框选
      return;
    }
    if (!pressPoint) return;
    if (pressedUnit) return; // 已命中单位：等待 pointerup 完成单选，不框选
    if (!dragging) {
      const dx = pointer.worldX - pressPoint.x;
      const dy = pointer.worldY - pressPoint.y;
      if (Math.hypot(dx, dy) <= values.input.dragBoxThreshold) return;
      dragging = true; // 超过阈值才真正进入框选：点击过程不绘制选框
      dragStart = { x: pressPoint.x, y: pressPoint.y };
    }
    dragEnd = { x: pointer.worldX, y: pointer.worldY };
  });

  scene.input.on('pointerup', (pointer) => {
    if (pointer.button !== 0) return;
    if (routeBlocked) {
      resetPress(); // 轨迹释放由 orders 处理，这里只复位，避免 dragging 悬挂
      return;
    }
    if (!pressPoint) return;
    const p = { x: pointer.worldX, y: pointer.worldY };
    const boxDragged = dragging;
    const boxStart = dragStart ?? pressPoint;
    resetPress();

    if (!pointer.event.shiftKey) selected.clear();
    if (!boxDragged) {
      // 点击单选：优先按下位置命中的单位，其次抬起位置附近的单位
      const target = pressedUnit ?? unitAt(p);
      if (target) selected.add(target.id);
      notify();
      return;
    }

    const box = {
      left: Math.min(boxStart.x, p.x),
      right: Math.max(boxStart.x, p.x),
      top: Math.min(boxStart.y, p.y),
      bottom: Math.max(boxStart.y, p.y),
    };
    const hits = world.units.filter(unit => unit.state !== 'dead' && unit.faction === 'blue'
      && unit.x > box.left && unit.x < box.right && unit.y > box.top && unit.y < box.bottom);
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
    // 框选矩形（渲染层绘制用）；仅在真正进入框选拖动后非空
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
