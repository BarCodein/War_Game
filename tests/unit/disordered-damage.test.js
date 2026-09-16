import { describe, expect, it } from 'vitest';
import { values } from '../../src/config/index.js';
import { makePlainMap, makeWorld } from './helpers.js';
import { updateCombat } from '../../src/simulation/systems/combat.js';

// 溃逃(rout) / 失序(unordered) 的部队阵型散乱：承受伤害 ×1.5（gdd.md §4）。
const RATIO = values.combat.disorderedDamageTaken;

// 同一几何下打一次：蓝军轻型接触红军轻型（首次接触立即攻击），返回红军这一次掉的血。
// 攻击方状态一致、地形全平原、双方满血 → 两次结果之比就是"易伤倍率"。
function damageTakenByState(state) {
  const world = makeWorld(makePlainMap({ width: 640, height: 480 }));
  world.spawnUnit('blue', 'light', 300, 240);
  const target = world.spawnUnit('red', 'light', 328, 240); // 半径和 28 → 接触
  target.state = state;
  const before = target.hp;
  world.spatial.rebuild(world.units); // updateCombat 走空间网格找目标（tick 里由 world.tick 重建）
  updateCombat(world, 1 / 60);
  return before - target.hp;
}

describe('溃逃/失序部队的易伤', () => {
  it('rout 与 unordered 承受的伤害都是常态的 1.5 倍', () => {
    const normal = damageTakenByState('hold');
    expect(normal).toBeGreaterThan(0);
    expect(damageTakenByState('rout')).toBeCloseTo(normal * RATIO, 6);
    expect(damageTakenByState('unordered')).toBeCloseTo(normal * RATIO, 6);
  });

  it('倍率与既有修正叠乘：原地固守(defend 0.75) 后再乘易伤', () => {
    // target 没有路线 → 命中 defend 系数；rout 目标同样没有路线，所以两者可直接比
    const normal = damageTakenByState('hold');
    const expected = values.units.light.damage * values.combat.defend * RATIO;
    expect(normal).toBeCloseTo(values.units.light.damage * values.combat.defend, 6);
    expect(damageTakenByState('rout')).toBeCloseTo(expected, 6);
  });

  it('伤害照常计入伤亡统计（走 damageUnit）与阵亡判定', () => {
    const world = makeWorld(makePlainMap({ width: 640, height: 480 }));
    world.spawnUnit('blue', 'light', 300, 240);
    const target = world.spawnUnit('red', 'light', 328, 240);
    target.state = 'rout';
    target.hp = 0.5; // 一击必杀

    world.spatial.rebuild(world.units);
    updateCombat(world, 1 / 60);
    expect(target.state).toBe('dead');
    expect(world.casualties.red).toBeCloseTo(0.5, 6); // 超杀不算，只记实际损失
  });

  it('常态部队不受影响（回归：倍率只作用于 rout/unordered）', () => {
    const world = makeWorld(makePlainMap({ width: 640, height: 480 }));
    world.spawnUnit('blue', 'light', 300, 240);
    const target = world.spawnUnit('red', 'light', 328, 240); // 默认 hold
    const before = target.hp;
    world.spatial.rebuild(world.units);
    updateCombat(world, 1 / 60);
    expect(before - target.hp).toBeCloseTo(values.units.light.damage * values.combat.defend, 6);
  });
});
