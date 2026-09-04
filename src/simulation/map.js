import { values } from '../config/index.js';

// 地图 JSON：版本化、读取时结构校验 + 可玩性校验、版本迁移链（architecture.md §7）。
// 编辑器与运行时共享本模块（REQUIREMENTS.md §4.6）。

export const MAP_VERSION = 1;

// 版本迁移链：data.version → MAP_VERSION。当前无历史版本；
// version 低于当前且无对应迁移时拒绝载入（机制就绪，F10 验收）。
export const migrations = [];

export function migrateMap(data) {
  let current = data;
  while (current.version < MAP_VERSION) {
    const step = migrations[current.version];
    if (!step) {
      throw new Error(`[map] unsupported map version ${current.version}: no migration to version ${current.version + 1}`);
    }
    current = step(current);
  }
  return current;
}

export function validateMap(data) {
  const errors = [];
  if (!data || typeof data !== 'object') return ['map data must be an object'];
  if (typeof data.version !== 'number') errors.push('missing numeric version');
  else if (data.version > MAP_VERSION) errors.push(`map version ${data.version} is newer than supported ${MAP_VERSION}`);

  const { size, gridCellSize, terrain, cities = [], spawns = [] } = data;
  if (!size || typeof size.width !== 'number' || typeof size.height !== 'number' || size.width <= 0 || size.height <= 0) {
    errors.push('invalid size');
  }
  if (typeof gridCellSize !== 'number' || gridCellSize <= 0) errors.push('invalid gridCellSize');
  if (!terrain || typeof terrain.width !== 'number' || typeof terrain.height !== 'number' || !Array.isArray(terrain.cells)) {
    errors.push('missing terrain grid');
  } else {
    if (terrain.width * terrain.height !== terrain.cells.length) errors.push('terrain cells length mismatch');
    if (size && gridCellSize > 0 && (terrain.width !== size.width / gridCellSize || terrain.height !== size.height / gridCellSize)) {
      errors.push('terrain grid dimensions do not match map size / gridCellSize');
    }
  }

  for (const city of cities) {
    if (!city || typeof city.id !== 'string' || !Number.isFinite(city.x) || !Number.isFinite(city.y) || !['blue', 'red'].includes(city.faction)) {
      errors.push(`invalid city: ${JSON.stringify(city)}`);
    }
  }
  for (const faction of ['blue', 'red']) {
    if (!cities.some(c => c && c.faction === faction)) errors.push(`no ${faction} city (unplayable)`);
  }
  for (const spawn of spawns) {
    if (!spawn || !['blue', 'red'].includes(spawn.faction) || !Number.isFinite(spawn.x) || !Number.isFinite(spawn.y)) {
      errors.push(`invalid spawn: ${JSON.stringify(spawn)}`);
    }
  }
  for (const faction of ['blue', 'red']) {
    if (!spawns.some(s => s && s.faction === faction)) errors.push(`no ${faction} spawn (unplayable)`);
  }
  return errors;
}

// 地形访问层：逻辑网格表达通行性、寻路成本、视野阻挡（REQUIREMENTS.md §4.3）。
export function makeTerrain(mapData) {
  const { gridCellSize, terrain } = mapData;
  const { width: cols, height: rows, cells } = terrain;
  const nameByCode = {};
  for (const [name, code] of Object.entries(values.terrain.codes)) nameByCode[code] = name;
  return {
    cellSize: gridCellSize,
    cols,
    rows,
    cells,
    cellAt(x, y) {
      const cx = Math.min(cols - 1, Math.max(0, Math.floor(x / gridCellSize)));
      const cy = Math.min(rows - 1, Math.max(0, Math.floor(y / gridCellSize)));
      return { cx, cy };
    },
    cellIndex(cx, cy) {
      return cy * cols + cx;
    },
    terrainAt(x, y) {
      const { cx, cy } = this.cellAt(x, y);
      return cells[this.cellIndex(cx, cy)];
    },
    passableAt(x, y) {
      return values.terrain.passable[nameByCode[this.terrainAt(x, y)]];
    },
    moveMultiplierAt(x, y) {
      return values.terrain.moveMultiplier[nameByCode[this.terrainAt(x, y)]] ?? 1;
    },
    defenseModifierAt(x, y) {
      return values.terrain.defenseModifier[nameByCode[this.terrainAt(x, y)]] ?? 1;
    },
  };
}

export function parseMap(data) {
  const migrated = migrateMap(data);
  const errors = validateMap(migrated);
  if (errors.length > 0) throw new Error(`[map] invalid map:\n- ${errors.join('\n- ')}`);
  return {
    name: migrated.name ?? '',
    version: migrated.version,
    size: migrated.size,
    gridCellSize: migrated.gridCellSize,
    terrain: makeTerrain(migrated),
    cities: migrated.cities,
    spawns: migrated.spawns,
    objectives: migrated.objectives ?? [],
  };
}
