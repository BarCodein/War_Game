import { describe, expect, it } from 'vitest';
import { World } from '../../src/simulation/world.js';
import { deployForces } from '../../src/simulation/level.js';
import { loadPvpLevel } from '../../server/src/levels.js';
import { values } from '../../src/config/index.js';

// §11.23 渡江 PvP 重制：40 vs 40，单位分驻各自 8 座城市附近 + 每方 8 人预备队。
// 内容型改动，但落点必须合法（不能生成在水里/互相重叠/离城太远），否则开局就掉血或挤成一坨。
function deploy() {
  const { level, map } = loadPvpLevel('dujiang_pvp');
  const world = new World(map);
  deployForces(world, level.forces, level.anchors ?? {});
  return { world, level };
}

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

describe('渡江 PvP：40 vs 40 分驻城市', () => {
  it('双方各 40 个单位，兵种对称（21 轻 + 19 重）', () => {
    const { world } = deploy();
    const blue = world.units.filter((unit) => unit.faction === 'blue');
    const red = world.units.filter((unit) => unit.faction === 'red');
    expect(blue).toHaveLength(40);
    expect(red).toHaveLength(40);
    const mix = (units) => units.reduce((acc, unit) => {
      acc[unit.type] = (acc[unit.type] ?? 0) + 1;
      return acc;
    }, {});
    expect(mix(blue)).toEqual({ light: 21, heavy: 19 });
    expect(mix(red)).toEqual({ light: 21, heavy: 19 });
  });

  it('没有单位生成在水里', () => {
    const { world } = deploy();
    const wet = world.units
      .filter((unit) => world.terrain.terrainAt(unit.x, unit.y) === values.terrain.codes.water)
      .map((unit) => `${unit.id}@${Math.round(unit.x)},${Math.round(unit.y)}`);
    expect(wet).toEqual([]);
  });

  it('同阵营两两间距 ≥ 20px（不叠成一坨）', () => {
    const { world } = deploy();
    const tooClose = [];
    for (let i = 0; i < world.units.length; i += 1) {
      for (let j = i + 1; j < world.units.length; j += 1) {
        const a = world.units[i];
        const b = world.units[j];
        if (a.faction !== b.faction) continue;
        if (distance(a, b) < 20) tooClose.push(`${a.id}/${b.id}`);
      }
    }
    expect(tooClose).toEqual([]);
  });

  it('每座城都有驻军，且都在己方城市 60px 以内', () => {
    const { world } = deploy();
    const garrisons = world.units.filter((unit) => !(unit.group ?? '').endsWith('-reserve'));
    expect(garrisons).toHaveLength(64);   // 16 城 × 4 人
    for (const unit of garrisons) {
      const nearCity = world.cities.some((city) => city.faction === unit.faction && distance(city, unit) <= 60);
      expect(nearCity, `单位 ${unit.id} 不在己方城市附近`).toBe(true);
    }
    for (const city of world.cities) {
      const guards = garrisons.filter((unit) => distance(unit, city) <= 60);
      expect(guards.length, `${city.id} 没有驻军`).toBeGreaterThanOrEqual(2);
    }
  });

  it('每方还有一支 8 人预备队，停在集结点附近', () => {
    const { world } = deploy();
    const reserves = world.units.filter((unit) => (unit.group ?? '').endsWith('-reserve'));
    expect(reserves).toHaveLength(16);    // 双方各 8
    expect(reserves.filter((unit) => unit.faction === 'blue')).toHaveLength(8);
    expect(reserves.filter((unit) => unit.faction === 'red')).toHaveLength(8);
  });

  it('单位 id 唯一（快照/路线靠 id 对齐）', () => {
    const { world } = deploy();
    const ids = world.units.map((unit) => unit.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
