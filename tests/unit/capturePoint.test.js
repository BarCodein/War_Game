import { describe, expect, it } from 'vitest';
import { advance, makePlainMap, makeWorld } from './helpers.js';
import { FOG_VISIBLE } from '../../src/simulation/systems/fog.js';
import { values } from '../../src/config/index.js';

// 占领点（gdd.md §7.1）：可被占领，但被占领后**仅提供视野**——
// 不提供补给容量、不提供士气加成、不生产、不恢复，也不计入胜负。
// 这些排除并非靠特判，而是因为占领点存在独立数组 world.capturePoints，
// 而 supply / morale / victory 只读 world.cities。

function pointMap(capturePoints, extra = {}) {
  return makePlainMap({ capturePoints, ...extra });
}

function pointAt(x, y, faction = 'neutral') {
  return { id: 'p1', x, y, faction };
}

describe('占领点：占领规则', () => {
  it('中立占领点：单一阵营在场时累积进度，满 100% 易主并产生事件', () => {
    const world = makeWorld(pointMap([pointAt(640, 360)]));
    const point = world.capturePoints[0];
    expect(point.faction).toBe('neutral');
    world.spawnUnit('blue', 'light', 640, 360);
    point.captureProgress = 99.5; // 只差一点，避免长时间推进带来的不确定性
    advance(world, 0.2); // 5%/s → +1%，足以跨过 100%
    expect(point.faction).toBe('blue');
    expect(point.captureProgress).toBe(0);
    expect(world.history.some(e => e.type === 'capturePointCaptured'
      && e.pointId === 'p1' && e.faction === 'blue')).toBe(true);
  });

  it('占领速率与城市一致：每单位 5%/s、上限 15%/s', () => {
    const world = makeWorld(pointMap([pointAt(640, 360)]));
    const point = world.capturePoints[0];
    world.spawnUnit('blue', 'light', 640, 360);
    advance(world, 1);
    // 容差留 0.5：advance 按 world.time 浮点累积，1s 可能跑 60 或 61 个 tick
    expect(point.captureProgress).toBeCloseTo(5, 0);
    const before = point.captureProgress;
    world.spawnUnit('blue', 'light', 640, 360);
    world.spawnUnit('blue', 'light', 640, 360); // 共 3 个 → 达到 15%/s 上限
    advance(world, 1);
    expect(point.captureProgress - before).toBeCloseTo(15, 0);
  });

  it('多阵营同时在场时冻结（中立点不出现「谁先遍历谁占」）', () => {
    const world = makeWorld(pointMap([pointAt(640, 360)]));
    const point = world.capturePoints[0];
    world.spawnUnit('blue', 'light', 630, 360);
    world.spawnUnit('red', 'light', 650, 360);
    advance(world, 1);
    expect(point.captureProgress).toBe(0);
    expect(point.faction).toBe('neutral');
  });

  it('守方在场时进度冻结且不衰减', () => {
    const world = makeWorld(pointMap([pointAt(640, 360, 'blue')]));
    const point = world.capturePoints[0];
    world.spawnUnit('blue', 'light', 640, 360);
    point.captureProgress = 40;
    advance(world, 1);
    expect(point.captureProgress).toBe(40);
    expect(point.faction).toBe('blue');
  });

  it('无人在场时进度按 3%/s 衰减', () => {
    const world = makeWorld(pointMap([pointAt(640, 360, 'blue')]));
    const point = world.capturePoints[0];
    point.captureProgress = 50;
    advance(world, 1);
    expect(point.captureProgress).toBeCloseTo(47, 1);
  });
});

describe('占领点：被占领后仅提供视野', () => {
  it('己方占领点提供视野（独立半径 values.capturePoints.vision）', () => {
    const world = makeWorld(pointMap([pointAt(640, 360, 'blue')]));
    advance(world, 1 / 60);
    const terrain = world.terrain;
    const cell = terrain.cellAt(640, 360);
    expect(world.fog.blue[terrain.cellIndex(cell.cx, cell.cy)]).toBe(FOG_VISIBLE);
  });

  it('中立占领点不提供视野', () => {
    const world = makeWorld(pointMap([pointAt(640, 360, 'neutral')]));
    advance(world, 1 / 60);
    const terrain = world.terrain;
    const cell = terrain.cellAt(640, 360);
    expect(world.fog.blue[terrain.cellIndex(cell.cx, cell.cy)]).not.toBe(FOG_VISIBLE);
  });

  it('敌方占领点不为己方提供视野', () => {
    const world = makeWorld(pointMap([pointAt(640, 360, 'red')]));
    advance(world, 1 / 60);
    const terrain = world.terrain;
    const cell = terrain.cellAt(640, 360);
    expect(world.fog.blue[terrain.cellIndex(cell.cx, cell.cy)]).not.toBe(FOG_VISIBLE);
  });
});

describe('占领点：不提供补给 / 士气 / 生产 / 恢复 / 胜负', () => {
  it('不提供补给容量：容量仍只由城市决定（每城 5）', () => {
    const world = makeWorld(pointMap([pointAt(640, 360, 'blue')]));
    for (let i = 0; i < 6; i += 1) world.spawnUnit('blue', 'light', 640 + i * 3, 360);
    advance(world, 1);
    const supplied = world.units.filter(unit => unit.supplied).length;
    // 只有唯一的蓝城提供 5 个容量；占领点没有增加容量
    expect(supplied).toBe(values.supply.capacityPerCity);
  });

  it('不提供回血，也没有生产计时器', () => {
    const world = makeWorld(pointMap([pointAt(640, 360, 'blue')]));
    const unit = world.spawnUnit('blue', 'light', 640, 360);
    unit.hp = 30;
    advance(world, 1);
    expect(unit.hp).toBe(30); // 远离蓝城，占领点不回血
    expect(world.capturePoints[0].productionTimer).toBeUndefined(); // 占领点不生产
  });

  it('不提供士气加成：同位置的城市给的士气明显更多', () => {
    const withCity = makeWorld(makePlainMap({
      cities: [
        { id: 'c1', x: 640, y: 360, faction: 'blue' }, // 城市就在该点
        { id: 'c2', x: 1100, y: 100, faction: 'red' },
      ],
    }));
    const cityUnit = withCity.spawnUnit('blue', 'light', 640, 360);

    const withPoint = makeWorld(pointMap([pointAt(640, 360, 'blue')]));
    const pointUnit = withPoint.spawnUnit('blue', 'light', 640, 360);

    cityUnit.morale = 50;
    pointUnit.morale = 50;
    advance(withCity, 1);
    advance(withPoint, 1);

    // 城市：城市修正 +5/s 与城市恢复 +5/s 叠加；占领点：只有补给 +1/s
    expect(cityUnit.morale).toBeGreaterThan(pointUnit.morale);
    expect(pointUnit.morale).toBeLessThan(56);
  });

  it('不影响胜负：失去全部城市仍然判负，即使仍拥有占领点', () => {
    const world = makeWorld(pointMap([pointAt(640, 360, 'blue')]));
    world.cities = world.cities.filter(city => city.faction !== 'blue');
    advance(world, 1 / 60);
    expect(world.winner).toBe('red');
  });
});
