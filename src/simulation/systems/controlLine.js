import { values } from '../../config/index.js';
import { createField, rebuildField, contour } from '../influence.js';

// 实际控制线系统（gdd.md §9）：
// 每 refreshTicks 个 tick 重算一次影响力场（默认 6 tick = 10 Hz），
// 结果写进 world.controlLine（网格）与 world.controlLineSegments（分界线线段），供渲染层读取。
//
// 纯视觉系统：战斗 / 补给 / 士气 / 视野 / 胜负都不读它，
// 因此放在 tick 顺序的末尾（victory 之前），不影响任何规则判定。
export function updateControlLine(world) {
  const cfg = values.controlLine;
  world.controlLineTick = (world.controlLineTick + 1) % cfg.refreshTicks;
  // 还没到重算点就保持上一次的结果（首帧例外：controlLine 为空时必须先建场）
  if (world.controlLineTick !== 0 && world.controlLine) return;

  if (!world.controlLine) {
    world.controlLine = createField(world.size.width, world.size.height, cfg.cellSize);
    world.controlLineSegments = [];
  }
  rebuildField(world.controlLine, collectSources(world), cfg);
  contour(world.controlLine, cfg.neutralEpsilon, world.controlLineSegments);
}

/**
 * 影响力源：存活单位 + 城市 + 占领点。
 * - 蓝方 sign = +1、红方 -1；中立（'neutral' / 未占领）不产生影响力；
 * - 城市与占领点在争夺中（captureProgress > 0）时，现属方的影响力按进度线性削弱，
 *   表现「城快丢了 → 控制线往城里压」；
 * - 半径 / 强度取自 values.controlLine 的三组配置。
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
    });
  }

  for (const city of world.cities) pushHeld(sources, city, cfg.city);
  for (const point of world.capturePoints) pushHeld(sources, point, cfg.capturePoint);

  return sources;
}

function pushHeld(sources, entity, sourceCfg) {
  const sign = signOf(entity.faction);
  if (sign === 0) return;
  const progress = Math.min(100, Math.max(0, entity.captureProgress ?? 0));
  const strength = sourceCfg.strength * (1 - progress / 100);
  if (strength <= 0) return;
  sources.push({ x: entity.x, y: entity.y, sign, radius: sourceCfg.influenceRadius, strength });
}

function signOf(faction) {
  if (faction === 'blue') return 1;
  if (faction === 'red') return -1;
  return 0; // 'neutral' / null / undefined
}
