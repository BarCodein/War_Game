import { describe, expect, it } from 'vitest';
import { createEditorStore, createNewMap } from '../../src/editor/editorStore.js';

describe('editor store', () => {
  it('新建地图：版本 1、全平原、预置双阵营城市与出生点、可直接玩', () => {
    const map = createNewMap('测试', 1280, 720);
    expect(map.version).toBe(1);
    expect(map.size).toEqual({ width: 1280, height: 720 });
    expect(map.terrain.width * map.terrain.height).toBe(map.terrain.cells.length);
    expect(map.terrain.cells.every(code => code === 0)).toBe(true);
    expect(map.cities.map(c => c.faction).sort()).toEqual(['blue', 'red']);
    expect(map.spawns.map(s => s.faction).sort()).toEqual(['blue', 'red']);
    expect(createEditorStore(map).errors()).toEqual([]);
  });

  it('绘制与线段采样绘制地形，越界被忽略', () => {
    const store = createEditorStore();
    store.paintTerrain(100, 100, 2);
    const idx = (cx, cy) => cy * 64 + cx;
    expect(store.mapData.terrain.cells[idx(5, 5)]).toBe(2);
    store.paintSegment(0, 0, 200, 0, 1); // 横线采样
    expect(store.mapData.terrain.cells[idx(10, 0)]).toBe(1);
    store.paintTerrain(-10, -10, 3);
    store.paintTerrain(9999, 9999, 3);
    expect(store.mapData.terrain.cells.every((code, i) => code !== 3)).toBe(true);
  });

  it('城市：添加、移动、删除', () => {
    const store = createEditorStore();
    const id = store.addCity(400, 300, 'red');
    expect(id).toBeTruthy();
    expect(store.mapData.cities.find(c => c.id === id).faction).toBe('red');
    store.moveCity(id, 500, 350);
    expect(store.mapData.cities.find(c => c.id === id)).toMatchObject({ x: 500, y: 350 });
    store.removeCity(id);
    expect(store.mapData.cities.some(c => c.id === id)).toBe(false);
  });

  it('出生点：添加、移动、删除', () => {
    const store = createEditorStore();
    const id = store.addSpawn(600, 300, 'blue');
    store.moveSpawn(id, 650, 320);
    expect(store.mapData.spawns.find(s => s.id === id)).toMatchObject({ x: 650, y: 320 });
    store.removeSpawn(id);
    expect(store.mapData.spawns.some(s => s.id === id)).toBe(false);
  });

  it('可玩性校验：删除红城后报告错误', () => {
    const store = createEditorStore();
    store.removeCity('c2');
    expect(store.errors()).toContain('no red city (unplayable)');
  });

  it('重命名与整体载入地图数据', () => {
    const store = createEditorStore();
    store.rename('断裂峡谷 v2');
    expect(store.mapData.name).toBe('断裂峡谷 v2');
    store.loadMapData(createNewMap('载入的地图', 960, 540));
    expect(store.mapData.size).toEqual({ width: 960, height: 540 });
    expect(store.mapData.name).toBe('载入的地图');
  });
});
