import {
  attackCommand, attackMoveCommand, moveCommand, appendRouteCommand, enqueueRouteCommand,
} from '../simulation/commands.js';
import { isSpotted } from '../simulation/systems/fog.js';
import { values } from '../config/index.js';

// 指挥输入（gdd.md §11）：右键空地 → attackMove，右键目视敌军 → attack；
// 左键从己方单位拖动 → 多路径点 move 轨迹（**不需要先框选**：从哪个单位起笔就指挥哪个单位，
// Shift 起笔则追加到当前选择）。只产出命令（world.issueCommands），与战斗逻辑完全解耦（AGENTS.md）。
export function createOrders(scene, world, selection) {
  let routeMode = false;
  let currentRoute = [];
  let pressedUnit = null; // 本次按下命中的己方单位（决定"单击收拢选择"的目标）
  const listeners = new Set();

  function notify(type) {
    for (const listener of listeners) listener(type);
  }

  // 轨迹总长度：用于区分"点选"和"真的画了一段路径"
  function routeLength(points) {
    let total = 0;
    for (let i = 1; i < points.length; i += 1) {
      total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    }
    return total;
  }

  // 按下位置命中的己方存活单位：取**最近**的一个（单位重叠时按最近的算，而不是数组里第一个）
  function friendlyUnitAt(p) {
    let nearest = null;
    let best = values.input.clickHitRadius;
    for (const unit of world.units) {
      if (unit.state === 'dead' || unit.faction !== 'blue') continue;
      const distance = Math.hypot(unit.x - p.x, unit.y - p.y);
      if (distance <= best) {
        best = distance;
        nearest = unit;
      }
    }
    return nearest;
  }

  scene.input.on('pointerdown', (pointer) => {
    if (pointer.rightButtonDown()) {
      handleRightClick(pointer);
      return;
    }
    const p = { x: pointer.worldX, y: pointer.worldY };
    const shiftHeld = Boolean(pointer.event?.shiftKey || pointer.shiftKey);
    const pressed = friendlyUnitAt(p);

    // 从未选中的单位起笔：先把它设为当前选择（Shift 为追加）。
    // 这样"点击选择"与"直接拖出移动路径"共用同一个按下动作——
    // 到底算哪一种，由抬起时的拖动距离决定（见 pointerup）。
    if (pressed && !selection.isSelected(pressed.id)) {
      selection.select([pressed.id], { additive: shiftHeld });
    }

    // 命中己方单位，或（Shift + 已有选择）在空地上起笔 → 进入轨迹绘制
    pressedUnit = pressed;
    if (pressed || (shiftHeld && selection.selected.size > 0)) {
      routeMode = true;
      currentRoute = [p];
      selection.setRouteBlocked(true);
    }
  });

  scene.input.on('pointermove', (pointer) => {
    if (!routeMode) return;
    const p = { x: pointer.worldX, y: pointer.worldY };
    const last = currentRoute[currentRoute.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) >= values.input.routeSampleDistance) currentRoute.push(p);
  });

  scene.input.on('pointerup', (pointer) => {
    if (!routeMode || pointer.button !== 0) return;
    routeMode = false;
    selection.setRouteBlocked(false);
    // 只有真的拖出了一段路径才下达移动命令：单纯点击（含轻微抖动）只完成选择。
    // 拖动阈值与框选一致（dragBoxThreshold），避免手抖变成一个小距离移动指令。
    const drawn = currentRoute.length > 1 && routeLength(currentRoute) >= values.input.dragBoxThreshold;
    if (drawn) {
      const offset = values.input.routeUnitOffset;
      const commandFactory = pointer.event?.shiftKey || pointer.shiftKey
        ? appendRouteCommand
        : moveCommand;
      [...selection.selected].forEach((id, index) => {
        const shift = index * offset;
        const unit = world.units.find(candidate => candidate.id === id);
        if (!unit || unit.state === 'dead' || unit.state === 'rout') return;
        const anchor = getRouteAnchor(unit);
        const drawnRoute = currentRoute.map(point => ({
          x: point.x + shift,
          y: point.y + shift,
        }));
        const path = commandFactory === appendRouteCommand
          ? [anchor, ...drawnRoute]
          : drawnRoute;
        world.issueCommands([id], commandFactory(
          path,
        ));
      });
      notify(commandFactory === appendRouteCommand ? 'queueAppend' : 'route');
    } else if (pressedUnit) {
      // 没拖动 = 单击：把选择**收拢到点中的这个单位**（Shift 为追加）。
      // 这一步是必需的：轨迹绘制会把 selection 的 pointerup 挡掉，
      // 所以"框选之后单击某个单位"不会自己生效——以前只能先点空地取消选择再重新框选。
      selection.select([pressedUnit.id], {
        additive: Boolean(pointer.event?.shiftKey || pointer.shiftKey),
      });
    }
    pressedUnit = null;
    currentRoute = [];
  });

  function getRouteAnchor(unit) {
    if (unit.pendingQueue?.length > 0) {
      const lastSegment = unit.pendingQueue[unit.pendingQueue.length - 1];
      if (lastSegment?.length > 0) return lastSegment[lastSegment.length - 1];
    }
    if (unit.route.length > unit.routeIndex) return unit.route[unit.route.length - 1];
    return { x: unit.x, y: unit.y };
  }

  function handleRightClick(pointer) {
    const ids = [...selection.selected];
    if (ids.length === 0) return;
    const p = { x: pointer.worldX, y: pointer.worldY };

    if (pointer.event?.shiftKey || pointer.shiftKey) {
      ids.forEach(id => world.issueCommands([id], enqueueRouteCommand(p)));
      notify('queueQueue');
      return;
    }
    const enemy = world.units.find(unit => unit.state !== 'dead' && unit.faction !== 'blue'
      && isSpotted(world, unit, 'blue')
      && Math.hypot(unit.x - p.x, unit.y - p.y) <= values.input.clickHitRadius + unit.radius);
    if (enemy) {
      world.issueCommands(ids, attackCommand(enemy.id));
      notify('orderAttack');
    } else {
      world.issueCommands(ids, attackMoveCommand(p));
      notify('orderMove');
    }
  }

  return {
    isRouting() {
      return routeMode;
    },
    getCurrentRoute() {
      return currentRoute;
    },
    onOrder(listener) {
      listeners.add(listener);
    },
  };
}
