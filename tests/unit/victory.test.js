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

describe('victory', () => {
  it('一方失去全部城市即告负，另一方获胜', () => {
    const world = makeWorld(twoCityMap());
    world.cities.find(c => c.id === 'c2').faction = 'blue'; // 红方失城
    advance(world, 1 / 60);
    expect(world.winner).toBe('blue');
    expect(world.endTime).toBeGreaterThan(0);
    expect(world.history.some(e => e.type === 'victory' && e.winner === 'blue')).toBe(true);
  });

  it('胜负对称：蓝方失去全部城市则红方获胜', () => {
    const world = makeWorld(twoCityMap());
    world.cities.find(c => c.id === 'c1').faction = 'red';
    advance(world, 1 / 60);
    expect(world.winner).toBe('red');
  });
});

// world.mess（关卡任务规则）由 GameScene 用 level.js 的 buildMission() 写入；
// 没写的关卡保持 null，此时只走上面的失城判负。
describe('victory：关卡任务规则（world.mess）', () => {
  function pointMap() {
    return makePlainMap({ capturePoints: [{ id: 'p1', x: 600, y: 300, faction: 'blue' }] });
  }

  it('world.mess 为空时安全退出（回归：曾因读 undefined.faction 抛 TypeError 导致整个 tick 崩溃）', () => {
    const world = makeWorld(twoCityMap());
    expect(world.mess).toBeNull();
    expect(() => advance(world, 1)).not.toThrow();
    expect(world.winner).toBeNull();
  });

  it('防守方坚守到时限即获胜', () => {
    const world = makeWorld(twoCityMap());
    world.mess = { mode: 'defend', faction: 'blue', time: 1, points: [] };
    advance(world, 0.5);
    expect(world.winner).toBeNull();
    advance(world, 0.7);
    expect(world.winner).toBe('blue');
    expect(world.history.some(e => e.type === 'victory' && e.winner === 'blue')).toBe(true);
  });

  it('防守方丢失据点即判负（由据点当前归属方获胜）', () => {
    const world = makeWorld(pointMap());
    world.mess = { mode: 'defend', faction: 'blue', time: null, points: [world.capturePoints[0]] };
    advance(world, 0.5);
    expect(world.winner).toBeNull();
    world.capturePoints[0].faction = 'red'; // 据点易主
    advance(world, 1 / 60);
    expect(world.winner).toBe('red');
  });

  it('进攻方在时限内拿下全部据点即获胜', () => {
    const world = makeWorld(pointMap()); // p1 本来就是蓝方（进攻方）的
    world.mess = { mode: 'attack', faction: 'blue', time: 300, points: [world.capturePoints[0]] };
    advance(world, 1 / 60);
    expect(world.winner).toBe('blue');
  });

  it('进攻方超时未拿下据点则判负', () => {
    const world = makeWorld(pointMap());
    world.capturePoints[0].faction = 'red'; // 攻方始终没拿下来
    world.mess = { mode: 'attack', faction: 'blue', time: 1, points: [world.capturePoints[0]] };
    advance(world, 0.5);
    expect(world.winner).toBeNull();
    advance(world, 0.7);
    expect(world.winner).toBe('red');
  });

  it('歼灭战：消灭全部「指定单位」即获胜（未被指定的敌军不影响判定）', () => {
    const world = makeWorld(pointMap());
    const target = world.spawnUnit('red', 'light', 600, 320);
    target.objective = 'annihilate';                 // 指定单位（来自 forces[].objective）
    const other = world.spawnUnit('red', 'light', 640, 320);
    world.spawnUnit('blue', 'light', 200, 300);
    world.mess = { mode: 'annihilative', faction: 'blue', time: null, points: [] };

    world.killUnit(other, 'combat');                 // 只死未指定的敌军 → 不判胜
    advance(world, 0.5);
    expect(world.winner).toBeNull();

    world.killUnit(target, 'combat');                // 指定单位全灭 → 我方胜
    advance(world, 1 / 60);
    expect(world.winner).toBe('blue');
  });

  it('歼灭战：只消灭部分指定单位不判胜；没有指定单位时完全不判定', () => {
    const world = makeWorld(pointMap());
    const a = world.spawnUnit('red', 'light', 600, 320);
    const b = world.spawnUnit('red', 'light', 640, 320);
    a.objective = 'annihilate';
    b.objective = 'annihilate';
    world.spawnUnit('blue', 'light', 200, 300);
    world.mess = { mode: 'annihilative', faction: 'blue', time: null, points: [] };
    world.killUnit(a, 'combat');
    advance(world, 1);
    expect(world.winner).toBeNull(); // b 还活着

    // 一个指定单位都没有 → 即使敌方全灭也不判胜（旧语义是"消灭全部敌军"，已改）
    const untagged = makeWorld(pointMap());
    const enemy = untagged.spawnUnit('red', 'light', 600, 320);
    untagged.spawnUnit('blue', 'light', 200, 300);
    untagged.mess = { mode: 'annihilative', faction: 'blue', time: null, points: [] };
    untagged.killUnit(enemy, 'combat');
    advance(untagged, 1);
    expect(untagged.winner).toBeNull();
  });

  it('歼灭战：超时未歼灭则判负', () => {
    const world = makeWorld(pointMap());
    const target = world.spawnUnit('red', 'light', 600, 320);
    target.objective = 'annihilate';
    world.spawnUnit('blue', 'light', 200, 300);
    world.mess = { mode: 'annihilative', faction: 'blue', time: 1, points: [] };
    advance(world, 0.5);
    expect(world.winner).toBeNull();
    advance(world, 0.7);
    expect(world.winner).toBe('red');
  });
});
