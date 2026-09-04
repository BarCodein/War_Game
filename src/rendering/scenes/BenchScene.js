import Phaser from 'phaser';
import { World } from '../../simulation/world.js';
import { createLoop } from '../../simulation/loop.js';
import { createTerrainRenderer } from '../terrainRenderer.js';
import { createFogRenderer } from '../fogRenderer.js';
import { createUnitRenderer } from '../unitRenderer.js';
import { createControlLineRenderer } from '../controlLineRenderer.js';
import { createSelection } from '../../input/selection.js';

// 性能基准场景（#bench，开发/验收用，acceptance G3）：
// 500 个活动单位下测量模拟 tick 耗时与渲染帧率，结果显示在页面左上角，
// 并通过 window.__bench 暴露给 e2e 断言。帧率在软件渲染下会显著偏低，
// 60 FPS 的最终确认需在真实 GPU 的三款浏览器上手动执行（见 docs/acceptance-criteria.md G3）。
const BENCH_MAP = {
  version: 1,
  name: 'bench',
  size: { width: 1280, height: 720 },
  gridCellSize: 20,
  terrain: { width: 64, height: 36, cells: new Array(64 * 36).fill(0) },
  cities: [
    { id: 'c1', x: 100, y: 600, faction: 'blue' },
    { id: 'c2', x: 1100, y: 100, faction: 'red' },
  ],
  spawns: [
    { faction: 'blue', x: 100, y: 600 },
    { faction: 'red', x: 1100, y: 100 },
  ],
  objectives: [],
};

const TICK_SAMPLES = 300;

export class BenchScene extends Phaser.Scene {
  constructor() {
    super({ key: 'Bench' });
  }

  create() {
    document.body.classList.remove('editor-mode');
    const world = new World(BENCH_MAP);
    for (let i = 0; i < 250; i += 1) {
      world.spawnUnit('blue', i % 2 ? 'light' : 'heavy', (i * 37) % 1280, (i * 53) % 720);
      world.spawnUnit('red', i % 2 ? 'heavy' : 'light', (i * 29 + 400) % 1280, (i * 41 + 100) % 720);
    }
    this.world = world;
    this.loop = createLoop(world);
    this.selection = createSelection(this, world);
    createTerrainRenderer(this, world);
    this.fogRenderer = createFogRenderer(this, world);
    this.unitRenderer = createUnitRenderer(this, world, this.selection);
    createControlLineRenderer(this, world);

    this.tickTimes = [];
    this.fpsWindow = [];
    this.finished = false;

    const overlay = document.createElement('div');
    overlay.id = 'benchOverlay';
    overlay.style.cssText = 'position:fixed;top:12px;left:12px;background:#102a2b;color:#d6e7df;padding:10px 14px;font:12px monospace;z-index:99;line-height:1.6';
    document.body.appendChild(overlay);
    this.overlay = overlay;

    window.__bench = {
      scene: this,
      get tickTimes() { return this.scene.tickTimes; },
      get fps() { return this.scene.currentFps; },
      get ready() { return this.scene.finished; },
    };
    window.__gameReady = true;
  }

  update(time, delta) {
    const start = performance.now();
    const ticks = this.loop.advance(delta / 1000);
    this.unitRenderer.draw();
    this.fogRenderer.sync();
    const frameCost = performance.now() - start;

    // 帧率滚动窗口（最近 1s 的帧数）
    const now = performance.now();
    this.fpsWindow.push(now);
    while (this.fpsWindow.length > 0 && now - this.fpsWindow[0] > 1000) this.fpsWindow.shift();
    this.currentFps = this.fpsWindow.length;

    if (!this.finished && this.tickTimes.length < TICK_SAMPLES) {
      const perTick = frameCost / Math.max(1, ticks);
      for (let i = 0; i < ticks; i += 1) {
        if (this.tickTimes.length >= TICK_SAMPLES) break;
        this.tickTimes.push(perTick);
      }
      if (this.tickTimes.length >= TICK_SAMPLES) this.finish();
    }
    if (this.finished && time % 500 < delta) this.renderOverlay();
  }

  finish() {
    this.finished = true;
    const sorted = [...this.tickTimes].sort((a, b) => a - b);
    const avg = sorted.reduce((sum, v) => sum + v, 0) / sorted.length;
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    this.result = { avg, p95, samples: sorted.length };
    this.renderOverlay();
  }

  renderOverlay() {
    const { avg = 0, p95 = 0, samples = 0 } = this.result ?? {};
    this.overlay.textContent = [
      `WAR OF DOTS 性能基准（500 单位）`,
      `模拟 tick：平均 ${avg.toFixed(2)} ms · p95 ${p95.toFixed(2)} ms（预算 8 ms，样本 ${samples}）`,
      `渲染帧率：${this.currentFps} FPS（软件渲染偏低；60 FPS 需真实 GPU 验证）`,
    ].join('\n');
  }
}
