import { describe, expect, it } from 'vitest';
import { values } from '../../src/config/index.js';
import {
  approachAxes, approachWaypoint, chooseApproach, chooseWeakSpot, feintAxis, frontPointsNear, pointStrength, terrainPreference,
} from '../../src/simulation/ai/front.js';
import { makePlainMap, makeWorld } from './helpers.js';

// 薄弱点进攻（docs/ai-design.md 阶段二 B）：复用战线找最弱接近轴。
const CFG = values.ai;

function withFront(world, segments) {
  world.controlLineSegments = segments.map(([ax, ay, bx, by]) => ({ a: { x: ax, y: ay }, b: { x: bx, y: by } }));
  return world;
}

describe('战线采样', () => {
  it('frontPointsNear：只取目标附近的线段端点，并按 40px 去重、受 pointLimit 限制', () => {
    const world = withFront(makeWorld(makePlainMap({ width: 1200, height: 600 })), [
      [600, 300, 640, 300],   // 目标附近
      [620, 300, 660, 300],   // 与上一条同格（去重）
      [1100, 100, 1150, 100], // 太远
    ]);
    const near = frontPointsNear(world, { x: 600, y: 300 }, 200);
    expect(near.length).toBeGreaterThan(0);
    expect(near.every(point => Math.hypot(point.x - 600, point.y - 300) <= 200)).toBe(true);
    expect(frontPointsNear(world, { x: 50, y: 50 }, 100)).toEqual([]);
  });

  it('pointStrength：给出双方战力与占比；空点记 1（没有部队挡路 = 薄弱）', () => {
    const world = makeWorld(makePlainMap({ width: 1200, height: 600 }));
    world.spawnUnit('blue', 'light', 600, 300);
    world.spawnUnit('blue', 'light', 620, 300);
    world.spawnUnit('red', 'light', 640, 300);
    world.spatial.rebuild(world.units);
    const blue = pointStrength(world, { x: 610, y: 300 }, 'blue');
    const red = pointStrength(world, { x: 610, y: 300 }, 'red');
    expect(blue.ratio).toBeGreaterThan(0.5);
    expect(red.ratio).toBeLessThan(0.5);
    expect(blue.ratio + red.ratio).toBeCloseTo(1, 6);

    const empty = pointStrength(world, { x: 100, y: 500 }, 'blue');
    expect(empty).toMatchObject({ friendly: 0, enemy: 0, ratio: 1 });
  });

  it('chooseWeakSpot：在目标附近的两段战线里选敌方更弱的那段', () => {
    const world = withFront(makeWorld(makePlainMap({ width: 1200, height: 600 })), [
      [500, 300, 520, 300], // 离目标稍远，但有敌军把守
      [760, 300, 780, 300], // 离目标稍近且空虚 → 薄弱
    ]);
    world.spawnUnit('red', 'light', 510, 300);
    world.spawnUnit('red', 'light', 515, 310);
    world.spatial.rebuild(world.units);

    const spot = chooseWeakSpot(world, { objective: { x: 600, y: 300 }, faction: 'blue' });
    expect(spot).not.toBeNull();
    expect(spot.x).toBeGreaterThan(700);   // 选了空虚的那一段
    expect(spot.enemy).toBe(0);
    expect(spot.ratio).toBe(1);
  });

  it('chooseWeakSpot：没有任何战线时返回 null（调用方回退到直接接近目标）', () => {
    const world = makeWorld(makePlainMap({ width: 800, height: 480 }));
    expect(chooseWeakSpot(world, { objective: { x: 400, y: 240 }, faction: 'blue' })).toBeNull();
  });
});

describe('接近轴', () => {
  it('approachAxes：围绕目标生成 axisCount 条轴线，中间一条正对我方，端点落在 standoff 上', () => {
    const objective = { x: 800, y: 300 };
    const origin = { x: 200, y: 300 };
    const axes = approachAxes(objective, origin, CFG);
    expect(axes).toHaveLength(CFG.weakSpot.axisCount);
    const middle = axes[Math.floor(axes.length / 2)];
    expect(middle.y).toBeCloseTo(300, 6);                                   // 正面轴
    expect(middle.x).toBeCloseTo(800 - CFG.weakSpot.standoff, 6);           // 停在目标前方
    // 两条侧翼轴分居中轴两侧（符号相反）
    expect((axes[0].y - middle.y) * (axes.at(-1).y - middle.y)).toBeLessThan(0);
    const spread = Math.abs(axes[0].angle - axes.at(-1).angle);
    expect(spread).toBeCloseTo(2 * CFG.weakSpot.axisSpread, 6);
  });

  it('chooseApproach：挑敌方最弱的一条轴，taken 里的轴会被跳过', () => {
    const world = makeWorld(makePlainMap({ width: 1200, height: 600 }));
    const objective = { x: 900, y: 300 };
    // 正面轴上放敌军，侧翼留空
    world.spawnUnit('red', 'light', 700, 300);
    world.spawnUnit('red', 'light', 700, 320);
    world.spawnUnit('blue', 'light', 200, 300);
    world.spatial.rebuild(world.units);

    const first = chooseApproach(world, { unit: { x: 200, y: 300 }, objective, faction: 'blue' });
    expect(first).not.toBeNull();
    const second = chooseApproach(world, { unit: { x: 200, y: 300 }, objective, faction: 'blue', taken: new Set([first.index]) });
    expect(second.index).not.toBe(first.index);
  });

  it('approachWaypoint：还没到停战线时先去轴线端点，越过后直接压向目标', () => {
    const objective = { x: 900, y: 300 };
    const axis = { x: 700, y: 300 };
    expect(approachWaypoint(axis, objective, { x: 200, y: 300 })).toEqual({ x: 700, y: 300 });
    expect(approachWaypoint(axis, objective, { x: 800, y: 300 })).toEqual(objective);
  });

  it('feintAxis：佯动轴与主攻轴不同', () => {
    const world = makeWorld(makePlainMap({ width: 1200, height: 600 }));
    world.spatial.rebuild(world.units);
    const objective = { x: 900, y: 300 };
    const mainAxis = approachAxes(objective, { x: 200, y: 300 }, CFG)[1];
    const feint = feintAxis(world, { mainAxis, objective, faction: 'blue', cfg: CFG });
    expect(feint.index).not.toBe(mainAxis.index);
  });
});

describe('地形偏好', () => {
  const gridCellSize = values.terrain.gridCellSize;
  const cols = 1200 / gridCellSize;
  const rows = 600 / gridCellSize;
  const terrainCells = {};
  // 一条森林带（x=20 列）与一条道路带（x=40 列）
  for (let cy = 0; cy < rows; cy += 1) {
    terrainCells[`20,${cy}`] = values.terrain.codes.forest;
    terrainCells[`40,${cy}`] = values.terrain.codes.road;
  }
  const world = makeWorld(makePlainMap({ width: 1200, height: 600, terrainCells }));
  const forest = { x: 20 * gridCellSize + gridCellSize / 2, y: 300 };
  const road = { x: 40 * gridCellSize + gridCellSize / 2, y: 300 };

  it('谨慎档偏好防守地形（森林），狡诈档偏好机动地形（道路）', () => {
    expect(terrainPreference(world, forest, 'defensive'))
      .toBeGreaterThan(terrainPreference(world, forest, 'mobility'));
    expect(terrainPreference(world, road, 'mobility'))
      .toBeGreaterThan(terrainPreference(world, road, 'defensive'));
  });

  it('平原在两种口味下都不极端', () => {
    const plain = { x: 600, y: 300 };
    const balanced = terrainPreference(world, plain, 'balanced');
    expect(balanced).toBeGreaterThanOrEqual(0);
    expect(balanced).toBeLessThanOrEqual(1);
  });
});
