import Phaser from 'phaser';
import { makeTerrain } from '../../simulation/map.js';
import { createNewMap, createEditorStore } from '../../editor/editorStore.js';
import { createEditorToolbar, loadFromStorage } from '../editorToolbar.js';
import { fitMapToCanvas } from '../../editor/mapResize.js';
import { fitZoom, mapPixelSize, needsTerrainRebuild } from '../editorView.js';
import { values } from '../../config/index.js';

// 地图编辑器（REQUIREMENTS.md §4.6）：绘制/擦除地形、放置/移动/删除城市、出生点与占领点、
// 对象初始阵营、可玩性校验、localStorage 与文件导入导出、一键试玩并安全返回。
// 与运行时共享同一地图模型与校验（architecture.md §10）。

const TERRAIN_COLORS = { 0: 0xa7c942, 1: 0x536426, 2: 0x2798ed, 3: 0x8a8a92, 4: 0x8f6b45, 5: 0x4b3d32, 6: 0xd6b35a, 7: 0xc2845a };
const FACTION_COLORS = { blue: 0x1911ce, red: 0xe93227 };
// 占领点：中立灰 + 阵营色；菱形绘制
const POINT_COLORS = { neutral: 0x9aa7a7, blue: 0x1911ce, red: 0xe93227 };
const POINT_TOOLS = { 'point-neutral': 'neutral', 'point-blue': 'blue', 'point-red': 'red' };

const TOOL_CODES = {
  'paint-plain': 0,
  'paint-forest': 1,
  'paint-water': 2,
  'paint-bridge': 3,
  'paint-mountain': 4,
  'paint-high-mountain': 5,
  'paint-road': 6,
  'paint-town': 7,
  erase: 0,
};

export class EditorScene extends Phaser.Scene {
  constructor() {
    super({ key: 'Editor' });
  }

  init(data) {
    // 编辑器为独立页面；若从试玩返回（?fromPlaytest=1），恢复试玩前的编辑地图。
    this.mapData = null;
    if (new URLSearchParams(window.location.search).get('fromPlaytest') === '1') {
      const raw = sessionStorage.getItem('war-of-dots.playtest');
      if (raw) {
        this.mapData = JSON.parse(raw);
        sessionStorage.removeItem('war-of-dots.playtest');
      }
    }
  }

  create() {
    document.body.classList.add('editor-mode');
    const initial = this.mapData ?? loadFromStorage() ?? createNewMap('新地图', 1280, 800);
    this.store = createEditorStore(initial);
    // 可编辑区域 = 画布：地图比画布小时先补齐，否则画布上会留下点不动、
    // 试玩时也不渲染的空白带（见 editor/mapResize.js）
    this.ensureCanvasSize();
    this.terrain = makeTerrain(this.store.mapData);
    this.tool = 'paint-plain';
    this.dragging = null; // { kind: 'city' | 'spawn', id }
    this.lastPaint = null;

    this.terrainImage = null; // 地形烘焙纹理（drawTerrain 中生成）
    this.fitCamera();         // 相机缩放适配当前地图尺寸

    this.objectGraphics = this.add.graphics().setDepth(5);
    this.drawTerrain();
    this.drawObjects();

    this.toolbar = createEditorToolbar(this, this.store, {
      onToolChange: (tool) => {
        this.tool = tool;
        this.dragging = null;
      },
      onPlay: () => this.testPlay(),
      onMapChange: () => {
        // 新建 / 载入 / 导入都会换掉整张地图：先补齐到画布尺寸，再让地形访问层、
        // 相机缩放、烘焙纹理都跟着当前尺寸走，否则可编辑范围与画布对不上
        this.ensureCanvasSize();
        this.terrain = makeTerrain(this.store.mapData);
        this.fitCamera();
        this.drawTerrain();
        this.drawObjects();
      },
    });
    this.toolbar.syncStatus();

    this.input.on('pointerdown', (pointer) => this.handleDown(pointer));
    this.input.on('pointermove', (pointer) => this.handleMove(pointer));
    this.input.on('pointerup', () => {
      this.dragging = null;
      this.lastPaint = null;
    });
    // 窗口尺寸变化（FIT 缩放下画布逻辑尺寸一般不变，但保险起见重新适配一次）
    this.scale.on('resize', () => this.fitCamera());

    if (import.meta.env.DEV) {
      window.__editor = { store: this.store, scene: this };
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
        delete window.__editor;
      });
    }
  }

  // 把地图补齐到至少等于画布尺寸（只扩不裁，新增格为平原）。
  // 游戏画布固定 1280×800，比它小的地图（例如预设里的 1280×720）会在画布上留下
  // 既点不动、试玩时也不渲染的空白带，所以打开/新建/导入时统一补齐。
  ensureCanvasSize() {
    const { mapData, resized } = fitMapToCanvas(this.store.mapData, this.scale.width, this.scale.height);
    if (!resized) return false;
    this.store.loadMapData(mapData);
    console.info(`[editor] 地图已补齐到画布尺寸 ${mapData.size.width}×${mapData.size.height}（新增区域为平原）`);
    return true;
  }

  // 相机缩放适配当前地图尺寸：新建 / 载入 / 导入不同尺寸的地图后必须重新适配，
  // 否则画布显示范围与地图尺寸不匹配（大地图右侧底部点不到，小地图四周留白）
  fitCamera() {
    const { width, height } = mapPixelSize(this.store.mapData);
    const camera = this.cameras.main;
    camera.setZoom(fitZoom(width, height, this.scale.width, this.scale.height));
    camera.centerOn(width / 2, height / 2); // 尺寸小于画布时四周留白均分，而不是挤在左上角
  }

  handleDown(pointer) {
    const p = { x: pointer.worldX, y: pointer.worldY };
    if (this.tool in TOOL_CODES) {
      this.store.paintTerrain(p.x, p.y, TOOL_CODES[this.tool]);
      this.lastPaint = p;
      this.drawTerrain();
      return;
    }
    if (this.tool === 'city-blue' || this.tool === 'city-red') {
      const hit = this.hitObject(p, 'city');
      if (hit) {
        this.dragging = hit;
      } else {
        this.store.addCity(p.x, p.y, this.tool === 'city-blue' ? 'blue' : 'red');
        this.drawObjects();
      }
      return;
    }
    if (this.tool === 'spawn-blue' || this.tool === 'spawn-red') {
      const hit = this.hitObject(p, 'spawn');
      if (hit) {
        this.dragging = hit;
      } else {
        this.store.addSpawn(p.x, p.y, this.tool === 'spawn-blue' ? 'blue' : 'red');
        this.drawObjects();
      }
      return;
    }
    if (this.tool in POINT_TOOLS) {
      const hit = this.hitObject(p, 'point');
      if (hit) {
        this.dragging = hit;
      } else {
        this.store.addCapturePoint(p.x, p.y, POINT_TOOLS[this.tool]);
        this.drawObjects();
      }
      return;
    }
    if (this.tool === 'delete') {
      const hit = this.hitObject(p);
      if (hit?.kind === 'city') {
        this.store.removeCity(hit.id);
        this.drawObjects();
        this.toolbar.syncStatus();
      } else if (hit?.kind === 'spawn') {
        this.store.removeSpawn(hit.id);
        this.drawObjects();
        this.toolbar.syncStatus();
      } else if (hit?.kind === 'point') {
        this.store.removeCapturePoint(hit.id);
        this.drawObjects();
        this.toolbar.syncStatus();
      }
    }
  }

  handleMove(pointer) {
    const p = { x: pointer.worldX, y: pointer.worldY };
    if (this.dragging) {
      if (this.dragging.kind === 'city') this.store.moveCity(this.dragging.id, p.x, p.y);
      else if (this.dragging.kind === 'spawn') this.store.moveSpawn(this.dragging.id, p.x, p.y);
      else this.store.moveCapturePoint(this.dragging.id, p.x, p.y);
      this.drawObjects();
      return;
    }
    if (this.lastPaint && this.tool in TOOL_CODES) {
      this.store.paintSegment(this.lastPaint.x, this.lastPaint.y, p.x, p.y, TOOL_CODES[this.tool]);
      this.lastPaint = p;
      this.drawTerrain();
    }
  }

  hitObject(p, kind) {
    const radius = values.input.clickHitRadius;
    if (!kind || kind === 'city') {
      const city = [...this.store.mapData.cities].reverse()
        .find(item => Math.hypot(item.x - p.x, item.y - p.y) <= radius);
      if (city) return { kind: 'city', id: city.id };
    }
    if (!kind || kind === 'spawn') {
      const spawn = [...this.store.mapData.spawns].reverse()
        .find(item => Math.hypot(item.x - p.x, item.y - p.y) <= radius);
      if (spawn) return { kind: 'spawn', id: spawn.id };
    }
    if (!kind || kind === 'point') {
      const point = [...this.store.mapData.capturePoints].reverse()
        .find(item => Math.hypot(item.x - p.x, item.y - p.y) <= radius);
      if (point) return { kind: 'point', id: point.id };
    }
    return null;
  }

  drawTerrain() {
    // 烘焙为纹理：画笔修改时重生成，平时以单个 Image 显示
    const terrain = this.terrain;
    const width = terrain.cols * terrain.cellSize;
    const height = terrain.rows * terrain.cellSize;

    // 尺寸变了必须丢弃旧纹理：Graphics.generateTexture 对已存在的 key 是"画到旧画布上"，
    // 不会改变画布尺寸——不重建的话，地图放大后新增区域永远画不出来（看起来像尺寸不匹配）
    const texture = this.textures.exists('editor-terrain') ? this.textures.get('editor-terrain') : null;
    const source = texture ? texture.getSourceImage() : null;
    if (this.terrainImage && needsTerrainRebuild(source, { width, height })) {
      this.terrainImage.destroy();
      this.terrainImage = null;
      this.textures.remove('editor-terrain');
    }

    const graphics = this.make.graphics({ x: 0, y: 0, add: false });
    for (let cy = 0; cy < terrain.rows; cy += 1) {
      for (let cx = 0; cx < terrain.cols; cx += 1) {
        const code = terrain.cells[terrain.cellIndex(cx, cy)];
        graphics.fillStyle(TERRAIN_COLORS[code] ?? TERRAIN_COLORS[0], 1);
        graphics.fillRect(cx * terrain.cellSize, cy * terrain.cellSize, terrain.cellSize, terrain.cellSize);
      }
    }
    graphics.generateTexture('editor-terrain', width, height);
    graphics.destroy();
    if (!this.terrainImage) {
      this.terrainImage = this.add.image(0, 0, 'editor-terrain').setOrigin(0).setDepth(0);
    } else {
      this.terrainImage.setTexture('editor-terrain');
    }
  }

  drawObjects() {
    this.objectGraphics.clear();
    for (const spawn of this.store.mapData.spawns) {
      const color = FACTION_COLORS[spawn.faction];
      this.objectGraphics.lineStyle(2, color, 0.9);
      this.objectGraphics.strokeCircle(spawn.x, spawn.y, 10);
      this.objectGraphics.fillStyle(color, 0.9);
      this.objectGraphics.fillCircle(spawn.x, spawn.y, 3);
    }
    for (const city of this.store.mapData.cities) {
      this.objectGraphics.fillStyle(0x4b4b53, 1);
      this.objectGraphics.lineStyle(2, 0x252c2e, 1);
      this.objectGraphics.fillCircle(city.x, city.y, 16);
      this.objectGraphics.strokeCircle(city.x, city.y, 16);
      this.objectGraphics.lineStyle(2, 0x252c2e, 1);
      this.objectGraphics.lineBetween(city.x, city.y - 16, city.x, city.y - 42);
      this.objectGraphics.fillStyle(FACTION_COLORS[city.faction], 1);
      this.objectGraphics.fillTriangle(city.x, city.y - 42, city.x + 18, city.y - 36, city.x, city.y - 30);
    }
    // 占领点：菱形轮廓 + 中心点（中立灰色，其余为阵营色）
    for (const point of this.store.mapData.capturePoints) {
      const color = POINT_COLORS[point.faction] ?? POINT_COLORS.neutral;
      const r = 14;
      this.objectGraphics.lineStyle(2, color, 1);
      this.objectGraphics.beginPath();
      this.objectGraphics.moveTo(point.x, point.y - r);
      this.objectGraphics.lineTo(point.x + r, point.y);
      this.objectGraphics.lineTo(point.x, point.y + r);
      this.objectGraphics.lineTo(point.x - r, point.y);
      this.objectGraphics.closePath();
      this.objectGraphics.strokePath();
      this.objectGraphics.fillStyle(color, 0.9);
      this.objectGraphics.fillCircle(point.x, point.y, 3);
    }
  }

  testPlay() {
    const errors = this.store.errors();
    if (errors.length > 0) {
      this.toolbar.syncStatus();
      return;
    }
    // 跨页试玩：把当前地图写入 sessionStorage，跳转到游戏页（?fromEditor=1），
    // 由 BootScene 读取地图并以无脚本敌军方式部署。
    sessionStorage.setItem('war-of-dots.playtest', JSON.stringify(this.store.mapData));
    window.location.href = '/game.html?fromEditor=1';
  }
}
