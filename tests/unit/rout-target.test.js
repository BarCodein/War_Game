import { describe, it, expect } from 'vitest';
import { rankRoutTargets } from '../../src/simulation/systems/movement.js';
import { makeWorld, makePlainMap } from './helpers.js';

// 溃退目标选择（gdd.md §6 增强）：默认取最近己方城市；
// 最近城市的撤退路线贴着敌军（单位 / 敌方城市）时，改选更安全的己方城市。
// rankRoutTargets 返回按分数升序的 { city, path, score }，只含可达城市。

function redWorld({ cities, terrainCells = {} } = {}) {
  // 地图校验要求双阵营都有城市，故自定义城市列表时预置一个远处的蓝城（不干扰红方撤退评估）
  const allCities = [
    { id: 'cBlue', x: 1200, y: 700, faction: 'blue' },
    ...(cities ?? [
      { id: 'c1', x: 100, y: 600, faction: 'blue' },
      { id: 'c2', x: 1100, y: 100, faction: 'red' },
    ]),
  ];
  const world = makeWorld(makePlainMap({
    cities: allCities,
    spawns: [
      { faction: 'blue', x: 100, y: 600 },
      { faction: 'red', x: 1100, y: 100 },
    ],
    terrainCells,
  }));
  return world;
}

function bestTarget(world, unit) {
  const targets = rankRoutTargets(world, unit);
  return targets.length > 0 ? targets[0] : null;
}

describe('溃退目标选择：无威胁时取最近己方城市（旧行为）', () => {
  it('多城、无任何敌军 → 选最近城市', () => {
    const world = redWorld({
      cities: [
        { id: 'cA', x: 400, y: 400, faction: 'red' },
        { id: 'cB', x: 900, y: 400, faction: 'red' },
      ],
    });
    const unit = world.spawnUnit('red', 'light', 600, 400);
    expect(bestTarget(world, unit).city.id).toBe('cA');
  });

  it('只有一座己方城市 → 就是它', () => {
    const world = redWorld();
    const unit = world.spawnUnit('red', 'light', 600, 400);
    expect(bestTarget(world, unit).city.id).toBe('c2');
  });

  it('没有任何己方城市 → 空列表（上层据此投降）', () => {
    const world = redWorld();
    // 地图校验要求双阵营都有城，故在创建后剔除红方城市（与 morale.test.js 同款做法）
    world.cities = world.cities.filter(c => c.faction !== 'red');
    const unit = world.spawnUnit('red', 'light', 600, 400);
    expect(rankRoutTargets(world, unit)).toEqual([]);
  });
});

describe('溃退目标选择：最近城市贴敌时改选安全城市', () => {
  it('最近城市被敌军围住 → 逃向更远的无威胁城市', () => {
    const world = redWorld({
      cities: [
        { id: 'cNear', x: 600, y: 520, faction: 'red' },   // 更近
        { id: 'cFar', x: 1000, y: 300, faction: 'red' },   // 更远但安全
      ],
    });
    const unit = world.spawnUnit('red', 'light', 600, 400);
    // 敌军贴在 cNear 脚下（威胁 ~145）；cFar 路线远离该敌军（威胁 ~35，来自起点采样）
    world.spawnUnit('blue', 'light', 600, 520);
    world.spatial.rebuild(world.units);

    const target = bestTarget(world, unit);
    expect(target.city.id).toBe('cFar');
    expect(target.path.length).toBeGreaterThan(0);
  });

  it('最近城市旁是敌方城市（静态威胁）→ 同样改选安全城市', () => {
    const world = redWorld({
      cities: [
        { id: 'cNear', x: 600, y: 520, faction: 'red' },
        { id: 'cFar', x: 1000, y: 300, faction: 'red' },
        { id: 'enemyBase', x: 600, y: 560, faction: 'blue' }, // 敌城贴着 cNear
      ],
    });
    const unit = world.spawnUnit('red', 'light', 600, 400);
    // 不需要空间网格（静态威胁直接遍历）
    expect(bestTarget(world, unit).city.id).toBe('cFar');
  });

  it('沿途一个敌军单位截住最近路线 → 改选另一条绕开它的路线', () => {
    const world = redWorld({
      cities: [
        { id: 'cNear', x: 600, y: 520, faction: 'red' },
        { id: 'cFar', x: 1000, y: 300, faction: 'red' },
      ],
    });
    const unit = world.spawnUnit('red', 'light', 600, 400);
    // 敌军站在单位与 cNear 之间（单位正下方 ~90px）
    world.spawnUnit('blue', 'light', 600, 500);
    world.spatial.rebuild(world.units);

    const target = bestTarget(world, unit);
    // 敌军离 cNear 路线终点（605,515）约 15px → 威胁高；cFar 路线受起点采样影响小 → 选 cFar
    expect(target.city.id).toBe('cFar');
  });

  it('所有城市都危险时选威胁最低的（不因距离近而送死）', () => {
    const world = redWorld({
      cities: [
        { id: 'cA', x: 600, y: 520, faction: 'red' },
        { id: 'cB', x: 1000, y: 300, faction: 'red' },
      ],
    });
    const unit = world.spawnUnit('red', 'light', 600, 400);
    world.spawnUnit('blue', 'light', 600, 540); // 威胁 cA（近）
    world.spawnUnit('blue', 'light', 1100, 200); // 距 cB 路线 ~142px，威胁很低
    world.spatial.rebuild(world.units);

    expect(bestTarget(world, unit).city.id).toBe('cB');
  });
});
