import { values } from '../../config/index.js';

// 战争迷雾（gdd.md §9）：每格三态 0 从未探索 / 1 已探索 / 2 当前可见。
// 可见区域 = 己方单位视野圆 ∪ 己方城市视野圆；森林中的敌军仅 60px 内可目视；
// 维护敌方最后已知位置（lastSeen），渲染层据此画虚影。
export const FOG_UNEXPLORED = 0;
export const FOG_EXPLORED = 1;
export const FOG_VISIBLE = 2;

const FACTIONS = ['blue', 'red'];

export function createFogGrid(terrain) {
  return new Uint8Array(terrain.cols * terrain.rows);
}

export function updateFog(world) {
  for (const faction of FACTIONS) {
    const grid = world.fog[faction];
    const mask = new Uint8Array(grid.length);
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
}

function paintCircle(terrain, mask, x, y, radius) {
  const cell = terrain.cellAt(x, y);
  const rCells = Math.ceil(radius / terrain.cellSize);
  for (let cy = Math.max(0, cell.cy - rCells); cy <= Math.min(terrain.rows - 1, cell.cy + rCells); cy += 1) {
    for (let cx = Math.max(0, cell.cx - rCells); cx <= Math.min(terrain.cols - 1, cell.cx + rCells); cx += 1) {
      const centerX = cx * terrain.cellSize + terrain.cellSize / 2;
      const centerY = cy * terrain.cellSize + terrain.cellSize / 2;
      if (Math.hypot(centerX - x, centerY - y) <= radius) mask[terrain.cellIndex(cx, cy)] = 1;
    }
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
