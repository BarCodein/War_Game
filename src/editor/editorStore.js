import { validateMap } from '../simulation/map.js';
import { values } from '../config/index.js';

// 地图编辑器状态：与运行时共享同一地图模型与校验（REQUIREMENTS.md §4.6）。
// 纯数据操作，无 DOM/Phaser 依赖，可单元测试。

export function createNewMap(name, width, height) {
  const gridCellSize = values.terrain.gridCellSize;
  const cols = width / gridCellSize;
  const rows = height / gridCellSize;
  return {
    version: 1,
    name,
    size: { width, height },
    gridCellSize,
    terrain: { width: cols, height: rows, cells: new Array(cols * rows).fill(0) },
    // 默认预置双阵营城市与出生点，保证新建地图即可玩
    cities: [
      { id: 'c1', x: Math.round(width * 0.15), y: Math.round(height * 0.75), faction: 'blue' },
      { id: 'c2', x: Math.round(width * 0.85), y: Math.round(height * 0.25), faction: 'red' },
    ],
    spawns: [
      { id: 's1', faction: 'blue', x: Math.round(width * 0.15), y: Math.round(height * 0.75) },
      { id: 's2', faction: 'red', x: Math.round(width * 0.85), y: Math.round(height * 0.25) },
    ],
    // 占领点：可被占领，被占领后仅提供视野（不提供补给/士气）；默认留空
    capturePoints: [],
    objectives: [],
  };
}

export function createEditorStore(initialMap = createNewMap('新地图', 1280, 800)) {
  const state = { mapData: JSON.parse(JSON.stringify(initialMap)) };
  // 旧存档/旧地图没有 capturePoints 字段：补齐为空数组，避免新增操作崩溃
  if (!Array.isArray(state.mapData.capturePoints)) state.mapData.capturePoints = [];

  // 新增对象的 id 计数器：城市 c*、出生点 s*、占领点 p* 各自独立，取已用最大编号 + 1。
  // 不能写死初值——像 suqian 这类已有 c23、s20 的地图，固定从 3 开始会生成重复的 s3，
  // 而 validateMap 会拒绝重复的城市/出生点 id，编辑器会直接报错、无法试玩。
  const nextIds = { c: 1, s: 1, p: 1 };
  function refreshNextIds() {
    const scan = (items, kind) => {
      nextIds[kind] = 1;
      for (const item of items) {
        const match = /^([csp])(\d+)$/.exec(String(item?.id ?? ''));
        if (match && match[1] === kind) nextIds[kind] = Math.max(nextIds[kind], Number(match[2]) + 1);
      }
    };
    scan(state.mapData.cities, 'c');
    scan(state.mapData.spawns, 's');
    scan(state.mapData.capturePoints, 'p');
  }
  refreshNextIds();

  function cellAt(x, y) {
    const { gridCellSize, size } = state.mapData;
    if (x < 0 || y < 0 || x >= size.width || y >= size.height) return null;
    return { cx: Math.floor(x / gridCellSize), cy: Math.floor(y / gridCellSize) };
  }

  function setCell(cx, cy, code) {
    state.mapData.terrain.cells[cy * state.mapData.terrain.width + cx] = code;
  }

  return {
    get mapData() {
      return state.mapData;
    },

    errors() {
      return validateMap(state.mapData);
    },

    paintTerrain(x, y, code) {
      const cell = cellAt(x, y);
      if (cell) setCell(cell.cx, cell.cy, code);
    },

    // 两点间按半格采样绘制，保证快速拖动画笔不中断
    paintSegment(x0, y0, x1, y1, code) {
      const step = state.mapData.gridCellSize / 2;
      const dist = Math.hypot(x1 - x0, y1 - y0);
      const samples = Math.floor(dist / step);
      for (let i = 0; i <= samples; i += 1) {
        const t = samples === 0 ? 0 : i / samples;
        this.paintTerrain(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, code);
      }
    },

    addCity(x, y, faction) {
      if (!cellAt(x, y)) return null;
      const id = `c${nextIds.c}`;
      nextIds.c += 1;
      state.mapData.cities.push({ id, x, y, faction });
      return id;
    },

    removeCity(id) {
      state.mapData.cities = state.mapData.cities.filter(city => city.id !== id);
    },

    moveCity(id, x, y) {
      const city = state.mapData.cities.find(item => item.id === id);
      if (city && cellAt(x, y)) {
        city.x = x;
        city.y = y;
      }
    },

    addSpawn(x, y, faction) {
      if (!cellAt(x, y)) return null;
      const id = `s${nextIds.s}`;
      nextIds.s += 1;
      state.mapData.spawns.push({ id, faction, x, y });
      return id;
    },

    removeSpawn(id) {
      state.mapData.spawns = state.mapData.spawns.filter(spawn => spawn.id !== id);
    },

    moveSpawn(id, x, y) {
      const spawn = state.mapData.spawns.find(item => item.id === id);
      if (spawn && cellAt(x, y)) {
        spawn.x = x;
        spawn.y = y;
      }
    },

    // 占领点：faction 为 'neutral' | 'blue' | 'red'
    addCapturePoint(x, y, faction = 'neutral') {
      if (!cellAt(x, y)) return null;
      const id = `p${nextIds.p}`;
      nextIds.p += 1;
      state.mapData.capturePoints.push({ id, x, y, faction });
      return id;
    },

    removeCapturePoint(id) {
      state.mapData.capturePoints = state.mapData.capturePoints.filter(point => point.id !== id);
    },

    moveCapturePoint(id, x, y) {
      const point = state.mapData.capturePoints.find(item => item.id === id);
      if (point && cellAt(x, y)) {
        point.x = x;
        point.y = y;
      }
    },

    rename(name) {
      state.mapData.name = name;
    },

    loadMapData(data) {
      state.mapData = JSON.parse(JSON.stringify(data));
      if (!Array.isArray(state.mapData.capturePoints)) state.mapData.capturePoints = [];
      refreshNextIds(); // 载入的地图可能已经用了很大的编号，计数器要跟着走
    },
  };
}
