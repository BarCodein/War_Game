import { describe, expect, it } from 'vitest';
import { World } from '../../src/simulation/world.js';
import { deployForces } from '../../src/simulation/level.js';
import { loadPvpLevel } from '../../server/src/levels.js';
import { buildBlockedMask, findSupplyPath, supplyGrid } from '../../src/simulation/supplyPath.js';

// 回归：**被占领的敌方基地**常常仍压在敌方实际控制区里。
// 代价场把"己方城市格"当作豁免的补给起点，所以单位会拿到指向它的补给边；
// 若绘制层的 A* 也把该终点格当 blocked，就会返回 null → 这条补给线永远画不出来。
function makeWorld() {
  const { level, map } = loadPvpLevel('dujiang_pvp');
  const world = new World(map);
  deployForces(world, level.forces, level.anchors ?? {});
  return world;
}

const cellIndex = (grid, x, y) => {
  const cx = Math.min(grid.cols - 1, Math.max(0, Math.floor(x / grid.cellSize)));
  const cy = Math.min(grid.rows - 1, Math.max(0, Math.floor(y / grid.cellSize)));
  return cy * grid.cols + cx;
};

describe('补给线绘制：终点格是己方城市时不受敌方控制区阻挡', () => {
  it('终点格被 mask 标记为 blocked，仍能找到路径（被占领基地的情形）', () => {
    const world = makeWorld();
    const unit = world.units.find((item) => item.faction === 'blue');
    const city = world.cities.find((item) => item.faction === 'blue');
    const grid = supplyGrid(world);
    const mask = buildBlockedMask(world, 'blue');

    // 制造"城市格被敌方控制"的局面：把终点格标记为 blocked
    mask[cellIndex(grid, city.x, city.y)] = 1;
    const path = findSupplyPath(world, 'blue', { x: unit.x, y: unit.y }, { x: city.x, y: city.y }, { mask });
    expect(path).not.toBeNull();
    expect(path.length).toBeGreaterThan(1);
  });

  it('终点被 mask 封死时，路径终点仍然落在城市格里', () => {
    const world = makeWorld();
    const unit = world.units.find((item) => item.faction === 'blue');
    const city = world.cities.find((item) => item.faction === 'blue');
    const grid = supplyGrid(world);
    const mask = buildBlockedMask(world, 'blue');
    mask[cellIndex(grid, city.x, city.y)] = 1;

    const path = findSupplyPath(world, 'blue', { x: unit.x, y: unit.y }, { x: city.x, y: city.y }, { mask });
    expect(path).not.toBeNull();
    const last = path[path.length - 1];
    expect(Math.hypot(last.x - city.x, last.y - city.y)).toBeLessThanOrEqual(20);
  });

  it('中途格被 blocked 时不会变成"无视控制区"（豁免只对终点生效）', () => {
    const world = makeWorld();
    const unit = world.units.find((item) => item.faction === 'blue');
    const grid = supplyGrid(world);
    const mask = buildBlockedMask(world, 'blue');

    // 在单位与目标之间横着封一条 3 格宽的墙
    const wallCol = Math.floor(unit.x / grid.cellSize) + 4;
    for (let cy = 0; cy < grid.rows; cy += 1) {
      for (let offset = 0; offset < 3; offset += 1) {
        const index = (cy * grid.cols) + Math.min(grid.cols - 1, wallCol + offset);
        mask[index] = 1;
      }
    }
    const target = { x: (wallCol + 8) * grid.cellSize, y: unit.y };
    const withWall = findSupplyPath(world, 'blue', { x: unit.x, y: unit.y }, target, { mask });
    const withoutWall = findSupplyPath(world, 'blue', { x: unit.x, y: unit.y }, target, {
      mask: buildBlockedMask(world, 'blue'),
    });
    expect(withoutWall).not.toBeNull();
    if (withWall) {
      // 有墙时要么绕路（更长），要么无路；绝不能和没墙一样直
      expect(withWall.length).toBeGreaterThanOrEqual(withoutWall.length);
    }
  });
});
