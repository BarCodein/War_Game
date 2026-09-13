import Phaser from 'phaser';
import { World } from '../../simulation/world.js';
import { createLoop } from '../../simulation/loop.js';
import { ScriptedAI } from '../../simulation/ai.js';
import { deployForces } from '../../simulation/level.js';
import { createTerrainRenderer } from '../terrainRenderer.js';
import { createFogRenderer } from '../fogRenderer.js';
import { createUnitRenderer } from '../unitRenderer.js';
import { createControlLineRenderer } from '../controlLineRenderer.js';
import { createHud } from '../hud.js';
import { createSelection } from '../../input/selection.js';
import { createOrders } from '../../input/orders.js';
import { createKeyboard } from '../../input/keyboard.js';
import { createGameController } from '../../controllers/gameController.js';
import { t } from '../../i18n/index.js';

// 轨迹末端箭头：沿行进方向在终点画一个实心三角。
function drawArrow(graphics, x0, y0, x1, y1, color) {
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

function drawDashedPath(graphics, points, dashLength = 12, gapLength = 8) {
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

// 游戏主场景：组装模拟层 + 渲染层 + 输入层 + 控制器（architecture.md §3 数据流）。
// 渲染只读世界状态；输入只产命令；模拟由固定步长 loop 推进。
export class GameScene extends Phaser.Scene {
  constructor() {
    super({ key: 'Game' });
  }

  init(data) {
    this.mapData = data.mapData;
    this.level = data.level ?? null;            // 关卡规格（标准格式，见 simulation/level.js）
    this.levelIndex = data.levelIndex ?? [];    // 关卡索引（供「下一关」导航）
    this.campaignId = this.level?.id ?? null;   // 存档与进度使用的关卡 id
    this.requestedLevelId = data.levelId ?? null; // 请求载入的关卡 id（失败时用于提示）
    this.levelError = data.levelError ?? null;  // 关卡载入/引用校验错误（非空时画面顶部显示横幅）
    this.fromEditor = data.fromEditor === true;
  }

  create() {
    document.body.classList.remove('editor-mode');
    const world = new World(this.mapData);
    this.world = world;
    if (this.level && !this.fromEditor) {
      // 关卡模式：兵力部署与敌方脚本全部来自关卡 JSON，引擎不包含任何关卡特例代码。
      // anchors 是关卡的命名锚点表，at / target 里的 { anchor } 都靠它解析。
      const anchors = this.level.anchors;
      deployForces(world, this.level.forces, anchors);
      this.ai = this.level.ai
        ? new ScriptedAI(world, { faction: this.level.ai.faction, script: this.level.ai, anchors })
        : null;
    } else {
      // 沙盒模式（编辑器试玩 / 关卡不可用）：仅按地图出生点部署，无脚本敌军
      world.spawnInitial();
      this.ai = null;
    }

    this.controller = createGameController();
    this.loop = createLoop(world);

    // 输入层（只产命令/选择状态）
    this.selection = createSelection(this, world);
    this.orders = createOrders(this, world, this.selection);
    createKeyboard(this, this.controller, this.selection);

    // 渲染层（只读状态）
    this.terrainRenderer = createTerrainRenderer(this, world);
    this.fogRenderer = createFogRenderer(this, world);
    this.unitRenderer = createUnitRenderer(this, world, this.selection);
    this.controlLineRenderer = createControlLineRenderer(this, world);
    this.overlayGraphics = this.add.graphics().setDepth(30);

    // HUD（DOM）
    this.hud = createHud(this, world, this.controller, this.selection, this.orders);

    // 关卡载入失败时在画面上给出可见提示（否则静默退回沙盒，看起来像"游戏坏了"）
    if (this.levelError) this.showLevelError();

    // 开发环境暴露实例供 Playwright 断言（生产构建不包含）；场景关闭时清理，避免旧引用竞态
    if (import.meta.env.DEV) {
      window.__game = { world, scene: this, controller: this.controller, selection: this.selection };
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
        delete window.__game;
      });
    }
    window.__gameReady = true;
  }

  // 关卡载入/引用校验失败时的可见提示（否则引擎会静默退回沙盒模式：
  // 地图、兵力、AI 全部不按关卡生效，看起来像"关卡跑不起来"，实际是 JSON 写错了）
  showLevelError() {
    const lines = this.levelError.split('\n').map(line => line.trim()).filter(Boolean);
    const body = lines
      .filter(line => !line.startsWith('[')) // 去掉 "[level] invalid level:" 这类前缀行
      .map(line => `· ${line.replace(/^-\s*/, '')}`)
      .join('\n');
    const banner = this.add.text(0, 0, `${t('hud.levelError', { id: this.requestedLevelId ?? '' })}\n${body}`, {
      fontFamily: 'Consolas, "Microsoft YaHei", monospace',
      fontSize: '18px',
      color: '#ffd9d9',
      backgroundColor: '#3a1616',
      padding: { x: 14, y: 10 },
      lineSpacing: 4,
      wordWrap: { width: Math.min(1000, this.scale.width - 80) },
    }).setDepth(200);
    banner.setPosition(Math.max(12, (this.scale.width - banner.width) / 2), 12);
  }

  update(time, delta) {
    const dt = delta / 1000;
    if (!this.controller.paused && !this.world.winner) {
      this.loop.advance(dt, this.controller.speed);
      this.ai?.update(dt * this.controller.speed);
    }
    // 渲染（每帧，只读状态；暂停时保持静态画面）
    this.unitRenderer.draw();
    this.fogRenderer.sync();
    this.controlLineRenderer.draw();
    this.drawOverlays();
    this.hud.update(delta);
  }

  // 框选矩形与轨迹路径
  drawOverlays() {
    this.overlayGraphics.clear();
    const rect = this.selection.getDragRect();
    if (rect) {
      this.overlayGraphics.fillStyle(0x000000, 0.08);
      this.overlayGraphics.fillRect(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top);
      this.overlayGraphics.lineStyle(2, 0x111111, 1);
      this.overlayGraphics.strokeRect(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top);
    }
    if (this.orders.isRouting()) {
      const route = this.orders.getCurrentRoute();
      if (route.length > 1) {
        this.overlayGraphics.lineStyle(4, 0x2f2f2f, 0.82);
        this.overlayGraphics.beginPath();
        this.overlayGraphics.moveTo(route[0].x, route[0].y);
        for (let i = 1; i < route.length; i += 1) this.overlayGraphics.lineTo(route[i].x, route[i].y);
        this.overlayGraphics.strokePath();
        drawArrow(this.overlayGraphics, route[route.length - 2].x, route[route.length - 2].y,
          route[route.length - 1].x, route[route.length - 1].y, 0x2f2f2f);
      }
    }
    // 行军/攻击前进轨迹（move 与 attackMove 均持续显示，含末端箭头）：
    // 未到达终点前不消失，直到单位到达/命令结束；已走过/阵亡/溃逃/到达自然消失。
    const routeColor = 0x1f2b24; // 加深轨迹颜色（截图效果）
    const queueColor = 0x3a4a3d;
    this.overlayGraphics.lineStyle(3, routeColor, 0.9);
    for (const unit of this.world.units) {
      if (unit.faction !== 'blue' || unit.state === 'dead' || unit.state === 'rout') continue;
      if (unit.route.length > 0 && unit.routeIndex < unit.route.length) {
        this.overlayGraphics.beginPath();
        this.overlayGraphics.moveTo(unit.x, unit.y);
        for (let i = unit.routeIndex; i < unit.route.length; i += 1) {
          this.overlayGraphics.lineTo(unit.route[i].x, unit.route[i].y);
        }
        this.overlayGraphics.strokePath();
        const lastIndex = unit.route.length - 1;
        const beforeIndex = lastIndex - 1;
        const end = unit.route[lastIndex];
        const start = beforeIndex >= unit.routeIndex ? unit.route[beforeIndex] : { x: unit.x, y: unit.y };
        drawArrow(this.overlayGraphics, start.x, start.y, end.x, end.y, routeColor);
      }
      if (!unit.pendingQueue?.length) continue;
      this.overlayGraphics.lineStyle(2, queueColor, 0.75);
      let tail = unit.route.length > unit.routeIndex
        ? unit.route[unit.route.length - 1]
        : { x: unit.x, y: unit.y };
      for (const segment of unit.pendingQueue) {
        if (!segment.length) continue;
        const points = [tail, ...segment];
        this.overlayGraphics.beginPath();
        drawDashedPath(this.overlayGraphics, points);
        this.overlayGraphics.strokePath();
        tail = segment[segment.length - 1];
      }
      this.overlayGraphics.lineStyle(3, routeColor, 0.9);
    }
  }
}
