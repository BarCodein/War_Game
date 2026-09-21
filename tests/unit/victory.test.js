import { describe, expect, it } from 'vitest';
import { advance, makePlainMap, makeWorld } from './helpers.js';
import { updateVictory } from '../../src/simulation/systems/victory.js';

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
  // 规则口径（gdd.md §10）：
  //   除 normal（占领全部城市）外，**没有任何"占光城市即胜"的通用规则**——
  //   以前那条无条件基础规则会让歼灭战"占完敌方城市"就提前获胜，已按需求移除。
  it('normal：占光地图上全部城市即获胜（默认模式，没写 victory 也走这条）', () => {
    const world = makeWorld(twoCityMap());
    world.cities.find(c => c.id === 'c2').faction = 'blue'; // 红方失城
    advance(world, 1 / 60);
    expect(world.winner).toBe('blue');
    expect(world.endTime).toBeGreaterThan(0);
    expect(world.history.some(e => e.type === 'victory' && e.winner === 'blue')).toBe(true);
  });

  it('normal 对称：蓝方被占光城市则红方获胜', () => {
    const world = makeWorld(twoCityMap());
    world.cities.find(c => c.id === 'c1').faction = 'red';
    advance(world, 1 / 60);
    expect(world.winner).toBe('red');
  });

  it('normal（显式声明）同样按占城判定', () => {
    const world = makeWorld(twoCityMap());
    world.mess = { mode: 'normal', faction: 'blue', time: null, points: [] };
    advance(world, 0.5);
    expect(world.winner).toBeNull(); // 双方都还有城
    world.cities.find(c => c.id === 'c2').faction = 'blue';
    advance(world, 1 / 60);
    expect(world.winner).toBe('blue');
  });

  it('歼灭战：**占光敌方城市不算胜利**，只有消灭全部指定单位才赢', () => {
    const world = makeWorld(twoCityMap());
    const target = world.spawnUnit('red', 'light', 1100, 120);
    target.objective = 'annihilate';
    world.spawnUnit('blue', 'light', 100, 600);
    world.mess = { mode: 'annihilative', faction: 'blue', time: null, points: [] };

    world.cities.find(c => c.id === 'c2').faction = 'blue'; // 红方城市全被占
    advance(world, 2);
    expect(world.winner, '歼灭战里占光城市不该判胜').toBeNull();

    world.killUnit(target, 'combat');                       // 指定单位全灭 → 才算赢
    advance(world, 1 / 60);
    expect(world.winner).toBe('blue');
  });

  it('进攻战：占光敌方城市不算胜利，拿下全部据点才算', () => {
    const world = makeWorld(makePlainMap({ capturePoints: [{ id: 'p1', x: 600, y: 300, faction: 'red' }] }));
    world.mess = { mode: 'attack', faction: 'blue', time: null, points: [world.capturePoints[0]] };

    world.cities.find(c => c.id === 'c2').faction = 'blue'; // 城市占光
    advance(world, 1);
    expect(world.winner, '进攻战里占光城市不该判胜').toBeNull();

    world.capturePoints[0].faction = 'blue';                // 据点到手 → 赢
    advance(world, 1 / 60);
    expect(world.winner).toBe('blue');
  });

  it('防守战：占光敌方城市不算胜利，守到时限才算', () => {
    const world = makeWorld(twoCityMap());
    world.mess = { mode: 'defend', faction: 'blue', time: 1, points: [] };
    world.cities.find(c => c.id === 'c2').faction = 'blue';
    advance(world, 0.5);
    expect(world.winner, '防守战里占光城市不该判胜').toBeNull();
    advance(world, 0.7);
    expect(world.winner).toBe('blue'); // 守到时限
  });

  it('非 normal 模式：丢光自己的城市也不会结束游戏（城市不再决定胜负）', () => {
    const world = makeWorld(twoCityMap());
    const target = world.spawnUnit('red', 'light', 1100, 120);
    target.objective = 'annihilate';
    world.spawnUnit('blue', 'light', 100, 600);
    world.mess = { mode: 'annihilative', faction: 'blue', time: null, points: [] };
    world.cities.find(c => c.id === 'c1').faction = 'red'; // 蓝方城市全丢
    advance(world, 2);
    expect(world.winner).toBeNull();
  });
});

// world.mess（关卡任务规则）由 GameScene 用 level.js 的 buildMission() 写入；
// 没写 victory 的关卡拿到的是 normal（占领全部城市），此时也只有 normal 规则生效。
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

  it('守多个据点：丢一个不算输，全部丢光才立即判负', () => {
    const world = makeWorld(makePlainMap({
      capturePoints: [
        { id: 'p1', x: 300, y: 300, faction: 'blue' },
        { id: 'p2', x: 900, y: 300, faction: 'blue' },
      ],
    }));
    world.mess = { mode: 'defend', faction: 'blue', time: null, points: [...world.capturePoints] };

    world.capturePoints[0].faction = 'red';
    advance(world, 0.5);
    expect(world.winner).toBeNull(); // 还剩 p2 → 继续守

    world.capturePoints[1].faction = 'red';
    advance(world, 1 / 60);
    expect(world.winner).toBe('red'); // 全丢立败
  });

  it('到时限结算：还有据点不在手里 → 防守失败；全部守住 → 防守方胜', () => {
    const late = makeWorld(makePlainMap({
      capturePoints: [
        { id: 'p1', x: 300, y: 300, faction: 'blue' },
        { id: 'p2', x: 900, y: 300, faction: 'red' },
      ],
    }));
    late.mess = { mode: 'defend', faction: 'blue', time: 1, points: [...late.capturePoints] };
    advance(late, 0.5);
    expect(late.winner).toBeNull(); // 时限内还有据点在手里
    advance(late, 0.7);
    expect(late.winner).toBe('red'); // 到点结算：仍有据点不在手里 → 防守失败

    const held = makeWorld(pointMap()); // p1 属于蓝方，全部守住
    held.mess = { mode: 'defend', faction: 'blue', time: 1, points: [...held.capturePoints] };
    advance(held, 1.5);
    expect(held.winner).toBe('blue');
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

  it('进攻方刚好在时限之后拿下全部据点：先判据点再判超时，仍算攻方胜', () => {
    const world = makeWorld(pointMap());
    world.capturePoints[0].faction = 'blue'; // 据点已全部到手
    world.mess = { mode: 'attack', faction: 'blue', time: 1, points: [world.capturePoints[0]] };
    world.time = 5;                          // 且时间已经越过时限
    updateVictory(world);                    // 顺序：先判据点 → 判胜（旧实现会先判超时 → 判负）
    expect(world.winner).toBe('blue');
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
