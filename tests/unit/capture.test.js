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

describe('capture', () => {
  it('单个单位 5%/s 积累占领进度', () => {
    const world = makeWorld(twoCityMap());
    world.spawnUnit('blue', 'light', 1100, 100);
    advance(world, 1);
    const redCity = world.cities.find(c => c.id === 'c2');
    expect(redCity.captureProgress).toBeCloseTo(5);
  });

  it('多单位叠加，上限 15%/s', () => {
    const world = makeWorld(twoCityMap());
    for (let i = 0; i < 4; i += 1) world.spawnUnit('blue', 'light', 1100 + i * 10, 100);
    advance(world, 1);
    const redCity = world.cities.find(c => c.id === 'c2');
    expect(redCity.captureProgress).toBeCloseTo(15);
  });

  it('守方单位在场时进度冻结', () => {
    const world = makeWorld(twoCityMap());
    world.spawnUnit('blue', 'light', 1100, 100);
    world.spawnUnit('red', 'light', 1120, 100); // 守方在半径内
    advance(world, 1);
    const redCity = world.cities.find(c => c.id === 'c2');
    expect(redCity.captureProgress).toBe(0);
  });

  it('攻方离开后进度 3%/s 衰减', () => {
    const world = makeWorld(twoCityMap());
    const redCity = world.cities.find(c => c.id === 'c2');
    redCity.captureProgress = 50;
    advance(world, 1);
    expect(redCity.captureProgress).toBeCloseTo(47);
  });

  it('进度达到 100% 城市易主并清零进度', () => {
    const world = makeWorld(twoCityMap());
    world.spawnUnit('blue', 'light', 1100, 100);
    const redCity = world.cities.find(c => c.id === 'c2');
    redCity.captureProgress = 95;
    advance(world, 1.1);
    expect(redCity.faction).toBe('blue');
    expect(redCity.captureProgress).toBe(0);
    expect(world.history.some(e => e.type === 'cityCaptured' && e.cityId === 'c2' && e.faction === 'blue')).toBe(true);
  });
});
