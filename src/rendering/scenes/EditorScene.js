import Phaser from 'phaser';
import { makeTerrain } from '../../simulation/map.js';
import { createNewMap, createEditorStore } from '../../editor/editorStore.js';
import { createEditorToolbar, loadFromStorage } from '../editorToolbar.js';
import { values } from '../../config/index.js';

// 地图编辑器（REQUIREMENTS.md §4.6）：绘制/擦除地形、放置/移动/删除城市与出生点、
// 城市初始阵营、可玩性校验、localStorage 与文件导入导出、一键试玩并安全返回。
// 与运行时共享同一地图模型与校验（architecture.md §10）。

const TERRAIN_COLORS = { 0: 0xa7c942, 1: 0x536426, 2: 0x2798ed, 3: 0x8a8a92 };
const FACTION_COLORS = { blue: 0x1911ce, red: 0xe93227 };

const TOOL_CODES = {
  'paint-plain': 0,
  'paint-forest': 1,
  'paint-water': 2,
  'paint-bridge': 3,
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
    const initial = this.mapData ?? loadFromStorage() ?? createNewMap('新地图', 1280, 720);
    this.store = createEditorStore(initial);
    this.terrain = makeTerrain(this.store.mapData);
    this.tool = 'paint-plain';
    this.dragging = null; // { kind: 'city' | 'spawn', id }
    this.lastPaint = null;

    // 相机缩放适配地图尺寸（画布逻辑分辨率 1280×720）
    const zoom = Math.min(1280 / this.store.mapData.size.width, 720 / this.store.mapData.size.height);
    this.cameras.main.setZoom(zoom);

    this.terrainImage = null; // 地形烘焙纹理（drawTerrain 中生成）
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
        this.terrain = makeTerrain(this.store.mapData);
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

    if (import.meta.env.DEV) {
      window.__editor = { store: this.store, scene: this };
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
        delete window.__editor;
      });
    }
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
      }
    }
  }

  handleMove(pointer) {
    const p = { x: pointer.worldX, y: pointer.worldY };
    if (this.dragging) {
      if (this.dragging.kind === 'city') this.store.moveCity(this.dragging.id, p.x, p.y);
      else this.store.moveSpawn(this.dragging.id, p.x, p.y);
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
    return null;
  }

  drawTerrain() {
    // 烘焙为纹理：画笔修改时重生成，平时以单个 Image 显示
    const terrain = this.terrain;
    const graphics = this.make.graphics({ x: 0, y: 0, add: false });
    for (let cy = 0; cy < terrain.rows; cy += 1) {
      for (let cx = 0; cx < terrain.cols; cx += 1) {
        const code = terrain.cells[terrain.cellIndex(cx, cy)];
        graphics.fillStyle(TERRAIN_COLORS[code] ?? TERRAIN_COLORS[0], 1);
        graphics.fillRect(cx * terrain.cellSize, cy * terrain.cellSize, terrain.cellSize, terrain.cellSize);
      }
    }
    graphics.generateTexture('editor-terrain', terrain.cols * terrain.cellSize, terrain.rows * terrain.cellSize);
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
