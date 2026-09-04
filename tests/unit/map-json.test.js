import { describe, expect, it } from 'vitest';
import { MAP_VERSION, migrateMap, parseMap, validateMap } from '../../src/simulation/map.js';
import { values } from '../../src/config/index.js';
import { loadTutorialMap, makePlainMap } from './helpers.js';

describe('map json', () => {
  it('教学地图解析成功：版本、地形尺寸、双阵营城市与出生点', () => {
    const map = parseMap(loadTutorialMap());
    expect(map.version).toBe(MAP_VERSION);
    expect(map.terrain.cols).toBe(64);
    expect(map.terrain.rows).toBe(36);
    expect(map.cities.map(c => c.faction).sort()).toEqual(['blue', 'red']);
    expect(map.spawns.map(s => s.faction).sort()).toEqual(['blue', 'red']);
    expect(map.objectives[0]).toMatchObject({ type: 'captureCity', cityId: 'c2' });
  });

  it('地形访问：河流为水域不可通行，桥梁可通行，森林修正生效', () => {
    const map = parseMap(loadTutorialMap());
    const terrain = map.terrain;
    expect(terrain.terrainAt(100, 360)).toBe(values.terrain.codes.water);  // 河流
    expect(terrain.passableAt(100, 360)).toBe(false);
    expect(terrain.terrainAt(640, 360)).toBe(values.terrain.codes.bridge); // 桥梁
    expect(terrain.passableAt(640, 360)).toBe(true);
    expect(terrain.terrainAt(120, 500)).toBe(values.terrain.codes.forest); // 森林
    expect(terrain.moveMultiplierAt(120, 500)).toBe(0.6);
    expect(terrain.defenseModifierAt(120, 500)).toBe(0.85);
  });

  it('结构校验：缺 version / 格子数不符 / 缺蓝城 / 缺红出生点 / 未来版本', () => {
    const base = makePlainMap({
      cities: [{ id: 'b', x: 100, y: 100, faction: 'blue' }, { id: 'r', x: 1000, y: 600, faction: 'red' }],
      spawns: [{ faction: 'blue', x: 100, y: 100 }, { faction: 'red', x: 1000, y: 600 }],
    });
    const missingVersion = { ...base };
    delete missingVersion.version;
    expect(validateMap(missingVersion)).toContain('missing numeric version');

    const badCells = JSON.parse(JSON.stringify(base));
    badCells.terrain.cells = [0];
    expect(validateMap(badCells)).toContain('terrain cells length mismatch');

    const noBlueCity = JSON.parse(JSON.stringify(base));
    noBlueCity.cities = noBlueCity.cities.filter(c => c.faction !== 'blue');
    expect(validateMap(noBlueCity)).toContain('no blue city (unplayable)');

    const noRedSpawn = JSON.parse(JSON.stringify(base));
    noRedSpawn.spawns = noRedSpawn.spawns.filter(s => s.faction !== 'red');
    expect(validateMap(noRedSpawn)).toContain('no red spawn (unplayable)');

    const future = { ...base, version: MAP_VERSION + 1 };
    expect(validateMap(future)).toContain(`map version ${MAP_VERSION + 1} is newer than supported ${MAP_VERSION}`);
  });

  it('版本迁移机制：低于当前版本且无迁移时拒绝载入', () => {
    const legacy = { ...makePlainMap(), version: 0 };
    expect(() => migrateMap(legacy)).toThrow(/unsupported map version 0/);
  });

  it('parseMap 聚合错误并抛出', () => {
    expect(() => parseMap(makePlainMap({ cities: [], spawns: [] }))).toThrow(/invalid map/);
  });
});
