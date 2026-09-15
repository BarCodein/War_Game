import { describe, expect, it } from 'vitest';
import { fitMapToCanvas } from '../../src/editor/mapResize.js';
import { createNewMap } from '../../src/editor/editorStore.js';
import { validateMap } from '../../src/simulation/map.js';

// 回归保护：游戏画布固定 1280×800，比画布小的地图会在画布上留下
// 既点不动（编辑器）、试玩时也不渲染的空白带。编辑器在打开/新建/导入时把地图补齐。
describe('editor：把地图补齐到画布尺寸', () => {
  it('高度不足时补行：原有地形逐格保留，新增格为平原，校验通过', () => {
    const map = createNewMap('新地图', 1280, 720); // 128×72
    map.terrain.cells[0] = 2;                       // 左上角 → 水域
    map.terrain.cells[71 * 128 + 127] = 4;          // 右下角 → 山地

    const { mapData, resized } = fitMapToCanvas(map, 1280, 800);

    expect(resized).toBe(true);
    expect(mapData.size).toEqual({ width: 1280, height: 800 });
    expect(mapData.terrain).toMatchObject({ width: 128, height: 80 });
    expect(mapData.terrain.cells).toHaveLength(128 * 80);
    expect(mapData.terrain.cells[0]).toBe(2);               // 原有内容保留
    expect(mapData.terrain.cells[71 * 128 + 127]).toBe(4);  // 宽度没变，行首索引也不变
    expect(mapData.terrain.cells[72 * 128]).toBe(0);        // 新增行 = 平原
    expect(validateMap(mapData)).toEqual([]);
  });

  it('宽度和高度都要扩展时按行重排（行首索引改变）', () => {
    const map = createNewMap('新地图', 960, 540); // 96×54
    map.terrain.cells[1] = 6;                      // 第一行第二格 → 道路
    map.terrain.cells[53 * 96 + 95] = 1;           // 最后一行最后一格 → 森林

    const { mapData, resized } = fitMapToCanvas(map, 1280, 800);

    expect(resized).toBe(true);
    expect(mapData.terrain).toMatchObject({ width: 128, height: 80 });
    expect(mapData.terrain.cells[1]).toBe(6);                 // 第 0 行第 1 格
    expect(mapData.terrain.cells[53 * 128 + 95]).toBe(1);     // 第 53 行第 95 格（新行宽）
    expect(mapData.terrain.cells.slice(96, 128).every(c => c === 0)).toBe(true); // 第 0 行右侧补平原
    expect(validateMap(mapData)).toEqual([]);
  });

  it('不小于画布的地图原样返回（resized=false，不复制对象）', () => {
    const exact = createNewMap('正好', 1280, 800);
    expect(fitMapToCanvas(exact, 1280, 800)).toEqual({ mapData: exact, resized: false });

    const bigger = createNewMap('更大', 1920, 1080);
    expect(fitMapToCanvas(bigger, 1280, 800)).toEqual({ mapData: bigger, resized: false });
  });

  it('城市 / 出生点 / 占领点坐标不受影响', () => {
    const map = createNewMap('新地图', 1280, 720);
    map.capturePoints.push({ id: 'p1', x: 600, y: 400, faction: 'neutral' });
    const { mapData } = fitMapToCanvas(map, 1280, 800);
    expect(mapData.cities).toEqual(map.cities);
    expect(mapData.spawns).toEqual(map.spawns);
    expect(mapData.capturePoints).toEqual(map.capturePoints);
  });
});
