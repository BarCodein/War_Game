import { describe, expect, it } from 'vitest';
import { advance, makePlainMap, makeWorld } from './helpers.js';
import { planRoute, transitionToNewRoute, updateMovement } from '../../src/simulation/systems/movement.js';
import { attackMoveCommand } from '../../src/simulation/commands.js';
import { values } from '../../src/config/index.js';

function riverWorldWithBridge() {
  // 第 30–31 列（x=300~320）为水域，第 32–33 行放一座桥（水域可通行，桥用于验证桥梁通行）。
  // 10px 网格下，原 20px 的 (15,16) 对应 2×2 块 (30~31, 32~33)，桥仍在 (310, 330)。
  const cells = {};
  for (let cy = 0; cy < 72; cy += 1) {
    cells[`30,${cy}`] = values.terrain.codes.water;
    cells[`31,${cy}`] = values.terrain.codes.water;
  }
  for (const key of ['30,32', '31,32', '30,33', '31,33']) cells[key] = values.terrain.codes.bridge;
  return makeWorld(makePlainMap({ terrainCells: cells }));
}

describe('planRoute（最短路径规划）', () => {
  it('地图外的目标点被夹回地图内（否则单位会走进未渲染区域）', () => {
    // 地图 1280×720，但游戏画布是 1280×800：画布下方 80px 不属于地图。
    // terrain.passableAt() 会把格子索引夹到边缘格，所以地图外的坐标"看起来可通行"，
    // 必须夹取，否则原始越界坐标会变成路径终点。
    const world = makeWorld(makePlainMap({ width: 1280, height: 720 }));
    const below = planRoute(world.terrain, 640, 360, [{ x: 640, y: 900 }]);
    expect(below[below.length - 1]).toEqual({ x: 640, y: 720 });

    const left = planRoute(world.terrain, 640, 360, [{ x: -50, y: 300 }]);
    expect(left[left.length - 1]).toEqual({ x: 0, y: 300 });

    const right = planRoute(world.terrain, 640, 360, [{ x: 5000, y: 100 }]);
    expect(right[right.length - 1]).toEqual({ x: 1280, y: 100 });
  });

  it('越界命令下达后单位停在地图边界内', () => {
    const world = makeWorld(makePlainMap({ width: 1280, height: 720 }));
    const unit = world.spawnUnit('blue', 'light', 640, 360);
    world.issueCommands([unit.id], attackMoveCommand({ x: 640, y: 900 }));
    expect(unit.route.every(p => p.y <= 720 && p.y >= 0 && p.x >= 0 && p.x <= 1280)).toBe(true);

    advance(world, 30);
    expect(unit.y).toBeLessThanOrEqual(720); // 不会走出地图（更不会走到画布空白带里）
    expect(unit.y).toBeGreaterThan(690);
  });

  it('无障碍时保留原路径点', () => {
    const world = makeWorld(makePlainMap());
    const route = planRoute(world.terrain, 100, 100, [{ x: 200, y: 100 }, { x: 300, y: 100 }]);
    expect(route).toEqual([{ x: 200, y: 100 }, { x: 300, y: 100 }]);
  });

  it('水域可以通行，路径不再强制绕行到桥梁', () => {
    const world = riverWorldWithBridge();
    const route = planRoute(world.terrain, 200, 360, [{ x: 400, y: 360 }]);
    expect(world.terrain.passableAt(310, 360)).toBe(true);
    expect(route[route.length - 1]).toEqual({ x: 400, y: 360 });
  });

  it('水域中的单位按水域速度倍率移动', () => {
    const plainWorld = makeWorld(makePlainMap());
    const waterWorld = makeWorld(makePlainMap({
      terrainCells: { '10,11': values.terrain.codes.water }, // 10px 网格下单位 (100,110) 所在格
    }));
    const plainUnit = plainWorld.spawnUnit('blue', 'light', 100, 110);
    const waterUnit = waterWorld.spawnUnit('blue', 'light', 100, 110);
    plainWorld.issueCommands([plainUnit.id], { type: 'move', path: [{ x: 200, y: 110 }] });
    waterWorld.issueCommands([waterUnit.id], { type: 'move', path: [{ x: 200, y: 110 }] });
    plainWorld.tick(1 / 60);
    waterWorld.tick(1 / 60);
    expect(waterUnit.x - 100).toBeCloseTo(
      (plainUnit.x - 100) * values.terrain.moveMultiplier.water,
    );
  });

  it('路径目标始终保留，即使水域没有桥梁', () => {
    // 第 80–81 列（x=800~820）为水域；水域可通行，因此直线路径直达目标
    // （坐标与其它用例不同，避免共用全局 pathCache 的格子键被复用）
    const cells = {};
    for (let cy = 0; cy < 72; cy += 1) {
      cells[`80,${cy}`] = values.terrain.codes.water;
      cells[`81,${cy}`] = values.terrain.codes.water;
    }
    const world = makeWorld(makePlainMap({ terrainCells: cells }));
    const route = planRoute(world.terrain, 600, 360, [{ x: 900, y: 360 }]);
    expect(route).toEqual([{ x: 900, y: 360 }]);
  });

  it('高山地形围起封闭山谷时，谷外单位无法规划路径且被物理阻挡无法进入山谷', () => {
    const cells = {};
    for (let cx = 20; cx <= 30; cx += 1) {
      cells[`${cx},20`] = values.terrain.codes.highMountain;
      cells[`${cx},30`] = values.terrain.codes.highMountain;
    }
    for (let cy = 20; cy <= 30; cy += 1) {
      cells[`20,${cy}`] = values.terrain.codes.highMountain;
      cells[`30,${cy}`] = values.terrain.codes.highMountain;
    }
    const world = makeWorld(makePlainMap({ terrainCells: cells }));
    const route = planRoute(world.terrain, 100, 250, [{ x: 250, y: 250 }]);
    expect(route).toEqual([]);

    const unit = world.spawnUnit('blue', 'light', 100, 250);
    world.issueCommands([unit.id], { type: 'move', path: [{ x: 250, y: 250 }] });
    expect(unit.state).toBe('hold');
    expect(unit.route).toEqual([]);

    // 即使被强行赋予穿山路径，移动系统也必须在撞上高山前将其阻挡停下
    unit.route = [{ x: 250, y: 250 }];
    unit.routeIndex = 0;
    unit.state = 'moving';
    for (let tick = 0; tick < 180; tick += 1) world.tick(1 / 60);

    expect(unit.x).toBeLessThanOrEqual(200);
    expect(unit.state).toBe('hold');
  });

  it('高山地形围起山谷但有缺口时，单位通过缺口绕行进入山谷', () => {
    const cells = {};
    for (let cx = 20; cx <= 30; cx += 1) {
      cells[`${cx},20`] = values.terrain.codes.highMountain;
      cells[`${cx},30`] = values.terrain.codes.highMountain;
    }
    for (let cy = 20; cy <= 30; cy += 1) {
      cells[`20,${cy}`] = values.terrain.codes.highMountain;
      cells[`30,${cy}`] = values.terrain.codes.highMountain;
    }
    delete cells['20,22']; // 在 cy=22 留出缺口
    const world = makeWorld(makePlainMap({ terrainCells: cells }));
    const route = planRoute(world.terrain, 100, 255, [{ x: 255, y: 255 }]);
    expect(route.length).toBeGreaterThan(1);
    expect(route[route.length - 1]).toEqual({ x: 255, y: 255 });
  });
});

describe('移动轨迹衔接', () => {
  it('半径 40px 内命中新轨迹时从覆盖点继续，不返回轨迹起点', () => {
    const world = makeWorld(makePlainMap());
    const unit = world.spawnUnit('blue', 'light', 100, 100);
    unit.route = [{ x: 200, y: 100 }, { x: 300, y: 100 }];
    unit.routeIndex = 0;
    unit.state = 'moving';
    const newRoute = [{ x: 300, y: 180 }, { x: 220, y: 100 }, { x: 400, y: 100 }];
    const result = transitionToNewRoute(unit, newRoute, world);
    expect(result[0]).toEqual({ x: 100, y: 100 });
    expect(result.length).toBeLessThan(newRoute.length + unit.route.length);
    expect(result).not.toContainEqual({ x: 300, y: 180 });
  });

  it('远离新轨迹时生成平滑过渡点而不是直接折返', () => {
    const world = makeWorld(makePlainMap());
    const unit = world.spawnUnit('blue', 'light', 100, 100);
    const result = transitionToNewRoute(unit, [{ x: 400, y: 300 }, { x: 500, y: 300 }], world);
    expect(result.length).toBeGreaterThan(1);
    expect(result[0]).not.toEqual({ x: 400, y: 300 });
    expect(result.at(-1)).toEqual({ x: 500, y: 300 });
  });

  it('水域阻挡时过渡路径使用可通行路径点', () => {
    const world = riverWorldWithBridge();
    const unit = world.spawnUnit('blue', 'light', 200, 360);
    const result = transitionToNewRoute(unit, [{ x: 400, y: 360 }], world);
    expect(result.every(point => world.terrain.passableAt(point.x, point.y))).toBe(true);
  });

  it('使用旧路径与新路径之间的最近线段连接点', () => {
    const world = makeWorld(makePlainMap());
    const unit = world.spawnUnit('blue', 'light', 100, 100);
    unit.route = [{ x: 200, y: 100 }, { x: 300, y: 100 }];
    unit.routeIndex = 0;
    unit.state = 'moving';
    const result = transitionToNewRoute(unit, [{ x: 220, y: 140 }, { x: 320, y: 140 }], world);
    expect(result.some(point => Math.abs(point.x - 220) < 1 && Math.abs(point.y - 100) < 1)).toBe(true);
    expect(result.some(point => Math.abs(point.x - 220) < 1 && Math.abs(point.y - 140) < 1)).toBe(true);
    expect(result.at(-1)).toEqual({ x: 320, y: 140 });
  });
});

describe('多单位移动分离', () => {
  it('相同目标的单位不会因重复碰撞分离而卡在原地', () => {
    const world = makeWorld(makePlainMap());
    const first = world.spawnUnit('blue', 'light', 100, 100);
    const second = world.spawnUnit('blue', 'light', 100, 100);
    world.issueCommands([first.id, second.id], { type: 'move', path: [{ x: 400, y: 100 }] });
    const initialDistance = Math.hypot(second.x - first.x, second.y - first.y);
    for (let tick = 0; tick < 120; tick += 1) world.tick(1 / 60);
    expect(Math.max(first.x, second.x)).toBeGreaterThan(150);
    expect(Math.hypot(second.x - first.x, second.y - first.y)).toBeGreaterThan(initialDistance);
  });

  it('被静态己方单位阻挡后会生成稳定的侧向绕行路线', () => {
    const world = makeWorld(makePlainMap());
    const moving = world.spawnUnit('blue', 'light', 100, 100);
    world.spawnUnit('blue', 'light', 140, 100);
    world.issueCommands([moving.id], { type: 'move', path: [{ x: 400, y: 100 }] });
    moving.stuckTime = values.movement.stuckThresholdSeconds;
    world.tick(0);
    expect(moving.route.some(point => Math.abs(point.y - 100) > 1)).toBe(true);
    for (let tick = 0; tick < 360; tick += 1) world.tick(1 / 60);
    expect(moving.x).toBeGreaterThan(180);
    expect(moving.rerouteAttempts).toBeLessThanOrEqual(values.movement.maxRerouteAttempts);
  });
});

describe('水域通行：不再被卡住', () => {
  // 水域的岸边可以是不可通行的高山；水本身可通行、速度 0.4，且"让路"逻辑都在 waterSafeStep 里。
  // 这一组用例守的是 bug：单位沿轨迹过水域时会停在河中央不动（详见各处注释）。
  function lakeWorld({ extraCells = {}, width = 640, height = 480 } = {}) {
    const cells = {};
    for (let cx = 10; cx <= 20; cx += 1) {
      for (let cy = 10; cy <= 20; cy += 1) cells[`${cx},${cy}`] = values.terrain.codes.water;
    }
    Object.assign(cells, extraCells);
    return makeWorld(makePlainMap({ width, height, terrainCells: cells }));
  }

  it('水中迎面相遇的两名友军会错身而过，不会互相顶住僵死', () => {
    // 圆心距 30.05 ≈ 软排斥的分离距离（14+14+2 = 30）：让路判据若与分离距离取同一个阈值，
    // 双方会互相判成"前方有人"，而软排斥又认为已经够开、根本不会推 → 双双步长为 0。
    const world = lakeWorld();
    const first = world.spawnUnit('blue', 'light', 100, 100);
    const second = world.spawnUnit('blue', 'light', 113.2, 127.0);
    world.issueCommands([first.id], { type: 'move', path: [{ x: 100, y: 200 }] });
    world.issueCommands([second.id], { type: 'move', path: [{ x: 113.2, y: 27 }] });

    advance(world, 2.5);
    // 两人都朝各自目标走了 15px 以上，并且已经错开（距离 > 分离距离）
    expect(first.y - 100).toBeGreaterThan(15);
    expect(127 - second.y).toBeGreaterThan(15);
    expect(Math.hypot(second.x - first.x, second.y - first.y)).toBeGreaterThan(30);
    expect(first.state).toBe('moving');
    expect(second.state).toBe('moving');

    // 错身之后各自走完（没有被对方顶住）
    advance(world, 6);
    expect(Math.hypot(first.x - 100, first.y - 200)).toBeLessThan(5);
    expect(Math.hypot(second.x - 113.2, second.y - 27)).toBeLessThan(5);
  });

  it('够不着的轨迹采样点被跳过，后续轨迹继续走（不丢整条轨迹）', () => {
    // 拖曳轨迹是 8px 一个采样点的长轨迹；其中一个点落在不可通行的高山上时，
    // 旧实现会把整条轨迹清空并停住 —— 于是"过水域时卡在河中央"。
    const cells = {};
    for (let cx = 30; cx <= 31; cx += 1) {
      for (let cy = 28; cy <= 31; cy += 1) cells[`${cx},${cy}`] = values.terrain.codes.highMountain;
    }
    const world = makeWorld(makePlainMap({ terrainCells: cells }));
    const unit = world.spawnUnit('blue', 'light', 200, 300);
    unit.route = [{ x: 260, y: 300 }, { x: 310, y: 300 }, { x: 400, y: 300 }]; // 中间那个点在山上
    unit.routeIndex = 0;
    unit.state = 'moving';

    advance(world, 20);
    expect(Math.hypot(unit.x - 400, unit.y - 300)).toBeLessThan(20); // 走到了轨迹终点
    expect(unit.state).toBe('hold');                                 // 轨迹走完才停
  });

  it('水面紧贴高山：不会踏进不可通行地形而永久定住，会绕过去', () => {
    // 水面东侧是一道高山墙（列 21~25、行 10~20）。目标在山那边：
    // 水里是直线航行、不看地形，旧实现会一路走进高山格 —— 那里移动倍率 0，位移恒为 0，
    // 单位再也出不来（永远"卡在河边"）。
    const extra = {};
    for (let cx = 21; cx <= 25; cx += 1) {
      for (let cy = 10; cy <= 20; cy += 1) extra[`${cx},${cy}`] = values.terrain.codes.highMountain;
    }
    const world = lakeWorld({ extraCells: extra });
    const unit = world.spawnUnit('blue', 'light', 150, 150);
    world.issueCommands([unit.id], { type: 'move', path: [{ x: 400, y: 150 }] });

    let everImpassable = false;
    for (let tick = 0; tick < 60 * 30; tick += 1) {
      world.tick(1 / 60);
      if (!world.terrain.passableAt(unit.x, unit.y)) everImpassable = true;
    }
    expect(everImpassable).toBe(false);
    expect(Math.hypot(unit.x - 400, unit.y - 150)).toBeLessThan(20); // 绕过山墙到达目标
  });

  it('水域软排斥不会把单位推进不可通行地形', () => {
    // 水西侧紧贴高山：挤在一起的两名友军里，靠西的那个"被推开"的方向正是山体。
    // 旧实现无条件推 → 单位被推进高山格 → 移动倍率 0 → 永久定住。
    const extra = {};
    for (let cy = 10; cy <= 20; cy += 1) extra[`9,${cy}`] = values.terrain.codes.highMountain;
    const world = lakeWorld({ extraCells: extra });
    const west = world.spawnUnit('blue', 'light', 101, 150);
    const east = world.spawnUnit('blue', 'light', 115, 150); // 距离 14 < 分离距离 30 → 触发软排斥
    world.issueCommands([west.id], { type: 'move', path: [{ x: 200, y: 150 }] });
    world.issueCommands([east.id], { type: 'move', path: [{ x: 200, y: 170 }] });

    for (let tick = 0; tick < 60 * 5; tick += 1) {
      world.tick(1 / 60);
      expect(world.terrain.passableAt(west.x, west.y)).toBe(true);
      expect(world.terrain.passableAt(east.x, east.y)).toBe(true);
    }
    // 靠西的单位留在水里且真的动了（没有被推进山里定住）
    expect(world.terrain.terrainAt(west.x, west.y)).toBe(values.terrain.codes.water);
    expect(west.x).toBeGreaterThan(105);
  });
});

describe('溃退移动速度', () => {
  it('自动溃退速度低于普通移动速度', () => {
    const routWorld = makeWorld(makePlainMap());
    const routUnit = routWorld.spawnUnit('red', 'light', 800, 150);
    routUnit.state = 'rout';
    routUnit.route = [{ x: 1100, y: 100 }];
    routUnit.routeIndex = 0;
    routUnit.pathDirty = false;
    routUnit.pathCheckCell = routWorld.terrain.cellIndex(40, 7);

    const normalWorld = makeWorld(makePlainMap());
    const normalUnit = normalWorld.spawnUnit('red', 'light', 800, 150);
    normalUnit.state = 'moving';
    normalUnit.route = [{ x: 1100, y: 100 }];
    normalUnit.routeIndex = 0;
    normalUnit.pathDirty = false;
    normalUnit.pathCheckCell = normalWorld.terrain.cellIndex(40, 7);

    updateMovement(routWorld, 1 / 60);
    updateMovement(normalWorld, 1 / 60);

    const routDistance = Math.hypot(routUnit.x - 800, routUnit.y - 150);
    const normalDistance = Math.hypot(normalUnit.x - 800, normalUnit.y - 150);
    expect(routDistance).toBeCloseTo(normalDistance * values.movement.routSpeedMultiplier);
    expect(routDistance).toBeLessThan(normalDistance);
  });
});
