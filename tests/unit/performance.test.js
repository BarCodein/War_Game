import { describe, expect, it } from 'vitest';
import { makePlainMap, makeWorld } from './helpers.js';
import { moveCommand } from '../../src/simulation/commands.js';
import { values } from '../../src/config/index.js';

// 性能基线（acceptance A7、G3 的模拟侧）：500 活动单位下的 tick 预算与统一下令开销。
// 边界带余量以避免慢机器误报；实测参考：tick 平均 ~3.4ms（Node），预算 8ms。
function spawn500(world) {
  for (let i = 0; i < 250; i += 1) {
    world.spawnUnit('blue', i % 2 ? 'light' : 'heavy', (i * 37) % 1280, (i * 53) % 720);
    world.spawnUnit('red', i % 2 ? 'heavy' : 'light', (i * 29 + 400) % 1280, (i * 41 + 100) % 720);
  }
}

function benchMap() {
  return makePlainMap({
    cities: [
      { id: 'c1', x: 100, y: 600, faction: 'blue' },
      { id: 'c2', x: 1100, y: 100, faction: 'red' },
    ],
    spawns: [
      { faction: 'blue', x: 100, y: 600 },
      { faction: 'red', x: 1100, y: 100 },
    ],
  });
}

describe('performance baseline', () => {
  it('500 活动单位模拟 tick 平均 ≤ 8ms（预算）', () => {
    const world = makeWorld(benchMap());
    spawn500(world);
    for (let i = 0; i < 60; i += 1) world.tick(1 / 60); // 预热
    const samples = [];
    for (let i = 0; i < 200; i += 1) {
      const start = performance.now();
      world.tick(values.simulation.fixedStep);
      samples.push(performance.now() - start);
    }
    const avg = samples.reduce((sum, v) => sum + v, 0) / samples.length;
    expect(avg).toBeLessThanOrEqual(8);
  });

  it('500 单位统一下令 < 16ms 且全部生效', () => {
    const world = makeWorld(benchMap());
    spawn500(world);
    const ids = world.units.filter(u => u.state !== 'dead' && u.faction === 'blue').map(u => u.id);
    const start = performance.now();
    world.issueCommands(ids, moveCommand([{ x: 640, y: 360 }]));
    const cost = performance.now() - start;
    expect(cost).toBeLessThan(16);
    const issued = world.units.filter(u => u.faction === 'blue' && u.command?.type === 'move').length;
    expect(issued).toBe(ids.length);
  });
});
