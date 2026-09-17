import { describe, expect, it } from 'vitest';
import { values } from '../../src/config/index.js';
import { updateFog, FOG_UNEXPLORED, FOG_VISIBLE } from '../../src/simulation/systems/fog.js';
import {
  awarenessSummary, allEnemies, knownEnemies, perceive, rememberedEnemies, unexploredFrontier, visibleEnemies,
} from '../../src/simulation/ai/perception.js';
import { makePlainMap, makeWorld } from './helpers.js';

// 公平模式的情报层（docs/ai-design.md 阶段三）：视野 + lastSeen 记忆 + 前沿探索。
const CFG = values.ai;

function scene({ vision = 140 } = {}) {
  const world = makeWorld(makePlainMap({ width: 1600, height: 600 }));
  const scout = world.spawnUnit('blue', 'light', 200, 300);
  const hidden = world.spawnUnit('red', 'light', 1400, 300);   // 远处，视野外
  const near = world.spawnUnit('red', 'light', 250, 300);      // 视野内
  scout.vision = vision;
  updateFog(world);
  return { world, scout, hidden, near };
}

describe('视野内的敌情', () => {
  it('visibleEnemies 只返回 FOG_VISIBLE 里的敌人，自己人永不出现', () => {
    const { world, near, hidden } = scene();
    const visible = visibleEnemies(world, 'blue').map(unit => unit.id);
    expect(visible).toContain(near.id);
    expect(visible).not.toContain(hidden.id);
    expect(visible).toHaveLength(1);
  });

  it('敌人在森林里更难被发现（沿用迷雾的隐蔽规则）', () => {
    const gridCellSize = values.terrain.gridCellSize;
    const cols = 1600 / gridCellSize;
    const rows = 600 / gridCellSize;
    const terrainCells = {};
    for (let cy = 0; cy < rows; cy += 1) terrainCells[`25,${cy}`] = values.terrain.codes.forest;
    const world = makeWorld(makePlainMap({ width: 1600, height: 600, terrainCells }));
    const observer = world.spawnUnit('blue', 'light', 25 * gridCellSize + 5, 300);
    // 距离在"视野内"但超过森林被发现距离 → 格子是 FOG_VISIBLE，但仍然看不见
    const distance = values.fog.forestSpotDistance + 40;
    const inForest = world.spawnUnit('red', 'light', observer.x, observer.y + distance);
    updateFog(world);
    const cell = world.terrain.cellAt(inForest.x, inForest.y);
    expect(world.fog.blue[world.terrain.cellIndex(cell.cx, cell.cy)]).toBe(FOG_VISIBLE);
    expect(visibleEnemies(world, 'blue').map(unit => unit.id)).not.toContain(inForest.id);
  });
});

describe('lastSeen 记忆', () => {
  it('记得住的敌人以 ghost 形式给出，置信度随年龄线性下降', () => {
    const { world, hidden } = scene();
    world.time = 100;
    hidden.lastSeen.blue = { x: 1400, y: 300, time: 100 }; // 刚刚看到过
    const fresh = rememberedEnemies(world, 'blue', CFG);
    expect(fresh.map(item => item.id)).toEqual([hidden.id]);
    expect(fresh[0].confidence).toBeCloseTo(1, 6);
    expect(fresh[0].ghost).toBe(true);
    expect(fresh[0].x).toBe(1400);

    world.time = 100 + CFG.memory.fadeSeconds / 2;
    expect(rememberedEnemies(world, 'blue', CFG)[0].confidence).toBeCloseTo(0.5, 6);
  });

  it('超过 fadeSeconds 或置信度低于 staleConfidence 的记忆会被忘掉', () => {
    const { world, hidden } = scene();
    world.time = 50;
    hidden.lastSeen.blue = { x: 1400, y: 300, time: 0 };
    expect(rememberedEnemies(world, 'blue', CFG)).toHaveLength(0); // 年龄 50s > fadeSeconds 25s
  });

  it('当前可见的敌人不会重复出现在记忆里', () => {
    const { world, near } = scene();
    world.time = 10;
    near.lastSeen.blue = { x: near.x, y: near.y, time: 9 };
    const known = knownEnemies(world, 'blue', CFG);
    expect(known.filter(item => item.id === near.id)).toHaveLength(1);
    expect(known.find(item => item.id === near.id).ghost).toBe(false);
  });

  it('perceive：全知模式返回全部敌军，公平模式只返回可见 + 记忆', () => {
    const { world, hidden, near } = scene();
    world.time = 80;
    hidden.lastSeen.blue = { x: 1400, y: 300, time: 78 };
    expect(allEnemies(world, 'blue').map(item => item.id).sort()).toEqual([hidden.id, near.id].sort());
    const fair = perceive(world, 'blue', CFG, true);
    expect(fair.map(item => item.id).sort()).toEqual([hidden.id, near.id].sort()); // 一个可见 + 一个记得
    expect(fair.find(item => item.id === hidden.id).ghost).toBe(true);
    expect(perceive(world, 'blue', CFG, false).every(item => item.ghost === false)).toBe(true);
  });

  it('awarenessSummary：汇总可见 / 记忆 / 敌方实际存活数（便于调试与测试）', () => {
    const { world, hidden } = scene();
    world.time = 60;
    hidden.lastSeen.blue = { x: 1400, y: 300, time: 59 };
    expect(awarenessSummary(world, 'blue', CFG, true)).toEqual({
      fogAware: true, visible: 1, remembered: 1, enemiesAlive: 2,
    });
  });
});

describe('前沿探索（侦察兵去哪）', () => {
  it('返回最近的未探索格中心，且不超出 maxExploreRadius', () => {
    const world = makeWorld(makePlainMap({ width: 1600, height: 600 }));
    const scout = world.spawnUnit('blue', 'light', 800, 300);
    scout.vision = 100;
    updateFog(world);
    const frontier = unexploredFrontier(world, 'blue', scout, { cfg: CFG });
    expect(frontier).not.toBeNull();
    const cell = world.terrain.cellAt(frontier.x, frontier.y);
    expect(world.fog.blue[world.terrain.cellIndex(cell.cx, cell.cy)]).toBe(FOG_UNEXPLORED);
    expect(Math.hypot(frontier.x - scout.x, frontier.y - scout.y)).toBeLessThanOrEqual(CFG.scout.maxExploreRadius);
  });

  it('同样近时优先朝敌方城市 / 目标方向侦察', () => {
    const world = makeWorld(makePlainMap({
      width: 1600, height: 600,
      cities: [{ id: 'c1', x: 800, y: 80, faction: 'blue' }, { id: 'c2', x: 800, y: 520, faction: 'red' }],
    }));
    const scout = world.spawnUnit('blue', 'light', 800, 300);
    scout.vision = 60;
    updateFog(world);
    const enemySide = { x: 800, y: 560 };
    const homeSide = { x: 800, y: 0 };
    const towardEnemy = unexploredFrontier(world, 'blue', scout, { cfg: CFG, prefer: [enemySide] });
    const away = unexploredFrontier(world, 'blue', scout, { cfg: CFG, prefer: [homeSide] });
    const distanceTo = (point, target) => Math.hypot(point.x - target.x, point.y - target.y);
    expect(towardEnemy).not.toEqual(away);
    expect(distanceTo(towardEnemy, enemySide)).toBeLessThan(distanceTo(away, enemySide));
  });

  it('全图都探索过时返回 null（侦察兵待命）', () => {
    const world = makeWorld(makePlainMap({ width: 400, height: 400 }));
    const scout = world.spawnUnit('blue', 'light', 200, 200);
    updateFog(world);
    world.fog.blue.fill(FOG_VISIBLE === 2 ? 1 : 1); // 全部标记为"已探索"（非未探索）
    expect(unexploredFrontier(world, 'blue', scout, { cfg: CFG })).toBeNull();
  });
});
