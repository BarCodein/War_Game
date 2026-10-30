import { describe, expect, it } from 'vitest';
import { World } from '../../src/simulation/world.js';
import { deployForces } from '../../src/simulation/level.js';
import { updateFog, isSpotted } from '../../src/simulation/systems/fog.js';
import { loadPvpLevel } from '../../server/src/levels.js';
import { markVanishedUnits } from '../../src/pvp/missingUnits.js';

// 回归：部署版（origin/main 517430e）里"我方视野内阵亡的敌军"会一直被渲染成活的。
// 规则见 docs/pvp-plan.md §11.13。
function makeWorld(levelId = 'dujiang_pvp') {
  const { level, map } = loadPvpLevel(levelId);
  const world = new World(map);
  deployForces(world, level.forces, level.anchors ?? {});
  return world;
}

/** 把我方一个单位挪到敌人身边，让那块区域进入视野 */
function standNextTo(world, enemy, faction = 'blue') {
  const own = world.units.find((unit) => unit.faction === faction);
  own.x = enemy.x + 12;
  own.y = enemy.y;
  own.state = 'hold';
  updateFog(world);
  return own;
}

describe('快照缺席判定：敌方阵亡必须同步到客户端', () => {
  it('迷雾在客户端（全量下发）：敌方缺席即阵亡', () => {
    const world = makeWorld();
    const enemy = world.units.find((unit) => unit.faction === 'red');
    const seen = new Set(world.units.filter((unit) => unit.id !== enemy.id).map((unit) => unit.id));

    const vanished = markVanishedUnits(world, seen, 'blue', 'client');
    expect(vanished).toBe(1);
    expect(enemy.state).toBe('dead');
  });

  it('部署版旧逻辑的场景：敌方在我方视野内阵亡 → 也必须判定阵亡（服务端过滤模式）', () => {
    const world = makeWorld();
    const enemy = world.units.find((unit) => unit.faction === 'red');
    standNextTo(world, enemy);
    const seen = new Set(world.units.filter((unit) => unit.id !== enemy.id).map((unit) => unit.id));

    // 旧实现只把"己方缺席"当阵亡，敌方永远不判死 → 这里必须变成 dead
    markVanishedUnits(world, seen, 'blue', 'server');
    expect(enemy.state).toBe('dead');
  });

  it('服务端过滤模式：视野外的敌方缺席 = 只是看不到，不能判死', () => {
    const world = makeWorld();
    const enemy = world.units.find((unit) => unit.faction === 'red');
    // 把己方全部挪到左上角、敌人丢到右下角，确保完全不在视野里
    for (const unit of world.units.filter((item) => item.faction === 'blue')) {
      unit.x = 20;
      unit.y = 20;
      unit.state = 'hold';
    }
    enemy.x = world.size.width - 20;
    enemy.y = world.size.height - 20;
    updateFog(world);
    expect(isSpotted(world, enemy, 'blue')).toBe(false);

    const seen = new Set(world.units.filter((unit) => unit.id !== enemy.id).map((unit) => unit.id));
    markVanishedUnits(world, seen, 'blue', 'server');
    expect(enemy.state).not.toBe('dead');
  });

  it('己方单位缺席永远判死（两种迷雾模式都一样）', () => {
    for (const mode of ['client', 'server']) {
      const world = makeWorld();
      const own = world.units.find((unit) => unit.faction === 'blue');
      const seen = new Set(world.units.filter((unit) => unit.id !== own.id).map((unit) => unit.id));
      markVanishedUnits(world, seen, 'blue', mode);
      expect(own.state).toBe('dead');
    }
  });

  it('对照：旧实现（只判己方）会把这个敌人留在场上 —— 这正是部署版看到的现象', () => {
    const world = makeWorld();
    const enemy = world.units.find((unit) => unit.faction === 'red');
    standNextTo(world, enemy);
    const seen = new Set(world.units.filter((unit) => unit.id !== enemy.id).map((unit) => unit.id));

    // origin/main 517430e 的旧逻辑：敌方缺席一律不处理
    for (const unit of world.units) {
      if (seen.has(unit.id) || unit.state === 'dead') continue;
      if (unit.faction === 'blue') unit.state = 'dead';
    }
    expect(enemy.state).not.toBe('dead');            // 客户端镜像里它还"活着"
    expect(isSpotted(world, enemy, 'blue')).toBe(true);  // 而我会画任何 state!=='dead' 且被目视的敌人
  });

  it('快照里出现过的单位不会被误判；已阵亡的不会被重复计数', () => {
    const world = makeWorld();
    const seen = new Set(world.units.map((unit) => unit.id));
    expect(markVanishedUnits(world, seen, 'blue', 'client')).toBe(0);
    expect(world.units.every((unit) => unit.state !== 'dead')).toBe(true);

    const enemy = world.units.find((unit) => unit.faction === 'red');
    enemy.state = 'dead';
    expect(markVanishedUnits(world, new Set(), 'blue', 'client')).toBe(world.units.length - 1);
  });
});
