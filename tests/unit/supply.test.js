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
    // 单位会被软排斥推开，因此"谁获得补给"取决于到城市的距离，而不是 spawn 顺序。
    // 只断言容量规则本身：恰好 5 个被补给、1 个补给不足并受到损耗。
    const supplied = units.filter(u => u.supplied);
    const starving = units.filter(u => !u.supplied);
    expect(supplied).toHaveLength(5);
    expect(starving).toHaveLength(1);
    expect(starving[0].hp).toBeCloseTo(59, 0);
    expect(supplied[0].hp).toBe(60);
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

  it('被敌方单位围攻时暂停生产', () => {
    const world = makeWorld(blueCityMap());
    world.spawnUnit('blue', 'light', 300, 600); // 守方不在地图半径内，避免交战
    world.spawnUnit('red', 'light', 150, 600);   // 距蓝城 50 ≤ 占领半径 60
    advance(world, 13);
    expect(world.units.filter(u => u.faction === 'blue').length).toBe(1); // 无产出
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
