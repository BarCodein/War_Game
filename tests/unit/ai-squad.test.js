import { describe, expect, it } from 'vitest';
import { values } from '../../src/config/index.js';
import {
  assignSlots, cohesionRatio, facingTo, formationSlots, isCohesive, isRushingAhead, needsColumn, squadAnchor, squadCentroid,
} from '../../src/simulation/ai/squad.js';
import { makePlainMap, makeWorld } from './helpers.js';

// 编队协同（docs/ai-design.md 阶段一 C）：队形槽位、窄口判定、就位度。
const SPACING = values.ai.squad.slotSpacing;

describe('队形槽位', () => {
  it('line：横向排开，居中于锚点（朝向 +x 时全在 y 轴上）', () => {
    const slots = formationSlots(4, 'line', { x: 1, y: 0 });
    expect(slots.map(s => s.x)).toEqual([0, 0, 0, 0]);
    expect(slots.map(s => s.y)).toEqual([-1.5 * SPACING, -0.5 * SPACING, 0.5 * SPACING, 1.5 * SPACING]);
  });

  it('column：全部排在锚点之后（过桥/隘口用）', () => {
    const slots = formationSlots(3, 'column', { x: 1, y: 0 });
    // 注意 -0：用 +0 归一，避免 Object.is(−0, 0) 造成的假失败
    expect(slots.map(s => Math.round(s.x) + 0)).toEqual([0, -SPACING, -2 * SPACING]);
    expect(slots.every(s => s.y === 0)).toBe(true);
  });

  it('槽位按朝向旋转：朝 -y 时 line 变成沿 x 轴排开', () => {
    const slots = formationSlots(2, 'line', { x: 0, y: -1 });
    expect(slots.every(s => Math.abs(s.y) < 1e-9)).toBe(true);
    expect(slots.map(s => s.x)).toEqual([-0.5 * SPACING, 0.5 * SPACING]);
  });

  it('wedge：第一排在锚点，其后成对向两侧张开', () => {
    const slots = formationSlots(5, 'wedge', { x: 1, y: 0 });
    expect(Math.round(slots[0].x) + 0).toBe(0);
    expect(slots[0].y).toBe(0);
    // 后续排都更靠后（x 更小），且左右对称
    expect(slots.slice(1).every(s => s.x < 0)).toBe(true);
    expect(Math.abs(slots[1].y + slots[2].y)).toBeLessThan(1e-9);
  });

  it('facingTo：两点重合时退化为 +x（不产生 NaN）', () => {
    expect(facingTo({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({ x: 1, y: 0 });
    const facing = facingTo({ x: 0, y: 0 }, { x: 0, y: 10 });
    expect(facing).toEqual({ x: 0, y: 1 });
  });
});

describe('编队锚点与槽位分配', () => {
  const units = [
    { id: 1, x: 0, y: 0 },
    { id: 2, x: 40, y: 0 },
    { id: 3, x: 0, y: 40 },
  ];

  it('锚点 = 形心向目标推进 advanceStep（不会越过目标）', () => {
    const objective = { x: 1000, y: 0 };
    const anchor = squadAnchor(units, objective, 60);
    expect(anchor.centroid.x).toBeCloseTo(40 / 3, 6);
    // 推进了 60px，方向指向目标（用距离与点积断言，避免依赖朝向的浮点尾数）
    expect(Math.hypot(anchor.x - anchor.centroid.x, anchor.y - anchor.centroid.y)).toBeCloseTo(60, 6);
    const toObjective = facingTo(anchor.centroid, objective);
    expect(anchor.facing.x * toObjective.x + anchor.facing.y * toObjective.y).toBeCloseTo(1, 9);

    const near = squadAnchor(units, { x: anchor.centroid.x + 10, y: anchor.centroid.y }, 60);
    expect(Math.hypot(near.x - near.centroid.x, near.y - near.centroid.y)).toBeCloseTo(10, 6); // 只走到目标
  });

  it('槽位分配是确定性的（同一输入两次结果一致，且与输入顺序无关）', () => {
    const anchor = squadAnchor(units, { x: 1000, y: 0 });
    const slots = formationSlots(units.length, 'line', anchor.facing);
    const first = assignSlots(units, anchor, slots).map(a => [a.unit.id, Math.round(a.point.x), Math.round(a.point.y)]);
    const again = assignSlots(units, anchor, slots).map(a => [a.unit.id, Math.round(a.point.x), Math.round(a.point.y)]);
    const shuffled = assignSlots([units[2], units[0], units[1]], anchor, slots)
      .map(a => [a.unit.id, Math.round(a.point.x), Math.round(a.point.y)]);
    expect(again).toEqual(first);
    expect(shuffled).toEqual(first);
  });
});

describe('窄口判定（是否改纵队）', () => {
  // 在 800×480 的平原地图正中竖着开一条水域（x = 400）
  const gridCellSize = values.terrain.gridCellSize;
  const cols = 800 / gridCellSize;
  const rows = 480 / gridCellSize;
  const terrainCells = {};
  for (let cy = 0; cy < rows; cy += 1) terrainCells[`${cols / 2},${cy}`] = values.terrain.codes.water;
  const world = makeWorld(makePlainMap({ width: 800, height: 480, terrainCells }));

  it('直线穿过水域 → 需要纵队', () => {
    expect(needsColumn(world.terrain, { x: 100, y: 240 }, { x: 700, y: 240 })).toBe(true);
  });

  it('不碰水域的直线 → 不需要纵队', () => {
    expect(needsColumn(world.terrain, { x: 100, y: 100 }, { x: 300, y: 100 })).toBe(false);
  });
});

describe('队形就位度', () => {
  const cfg = values.ai.squad;
  const center = { x: 0, y: 0 };

  it('cohesionRatio：按半径统计比例，超出半径的掉队者会拉低比例', () => {
    const tight = [{ x: 10, y: 0 }, { x: 20, y: 0 }, { x: 30, y: 0 }, { x: 40, y: 0 }];
    expect(cohesionRatio(tight, center)).toBe(1);
    const lagging = [{ x: 10, y: 0 }, { x: 20, y: 0 }, { x: 30, y: 0 }, { x: cfg.cohesionRadius + 50, y: 0 }];
    expect(cohesionRatio(lagging, center)).toBeCloseTo(0.75, 6);
    expect(isCohesive(lagging, center)).toBe(true);   // 0.75 ≥ 0.7
    expect(isCohesive([{ x: 10, y: 0 }, { x: cfg.cohesionRadius + 50, y: 0 }], center)).toBe(false); // 0.5 < 0.7
  });

  it('isRushingAhead：只有"脱离队形 + 比形心更靠前"的单位才需要等主力', () => {
    const objective = { x: 1000, y: 0 };
    const front = { x: cfg.cohesionRadius + 60, y: 0 };
    const behind = { x: -(cfg.cohesionRadius + 60), y: 0 };
    expect(isRushingAhead(front, center, objective)).toBe(true);
    expect(isRushingAhead(behind, center, objective)).toBe(false);
    expect(isRushingAhead({ x: 10, y: 0 }, center, objective)).toBe(false); // 在队形内
  });

  it('squadCentroid：空小队不报错', () => {
    expect(squadCentroid([])).toEqual({ x: 0, y: 0 });
  });
});
