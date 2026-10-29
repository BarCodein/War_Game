import { describe, expect, it } from 'vitest';
import { loadPvpLevel, PVP_LEVELS } from '../../server/src/levels.js';
import { World } from '../../src/simulation/world.js';
import { deployForces } from '../../src/simulation/level.js';

// P2 验收之一：**对称兵力模板**。
// PvP 的地图沿用战役地图（城市数本身对称：渡江 8v8、平津 4v4），
// 但战役关卡的 forces 是剧本化的（渡江 20v21、平津 17v23），所以单独做了 public/assets/pvp/*.json：
//   · 双方兵种与数量完全相同
//   · 各自只使用**本方**地图出生点（不把部队放进敌方腹地，也不会踩到河里）
//   · victory = normal（占光全部城市，对称判定）
const spawnsOf = (map, faction) => map.spawns.filter((spawn) => spawn.faction === faction);

function composition(level, faction) {
  const counts = {};
  for (const force of level.forces.filter((item) => item.faction === faction)) {
    for (const unit of force.units) counts[unit.type] = (counts[unit.type] ?? 0) + unit.count;
  }
  return counts;
}

describe('PvP 关卡：对称兵力模板', () => {
  it('两个 PvP 关卡都能通过战役关卡的校验（parseLevel）', () => {
    expect(PVP_LEVELS).toEqual(['dujiang_pvp', 'pingjin_pvp']);
    for (const levelId of PVP_LEVELS) {
      const { level, map } = loadPvpLevel(levelId);
      expect(level.id).toBe(levelId);
      expect(level.forces.length).toBeGreaterThan(0);
      expect(map.size.width).toBeGreaterThan(0);
    }
  });

  it.each(PVP_LEVELS)('%s：双方兵种与数量完全相等', (levelId) => {
    const { level } = loadPvpLevel(levelId);
    const blue = composition(level, 'blue');
    const red = composition(level, 'red');
    expect(red).toEqual(blue);

    const total = (counts) => Object.values(counts).reduce((sum, n) => sum + n, 0);
    expect(total(blue)).toBeGreaterThanOrEqual(8);
    expect(total(blue)).toBe(total(red));
  });

  it.each(PVP_LEVELS)('%s：胜利条件是 normal，且没有 AI 脚本', (levelId) => {
    const { level } = loadPvpLevel(levelId);
    expect(level.victory).toEqual({ mode: 'normal' });
    expect(level.scripts).toEqual([]);
    expect(level.ai).toBeNull();
  });

  it.each(PVP_LEVELS)('%s：每方只用本方出生点，且出生点确实在地图上', (levelId) => {
    const { level, map } = loadPvpLevel(levelId);
    for (const force of level.forces) {
      const spawnId = force.at.spawnId;
      expect(spawnId, `${force.faction} 的兵力应使用 spawnId 出生`).toBeTruthy();
      const spawn = map.spawns.find((item) => item.id === spawnId);
      expect(spawn, `地图里没有出生点 ${spawnId}`).toBeTruthy();
      expect(spawn.faction).toBe(force.faction);
      expect(spawnsOf(map, force.faction).length).toBeGreaterThanOrEqual(2);
    }
  });

  it.each(PVP_LEVELS)('%s：所有单位都出生在可通行地形上（不会卡在水里/山里）', (levelId) => {
    const { level, map } = loadPvpLevel(levelId);
    const world = new World(map);
    const units = deployForces(world, level.forces, level.anchors);
    expect(units.length).toBeGreaterThanOrEqual(8);
    for (const unit of units) {
      expect(world.terrain.passableAt(unit.x, unit.y), `单位 ${unit.id} 出生点不可通行`).toBe(true);
    }
  });

  it.each(PVP_LEVELS)('%s：双方出生点至少相隔 400px（开局不会被对方直接目视）', (levelId) => {
    const { level, map } = loadPvpLevel(levelId);
    const spawnOf = (force) => map.spawns.find((spawn) => spawn.id === force.at.spawnId);
    const blue = level.forces.filter((force) => force.faction === 'blue').map(spawnOf);
    const red = level.forces.filter((force) => force.faction === 'red').map(spawnOf);
    let minDistance = Infinity;
    for (const a of blue) {
      for (const b of red) {
        minDistance = Math.min(minDistance, Math.hypot(a.x - b.x, a.y - b.y));
      }
    }
    // 视野：轻步兵 140 / 重步兵 160 / 城市 180 —— 400px 保证开局互不可见
    expect(minDistance).toBeGreaterThanOrEqual(400);
  });

  it.each(PVP_LEVELS)('%s：双方各持有城市，且城市总数与战报一致', (levelId) => {
    const { level, map } = loadPvpLevel(levelId);
    const world = new World(map);
    deployForces(world, level.forces, level.anchors);
    const blue = world.cities.filter((city) => city.faction === 'blue').length;
    const red = world.cities.filter((city) => city.faction === 'red').length;
    expect(blue).toBeGreaterThan(0);
    expect(red).toBeGreaterThan(0);
    expect(blue).toBe(red); // 占光对手城市 = 拿下全部城市，双方起点对称
    expect(world.cities.length).toBe(blue + red);
  });
});
