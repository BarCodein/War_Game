import { values } from '../../config/index.js';
import { FOG_UNEXPLORED, FOG_VISIBLE, isSpotted } from '../systems/fog.js';

// 公平模式下的"AI 眼中的战场"（docs/ai-design.md 阶段三）：只承认看得见 + 记得住的东西。
// 纯函数（只读 world 与 values），可单测（tests/unit/ai-perception.test.js）。
//
// 三条情报来源：
//   ① 当前视野：isSpotted（含森林隐蔽规则）→ 置信度 1，可以当攻击目标
//   ② lastSeen 记忆：最后目视位置 + 年龄 → 置信度 1 - 年龄/fadeSeconds，只能当"去看看"的坐标
//   ③ 已探索/未探索：fog 网格三态 → 决定侦察兵往哪走
// 明确不做的事：不读全知的影响力场（那是双方全知算出来的），战线由已知敌情自建。

// 当前视野内的敌方单位（公平模式下唯一可攻击的目标来源）
export function visibleEnemies(world, faction) {
  return world.units.filter(unit => isSpotted(world, unit, faction));
}

// 记忆中的敌情：只保留"记得住 + 还有意义"的条目（去重掉当前可见的那些）
export function rememberedEnemies(world, faction, cfg = values.ai) {
  const { fadeSeconds, staleConfidence } = cfg.memory;
  const seen = new Set(visibleEnemies(world, faction).map(unit => unit.id));
  const memories = [];
  for (const unit of world.units) {
    if (unit.state === 'dead' || unit.faction === faction) continue;
    if (seen.has(unit.id)) continue;                 // 可见的走实时情报
    const last = unit.lastSeen?.[faction];
    if (!last) continue;
    const age = Math.max(0, world.time - last.time);
    const confidence = Math.max(0, 1 - age / Math.max(1e-6, fadeSeconds));
    if (confidence < staleConfidence) continue;      // 太久没见 → 忘了
    memories.push({
      id: unit.id,
      faction: unit.faction,
      x: last.x,
      y: last.y,
      confidence,
      age,
      ghost: true,                                   // 这是"记忆"，不是实体
    });
  }
  return memories;
}

// AI 眼中的全部敌情（可见的在前、置信度 1；记忆在后）
export function knownEnemies(world, faction, cfg = values.ai) {
  const visible = visibleEnemies(world, faction).map(unit => ({
    id: unit.id,
    faction: unit.faction,
    x: unit.x,
    y: unit.y,
    confidence: 1,
    age: 0,
    ghost: false,
    unit,
  }));
  return [...visible, ...rememberedEnemies(world, faction, cfg)];
}

// 全知模式下的敌情（阶段一/二的默认行为：返回真实单位，置信度 1）
export function allEnemies(world, faction) {
  return world.units
    .filter(unit => unit.state !== 'dead' && unit.faction !== faction)
    .map(unit => ({ id: unit.id, faction: unit.faction, x: unit.x, y: unit.y, confidence: 1, age: 0, ghost: false, unit }));
}

// 按模式取敌情：公平模式 = 可见 + 记忆，否则全知
export function perceive(world, faction, cfg = values.ai, fogAware = cfg.fog) {
  return fogAware ? knownEnemies(world, faction, cfg) : allEnemies(world, faction);
}

// 侦察兵的前沿目标：在 fog 网格上做有界 BFS，找最近的未探索格中心。
// 同样近的情况下，优先"靠敌方城市 / 靠脚本目标"的那一格（朝敌人方向侦察）。
export function unexploredFrontier(world, faction, from, { cfg = values.ai, prefer = [] } = {}) {
  const terrain = world.terrain;
  const grid = world.fog?.[faction];
  if (!grid) return null;
  const start = terrain.cellAt(from.x, from.y);
  const maxCells = Math.ceil(cfg.scout.maxExploreRadius / terrain.cellSize);
  const visited = new Set();
  const queue = [{ cx: start.cx, cy: start.cy, depth: 0 }];
  visited.add(`${start.cx},${start.cy}`);
  let best = null;
  while (queue.length > 0) {
    const cell = queue.shift();
    const index = terrain.cellIndex(cell.cx, cell.cy);
    if (grid[index] === FOG_UNEXPLORED) {
      const point = { x: (cell.cx + 0.5) * terrain.cellSize, y: (cell.cy + 0.5) * terrain.cellSize };
      // 同深度里选"离偏好点（敌城/目标）最近"的那一格
      const bias = prefer.length === 0 ? 0 : Math.min(...prefer.map(target => Math.hypot(target.x - point.x, target.y - point.y)));
      const score = cell.depth * terrain.cellSize + bias * 0.3;
      if (!best || score < best.score) best = { ...point, cell: { cx: cell.cx, cy: cell.cy }, depth: cell.depth, score };
      // 同一层的其余格也可能更近，继续扫完这一层
      if (queue.every(item => item.depth > cell.depth)) break;
      continue;
    }
    if (cell.depth >= maxCells) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const cx = cell.cx + dx;
      const cy = cell.cy + dy;
      if (cx < 0 || cy < 0 || cx >= terrain.cols || cy >= terrain.rows) continue;
      const key = `${cx},${cy}`;
      if (visited.has(key)) continue;
      visited.add(key);
      queue.push({ cx, cy, depth: cell.depth + 1 });
    }
  }
  return best;
}

// 供前端/调试：AI 当前掌握的信息摘要（可见 / 记忆 / 已知格数）
export function awarenessSummary(world, faction, cfg = values.ai, fogAware = cfg.fog) {
  const known = perceive(world, faction, cfg, fogAware);
  return {
    fogAware,
    visible: known.filter(item => !item.ghost).length,
    remembered: known.filter(item => item.ghost).length,
    enemiesAlive: world.units.filter(unit => unit.state !== 'dead' && unit.faction !== faction).length,
  };
}

export { FOG_UNEXPLORED, FOG_VISIBLE };
