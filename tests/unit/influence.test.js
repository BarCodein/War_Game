import { describe, expect, it } from 'vitest';
import { values } from '../../src/config/index.js';
import {
  influenceAt, createField, rebuildField, contour, chainSegments, smoothPath, buildPaths, partitionField,
  guaranteeUnitCells,
} from '../../src/simulation/influence.js';
import { collectSources } from '../../src/simulation/systems/controlLine.js';
import { FOG_VISIBLE } from '../../src/simulation/systems/fog.js';
import { attackMoveCommand } from '../../src/simulation/commands.js';
import { makePlainMap, makeWorld, loadFractureCanyonMap, advance } from './helpers.js';

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
    coreRadius: values.units.light.radius, // 核心圈 = 碰撞体积
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

describe('影响力衰减曲线（照搬 srcipt.js，核心圈取绝对值、中圈/外圈按半径缩放）', () => {
  const { curve } = CFG;
  const radius = CFG.unit.influenceRadius;
  const strength = CFG.unit.strength;
  const core = values.units.light.radius;
  const scale = radius / curve.maxDistance;
  const source = (coreRadius) => ({ radius, strength, coreRadius });

  it('核心圈内满强度、出核心圈断崖、到半径处最低、超出半径归零', () => {
    expect(influenceAt(0, source(core), curve)).toBe(strength);
    expect(influenceAt(core, source(core), curve)).toBe(strength);
    // 刚出核心圈 → 直接掉到 coreExitRatio（原型的 100 → 20 断崖）
    expect(influenceAt(core + 1e-6, source(core), curve)).toBeCloseTo(strength * curve.coreExitRatio, 4);
    expect(influenceAt(curve.midDistance * scale, source(core), curve))
      .toBeCloseTo(strength * curve.midEndRatio, 6);
    expect(influenceAt(radius, source(core), curve)).toBeCloseTo(strength * curve.edgeEndRatio, 6);
    expect(influenceAt(radius + 1e-6, source(core), curve)).toBe(0);
  });

  it('核心圈是绝对值：换影响力半径不改变核心圈的 px 大小', () => {
    const narrow = 70;
    expect(influenceAt(core, source(core), curve)).toBe(strength);
    expect(influenceAt(core, { radius: narrow, strength, coreRadius: core }, curve)).toBe(strength);
    // 核心圈比影响力半径还大时以影响力半径为界
    expect(influenceAt(20, { radius: 10, strength, coreRadius: 60 }, curve)).toBe(0);
    expect(influenceAt(10, { radius: 10, strength, coreRadius: 60 }, curve)).toBe(strength);
  });

  it('沿距离单调不增', () => {
    let previous = Infinity;
    for (let distance = 0; distance <= radius + 40; distance += 1) {
      const value = influenceAt(distance, source(core), curve);
      expect(value).toBeLessThanOrEqual(previous);
      previous = value;
    }
  });

  it('中圈/外圈断点随影响力半径等比缩放，核心圈不跟着缩', () => {
    const half = radius / 2;
    const at = (r) => ({ radius: r, strength, coreRadius: core });
    // 中圈末端、外圈末端都按半径比例出现
    expect(influenceAt(curve.midDistance * (half / curve.maxDistance), at(half), curve))
      .toBeCloseTo(strength * curve.midEndRatio, 6);
    expect(influenceAt(half, at(half), curve)).toBeCloseTo(strength * curve.edgeEndRatio, 6);
    expect(influenceAt(half + 1e-6, at(half), curve)).toBe(0);
    // 核心圈是绝对值：半径减半后，核心圈仍然是碰撞体积那么大（断崖位置不变）
    expect(influenceAt(core, at(half), curve)).toBe(strength);
    expect(influenceAt(core + 1e-6, at(half), curve)).toBeCloseTo(strength * curve.coreExitRatio, 4);
  });
});

describe('影响力网格', () => {
  it('1280×800 地图在 cellSize 20 下是 64×40 格', () => {
    const field = createField(1280, 800, CFG.cellSize);
    expect([field.cols, field.rows]).toEqual([64, 40]);
    expect(field.values).toHaveLength(64 * 40);
  });

  it('蓝方单位令所在格为正、红方为负，半径外的格恰好为 0（不做全图划分时）', () => {
    const plain = { ...CFG, partitionMap: false }; // 只看影响力本身，排除"铺满全图"的填充
    const blue = buildField(400, 400, [unitSource(200, 200, 'blue')], plain);
    const red = buildField(400, 400, [unitSource(200, 200, 'red')], plain);
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
    expect(full[0].coreRadius).toBe(CFG.city.coreRadius); // 核心圈 = 城市自己的数值（不再是占领半径）

    world.cities[0].captureProgress = 50;
    expect(collectSources(world)[0].strength).toBeCloseTo(CFG.city.strength / 2, 6);

    world.cities[0].faction = 'neutral';
    expect(collectSources(world)).toHaveLength(0);
  });

  it('单位的核心圈是碰撞体积、城市是独立的 coreRadius、占领点是占领半径', () => {
    const world = makeWorld(makePlainMap({ width: 640, height: 480 }));
    world.cities = [{ id: 'c1', x: 100, y: 100, faction: 'blue', captureProgress: 0 }];
    world.capturePoints = [{ id: 'p1', x: 300, y: 100, faction: 'red', captureProgress: 0 }];
    const light = world.spawnUnit('blue', 'light', 200, 200);
    const heavy = world.spawnUnit('red', 'heavy', 400, 200);

    const bySign = (sign) => collectSources(world).filter((source) => source.sign === sign);
    expect(bySign(1).find((s) => s.coreRadius === light.radius).coreRadius).toBe(values.units.light.radius);
    expect(bySign(-1).find((s) => s.coreRadius === heavy.radius).coreRadius).toBe(values.units.heavy.radius);
    expect(bySign(-1).find((s) => s.coreRadius === values.controlLine.capturePoint.coreRadius).coreRadius)
      .toBe(values.controlLine.capturePoint.coreRadius);
    // 城市与占领点的核心圈**都与各自的占领半径脱钩**：改占领半径不会动它们，反之亦然
    expect(bySign(1).find((s) => s.coreRadius === values.controlLine.city.coreRadius).coreRadius)
      .toBe(values.controlLine.city.coreRadius);
    expect(values.controlLine.city.coreRadius).not.toBe(values.cities.capture.radius);
    expect(values.controlLine.capturePoint.coreRadius).not.toBe(values.capturePoints.capture.radius);
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
      {
        x: 300,
        y: 400,
        sign: 1,
        radius: CFG.city.influenceRadius,
        strength: CFG.city.strength,
        coreRadius: values.controlLine.city.coreRadius,
      },
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
    const world = makeWorld(loadFractureCanyonMap());
    world.spawnUnit('blue', 'light', 500, 400);
    world.spawnUnit('red', 'light', 700, 400);
    advance(world, 1);
    expect(world.controlLineSegments.length).toBeGreaterThan(0);
  });

  it('影响力只累加到半径覆盖的格子（不扫全图，500 单位也扛得住）', () => {
    // 性能守卫：绝对耗时断言在多 worker 并行跑测试时不可靠（实测本机并行时抖动可达数十倍），
    // 所以这里守「算法复杂度」：单个源最多污染它半径框内的格子。
    // 实测（Node，500 单位，1280×720）：单次重算 0.77 ms，tick 平均 2.13 ms（预算 8 ms）。
    const plain = { ...CFG, partitionMap: false }; // 关掉全图划分，只看累加本身扫了多少格
    const field = buildField(1280, 720, [unitSource(640, 360, 'blue')], plain);
    const touched = field.values.reduce((n, v) => n + (v !== 0 ? 1 : 0), 0);
    const span = Math.ceil((2 * CFG.unit.influenceRadius) / CFG.cellSize) + 3;
    expect(touched).toBeLessThanOrEqual(span * span);
    expect(touched).toBeLessThan(field.values.length / 5);
  });

  it('控制线不受视野限制：迷雾里的敌军照样参与统计', () => {
    const world = makeWorld(makePlainMap({ width: 640, height: 480 }));
    world.spawnUnit('blue', 'light', 200, 240); // 视野 140 → 覆盖 x ∈ [60, 340]
    world.spawnUnit('red', 'light', 400, 240);  // 落在蓝军视野之外
    advance(world, 1);

    const terrain = world.terrain;
    const redCell = terrain.cellIndex(
      Math.floor(400 / terrain.cellSize),
      Math.floor(240 / terrain.cellSize),
    );
    expect(world.fog.blue[redCell]).not.toBe(FOG_VISIBLE); // 红军所在格确实不可见
    // 但控制线照常统计（影响力源读的是 world.units，与 fog 无关）
    expect(world.controlLineSegments.length).toBeGreaterThan(0);
    expect(world.controlLinePaths.length).toBeGreaterThan(0);
  });

  it('铺满全图：战线一直延伸到地图边界，未探索/无影响力区域也有线', () => {
    // 两军在 y=400 对峙，上下都是没有任何影响力源的旷野
    const field = buildField(1000, 800, [unitSource(400, 400, 'blue'), unitSource(600, 400, 'red')]);
    const segments = contour(field, CFG.neutralEpsilon);

    const ys = segments.flatMap((segment) => [segment.y1, segment.y2]);
    expect(Math.min(...ys)).toBeLessThanOrEqual(CFG.cellSize);                    // 顶到地图上边
    expect(Math.max(...ys)).toBeGreaterThanOrEqual(800 - CFG.cellSize);           // 顶到地图下边
    // 场上没有影响力源的格子也已经被判定归属（不再有 0）
    expect(field.values.some((value) => value === 0)).toBe(false);
  });

  it('关掉 partitionMap 时旷野仍是中立、战线会在无部队处断开（回归）', () => {
    const noPartition = { ...CFG, partitionMap: false };
    const field = buildField(1000, 800, [unitSource(400, 400, 'blue'), unitSource(600, 400, 'red')], noPartition);
    const segments = contour(field, CFG.neutralEpsilon);
    const ys = segments.flatMap((segment) => [segment.y1, segment.y2]);
    expect(Math.min(...ys)).toBeGreaterThan(CFG.cellSize * 2);
    expect(Math.max(...ys)).toBeLessThan(800 - CFG.cellSize * 2);
  });

  it('partitionField：空格按最近的阵营归属，两侧波前相遇处形成分界', () => {
    const field = createField(400, 400, CFG.cellSize);
    field.values[0] = 5;                       // 左上角一个蓝方种子
    field.values[field.values.length - 1] = -5; // 右下角一个红方种子
    partitionField(field, CFG.neutralEpsilon, CFG.partitionFillValue);

    expect(field.values.some((value) => value === 0)).toBe(false);
    const cols = field.cols;
    // 对角线上离谁近就归谁：左上角为蓝、右下角为红
    expect(field.values[0]).toBeGreaterThan(0);
    expect(field.values[cols]).toBeGreaterThan(0);
    expect(field.values[field.values.length - 1]).toBeLessThan(0);
    expect(field.values[field.values.length - 1 - cols]).toBeLessThan(0);
    // 没有任何影响力源时不做划分（避免瞎涂满地图）
    const empty = createField(400, 400, CFG.cellSize);
    partitionField(empty, CFG.neutralEpsilon, CFG.partitionFillValue);
    expect(empty.values.every((value) => value === 0)).toBe(true);
  });
});

describe('单位所在格的硬保证（guaranteeUnitCells）', () => {
  // 敌方城市：核心圈 = controlLine.city.coreRadius、强度随占领进度衰减
  // ——正是"攻城时自己脚下被判给敌方"的元凶
  const cityAt = (progress) => ({
    x: 640,
    y: 360,
    sign: -1,
    radius: CFG.city.influenceRadius,
    strength: CFG.city.strength * (1 - progress / 100),
    coreRadius: values.controlLine.city.coreRadius,
  });
  const guard = (field, unit) => guaranteeUnitCells(
    field,
    [{ x: unit.x, y: unit.y, sign: unit.faction === 'red' ? -1 : 1 }],
    CFG.partitionFillValue,
  );

  it('站在敌方城市里（任意占领进度 × 任意站位）都留在自己阵营的控制区（回归）', () => {
    for (const progress of [0, 30, 60, 90]) {
      for (const dx of [0, 10, 20, 30, 40, 60, 80, 120]) {
        const unit = { x: 640 + dx, y: 360, faction: 'blue' };
        const field = buildField(1280, 720, [cityAt(progress), unitSource(unit.x, unit.y, 'blue')]);
        guard(field, unit);
        expect(
          field.values[cellIndexOf(field, unit.x, unit.y)],
          `progress=${progress} dx=${dx}`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it('多个敌军贴身时同样保住自己那一格', () => {
    const unit = { x: 640, y: 360, faction: 'blue' };
    const sources = [unitSource(unit.x, unit.y, 'blue')];
    for (let i = 0; i < 3; i += 1) sources.push(unitSource(660, 375 + i * 12, 'red'));
    const field = buildField(1280, 720, sources);
    guard(field, unit);
    expect(field.values[cellIndexOf(field, unit.x, unit.y)]).toBeGreaterThan(0);
  });

  it('最小扰动：只翻转单位自己那一格，量级不变', () => {
    const unit = { x: 640, y: 360, faction: 'blue' };
    const field = buildField(1280, 720, [cityAt(0), unitSource(unit.x, unit.y, 'blue')]);
    const before = Float32Array.from(field.values);
    const index = cellIndexOf(field, unit.x, unit.y);
    expect(before[index]).toBeLessThan(0); // 没兜底时确实被判给敌方

    guard(field, unit);
    expect(field.values[index]).toBeCloseTo(-before[index], 6);
    for (let i = 0; i < before.length; i += 1) {
      if (i === index) continue;
      expect(field.values[i]).toBe(before[i]);
    }
  });

  it('已经是己方的格不动（幂等）', () => {
    const unit = { x: 640, y: 360, faction: 'blue' };
    const field = buildField(1280, 720, [unitSource(unit.x, unit.y, 'blue')]);
    const before = Float32Array.from(field.values);
    guard(field, unit);
    expect(Array.from(field.values)).toEqual(Array.from(before));
  });

  it('系统集成：整场对战中每个存活单位脚下那格始终归自己阵营', () => {
    const world = makeWorld(makePlainMap({ width: 1280, height: 720 }));
    const blue = [];
    const red = [];
    for (let i = 0; i < 8; i += 1) {
      blue.push(world.spawnUnit('blue', i % 3 ? 'light' : 'heavy', 380, 140 + i * 60).id);
      red.push(world.spawnUnit('red', i % 3 ? 'light' : 'heavy', 900, 140 + i * 60).id);
    }
    world.issueCommands(blue, attackMoveCommand({ x: 1240, y: 360 }));
    world.issueCommands(red, attackMoveCommand({ x: 40, y: 360 }));

    let checked = 0;
    let violations = 0;
    for (let tick = 0; tick < 60 * 30; tick += 1) {
      world.tick(STEP);
      // 只在"刚重算完影响力场"的那一 tick 检查：两次重算之间（100 ms）单位会挪动，
      // 可能跨进相邻格，而那一格要等下一次重算才被保证——这是 10 Hz 刷新的固有延迟，
      // 不是规则漏洞（站着攻城这种静止场景是确定性满足的）。
      if (!world.controlLine || world.controlLineTick !== 0) continue;
      const field = world.controlLine;
      for (const unit of world.units) {
        if (unit.state === 'dead') continue;
        const sign = unit.faction === 'blue' ? 1 : -1;
        checked += 1;
        if (field.values[cellIndexOf(field, unit.x, unit.y)] * sign <= 0) violations += 1;
      }
    }
    expect(checked).toBeGreaterThan(100);
    expect(violations).toBe(0);
  });
});

describe('控制线几何：串联 + Chaikin 平滑', () => {
  it('线段按端点串成折线，两端保留、中段加密', () => {
    const field = buildField(1000, 800, [unitSource(400, 400, 'blue'), unitSource(600, 400, 'red')]);
    const segments = contour(field, CFG.neutralEpsilon);
    const polylines = chainSegments(segments);

    expect(polylines).toHaveLength(1); // 两军对峙只有一条战线
    const line = polylines[0];
    expect(line.length).toBe(segments.length + 1); // 串联后点数 = 线段数 + 1

    const smoothed = smoothPath(line, 2);
    expect(smoothed.length).toBeGreaterThan(line.length * 3); // 每轮切角点数近似翻倍
    expect(smoothed[0]).toEqual(line[0]);                      // 首尾不动
    expect(smoothed[smoothed.length - 1]).toEqual(line[line.length - 1]);
    for (const point of smoothed) {
      expect(Math.abs(point.x - 500)).toBeLessThanOrEqual(CFG.cellSize);
    }
  });

  it('平滑只切角，不改变折线的大致形状（点都留在原折线附近）', () => {
    const corner = [
      { x: 0, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 200 },
    ];
    const smoothed = smoothPath(corner, 3);
    expect(smoothed[0]).toEqual(corner[0]);
    expect(smoothed[smoothed.length - 1]).toEqual(corner[corner.length - 1]);
    for (const point of smoothed) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(100);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(200);
    }
    // 直角处的点被磨掉：不再有正好落在原拐角上的点
    expect(smoothed.some(point => point.x === 0 && point.y === 100)).toBe(false);
  });

  it('iters = 0 时只串联不平滑；包围圈串成闭合折线', () => {
    const field = buildField(1000, 800, [unitSource(400, 400, 'blue'), unitSource(600, 400, 'red')]);
    const segments = contour(field, CFG.neutralEpsilon);
    expect(buildPaths(segments, 0)[0]).toEqual(chainSegments(segments)[0]);

    // 红方城市被蓝军团团围住 → 0 等值线闭合成一个圈
    // （用城市当圆心：城市核心圈 = controlLine.city.coreRadius、强度 120，
    //  被 4 个 130px 外的单位围住仍守得住中心）
    const ring = buildField(1000, 800, [
      {
        x: 400,
        y: 400,
        sign: -1,
        radius: CFG.city.influenceRadius,
        strength: CFG.city.strength,
        coreRadius: values.controlLine.city.coreRadius,
      },
      unitSource(270, 400, 'blue'), unitSource(530, 400, 'blue'),
      unitSource(400, 270, 'blue'), unitSource(400, 530, 'blue'),
    ]);
    const rings = chainSegments(contour(ring, CFG.neutralEpsilon));
    const closed = rings.filter((line) => (
      line.length > 2
      && line[0].x === line[line.length - 1].x
      && line[0].y === line[line.length - 1].y
    ));
    expect(closed.length).toBeGreaterThan(0);
    // 闭合圈平滑后仍然闭合
    const smoothedClosed = smoothPath(closed[0], 2);
    expect(smoothedClosed[0]).toEqual(smoothedClosed[smoothedClosed.length - 1]);
  });
});
