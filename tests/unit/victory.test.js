import { describe, expect, it } from 'vitest';
import { advance, makePlainMap, makeWorld } from './helpers.js';

function twoCityMap() {
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

describe('victory', () => {
  it('一方失去全部城市即告负，另一方获胜', () => {
    const world = makeWorld(twoCityMap());
    world.cities.find(c => c.id === 'c2').faction = 'blue'; // 红方失城
    advance(world, 1 / 60);
    expect(world.winner).toBe('blue');
    expect(world.endTime).toBeGreaterThan(0);
    expect(world.history.some(e => e.type === 'victory' && e.winner === 'blue')).toBe(true);
  });

  it('胜负对称：蓝方失去全部城市则红方获胜', () => {
    const world = makeWorld(twoCityMap());
    world.cities.find(c => c.id === 'c1').faction = 'red';
    advance(world, 1 / 60);
    expect(world.winner).toBe('red');
  });
});
