import { describe, expect, it } from 'vitest';
import { MAP_VERSION, migrateMap, parseMap, validateMap } from '../../src/simulation/map.js';
import { values } from '../../src/config/index.js';
import { loadTutorialMap, makePlainMap } from './helpers.js';

describe('map json', () => {
  it('教学地图解析成功：版本、地形尺寸、双阵营城市与出生点', () => {
    const map = parseMap(loadTutorialMap());
    expect(map.version).toBe(MAP_VERSION);
    expect(map.terrain.cols).toBe(128); // 10px 网格：1280 / 10
    expect(map.terrain.rows).toBe(80);  // 800 / 10
    expect(map.cities.map(c => c.faction).sort()).toEqual(['blue', 'red']);
    expect(map.spawns.map(s => s.faction).sort()).toEqual(['blue', 'red']);
    expect(map.capturePoints).toEqual([]); // 教学地图未放置占领点 → 缺省空数组
    expect(map.objectives[0]).toMatchObject({ type: 'captureCity', cityId: 'c2' });
  });

  it('占领点：解析 neutral/blue/red 三种归属，非法阵营被校验拦截', () => {
    const map = parseMap(makePlainMap({
      capturePoints: [
        { id: 'p1', x: 300, y: 300, faction: 'neutral' },
        { id: 'p2', x: 900, y: 400, faction: 'red' },
      ],
    }));
    expect(map.capturePoints.map(p => p.faction)).toEqual(['neutral', 'red']);

    const bad = makePlainMap({ capturePoints: [{ id: 'p1', x: 300, y: 300, faction: 'green' }] });
    expect(validateMap(bad)).toContainEqual(expect.stringContaining('invalid capturePoint'));
  });

  it('地形访问：河流为可减速水域，桥梁可通行，森林修正生效', () => {
    const map = parseMap(loadTutorialMap());
    const terrain = map.terrain;
    expect(terrain.terrainAt(100, 360)).toBe(values.terrain.codes.water);  // 河流
    expect(terrain.passableAt(100, 360)).toBe(true);
    expect(terrain.moveMultiplierAt(100, 360)).toBe(0.4);
    expect(terrain.terrainAt(640, 360)).toBe(values.terrain.codes.bridge); // 桥梁
    expect(terrain.passableAt(640, 360)).toBe(true);
    expect(terrain.terrainAt(120, 500)).toBe(values.terrain.codes.forest); // 森林
    expect(terrain.moveMultiplierAt(120, 500)).toBe(0.6);
    expect(terrain.defenseModifierAt(120, 500)).toBe(0.85);
  });

  it('新增地形：山地减速减伤，高山不可通行，道路加速并降低移动士气消耗', () => {
    const map = parseMap(makePlainMap({ terrainCells: { '1,1': 4, '2,1': 5, '3,1': 6 } }));
    const terrain = map.terrain;
    expect(terrain.moveMultiplierAt(15, 15)).toBe(0.65);
    expect(terrain.defenseModifierAt(15, 15)).toBe(0.75);
    expect(terrain.passableAt(25, 15)).toBe(false);
    expect(terrain.moveMultiplierAt(35, 15)).toBe(1.25);
    expect(terrain.moraleMoveMultiplierAt(35, 15)).toBe(0.5);
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

    const unknownTerrain = JSON.parse(JSON.stringify(base));
    unknownTerrain.terrain.cells[0] = 99;
    expect(validateMap(unknownTerrain)).toContain('terrain contains unknown code');

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
