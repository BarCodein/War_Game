import { describe, expect, it } from 'vitest';
import { values } from '../../src/config/index.js';
import {
  chooseTarget, combatPower, enemiesWithin, isVulnerable, localBalance, scoreAttack, targetValue,
} from '../../src/simulation/ai/tactics.js';
import { makePlainMap, makeWorld } from './helpers.js';

// 战术效用打分（docs/ai-design.md 阶段一 A）：战力估算、局部兵力比、选目标。
function setup({ terrainCells } = {}) {
  const world = makeWorld(makePlainMap({ width: 1280, height: 720, terrainCells }));
  return world;
}

describe('战力估算', () => {
  it('满血单位战力 = dps × 血量；掉血会降低战力（兰切斯特项）', () => {
    const world = setup();
    const full = world.spawnUnit('blue', 'light', 100, 100);
    const wounded = world.spawnUnit('blue', 'light', 300, 100);
    wounded.hp = values.units.light.hp * 0.5;
    expect(combatPower(full, world)).toBeGreaterThan(combatPower(wounded, world));
  });

  it('死亡单位战力为 0；士气削弱会降低战力', () => {
    const world = setup();
    const unit = world.spawnUnit('blue', 'light', 100, 100);
    const before = combatPower(unit, world);
    unit.morale = values.morale.effects.shaken ? 20 : 20; // 低于 weakenedBelow(60) → 士气削弱
    expect(combatPower(unit, world)).toBeLessThan(before);
    unit.state = 'dead';
    expect(combatPower(unit, world)).toBe(0);
  });

  it('水里战力不升反降（地形修正），防守地形上的单位更"经打"', () => {
    const gridCellSize = values.terrain.gridCellSize;
    const cols = 1280 / gridCellSize;
    const rows = 720 / gridCellSize;
    const terrainCells = {};
    for (let cy = 0; cy < rows; cy += 1) terrainCells[`2,${cy}`] = values.terrain.codes.water;
    const world = setup({ terrainCells });
    const dry = world.spawnUnit('blue', 'light', 600, 100);
    const wet = world.spawnUnit('blue', 'light', 2 * gridCellSize + gridCellSize / 2, 100);
    expect(world.terrain.attackMultiplierAt(wet.x, wet.y)).toBeLessThan(1);
    // 在水里的单位输出被砍半（attackMultiplier 由战斗系统读取），战术打分同样要认这一点
    expect(scoreAttack(world, wet, world.units[0], {})).not.toBeNull();
    expect(combatPower(dry, world)).toBeGreaterThan(0);
  });
});

describe('局部兵力比', () => {
  it('3 打 1 时我方占优；敌方增援后红方占比同步上升', () => {
    const world = setup();
    // 双方都在 localForceRadius(180) 内：蓝 3 个 vs 红 1 个
    const blues = [0, 1, 2].map(i => world.spawnUnit('blue', 'light', 500 + i * 20, 300));
    const lone = world.spawnUnit('red', 'light', 600, 300);
    world.spatial.rebuild(world.units);

    const blueBalance = localBalance(world, blues[0]);
    const redBefore = localBalance(world, lone);
    expect(blueBalance).toBeGreaterThan(0.5);   // 蓝方占优
    expect(redBefore).toBeLessThan(0.5);        // 红方劣势
    expect(blueBalance + redBefore).toBeCloseTo(1, 6); // 互补

    // 红军增援 2 个后，红方占比上升
    world.spawnUnit('red', 'light', 600, 320);
    world.spawnUnit('red', 'light', 620, 300);
    world.spatial.rebuild(world.units);
    expect(localBalance(world, lone)).toBeGreaterThan(redBefore);
  });

  it('半径内没有敌人时占比为 1（不会除以 0）', () => {
    const world = setup();
    const unit = world.spawnUnit('blue', 'light', 100, 100);
    world.spatial.rebuild(world.units);
    expect(localBalance(world, unit)).toBe(1);
  });
});

describe('目标价值与易伤', () => {
  it('指定歼灭单位 > 重型 > 普通轻装', () => {
    const world = setup();
    const light = world.spawnUnit('red', 'light', 400, 100);
    const heavy = world.spawnUnit('red', 'heavy', 420, 100);
    const objective = world.spawnUnit('red', 'light', 440, 100);
    objective.objective = 'annihilate';
    expect(targetValue(world, objective)).toBeGreaterThan(targetValue(world, heavy));
    expect(targetValue(world, heavy)).toBeGreaterThan(targetValue(world, light));
  });

  it('站在据点上的守军价值更高；溃逃/失序 = 易伤', () => {
    const world = makeWorld(makePlainMap({
      width: 1280, height: 720, capturePoints: [{ id: 'p1', x: 500, y: 300, faction: 'red' }],
    }));
    const onPoint = world.spawnUnit('red', 'light', 500, 300);
    const elsewhere = world.spawnUnit('red', 'light', 900, 600);
    expect(targetValue(world, onPoint)).toBeGreaterThan(targetValue(world, elsewhere));

    elsewhere.state = 'rout';
    expect(isVulnerable(elsewhere)).toBe(true);
    expect(isVulnerable(onPoint)).toBe(false);
  });
});

describe('交战打分与集中火力', () => {
  it('同样条件下：残血目标得分更高、更近的目标得分更高', () => {
    const world = setup();
    const attacker = world.spawnUnit('blue', 'light', 500, 300);
    const nearFull = world.spawnUnit('red', 'light', 560, 300);
    const farWounded = world.spawnUnit('red', 'light', 780, 300);
    farWounded.hp = 5;
    const near = scoreAttack(world, attacker, nearFull);
    const far = scoreAttack(world, attacker, farWounded);
    expect(near.score).toBeGreaterThan(0);
    expect(far.score).toBeGreaterThan(0);
  });

  it('集中火力：达到上限的目标返回 null（不再被选）', () => {
    const world = setup();
    const attacker = world.spawnUnit('blue', 'light', 500, 300);
    const enemy = world.spawnUnit('red', 'light', 560, 300);
    const cap = values.ai.squad.maxAttackersPerTarget;
    expect(scoreAttack(world, attacker, enemy, { targetCounts: new Map([[enemy.id, cap - 1]]) })).not.toBeNull();
    expect(scoreAttack(world, attacker, enemy, { targetCounts: new Map([[enemy.id, cap]]) })).toBeNull();
  });

  it('chooseTarget：攻坚逃目标优先于更近的严整目标', () => {
    const world = setup();
    const attacker = world.spawnUnit('blue', 'light', 500, 300);
    const solid = world.spawnUnit('red', 'light', 540, 300);
    const fleeing = world.spawnUnit('red', 'light', 700, 300);
    fleeing.state = 'rout';
    const picked = chooseTarget(world, attacker, [solid, fleeing]);
    expect(picked.enemy.id).toBe(fleeing.id);
    expect(picked.vulnerable).toBe(true);

    // 溃逃目标被撤掉后自然回到严整目标
    expect(chooseTarget(world, attacker, [solid]).enemy.id).toBe(solid.id);
  });

  it('enemiesWithin：只返回半径内、非本方、非死亡的敌人', () => {
    const world = setup();
    const unit = world.spawnUnit('blue', 'light', 500, 300);
    world.spawnUnit('blue', 'light', 520, 300);            // 友军
    const near = world.spawnUnit('red', 'light', 600, 300);  // 敌军（半径内）
    const far = world.spawnUnit('red', 'light', 1200, 300);  // 敌军（半径外）
    const dead = world.spawnUnit('red', 'light', 520, 320);
    dead.state = 'dead';
    world.spatial.rebuild(world.units);
    const found = enemiesWithin(world, unit).map(enemy => enemy.id);
    expect(found).toContain(near.id);
    expect(found).not.toContain(far.id);
    expect(found).not.toContain(dead.id);
  });
});
