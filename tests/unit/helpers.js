import { readFileSync } from 'node:fs';
import { World } from '../../src/simulation/world.js';
import { advanceTo } from '../../src/simulation/loop.js';
import { values } from '../../src/config/index.js';

// 全平原测试地图：默认含双阵营城市与出生点（满足可玩性校验），
// 需要无城/单阵营场景的测试可显式覆盖或运行时剔除城市。
export function makePlainMap({ width = 1280, height = 720, gridCellSize = 20, cities, spawns, terrainCells = {} } = {}) {
  const cols = width / gridCellSize;
  const rows = height / gridCellSize;
  const cells = new Array(cols * rows).fill(0);
  for (const [key, code] of Object.entries(terrainCells)) {
    const [cx, cy] = key.split(',').map(Number);
    cells[cy * cols + cx] = code;
  }
  const defaultCities = [
    { id: 'c1', x: 100, y: 600, faction: 'blue' },
    { id: 'c2', x: 1100, y: 100, faction: 'red' },
  ];
  const defaultSpawns = [
    { faction: 'blue', x: 100, y: 600 },
    { faction: 'red', x: 1100, y: 100 },
  ];
  return {
    version: 1,
    name: 'test-map',
    size: { width, height },
    gridCellSize,
    terrain: { width: cols, height: rows, cells },
    cities: cities ?? defaultCities,
    spawns: spawns ?? defaultSpawns,
    objectives: [],
  };
}

export function makeWorld(mapData = makePlainMap()) {
  return new World(mapData);
}

export function advance(world, seconds) {
  advanceTo(world, world.time + seconds);
}

// 推进世界与外部控制器（如 ScriptedAI）到目标时刻。
// 先 tick 后决策：控制器读取本 tick 更新后的状态（含重建的空间网格），
// 下发的命令在下一 tick 生效。
export function runSimulation(world, controllers, seconds) {
  const step = values.simulation.fixedStep;
  const target = world.time + seconds;
  while (world.time < target && !world.winner) {
    world.tick(step);
    for (const controller of controllers) controller.update(step);
  }
}

export function loadTutorialMap() {
  const url = new URL('../../public/assets/maps/fracture-canyon.json', import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8'));
}
