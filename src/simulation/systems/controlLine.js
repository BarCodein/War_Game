import { values } from '../../config/index.js';
import { createField, rebuildField, contour, buildPaths, guaranteeUnitCells } from '../influence.js';

// 实际控制线系统（gdd.md §9）：
// 每 refreshTicks 个 tick 重算一次影响力场（默认 6 tick = 10 Hz），
// 结果写进 world.controlLine（网格）、world.controlLineSegments（原始线段）、
// world.controlLinePaths（串联并平滑后的折线），供渲染层读取。
//
// 纯视觉系统：战斗 / 补给 / 士气 / 视野 / 胜负都不读它，
// 因此放在 tick 顺序的末尾（victory 之前），不影响任何规则判定。
// **也不读战争迷雾**：影响力源包含双方全部存活单位（含迷雾里的敌军），
// 所以控制线画出来的是真实分界，不受视野限制（渲染层同样画在迷雾之上）。
export function updateControlLine(world) {
  const cfg = values.controlLine;
  world.controlLineTick = (world.controlLineTick + 1) % cfg.refreshTicks;
  // 还没到重算点就保持上一次的结果（首帧例外：controlLine 为空时必须先建场）
  if (world.controlLineTick !== 0 && world.controlLine) return;

  if (!world.controlLine) {
    world.controlLine = createField(world.size.width, world.size.height, cfg.cellSize);
    world.controlLineSegments = [];
    world.controlLinePaths = [];
  }
  collectUnitMarks(world, world.unitMarks);
  rebuildField(world.controlLine, collectSources(world), cfg);
  // 单位所在格的硬保证：攻城/贴身时也不会出现"自己的兵站在敌方控制区里"（最小幅度翻转）
  if (cfg.guaranteeUnitCell) {
    guaranteeUnitCells(world.controlLine, world.unitMarks, cfg.partitionFillValue);
  }
  contour(world.controlLine, cfg.neutralEpsilon, world.controlLineSegments);
  // 平滑只作用在几何上（串联 + Chaikin 切角），影响力场保持精确
  buildPaths(world.controlLineSegments, cfg.pathSmoothing, world.controlLinePaths);
}

// 存活单位的位置 + 阵营（硬保证用；复用一份数组，避免每次重算都分配）
function collectUnitMarks(world, out = []) {
  out.length = 0;
  for (const unit of world.units) {
    if (unit.state === 'dead') continue;
    const sign = signOf(unit.faction);
    if (sign === 0) continue;
    out.push({ x: unit.x, y: unit.y, sign });
  }
  return out;
}

/**
 * 影响力源：存活单位 + 城市 + 占领点。
 * - 蓝方 sign = +1、红方 -1；中立（'neutral' / 未占领）不产生影响力；
 * - **核心圈（满强度段）取绝对值**：单位 = 它自己的碰撞体积（`unit.radius`），
 *   城市/占领点 = 各自的占领半径——核心圈因此只覆盖「脚下这块地」，
 *   单位始终落在自己阵营的控制区里（城市不享受这个保证，见 gdd.md §9）；
 * - 城市与占领点在争夺中（captureProgress > 0）时，现属方的影响力按进度线性削弱，
 *   表现「城快丢了 → 控制线往城里压」；
 * - 影响力半径 / 强度取自 values.controlLine 的三组配置。
 */
export function collectSources(world) {
  const cfg = values.controlLine;
  const sources = [];

  for (const unit of world.units) {
    if (unit.state === 'dead') continue;
    const sign = signOf(unit.faction);
    if (sign === 0) continue;
    sources.push({
      x: unit.x,
      y: unit.y,
      sign,
      radius: cfg.unit.influenceRadius,
      strength: cfg.unit.strength,
      coreRadius: unit.radius ?? 0, // 核心圈 = 单位碰撞体积
    });
  }

  // 城市/占领点的核心圈 = 占领半径（沿用同一份数值，不再另写一个 60）
  for (const city of world.cities) pushHeld(sources, city, cfg.city, values.cities.capture.radius);
  for (const point of world.capturePoints) {
    pushHeld(sources, point, cfg.capturePoint, values.capturePoints.capture.radius);
  }

  return sources;
}

function pushHeld(sources, entity, sourceCfg, coreRadius) {
  const sign = signOf(entity.faction);
  if (sign === 0) return;
  const progress = Math.min(100, Math.max(0, entity.captureProgress ?? 0));
  const strength = sourceCfg.strength * (1 - progress / 100);
  if (strength <= 0) return;
  sources.push({
    x: entity.x,
    y: entity.y,
    sign,
    radius: sourceCfg.influenceRadius,
    strength,
    coreRadius,
  });
}

function signOf(faction) {
  if (faction === 'blue') return 1;
  if (faction === 'red') return -1;
  return 0; // 'neutral' / null / undefined
}
