import { describe, expect, it } from 'vitest';
import { values } from '../../src/config/index.js';
import { influenceAt, createField, rebuildField, contour } from '../../src/simulation/influence.js';
import { collectSources } from '../../src/simulation/systems/controlLine.js';
import { makePlainMap, makeWorld, loadTutorialMap, advance } from './helpers.js';

// 实际控制线（gdd.md §9）：影响力衰减曲线、影响力网格、0 等值线。
// 这些是纯函数，可以脱离渲染精确构造几何再断言。
const CFG = values.controlLine;
const STEP = values.simulation.fixedStep;

function unitSource(x, y, faction, overrides = {}) {
  return {
    x,
    y,
    sign: faction === 'blue' ? 1 : -1,
    radius: CFG.unit.influenceRadius,
    strength: CFG.unit.strength,
    ...overrides,
  };
}

function buildField(width, height, sources, cfg = CFG) {
  const field = createField(width, height, CFG.cellSize);
  rebuildField(field, sources, cfg);
  return field;
}

const cellIndexOf = (field, x, y) => (
  Math.min(field.rows - 1, Math.floor(y / field.cellSize)) * field.cols
  + Math.min(field.cols - 1, Math.floor(x / field.cellSize))
);
const checksum = (field) => field.values.reduce((sum, value) => sum + value, 0);

describe('影响力衰减曲线（照搬 srcipt.js 的四段式，按半径等比缩放）', () => {
  const { curve } = CFG;
  const radius = CFG.unit.influenceRadius;
  const strength = CFG.unit.strength;
  const scale = radius / curve.maxDistance;

  it('内圈满强度、出内圈断崖、到半径处最低、超出半径归零', () => {
    expect(influenceAt(0, radius, strength, curve)).toBe(strength);
    expect(influenceAt(curve.coreDistance * scale, radius, strength, curve)).toBe(strength);
    // 刚出内圈 → 直接掉到 coreExitRatio（原型的 100 → 20 断崖）
    expect(influenceAt(curve.coreDistance * scale + 1e-6, radius, strength, curve))
      .toBeCloseTo(strength * curve.coreExitRatio, 4);
    expect(influenceAt(curve.midDistance * scale, radius, strength, curve))
      .toBeCloseTo(strength * curve.midEndRatio, 6);
    expect(influenceAt(radius, radius, strength, curve)).toBeCloseTo(strength * curve.edgeEndRatio, 6);
    expect(influenceAt(radius + 1e-6, radius, strength, curve)).toBe(0);
  });

  it('沿距离单调不增', () => {
    let previous = Infinity;
    for (let distance = 0; distance <= radius + 40; distance += 1) {
      const value = influenceAt(distance, radius, strength, curve);
      expect(value).toBeLessThanOrEqual(previous);
      previous = value;
    }
  });

  it('半径整体缩放：同一相对距离的影响力相同', () => {
    const half = radius / 2;
    expect(influenceAt(radius * 0.5, radius, strength, curve))
      .toBeCloseTo(influenceAt(half * 0.5, half, strength, curve), 10);
    expect(influenceAt(half, half, strength, curve)).toBeCloseTo(strength * curve.edgeEndRatio, 6);
    expect(influenceAt(half + 1e-6, half, strength, curve)).toBe(0);
  });
});

describe('影响力网格', () => {
  it('1280×800 地图在 cellSize 20 下是 64×40 格', () => {
    const field = createField(1280, 800, CFG.cellSize);
    expect([field.cols, field.rows]).toEqual([64, 40]);
    expect(field.values).toHaveLength(64 * 40);
  });

  it('蓝方单位令所在格为正、红方为负，半径外的格恰好为 0', () => {
    const blue = buildField(400, 400, [unitSource(200, 200, 'blue')]);
    const red = buildField(400, 400, [unitSource(200, 200, 'red')]);
    const near = cellIndexOf(blue, 200, 200);
    const far = cellIndexOf(blue, 10, 10); // 距单位 ~268 px > 140 px 半径

    expect(blue.values[near]).toBeGreaterThan(0);
    expect(red.values[near]).toBeCloseTo(-blue.values[near], 6);
    expect(blue.values[far]).toBe(0);
    expect(red.values[far]).toBe(0);
  });

  it('城市/占领点按阵营贡献影响力；争夺中按占领进度线性削弱；中立不贡献', () => {
    const world = makeWorld(makePlainMap({ width: 640, height: 480 }));
    world.units = [];
    world.capturePoints = [];
    world.cities = [{ id: 'c1', x: 320, y: 240, faction: 'blue', captureProgress: 0 }];

    const full = collectSources(world);
    expect(full).toHaveLength(1);
    expect(full[0].sign).toBe(1);
    expect(full[0].radius).toBe(CFG.city.influenceRadius);
    expect(full[0].strength).toBe(CFG.city.strength);

    world.cities[0].captureProgress = 50;
    expect(collectSources(world)[0].strength).toBeCloseTo(CFG.city.strength / 2, 6);

    world.cities[0].faction = 'neutral';
    expect(collectSources(world)).toHaveLength(0);
  });

  it('阵亡单位与中立占领点不产生影响力', () => {
    const world = makeWorld(makePlainMap({ width: 640, height: 480 }));
    world.cities = [];
    world.capturePoints = [{ id: 'p1', x: 100, y: 100, faction: 'neutral', captureProgress: 0 }];
    const blue = world.spawnUnit('blue', 'light', 200, 200);
    world.spawnUnit('red', 'light', 400, 200);
    expect(collectSources(world)).toHaveLength(2);

    blue.state = 'dead';
    const sources = collectSources(world);
    expect(sources).toHaveLength(1);
    expect(sources[0].sign).toBe(-1);
  });
});

describe('实际控制线（0 等值线）', () => {
  it('两军对峙时，分界线落在双方正中间', () => {
    // 蓝军在 x=400、红军在 x=600（都在 y=400）：影响力场关于 x=500 反对称，
    // 因此 0 等值线就是 x=500 的竖线（两端会各自拐一小段，收进中立区）。
    const field = buildField(1000, 800, [unitSource(400, 400, 'blue'), unitSource(600, 400, 'red')]);
    const segments = contour(field, CFG.neutralEpsilon);

    expect(segments.length).toBeGreaterThan(0);
    for (const segment of segments) {
      expect(Math.abs(segment.x1 - 500)).toBeLessThanOrEqual(CFG.cellSize);
      expect(Math.abs(segment.x2 - 500)).toBeLessThanOrEqual(CFG.cellSize);
    }
    // 绝大多数线段正落在中线上（只有两端各有一段收尾）
    const onFront = segments.filter(segment => (
      Math.abs(segment.x1 - 500) < 1e-6 && Math.abs(segment.x2 - 500) < 1e-6
    ));
    expect(onFront.length).toBeGreaterThan(segments.length / 2);

    const ys = segments.flatMap(segment => [segment.y1, segment.y2]);
    expect(Math.min(...ys)).toBeLessThan(400);
    expect(Math.max(...ys)).toBeGreaterThan(400);
  });

  it('只有一方或空场时不画线（影响范围的外沿不算分界）', () => {
    expect(contour(buildField(1000, 800, [unitSource(400, 400, 'blue')]), CFG.neutralEpsilon)).toHaveLength(0);
    expect(contour(buildField(1000, 800, []), CFG.neutralEpsilon)).toHaveLength(0);
  });

  it('城市影响力同样参与分界（城市 vs 敌军单位）', () => {
    const field = buildField(1000, 800, [
      { x: 300, y: 400, sign: 1, radius: CFG.city.influenceRadius, strength: CFG.city.strength },
      unitSource(550, 400, 'red'), // 双方影响力半径在这两点之间重叠
    ]);
    const segments = contour(field, CFG.neutralEpsilon);
    expect(segments.length).toBeGreaterThan(0);
    for (const segment of segments) {
      expect(segment.x1).toBeGreaterThan(300);
      expect(segment.x1).toBeLessThan(700);
    }
  });

  it('时间平滑：重算时按 temporalSmoothing 向上一次结果靠拢', () => {
    const noBlur = { ...CFG, fieldBlurPasses: 0 };
    const field = createField(400, 400, CFG.cellSize);
    rebuildField(field, [unitSource(200, 200, 'blue')], noBlur); // 首次重算直接采用新值
    const index = cellIndexOf(field, 200, 200);
    const before = field.values[index];
    expect(before).toBeGreaterThan(0);

    rebuildField(field, [], noBlur); // 影响力源消失
    expect(field.values[index]).toBeCloseTo(before * (1 - CFG.temporalSmoothing), 6);
  });
});

describe('controlLine 系统（10 Hz 重算 + tick 集成）', () => {
  it('第 1 个 tick 立即建场，之后每 refreshTicks 个 tick 重算一次', () => {
    const world = makeWorld(makePlainMap());
    const blue = world.spawnUnit('blue', 'light', 500, 300);
    world.spawnUnit('red', 'light', 700, 300); // 相距 200 px < 2×半径 → 中间有分界线

    world.tick(STEP);
    expect(world.controlLine).not.toBeNull();
    expect(world.controlLineTick).toBe(1);
    expect(world.controlLineSegments.length).toBeGreaterThan(0);

    const before = checksum(world.controlLine);
    blue.x = 400; // 拉开距离 → 双方影响力不再接触
    for (let i = 0; i < CFG.refreshTicks - 2; i += 1) world.tick(STEP);
    expect(world.controlLineTick).toBe(CFG.refreshTicks - 1);
    expect(checksum(world.controlLine)).toBe(before); // 未到重算点：场保持原样

    world.tick(STEP); // 第 refreshTicks 个 tick → 重算
    expect(world.controlLineTick).toBe(0);
    expect(checksum(world.controlLine)).not.toBe(before);
  });

  it('教学地图上双方接火后能画出控制线', () => {
    const world = makeWorld(loadTutorialMap());
    world.spawnUnit('blue', 'light', 500, 400);
    world.spawnUnit('red', 'light', 700, 400);
    advance(world, 1);
    expect(world.controlLineSegments.length).toBeGreaterThan(0);
  });

  it('影响力只累加到半径覆盖的格子（不扫全图，500 单位也扛得住）', () => {
    // 性能守卫：绝对耗时断言在多 worker 并行跑测试时不可靠（实测本机并行时抖动可达数十倍），
    // 所以这里守「算法复杂度」：单个源最多污染它半径框内的格子（+ 1 格模糊扩散）。
    // 实测（Node，500 单位，1280×720）：单次重算 0.77 ms，tick 平均 2.13 ms（预算 8 ms）。
    const field = buildField(1280, 720, [unitSource(640, 360, 'blue')]);
    const touched = field.values.reduce((n, v) => n + (v !== 0 ? 1 : 0), 0);
    const span = Math.ceil((2 * CFG.unit.influenceRadius) / CFG.cellSize) + 3;
    expect(touched).toBeLessThanOrEqual(span * span);
    expect(touched).toBeLessThan(field.values.length / 5);
  });
});
