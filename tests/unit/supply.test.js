import { describe, expect, it } from 'vitest';
import { advance, makePlainMap, makeWorld } from './helpers.js';

function blueCityMap() {
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

describe('supply', () => {
  it('每城容量 5：第 6 个单位补给不足并损耗 hp −1/s', () => {
    const world = makeWorld(blueCityMap());
    const units = [];
    for (let i = 0; i < 6; i += 1) units.push(world.spawnUnit('blue', 'light', 300 + i * 10, 600));
    advance(world, 1);
    expect(units.slice(0, 5).every(u => u.supplied)).toBe(true);
    expect(units[5].supplied).toBe(false);
    expect(units[5].hp).toBeCloseTo(59);
    expect(units[0].hp).toBe(60);
  });

  it('城市自动生产：12s 出一个轻型单位；补给满时暂停', () => {
    const world = makeWorld(blueCityMap());
    world.spawnUnit('blue', 'light', 150, 600);
    advance(world, 12.5);
    expect(world.units.filter(u => u.faction === 'blue').length).toBe(2);
    expect(world.units.find(u => u.faction === 'blue' && u.id !== 1).type).toBe('light');

    const full = makeWorld(blueCityMap());
    for (let i = 0; i < 5; i += 1) full.spawnUnit('blue', 'light', 300 + i * 10, 600);
    advance(full, 13);
    expect(full.units.filter(u => u.faction === 'blue').length).toBe(5); // 满补给，生产暂停
  });

  it('己方城市附近恢复生命 +3/s（上限封顶）', () => {
    const world = makeWorld(blueCityMap());
    const unit = world.spawnUnit('blue', 'light', 150, 600); // 距城 50 ≤ 120
    unit.hp = 50;
    advance(world, 1);
    expect(unit.hp).toBeCloseTo(53);
    advance(world, 5);
    expect(unit.hp).toBe(60); // 封顶
  });
});
