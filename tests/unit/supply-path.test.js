import { describe, expect, it } from 'vitest';
import { advance, makePlainMap, makeWorld } from './helpers.js';
import { values } from '../../src/config/index.js';
import {
  buildBlockedMask, buildSupplyField, createSupplyField, findSupplyPath, supplyFactor, supplyGrid,
} from '../../src/simulation/supplyPath.js';

// 补给线规则（gdd.md §7）：
//   单位 → 己方城市的最短路径（地形加权「等效像素」、不穿敌方实际控制区）
//   → 城市按「离自己最近的单位优先」支出吞吐点数（容量 5）
//   → 城市为把补给送到手里要付 需求 ÷ 因子 点；实收 = 付出 × 因子
//   → 实收不足即缺补给，损耗与士气惩罚按缺口比例缩放；多座城可同时供同一单位。

const PLAIN = 0;
const FOREST = 1;
const WATER = 2;
const HIGH_MOUNTAIN = 5;
const ROAD = 6;

function blueMap({ cities, terrainCells = {}, width = 1280, height = 720 } = {}) {
  return makePlainMap({
    width,
    height,
    terrainCells,
    cities: cities ?? [
      { id: 'c1', x: 100, y: 600, faction: 'blue' },
      { id: 'c2', x: 1100, y: 100, faction: 'red' },
    ],
    spawns: [
      { faction: 'blue', x: 100, y: 600 },
      { faction: 'red', x: 1100, y: 100 },
    ],
  });
}

// 一格地形（脚本地图是 10 px 网格）
function fillCells(cells, fromCol, toCol, fromRow, toRow, code) {
  for (let row = fromRow; row <= toRow; row += 1) {
    for (let col = fromCol; col <= toCol; col += 1) cells[`${col},${row}`] = code;
  }
}

describe('补给：距离因子', () => {
  it('因子 = clamp(1 − (代价 − 100) / 800, 0.2, 1)', () => {
    expect(supplyFactor(0)).toBe(1);      // 近在咫尺
    expect(supplyFactor(100)).toBe(1);    // 满额段
    expect(supplyFactor(500)).toBeCloseTo(0.5, 10);
    expect(supplyFactor(900)).toBeCloseTo(0.2, 10);
    expect(supplyFactor(1500)).toBe(0.2); // 下限封底：远城仍能救急
    expect(supplyFactor(Infinity)).toBe(0); // 够不着
  });
});

describe('补给：路径代价', () => {
  it('代价 = 平原上的等效像素（斜向按八向距离算）', () => {
    const world = makeWorld(blueMap());
    const straight = world.spawnUnit('blue', 'light', 400, 600);   // 正东 300 px
    const diagonal = world.spawnUnit('blue', 'light', 400, 300);   // 斜向：直线距离 300√2 ≈ 424
    advance(world, 1);
    expect(straight.supplyCost).toBeCloseTo(300, 0);
    // 斜着走不多收费：代价 = 地表距离（4 邻域会算成 600 = 曼哈顿距离）
    expect(diagonal.supplyCost).toBeCloseTo(Math.hypot(300, 300), 0);
  });

  it('地形加权：森林更贵、道路更便宜', () => {
    const cost = (terrainCells) => {
      const world = makeWorld(blueMap({ terrainCells }));
      const unit = world.spawnUnit('blue', 'light', 500, 600);
      advance(world, 1);
      return { unit, cost: unit.supplyCost };
    };
    const plain = cost({});
    // 城 (100,600) 与单位 (500,600) 之间铺满森林（x 200~400）
    const forestCells = {};
    fillCells(forestCells, 20, 40, 55, 65, FOREST);
    const forest = cost(forestCells);
    // 同一条走廊改成道路
    const roadCells = {};
    fillCells(roadCells, 20, 40, 55, 65, ROAD);
    const road = cost(roadCells);

    expect(plain.cost).toBeCloseTo(400, 0);
    expect(forest.cost).toBeGreaterThan(plain.cost);  // 森林拖慢补给
    expect(road.cost).toBeLessThan(plain.cost);       // 道路加快补给
    expect(forest.unit.supplyEdges[0].factor).toBeLessThan(plain.unit.supplyEdges[0].factor);
  });

  it('不可通行地形不参与平均、整格不可通行即阻断；水域默认可蹚但很贵', () => {
    // 补给格是 20 px = 2×2 个地形格：这里挑补给格 (10,30)（x 200~220、y 600~620）
    const cells = {};
    fillCells(cells, 20, 21, 60, 61, HIGH_MOUNTAIN); // 整格高山
    const grid = supplyGrid(makeWorld(blueMap({ terrainCells: cells })));
    expect(Number.isFinite(grid.steps[(30 * grid.cols) + 10])).toBe(false); // 整格高山 = 阻断

    const water = {};
    fillCells(water, 20, 21, 60, 61, WATER);
    const waterGrid = supplyGrid(makeWorld(blueMap({ terrainCells: water })));
    const waterStep = waterGrid.steps[(30 * waterGrid.cols) + 10];
    expect(waterStep).toBeCloseTo(waterGrid.cellSize / 0.4, 5); // 水域通行倍率 0.4 → 代价 2.5 倍
  });
});

describe('补给：敌方实际控制区阻断', () => {
  it('穿过敌方控制区的补给线被切断；忽略控制区时那条线仍在（断补提示用）', () => {
    const world = makeWorld(blueMap());
    // 红方在 x=400 拉一道竖墙：影响力半径 140、间隔 100 → 整张地图的南北通道全被盖住
    for (let y = 100; y <= 700; y += 100) world.spawnUnit('red', 'light', 400, y);
    const unit = world.spawnUnit('blue', 'light', 500, 600);
    advance(world, 2); // 代价场每 1 s 重算一次（首次在 t=0、那时还没有控制线），2 s 足以生效

    expect(unit.supplied).toBe(false);
    expect(unit.supplyRatio).toBe(0);
    expect(unit.supplyCost).toBe(Infinity); // 敌方控制区不可通行 → 够不着任何己方城市

    // 掩码：墙所在的那一列被标记为阻断
    const grid = supplyGrid(world);
    const mask = buildBlockedMask(world, 'blue');
    const wallCol = Math.floor(400 / grid.cellSize);
    expect(mask[Math.floor(600 / grid.cellSize) * grid.cols + wallCol]).toBe(1);

    // "本来该走的那条路"：忽略控制区就能算出来（渲染层用它画红色虚线）
    const city = world.cities.find(c => c.id === 'c1');
    const relief = findSupplyPath(world, 'blue', { x: unit.x, y: unit.y }, { x: city.x, y: city.y }, { ignoreControl: true });
    expect(relief).not.toBeNull();
    expect(findSupplyPath(world, 'blue', { x: unit.x, y: unit.y }, { x: city.x, y: city.y })).toBeNull();
  });

  it('没有敌军阻断时同一条线是通的（对照组）', () => {
    const world = makeWorld(blueMap());
    const unit = world.spawnUnit('blue', 'light', 500, 600);
    advance(world, 1);
    expect(unit.supplied).toBe(true);
    expect(unit.supplyCost).toBeCloseTo(400, 0);
    expect(unit.supplyEdges).toHaveLength(1);
    expect(unit.supplyEdges[0].cityId).toBe('c1');
  });
});

describe('补给：容量与多城协同', () => {
  it('最近的城市点数用光后，单位改由下一座城补给', () => {
    const world = makeWorld(blueMap({
      cities: [
        { id: 'c1', x: 100, y: 600, faction: 'blue' },
        { id: 'c3', x: 560, y: 600, faction: 'blue' },
        { id: 'c2', x: 1100, y: 100, faction: 'red' },
      ],
    }));
    // 5 个贴城单位（因子 1，各花 1 点）吃掉 c1 的全部 5 点吞吐
    for (let i = 0; i < 5; i += 1) world.spawnUnit('blue', 'light', 110 + i * 10, 600);
    const far = world.spawnUnit('blue', 'light', 300, 600); // 离 c1 200、离 c3 260 → 首选 c1
    advance(world, 1);

    expect(far.supplied).toBe(true);
    expect(far.supplyEdges).toHaveLength(1);
    expect(far.supplyEdges[0].cityId).toBe('c3'); // c1 满了 → 顺延到 c3
    expect(far.supplyEdges[0].factor).toBeLessThan(1); // 远城要打折
    expect(world.citySupplyLoad.get('c1')).toBeCloseTo(values.supply.capacityPerCity, 5); // 容量用满
  });

  it('一座城不够时，多座城同时给同一个单位补给（部分 + 补齐）', () => {
    const world = makeWorld(blueMap({
      cities: [
        { id: 'c1', x: 100, y: 600, faction: 'blue' },
        { id: 'c3', x: 600, y: 600, faction: 'blue' },
        { id: 'c2', x: 1100, y: 100, faction: 'red' },
      ],
    }));
    // 4 个贴城单位吃掉 c3 的 4 点，只给它留下 1 点
    for (let i = 0; i < 4; i += 1) world.spawnUnit('blue', 'light', 560 + i * 30, 600);
    const far = world.spawnUnit('blue', 'light', 1200, 600); // 到 c3 约 600（因子 0.375）、到 c1 约 1100（因子 0.2）
    advance(world, 1);

    expect(far.supplied).toBe(true); // 两座城合力凑满
    expect(far.supplyEdges).toHaveLength(2);
    expect(far.supplyEdges[0].cityId).toBe('c3'); // 先吃近城的剩余运力
    expect(far.supplyEdges[1].cityId).toBe('c1'); // 再由远城补齐差额
    expect(far.supplyEdges[0].received).toBeGreaterThan(0);
    expect(far.supplyEdges[1].received).toBeGreaterThan(0);
    const received = far.supplyEdges.reduce((sum, edge) => sum + edge.received, 0);
    expect(received).toBeCloseTo(values.supply.demandPerUnit, 5);
  });

  it('所有城市都满了 → 断补（损耗按缺口比例：完全断补 = 1 hp/s）', () => {
    const world = makeWorld(blueMap());
    for (let i = 0; i < 5; i += 1) world.spawnUnit('blue', 'light', 110 + i * 10, 600); // 吃掉全部 5 点
    const extra = world.spawnUnit('blue', 'light', 300, 600); // 唯一的另一座城是敌方的
    advance(world, 1);
    expect(extra.supplied).toBe(false);
    expect(extra.supplyRatio).toBe(0);
    expect(extra.supplyEdges).toHaveLength(0);
    expect(extra.hp).toBeCloseTo(59, 1); // 1 hp/s × 1 s
  });

  it('部分补给按缺口比例减轻损耗（实收 73% → 损耗 27%）', () => {
    const world = makeWorld(blueMap());
    const near = world.spawnUnit('blue', 'light', 400, 600);  // 代价 ~300 → 因子 0.75 → 要 1.33 点
    const far = world.spawnUnit('blue', 'light', 1000, 600);  // 代价 ~900 → 因子 0.2 → 要 5 点
    advance(world, 1);
    expect(near.supplied).toBe(true); // 便宜的先用（城市优先补最近的）
    expect(far.supplied).toBe(false);
    // c1 的 5 点：先给 near 1.33，剩下 3.67 给 far → 实收 3.67 × 0.2 = 0.734
    expect(far.supplyRatio).toBeGreaterThan(0.6);
    expect(far.supplyRatio).toBeLessThan(0.8);
    const deficit = 1 - far.supplyRatio;
    expect(far.hp).toBeCloseTo(60 - values.supply.attritionHpPerSecond * deficit, 1);
  });
});

describe('补给：确定性与开销', () => {
  it('同一场景重复跑得到同样的补给结果（可复现）', () => {
    const run = () => {
      const world = makeWorld(blueMap());
      for (let i = 0; i < 8; i += 1) world.spawnUnit('blue', 'light', 200 + i * 20, 600);
      advance(world, 3);
      return world.units.map(unit => `${unit.id}:${unit.supplyRatio.toFixed(6)}:${unit.supplyCost.toFixed(3)}`).join('|');
    };
    expect(run()).toBe(run());
  });

  it('代价场重算开销可接受（500 单位 / 1280×720 地图）', () => {
    const world = makeWorld(blueMap());
    for (let i = 0; i < 500; i += 1) {
      world.spawnUnit('blue', 'light', 120 + (i % 25) * 12, 500 + Math.floor(i / 25) * 8);
    }
    const field = createSupplyField(supplyGrid(world));
    buildSupplyField(world, 'blue', field); // 预热（含 JIT）
    const started = performance.now();
    const builds = 20;
    for (let i = 0; i < builds; i += 1) buildSupplyField(world, 'blue', field);
    const perBuild = (performance.now() - started) / builds;
    // 代价场每 fieldRefreshSeconds(1s) 才重算一次，摊到每 tick 是 perBuild / 60：
    // 这里只守住"单次重算 < 一帧预算的若干倍"这条上限（实测见提交说明）
    expect(perBuild).toBeLessThan(50);
  });
});
