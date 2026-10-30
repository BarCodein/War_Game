import { describe, expect, it } from 'vitest';
import { World } from '../../src/simulation/world.js';
import { deployForces } from '../../src/simulation/level.js';
import { loadPvpLevel } from '../../server/src/levels.js';
import {
  FORCED_ROUTE_COLOR, QUEUE_COLOR, ROUTE_COLOR, drawBattleOverlays, drawDashedPath,
} from '../../src/rendering/battleOverlay.js';

// 记录调用序列的假 graphics（Phaser.Graphics 的最小替身）
function fakeGraphics() {
  const calls = [];
  const api = {
    calls,
    clear: () => calls.push(['clear']),
    lineStyle: (...args) => calls.push(['lineStyle', ...args]),
    fillStyle: (...args) => calls.push(['fillStyle', ...args]),
    fillRect: (...args) => calls.push(['fillRect', ...args]),
    strokeRect: (...args) => calls.push(['strokeRect', ...args]),
    strokeCircle: (...args) => calls.push(['strokeCircle', ...args]),
    beginPath: () => calls.push(['beginPath']),
    moveTo: (...args) => calls.push(['moveTo', ...args]),
    lineTo: (...args) => calls.push(['lineTo', ...args]),
    strokePath: () => calls.push(['strokePath']),
    fillTriangle: (...args) => calls.push(['fillTriangle', ...args]),
    count: (name) => calls.filter((call) => call[0] === name).length,
  };
  return api;
}

function makeWorld() {
  const { level, map } = loadPvpLevel('dujiang_pvp');
  const world = new World(map);
  deployForces(world, level.forces, level.anchors ?? {});
  return world;
}

describe('共享覆盖层：行军路线 / 排队 / 框选', () => {
  it('只画 viewerFaction 的路线（敌方绝不画）', () => {
    const world = makeWorld();
    const blue = world.units.find((unit) => unit.faction === 'blue');
    const red = world.units.find((unit) => unit.faction === 'red');
    blue.route = [{ x: blue.x + 10, y: blue.y }, { x: blue.x + 40, y: blue.y }];
    red.route = [{ x: red.x + 10, y: red.y }, { x: red.x + 40, y: red.y }];

    const graphics = fakeGraphics();
    drawBattleOverlays(graphics, { world, viewerFaction: 'blue' });

    // 路线用 3px ROUTE_COLOR；数一下 lineStyle 的次数应为 1（只有蓝方一条）
    const routeStyles = graphics.calls.filter((call) => call[0] === 'lineStyle' && call[1] === 3 && call[2] === ROUTE_COLOR);
    expect(routeStyles).toHaveLength(1);
    // 一条路线 → 一个箭头
    expect(graphics.count('fillTriangle')).toBe(1);
  });

  it('急行军用暗红；排队路线画虚线', () => {
    const world = makeWorld();
    const blues = world.units.filter((item) => item.faction === 'blue');
    const forcedUnit = blues[0];
    const queueUnit = blues[1];
    forcedUnit.route = [{ x: forcedUnit.x + 30, y: forcedUnit.y }, { x: forcedUnit.x + 60, y: forcedUnit.y }];
    forcedUnit.forcedMarch = true;
    queueUnit.route = [{ x: queueUnit.x + 20, y: queueUnit.y + 20 }];
    queueUnit.forcedMarch = false;
    queueUnit.pendingQueue = [[{ x: queueUnit.x + 90, y: queueUnit.y }, { x: queueUnit.x + 120, y: queueUnit.y }]];

    const graphics = fakeGraphics();
    drawBattleOverlays(graphics, { world, viewerFaction: 'blue' });

    // 急行军的路线用暗红
    expect(graphics.calls.some((call) => call[0] === 'lineStyle' && call[2] === FORCED_ROUTE_COLOR)).toBe(true);
    // 非急行军的排队段用 QUEUE_COLOR 画虚线
    expect(graphics.calls.some((call) => call[0] === 'lineStyle' && call[2] === QUEUE_COLOR)).toBe(true);
    // 虚线：至少 4 段 moveTo（dash 12 / gap 8 走 90px+）
    expect(graphics.count('moveTo')).toBeGreaterThanOrEqual(4);
    // 两条路线（forced + queueUnit）→ 两个箭头
    expect(graphics.count('fillTriangle')).toBe(2);
  });

  it('没有路线/队列的单位不产生任何绘制；框选矩形按战役样式画', () => {
    const world = makeWorld();
    for (const unit of world.units) unit.route = [];
    const graphics = fakeGraphics();
    drawBattleOverlays(graphics, {
      world,
      viewerFaction: 'blue',
      selection: { getDragRect: () => ({ left: 10, top: 20, right: 110, bottom: 120 }) },
    });
    expect(graphics.calls.filter((call) => call[0] === 'moveTo')).toHaveLength(0);
    expect(graphics.count('strokeRect')).toBe(1);
    expect(graphics.count('fillTriangle')).toBe(0);
  });

  it('drawDashedPath：点数不足 / 零长度段不炸', () => {
    const graphics = fakeGraphics();
    drawDashedPath(graphics, []);
    drawDashedPath(graphics, [{ x: 0, y: 0 }]);
    drawDashedPath(graphics, [{ x: 5, y: 5 }, { x: 5, y: 5 }]);
    expect(graphics.calls.filter((call) => call[0] === 'moveTo')).toHaveLength(0);
  });
});
