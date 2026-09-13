import { values } from '../../config/index.js';

// 战争迷雾（gdd.md §9）：每格三态 0 从未探索 / 1 已探索 / 2 当前可见。
// 可见区域 = 己方单位视野圆 ∪ 己方城市视野圆；森林中的敌军仅 60px 内可目视；
// 维护敌方最后已知位置（lastSeen），渲染层据此画虚影。
export const FOG_UNEXPLORED = 0;
export const FOG_EXPLORED = 1;
export const FOG_VISIBLE = 2;

const FACTIONS = ['blue', 'red'];

// 复用可见性掩码：避免每 tick 每阵营各分配一个 Uint8Array（网格加密后分配开销可观）。
// 两阵营顺序使用同一个缓冲区，故按长度缓存一份即可。
const maskCache = new Map();
function maskFor(length) {
  let mask = maskCache.get(length);
  if (!mask || mask.length !== length) {
    mask = new Uint8Array(length);
    maskCache.set(length, mask);
  }
  return mask;
}

export function createFogGrid(terrain) {
  return new Uint8Array(terrain.cols * terrain.rows);
}

export function updateFog(world) {
  for (const faction of FACTIONS) {
    const grid = world.fog[faction];
    const mask = maskFor(grid.length);
    mask.fill(0);
    paintVision(world, faction, mask);
    for (let i = 0; i < grid.length; i += 1) {
      if (mask[i]) grid[i] = FOG_VISIBLE;
      else if (grid[i] === FOG_VISIBLE) grid[i] = FOG_EXPLORED;
    }
  }
  updateSightings(world);
}

function paintVision(world, faction, mask) {
  const terrain = world.terrain;
  for (const unit of world.units) {
    if (unit.state === 'dead' || unit.faction !== faction) continue;
    paintCircle(terrain, mask, unit.x, unit.y, values.units[unit.type].vision);
  }
  for (const city of world.cities) {
    if (city.faction !== faction) continue;
    paintCircle(terrain, mask, city.x, city.y, values.cities.vision);
  }
  // 占领点：仅在被己方占领时提供视野（用独立半径 values.capturePoints.vision）。
  // 这是占领点唯一的规则作用——不提供补给、士气、生产或恢复。
  for (const point of world.capturePoints) {
    if (point.faction !== faction) continue;
    paintCircle(terrain, mask, point.x, point.y, values.capturePoints.vision);
  }
}

// 逐行解析求交：格子中心 (cx*size+half, cy*size+half) 落在半径内 ⟺
//   |dy| ≤ r 且 |centerX − x| ≤ sqrt(r² − dy²)
// 于是每行只做一次开方，再把该行圆内的连续列区间直接填满，
// 取代原先对包围盒内每一格调用 Math.hypot（10px 网格下这是迷雾的主要热点）。
function paintCircle(terrain, mask, x, y, radius) {
  const size = terrain.cellSize;
  const half = size / 2;
  const r2 = radius * radius;
  const rCells = Math.ceil(radius / size);
  const center = terrain.cellAt(x, y);
  const rowMin = Math.max(0, center.cy - rCells);
  const rowMax = Math.min(terrain.rows - 1, center.cy + rCells);
  const lastCol = terrain.cols - 1;
  for (let cy = rowMin; cy <= rowMax; cy += 1) {
    const dy = cy * size + half - y;
    const dy2 = dy * dy;
    if (dy2 > r2) continue;
    const halfWidth = Math.sqrt(r2 - dy2);
    let cxMin = Math.ceil((x - halfWidth - half) / size);
    let cxMax = Math.floor((x + halfWidth - half) / size);
    if (cxMin < 0) cxMin = 0;
    if (cxMax > lastCol) cxMax = lastCol;
    const row = cy * terrain.cols;
    for (let cx = cxMin; cx <= cxMax; cx += 1) mask[row + cx] = 1;
  }
}

// 敌单位是否被 viewerFaction 目视：所在格当前可见，
// 且森林中的敌军仅当距己方任一单位 ≤ forestSpotDistance（gdd.md §5）。
export function isSpotted(world, unit, viewerFaction) {
  if (unit.state === 'dead' || unit.faction === viewerFaction) return false;
  const terrain = world.terrain;
  const cell = terrain.cellAt(unit.x, unit.y);
  if (world.fog[viewerFaction][terrain.cellIndex(cell.cx, cell.cy)] !== FOG_VISIBLE) return false;
  if (terrain.terrainAt(unit.x, unit.y) === values.terrain.codes.forest) {
    return world.units.some(other =>
      other.state !== 'dead'
      && other.faction === viewerFaction
      && Math.hypot(other.x - unit.x, other.y - unit.y) <= values.fog.forestSpotDistance);
  }
  return true;
}

function updateSightings(world) {
  if (!values.fog.showLastKnownGhost) return;
  for (const faction of FACTIONS) {
    for (const unit of world.units) {
      if (unit.state === 'dead' || unit.faction === faction) continue;
      if (isSpotted(world, unit, faction)) {
        unit.lastSeen[faction] = { x: unit.x, y: unit.y, time: world.time };
      }
      // 未目视时保留 lastSeen，作为最后已知位置
    }
  }
}
