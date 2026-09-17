import { values } from '../../config/index.js';

// 编队协同（docs/ai-design.md 阶段一 C）：队形槽位、窄口判定、队形就位度。
//
// 约定：槽位偏移的 `along` 分量沿"朝向"（朝目标），`lateral` 分量沿朝向的右法线。
// 全是不依赖 Phaser / DOM 的纯函数，可单测（tests/unit/ai-squad.test.js）。

// 锚点 → 目标 的单位朝向向量；两点重合时退化为 +x
export function facingTo(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  return length > 1e-6 ? { x: dx / length, y: dy / length } : { x: 1, y: 0 };
}

// 模板里第 index 个单位的槽位（未旋转；along 为朝向分量，lateral 为横向分量）
function templateOffset(index, count, template, spacing) {
  if (template === 'column') {
    // 纵队：全部排在锚点之后（index 0 在锚点处），过桥/隘口用
    return { along: -index * spacing, lateral: 0 };
  }
  if (template === 'wedge') {
    // 楔形：index 0 是尖（锚点处），其后成对地向后、向两侧张开
    if (index === 0) return { along: 0, lateral: 0 };
    const row = Math.floor((index - 1) / 2) + 1;
    const side = index % 2 === 1 ? 1 : -1;
    return { along: -row * spacing * 0.5, lateral: side * row * spacing * 0.7 };
  }
  // line（默认）：横向排开，居中于锚点
  return { along: 0, lateral: (index - (count - 1) / 2) * spacing };
}

// count 个单位的槽位偏移（已按 facing 旋转到世界坐标的偏移量）
export function formationSlots(count, template, facing, spacing = values.ai.squad.slotSpacing) {
  const right = { x: -facing.y, y: facing.x }; // 朝向的右法线
  const slots = [];
  for (let i = 0; i < count; i += 1) {
    const { along, lateral } = templateOffset(i, count, template, spacing);
    slots.push({
      x: facing.x * along + right.x * lateral,
      y: facing.y * along + right.y * lateral,
    });
  }
  return slots;
}

// 编队锚点：以小队形心为基准，向目标推进 advanceStep（编队像一块整体往前挪）
export function squadAnchor(units, objective, advanceStep = values.ai.squad.advanceStep) {
  const centroid = squadCentroid(units);
  const facing = facingTo(centroid, objective);
  const remaining = Math.hypot(objective.x - centroid.x, objective.y - centroid.y);
  const step = Math.min(advanceStep, remaining);
  return { x: centroid.x + facing.x * step, y: centroid.y + facing.y * step, facing, centroid };
}

export function squadCentroid(units) {
  if (units.length === 0) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const unit of units) {
    x += unit.x;
    y += unit.y;
  }
  return { x: x / units.length, y: y / units.length };
}

// 是否需要纵队：采样"形心 → 目标"这条直线，只要碰到水域（含桥梁）或不可通行格就排队通过。
// 这是廉价近似——真正的路径由模拟层的 A* 规划，这里只需要一个"是不是窄口"的判断。
export function needsColumn(terrain, from, to, step = values.ai.squad.columnSampleStep) {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const steps = Math.max(1, Math.ceil(distance / step));
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const x = from.x + (to.x - from.x) * t;
    const y = from.y + (to.y - from.y) * t;
    if (!terrain.passableAt(x, y)) return true;
    if (terrain.terrainAt(x, y) === values.terrain.codes.water) return true;
  }
  return false;
}

// 队形就位度：有多少比例的队员还在 cohesionRadius 内（围着形心算）
export function cohesionRatio(units, center, radius = values.ai.squad.cohesionRadius) {
  if (units.length === 0) return 1;
  let inside = 0;
  for (const unit of units) {
    if (Math.hypot(unit.x - center.x, unit.y - center.y) <= radius) inside += 1;
  }
  return inside / units.length;
}

// 队形是否已经就位（达到配置比例）
export function isCohesive(units, center, cfg = values.ai.squad) {
  return cohesionRatio(units, center, cfg.cohesionRadius) >= cfg.cohesionRatio;
}

// 该单位是不是"跑在队伍前面且脱离队形"（是的话让它等一等主力）
export function isRushingAhead(unit, center, objective, cfg = values.ai.squad) {
  const fromCenter = Math.hypot(unit.x - center.x, unit.y - center.y);
  if (fromCenter <= cfg.cohesionRadius) return false;
  const own = Math.hypot(objective.x - unit.x, objective.y - unit.y);
  const middle = Math.hypot(objective.x - center.x, objective.y - center.y);
  return own < middle; // 比形心更靠近目标 + 已脱离队形
}

// 把槽位分配给队员：按"离目标由近到远"排序，最近的人拿最靠前的槽位（确定性、可复现）
export function assignSlots(units, anchor, slots) {
  const ordered = [...units].sort((a, b) => {
    const da = Math.hypot(anchor.x - a.x, anchor.y - a.y);
    const db = Math.hypot(anchor.x - b.x, anchor.y - b.y);
    if (da !== db) return da - db;
    return a.id - b.id; // 距离相同时按 id，保证确定性
  });
  return ordered.map((unit, index) => ({
    unit,
    point: {
      x: anchor.x + (slots[index]?.x ?? 0),
      y: anchor.y + (slots[index]?.y ?? 0),
    },
  }));
}
