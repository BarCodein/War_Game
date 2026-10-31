// 战场覆盖层绘制（单机与联机共用）：
//   框选矩形、拖动中的行军轨迹、己方单位的行军路线（实线 + 末端箭头）、排队路线（虚线）。
//
// 这段代码原本私有在 `GameScene.drawOverlays()` 里。抽出来是因为联机（PvP 对局页）
// 需要**完全一样**的画法（docs/pvp-plan.md §11.15）：样式常量、绘制顺序、箭头与虚线细节
// 都按原样搬运，只把"阵营"和"输入来源"变成参数。
//
// 约定：`graphics` 是 Phaser.Graphics；`world` 只需提供 `units`（含 route/routeIndex/pendingQueue/forcedMarch）。

export const FORCED_ROUTE_COLOR = 0x8c1d1d;   // 急行军（暗红）
export const ROUTE_COLOR = 0x1f2b24;          // 常规行军轨迹（加深墨绿）
export const QUEUE_COLOR = 0x3a4a3d;          // 排队路线
export const DRAG_ROUTE_COLOR = 0x2f2f2f;     // 拖动中的轨迹（深灰）
export const SELECTION_COLOR = 0x111111;

// 轨迹末端箭头：沿行进方向在终点画一个实心三角。
export function drawArrow(graphics, x0, y0, x1, y1, color) {
  const angle = Math.atan2(y1 - y0, x1 - x0);
  const size = 9;
  const spread = 0.5;
  graphics.fillStyle(color, 0.85);
  graphics.fillTriangle(
    x1, y1,
    x1 - Math.cos(angle - spread) * size, y1 - Math.sin(angle - spread) * size,
    x1 - Math.cos(angle + spread) * size, y1 - Math.sin(angle + spread) * size,
  );
}

// 虚线折线：按 dash/gap 长度沿路径推进，逐段 moveTo/lineTo（调用方负责 beginPath/strokePath）。
export function drawDashedPath(graphics, points, dashLength = 12, gapLength = 8) {
  if (points.length < 2) return;
  let drawing = true;
  let remaining = dashLength;
  for (let i = 1; i < points.length; i += 1) {
    let x0 = points[i - 1].x;
    let y0 = points[i - 1].y;
    const x1 = points[i].x;
    const y1 = points[i].y;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const length = Math.hypot(dx, dy);
    if (length === 0) continue;
    const ux = dx / length;
    const uy = dy / length;
    let travelled = 0;
    while (travelled < length) {
      const step = Math.min(remaining, length - travelled);
      const x = x0 + ux * step;
      const y = y0 + uy * step;
      if (drawing) {
        graphics.moveTo(x0, y0);
        graphics.lineTo(x, y);
      }
      x0 = x;
      y0 = y;
      travelled += step;
      remaining -= step;
      if (remaining <= 0) {
        drawing = !drawing;
        remaining = drawing ? dashLength : gapLength;
      }
    }
  }
}

/**
 * 画一帧战场覆盖层。
 * @param {object} graphics Phaser.Graphics
 * @param {object} options
 * @param {object} options.world          世界（读 units[].route/routeIndex/pendingQueue/forcedMarch）
 * @param {'blue'|'red'|null} options.viewerFaction 只画这一方的行军路线（敌方绝不画）；null = 观战，双方都画
 * @param {object} [options.selection]    选择框（需 getDragRect()）
 * @param {Array}  [options.routing]      正在拖的轨迹点
 * @param {boolean}[options.forcedRouting] 正在拖的轨迹是否急行军
 */
export function drawBattleOverlays(graphics, {
  world, viewerFaction, selection = null, routing = null, forcedRouting = false,
}) {
  graphics.clear();

  const rect = selection?.getDragRect?.() ?? null;
  if (rect) {
    graphics.fillStyle(0x000000, 0.08);
    graphics.fillRect(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top);
    graphics.lineStyle(2, SELECTION_COLOR, 1);
    graphics.strokeRect(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top);
  }

  if (routing && routing.length > 1) {
    // 急行军轨迹换色（暗红），与普通行军（深灰）区分
    const color = forcedRouting ? FORCED_ROUTE_COLOR : DRAG_ROUTE_COLOR;
    graphics.lineStyle(4, color, 0.82);
    graphics.beginPath();
    graphics.moveTo(routing[0].x, routing[0].y);
    for (let i = 1; i < routing.length; i += 1) graphics.lineTo(routing[i].x, routing[i].y);
    graphics.strokePath();
    drawArrow(graphics, routing[routing.length - 2].x, routing[routing.length - 2].y,
      routing[routing.length - 1].x, routing[routing.length - 1].y, color);
  }

  // 行军/攻击前进轨迹（move 与 attackMove 均持续显示，含末端箭头）：
  // 未到达终点前不消失，直到单位到达/命令结束；已走过/阵亡/溃逃/到达自然消失。
  // 急行军的轨迹改用暗红，一眼能看出哪些部队在急行军。
  for (const unit of world.units) {
    // 观战（viewerFaction = null）时双方路线都画；参战者只画己方
    if ((viewerFaction && unit.faction !== viewerFaction) || unit.state === 'dead' || unit.state === 'rout') continue;
    const route = unit.route ?? [];
    const routeIndex = unit.routeIndex ?? 0;
    if (route.length > 0 && routeIndex < route.length) {
      const color = unit.forcedMarch ? FORCED_ROUTE_COLOR : ROUTE_COLOR;
      graphics.lineStyle(3, color, 0.9);
      graphics.beginPath();
      graphics.moveTo(unit.x, unit.y);
      for (let i = routeIndex; i < route.length; i += 1) {
        graphics.lineTo(route[i].x, route[i].y);
      }
      graphics.strokePath();
      const lastIndex = route.length - 1;
      const beforeIndex = lastIndex - 1;
      const end = route[lastIndex];
      const start = beforeIndex >= routeIndex ? route[beforeIndex] : { x: unit.x, y: unit.y };
      drawArrow(graphics, start.x, start.y, end.x, end.y, color);
    }
    if (!unit.pendingQueue?.length) continue;
    graphics.lineStyle(2, unit.forcedMarch ? FORCED_ROUTE_COLOR : QUEUE_COLOR, 0.75);
    let tail = route.length > routeIndex
      ? route[route.length - 1]
      : { x: unit.x, y: unit.y };
    for (const segment of unit.pendingQueue) {
      if (!segment.length) continue;
      const points = [tail, ...segment];
      graphics.beginPath();
      drawDashedPath(graphics, points);
      graphics.strokePath();
      tail = segment[segment.length - 1];
    }
    graphics.lineStyle(3, ROUTE_COLOR, 0.9);
  }
}
