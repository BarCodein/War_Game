import Phaser from 'phaser';
import { World } from '../../simulation/world.js';
import { createLoop } from '../../simulation/loop.js';
import { ScriptedAI } from '../../simulation/ai.js';
import { values } from '../../config/index.js';
import { createTerrainRenderer } from '../terrainRenderer.js';
import { createFogRenderer } from '../fogRenderer.js';
import { createUnitRenderer } from '../unitRenderer.js';
import { createControlLineRenderer } from '../controlLineRenderer.js';
import { createHud } from '../hud.js';
import { createSelection } from '../../input/selection.js';
import { createOrders } from '../../input/orders.js';
import { createKeyboard } from '../../input/keyboard.js';
import { createGameController } from '../../controllers/gameController.js';

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

// 游戏主场景：组装模拟层 + 渲染层 + 输入层 + 控制器（architecture.md §3 数据流）。
// 渲染只读世界状态；输入只产命令；模拟由固定步长 loop 推进。
export class GameScene extends Phaser.Scene {
  constructor() {
    super({ key: 'Game' });
  }

  init(data) {
    this.mapData = data.mapData;
  }

  create() {
    const world = new World(this.mapData);
    this.world = world;
    this.spawnTutorialForces();
    this.ai = new ScriptedAI(world, {
      faction: 'red',
      script: {
        reinforcement: {
          atTime: values.tutorial.reinforcement.atSecond,
          count: values.tutorial.reinforcement.count,
          unitType: values.tutorial.reinforcement.unitType,
          spawn: { x: 1230, y: 400 },
          moveTo: { x: 1080, y: 160 },
        },
        trigger: { onEnemyCrossX: values.tutorial.map.midlineX, retargetInterval: 5 },
        // 蓝军覆灭后红军向蓝城进军（失败条件可达，gdd.md §10）
        fallbackTarget: world.cities.find(city => city.faction === 'blue'),
      },
    });

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

    // 开发环境暴露实例供 Playwright 断言（生产构建不包含）
    if (import.meta.env.DEV) {
      window.__game = { world, scene: this, controller: this.controller, selection: this.selection };
    }
    window.__gameReady = true;
  }

  // 教学关初始兵力（gdd.md §10）：蓝 3 轻 + 1 重，红 2 轻 + 2 重
  spawnTutorialForces() {
    const { world } = this;
    world.spawnInitial();
    const blue = world.map.spawns.find(spawn => spawn.faction === 'blue');
    const red = world.map.spawns.find(spawn => spawn.faction === 'red');
    const forces = values.tutorial.forces;
    for (let i = 0; i < forces.blue.light - 1; i += 1) world.spawnUnit('blue', 'light', blue.x - 30 - i * 20, blue.y + 30);
    for (let i = 0; i < forces.blue.heavy; i += 1) world.spawnUnit('blue', 'heavy', blue.x + 40 + i * 30, blue.y - 40);
    for (let i = 0; i < forces.red.light - 1; i += 1) world.spawnUnit('red', 'light', red.x - 40 - i * 25, red.y - 40);
    for (let i = 0; i < forces.red.heavy; i += 1) world.spawnUnit('red', 'heavy', red.x + 40 + i * 30, red.y + 50);
  }

  update(time, delta) {
    const dt = delta / 1000;
    if (!this.controller.paused && !this.world.winner) {
      this.loop.advance(dt, this.controller.speed);
      this.ai.update(dt * this.controller.speed);
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
    this.overlayGraphics.lineStyle(3, routeColor, 0.9);
    for (const unit of this.world.units) {
      if (unit.faction !== 'blue' || unit.state === 'dead' || unit.state === 'rout') continue;
      const cmd = unit.command?.type;
      if (cmd !== 'move' && cmd !== 'attackMove') continue;
      if (unit.route.length === 0 || unit.routeIndex >= unit.route.length) continue;
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
  }
}
