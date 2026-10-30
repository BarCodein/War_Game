import {
  attackCommand, attackMoveCommand, moveCommand, appendRouteCommand, enqueueRouteCommand, lockCommand,
} from '../simulation/commands.js';
import { isSpotted } from '../simulation/systems/fog.js';
import { values } from '../config/index.js';

// 指挥输入（gdd.md §11）：右键空地 → attackMove，右键目视敌军 → attack；
// 左键从己方单位拖动 → 多路径点 move 轨迹（**不需要先框选**：从哪个单位起笔就指挥哪个单位，
// Shift 起笔则追加到当前选择）。只产出命令，与战斗逻辑完全解耦（AGENTS.md）。
//
// **执行者注入**（PvP 用）：`options.issue(unitIds, command)` 默认 = `world.issueCommands`（单机本地执行）；
// PvP 传入"打包成一条 cmd 消息发给服务器"的实现即可复用同一套交互。
//
// **急行军**（gdd.md §4）：按住 E 时，右键 = 急行军 attackMove（点敌人也是它，靠近后照常交战）、
// E + 左键拖轨迹 = 急行军 move；E + Shift 的组合沿用追加/排队，只是命令带 forced: true。
export function createOrders(scene, world, selection, options = {}) {
  const getFaction = options.getFaction ?? (() => 'blue');
  const issue = options.issue ?? ((unitIds, command) => world.issueCommands(unitIds, command));
  let routeMode = false;
  let currentRoute = [];
  let pressedUnit = null; // 本次按下命中的己方单位（决定"单击收拢选择"的目标）
  let forcedRoute = false; // 本次拖出的轨迹是否急行军（按下时按 E 的状态定一次）
  const listeners = new Set();

  // E 键状态：pointer 事件里拿不到字母键，所以单独挂一个 Key 对象。
  const forcedKey = scene.input.keyboard?.addKey?.('E') ?? null;
  const forcedHeld = () => Boolean(forcedKey?.isDown);

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
      if (unit.state === 'dead' || unit.faction !== getFaction()) continue;
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
      forcedRoute = forcedHeld(); // 按下时按一次 E 的状态决定这条轨迹是否急行军
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
      const append = pointer.event?.shiftKey || pointer.shiftKey;

      // 一次拖拽 = 一批命令（每个单位一条绝对路径，保持队形）；执行者由 options.issue 注入：
      //   战役 → world.issueCommands（本地）；PvP → 打包成一条 cmd 消息发给服务器
      const orders = buildFormationOrders([...selection.selected], currentRoute, {
        append,
        forced: forcedRoute,
        world,
      });
      for (const order of orders) issue(order.unitIds, order.command);
      notify(append ? 'queueAppend' : (forcedRoute ? 'routeForced' : 'route'));
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
    forcedRoute = false;
  });

  function handleRightClick(pointer) {
    const ids = [...selection.selected];
    if (ids.length === 0) return;
    const p = { x: pointer.worldX, y: pointer.worldY };
    const forced = forcedHeld(); // 按住 E：急行军（点敌人也是急行军 attackMove，靠近后照常交战）
    const faction = getFaction();

    if (pointer.event?.shiftKey || pointer.shiftKey) {
      ids.forEach(id => issue([id], enqueueRouteCommand(p, { forced })));
      notify('queueQueue');
      return;
    }
    if (forced) {
      issue(ids, attackMoveCommand(p, { forced: true }));
      notify('orderForcedMove');
      return;
    }
    const enemy = world.units.find(unit => unit.state !== 'dead' && unit.faction !== faction
      && isSpotted(world, unit, faction)
      && Math.hypot(unit.x - p.x, unit.y - p.y) <= values.input.clickHitRadius + unit.radius);
    if (enemy) {
      issue(ids, lockCommand(enemy.id));
      notify('orderAttack');
    } else {
      issue(ids, attackMoveCommand(p));
      notify('orderMove');
    }
  }

  return {
    isRouting() {
      return routeMode;
    },
    // 当前正在拖的轨迹是否急行军（渲染层据此换色）
    isForcedRouting() {
      return routeMode && forcedRoute;
    },
    getCurrentRoute() {
      return currentRoute;
    },
    onOrder(listener) {
      listeners.add(listener);
    },
  };
}

/**
 * 追加路线时的锚点：pendingQueue 尾 → route 尾 → 自身坐标。
 * （抽成模块级函数，便于单测与 PvP 复用）
 */
export function routeAnchorOf(unit) {
  if (unit.pendingQueue?.length > 0) {
    const lastSegment = unit.pendingQueue[unit.pendingQueue.length - 1];
    if (lastSegment?.length > 0) return lastSegment[lastSegment.length - 1];
  }
  if (unit.route?.length > unit.routeIndex) return unit.route[unit.route.length - 1];
  return { x: unit.x, y: unit.y };
}

/**
 * 把"玩家拖出的一条轨迹"翻译成**每个单位一条绝对路径命令**（这是保持队形的关键：
 * 轨迹只提供相对位移，每个单位把它叠加到自己身上，因此队形不会全部挤到同一条线上）。
 *
 * 纯函数（不碰 Phaser / 网络），战役与 PvP 共用；单测见 tests/unit/pvp-formation-orders.test.js。
 * @param {number[]} unitIds 选中单位
 * @param {{x:number,y:number}[]} drawnRoute 拖出的轨迹（≥ 2 个点）
 * @param {{append?: boolean, forced?: boolean, world?: object}} options
 * @returns {{unitIds: number[], command: object}[]}
 */
export function buildFormationOrders(unitIds, drawnRoute, { append = false, forced = false, world } = {}) {
  if (!Array.isArray(drawnRoute) || drawnRoute.length < 2) return [];
  const start = drawnRoute[0];
  const relative = drawnRoute.map((point) => ({ x: point.x - start.x, y: point.y - start.y }));

  const orders = [];
  for (const id of unitIds ?? []) {
    const unit = world?.units?.find((candidate) => candidate.id === id);
    if (!unit || unit.state === 'dead' || unit.state === 'rout') continue;
    const anchor = routeAnchorOf(unit);
    const base = append ? anchor : { x: unit.x, y: unit.y };
    const absolute = relative.map((delta) => ({ x: base.x + delta.x, y: base.y + delta.y }));
    const path = append ? [anchor, ...absolute.slice(1)] : absolute;
    orders.push({
      unitIds: [unit.id],
      command: append ? appendRouteCommand(path, { forced }) : moveCommand(path, { forced }),
    });
  }
  return orders;
}
