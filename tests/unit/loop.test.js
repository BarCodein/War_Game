import { describe, expect, it } from 'vitest';
import { advance, makePlainMap, makeWorld } from './helpers.js';
import { createLoop } from '../../src/simulation/loop.js';
import { moveCommand } from '../../src/simulation/commands.js';
import { values } from '../../src/config/index.js';

function snapshot(world) {
  return JSON.stringify({
    time: world.time,
    units: world.units.map(u => ({ id: u.id, x: u.x, y: u.y, hp: u.hp, morale: u.morale, state: u.state })),
    cities: world.cities.map(c => ({ id: c.id, faction: c.faction, captureProgress: c.captureProgress })),
  });
}

describe('loop', () => {
  it('固定时间步长：advance(1/60) 推进一个 tick', () => {
    const world = makeWorld(makePlainMap());
    world.spawnUnit('blue', 'light', 100, 100);
    const loop = createLoop(world);
    expect(loop.advance(1 / 60)).toBe(1);
    expect(world.time).toBeCloseTo(1 / 60);
    expect(loop.accumulator).toBeCloseTo(0);
  });

  it('掉帧时最多补 maxCatchUpTicks 个 tick，积压丢弃', () => {
    const world = makeWorld(makePlainMap());
    const loop = createLoop(world);
    expect(loop.advance(1.0)).toBe(values.simulation.maxCatchUpTicks);
    expect(world.time).toBeCloseTo(values.simulation.maxCatchUpTicks / 60);
    expect(loop.accumulator).toBe(0);
  });

  it('游戏速度 ×2 时每帧推进两个 tick', () => {
    const world = makeWorld(makePlainMap());
    const loop = createLoop(world);
    expect(loop.advance(1 / 60, 2)).toBe(2);
    expect(world.time).toBeCloseTo(2 / 60);
  });

  it('确定性：相同初始状态与命令序列产生完全一致的世界状态', () => {
    function run() {
      const world = makeWorld(makePlainMap());
      const a = world.spawnUnit('blue', 'light', 100, 100);
      const b = world.spawnUnit('red', 'light', 1100, 100);
      world.issueCommands([a.id], moveCommand([{ x: 600, y: 300 }]));
      advance(world, 3);
      world.issueCommands([b.id], moveCommand([{ x: 700, y: 300 }]));
      advance(world, 5);
      return snapshot(world);
    }
    expect(run()).toBe(run());
  });
});
