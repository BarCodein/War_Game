import {
  attackCommand, attackMoveCommand, moveCommand, appendRouteCommand, enqueueRouteCommand,
} from '../simulation/commands.js';
import { isSpotted } from '../simulation/systems/fog.js';
import { values } from '../config/index.js';

// 指挥输入（gdd.md §11）：右键空地 → attackMove，右键目视敌军 → attack；
// 从已选单位左键拖动 → 多路径点 move 轨迹。只产出命令（world.issueCommands），
// 与战斗逻辑完全解耦（AGENTS.md）。
export function createOrders(scene, world, selection) {
  let routeMode = false;
  let currentRoute = [];
  const listeners = new Set();

  function notify(type) {
    for (const listener of listeners) listener(type);
  }

  scene.input.on('pointerdown', (pointer) => {
    if (pointer.rightButtonDown()) {
      handleRightClick(pointer);
      return;
    }
    // 命中已选单位 → 开始轨迹绘制
    const p = { x: pointer.worldX, y: pointer.worldY };
    const shiftHeld = pointer.event?.shiftKey || pointer.shiftKey;
    const hit = world.units.find(unit => unit.state !== 'dead' && unit.faction === 'blue'
      && selection.isSelected(unit.id)
      && Math.hypot(unit.x - p.x, unit.y - p.y) <= values.input.clickHitRadius);
    if (hit || (shiftHeld && selection.selected.size > 0)) {
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
    if (currentRoute.length > 1) {
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
    }
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
