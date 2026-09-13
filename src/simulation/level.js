import { values } from '../config/index.js';

// 关卡（Level）标准格式 v1（architecture.md §7.1）：
// 把「地图 + 兵力部署 + 增援 + 关卡类型 + AI 脚本」全部数据化，
// 引擎不再包含任何具体关卡的特例代码（GameScene 只按本模块的接口消费数据）。
//
// 字段总览
//   version     number    关卡格式版本
//   id          string    关卡唯一标识（同时是 URL ?level=<id> 与存档 key）
//   name / subtitle / description / difficulty / order   展示用元数据
//   type        string    'offensive'（进攻）| 'defensive'（防守）；当前仅作元数据与 UI 展示
//   map         string    地图 JSON 路径（与关卡分离，编辑器产出的地图可被多个关卡复用）
//   anchors     object    可选：命名锚点表，把常用坐标起名，供 at / target 用 { anchor: '名字' } 引用
//   forces      Force[]   初始兵力（编队式描述）
//   ai          AiScript  敌方脚本（事件 → 动作）
//   victory     object    预留：胜负条件。当前引擎不读取，判定仍见 gdd.md §10（失去全部城市即负）
//
// Force      { faction, at: PointRef, units: [{ type, count, offset?, spacing? }] }
//            第 i 个单位的落点 = 锚点坐标 + offset + spacing × i（offset / spacing 省略即 0）
//
// PointRef（坐标引用）——at / target / fallback / anchors 的值都用它，六选一：
//   { x, y }               绝对坐标
//   { spawn: 'blue' }      该阵营在地图中的【第一个】出生点（兼容写法；多出生点请用 spawnId）
//   { spawnId: 's3' }      指定 id 的出生点（编辑器产出的出生点自带 id；手写地图的出生点会在解析时自动补 id）
//   { city: 'blue' }       该阵营当前拥有的第一座城市（调用时解析，跟随城市易主）
//   { cityId: 'c2' }       指定 id 的城市（城市 id 在地图中必填）
//   { anchor: 'east' }     引用本关 anchors 表中的命名锚点
//
// AiScript   { faction, fallback?: PointRef, triggers: Trigger[] }
// Trigger    { id?, at: Condition, repeatEvery?: number, actions: Action[] }
// Condition  { time: 秒 } | { enemyCrossX: x }
// Action     { type: 'spawn', ... } | { type: 'attackNearest' } | { type: 'attackMove', target } | { type: 'hold' }
// 触发语义   条件首次满足 → 立即执行一次 actions；若给了 repeatEvery → 此后每 repeatEvery 秒再执行一次

export const LEVEL_VERSION = 1;
export const LEVEL_TYPES = ['offensive', 'defensive'];
export const AI_ACTION_TYPES = ['spawn', 'attackNearest', 'attackMove', 'hold'];
export const FACTIONS = ['blue', 'red'];
// 关卡索引文件路径（BootScene 与战役选择页共用，避免路径写两遍）
export const LEVELS_INDEX_PATH = '/assets/levels/index.json';
// 关卡 JSON 的约定路径：/assets/levels/<id>.json
export const levelPath = (id) => `/assets/levels/${id}.json`;

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const isPoint = (p) => !!p && isFiniteNumber(p.x) && isFiniteNumber(p.y);
const isNonEmptyString = (v) => typeof v === 'string' && v.length > 0;

// 结构上是否是合法的坐标引用（不检查引用的目标是否真实存在——那需要地图，见 validateLevelReferences）
function isPointRef(ref) {
  if (!ref || typeof ref !== 'object') return false;
  if (isPoint(ref)) return true;
  if (FACTIONS.includes(ref.spawn)) return true;
  if (isNonEmptyString(ref.spawnId)) return true;
  if (FACTIONS.includes(ref.city)) return true;
  if (isNonEmptyString(ref.cityId)) return true;
  if (isNonEmptyString(ref.anchor)) return true;
  return false;
}

// 校验命名锚点表，返回 { anchors, errors }
function parseAnchors(data) {
  const errors = [];
  const anchors = {};
  if (data.anchors === undefined) return { anchors, errors };
  if (!data.anchors || typeof data.anchors !== 'object' || Array.isArray(data.anchors)) {
    return { anchors, errors: ['anchors must be an object'] };
  }
  for (const [name, ref] of Object.entries(data.anchors)) {
    if (!isNonEmptyString(name)) { errors.push('anchors 含空名字'); continue; }
    if (ref && typeof ref === 'object' && 'anchor' in ref) {
      errors.push(`anchors["${name}"] 不能引用其它命名锚点（禁止链式引用）`);
      continue;
    }
    if (!isPointRef(ref)) { errors.push(`anchors["${name}"] 不是合法的坐标引用`); continue; }
    anchors[name] = ref;
  }
  return { anchors, errors };
}

// 结构 + 语义校验；返回错误字符串数组（空数组表示合法）
export function validateLevel(data) {
  const errors = [];
  if (!data || typeof data !== 'object') return ['level must be an object'];

  if (typeof data.version !== 'number') errors.push('missing numeric version');
  else if (data.version > LEVEL_VERSION) errors.push(`level version ${data.version} is newer than supported ${LEVEL_VERSION}`);

  if (!isNonEmptyString(data.id)) errors.push('missing id');
  if (!isNonEmptyString(data.map)) errors.push('missing map path');
  if (!LEVEL_TYPES.includes(data.type)) errors.push(`invalid type: ${data.type} (expected ${LEVEL_TYPES.join(' | ')})`);

  const { anchors, errors: anchorErrors } = parseAnchors(data);
  errors.push(...anchorErrors);
  // 引用了命名锚点时，该名字必须已定义
  const refOk = (ref) => isPointRef(ref) && (!isNonEmptyString(ref.anchor) || Boolean(anchors[ref.anchor]));
  const refHint = '{x,y} | {spawn} | {spawnId} | {city} | {cityId} | {anchor}';

  // 兵力部署
  if (!Array.isArray(data.forces) || data.forces.length === 0) {
    errors.push('forces must be a non-empty array');
  } else {
    data.forces.forEach((force, fi) => {
      if (!force || !FACTIONS.includes(force.faction)) errors.push(`forces[${fi}] invalid faction`);
      if (!refOk(force.at)) errors.push(`forces[${fi}] invalid anchor (need ${refHint})`);
      if (!Array.isArray(force.units) || force.units.length === 0) {
        errors.push(`forces[${fi}] units must be a non-empty array`);
        return;
      }
      force.units.forEach((unit, ui) => {
        if (!unit || !values.units[unit.type]) errors.push(`forces[${fi}].units[${ui}] unknown type: ${unit?.type}`);
        if (!Number.isInteger(unit?.count) || unit.count < 1) errors.push(`forces[${fi}].units[${ui}] count must be a positive integer`);
        if (unit?.offset !== undefined && !isPoint(unit.offset)) errors.push(`forces[${fi}].units[${ui}] invalid offset`);
        if (unit?.spacing !== undefined && !isPoint(unit.spacing)) errors.push(`forces[${fi}].units[${ui}] invalid spacing`);
      });
    });
  }

  // AI 脚本（可选）
  if (data.ai !== undefined) {
    const ai = data.ai;
    if (!ai || !FACTIONS.includes(ai.faction)) errors.push('ai invalid faction');
    if (ai?.fallback !== undefined && !refOk(ai.fallback)) errors.push(`ai invalid fallback target (need ${refHint})`);
    if (!Array.isArray(ai?.triggers) || ai.triggers.length === 0) {
      errors.push('ai.triggers must be a non-empty array');
    } else {
      ai.triggers.forEach((trigger, ti) => {
        const at = trigger?.at;
        const hasTime = isFiniteNumber(at?.time);
        const hasCross = isFiniteNumber(at?.enemyCrossX);
        if (!hasTime && !hasCross) errors.push(`ai.triggers[${ti}] invalid condition (need { time } or { enemyCrossX })`);
        if (trigger?.repeatEvery !== undefined && !(isFiniteNumber(trigger.repeatEvery) && trigger.repeatEvery > 0)) {
          errors.push(`ai.triggers[${ti}] repeatEvery must be > 0`);
        }
        if (!Array.isArray(trigger?.actions) || trigger.actions.length === 0) {
          errors.push(`ai.triggers[${ti}] actions must be a non-empty array`);
          return;
        }
        trigger.actions.forEach((action, ai2) => {
          const where = `ai.triggers[${ti}].actions[${ai2}]`;
          if (!action || !AI_ACTION_TYPES.includes(action.type)) {
            errors.push(`${where} unknown action: ${action?.type}`);
            return;
          }
          if (action.type === 'spawn') {
            if (!values.units[action.unitType]) errors.push(`${where} unknown unitType`);
            if (!Number.isInteger(action.count) || action.count < 1) errors.push(`${where} count must be a positive integer`);
            if (!refOk(action.at)) errors.push(`${where} invalid anchor (need ${refHint})`);
            if (action.spacing !== undefined && !isPoint(action.spacing)) errors.push(`${where} invalid spacing`);
            if (action.order !== undefined && !['attackMove', 'hold'].includes(action.order?.type)) {
              errors.push(`${where} order.type must be attackMove | hold`);
            }
            if (action.order?.type === 'attackMove' && !refOk(action.order.target)) {
              errors.push(`${where} order.target invalid (need ${refHint})`);
            }
          }
          if (action.type === 'attackMove' && !refOk(action.target)) {
            errors.push(`${where} invalid target (need ${refHint})`);
          }
        });
      });
    }
  }

  return errors;
}

// 校验并归一化：补齐可选字段默认值，并冻结为运行时使用的规格
export function parseLevel(data) {
  const errors = validateLevel(data);
  if (errors.length > 0) throw new Error(`[level] invalid level:\n- ${errors.join('\n- ')}`);
  return {
    version: data.version,
    id: data.id,
    name: data.name ?? data.id,
    subtitle: data.subtitle ?? '',
    type: data.type,
    difficulty: data.difficulty ?? '',
    order: data.order ?? 0,
    description: data.description ?? '',
    map: data.map,
    anchors: parseAnchors(data).anchors,
    forces: data.forces,
    ai: data.ai ?? null,
    victory: data.victory ?? null, // 预留：当前引擎不读取
  };
}

// ---------- 坐标解析 ----------

// 坐标引用 → 世界坐标。anchors 为本关的命名锚点表（可选）。
// 解析顺序：绝对坐标 → 命名锚点 → 出生点 id → 阵营首个出生点 → 城市 id → 阵营首座城市。
// 解析不到（引用不存在）时返回 null，调用方跳过而不是崩溃。
export function resolvePoint(ref, world, anchors = {}) {
  if (!ref || typeof ref !== 'object') return null;
  if (isPoint(ref)) return { x: ref.x, y: ref.y };

  if (isNonEmptyString(ref.anchor)) {
    const named = anchors[ref.anchor];
    if (!named || typeof named !== 'object') return null;
    if ('anchor' in named) return null; // 防御：命名锚点不允许链式引用
    return resolvePoint(named, world, {});
  }
  if (isNonEmptyString(ref.spawnId)) {
    const spawn = world.map.spawns.find(s => s.id === ref.spawnId);
    return spawn ? { x: spawn.x, y: spawn.y } : null;
  }
  if (FACTIONS.includes(ref.spawn)) {
    const spawn = world.map.spawns.find(s => s.faction === ref.spawn);
    return spawn ? { x: spawn.x, y: spawn.y } : null;
  }
  if (isNonEmptyString(ref.cityId)) {
    const city = world.cities.find(c => c.id === ref.cityId);
    return city ? { x: city.x, y: city.y } : null;
  }
  if (FACTIONS.includes(ref.city)) {
    const city = world.cities.find(c => c.faction === ref.city);
    return city ? { x: city.x, y: city.y } : null;
  }
  return null;
}

// 两个历史名字现在指向同一个解析函数（at / target 支持的写法完全一致）
export const resolveAnchor = resolvePoint;
export const resolveTarget = resolvePoint;

// 交叉校验：把关卡里引用的 spawnId / cityId / anchor 与真实地图对照，找出拼错或已删除的目标。
// 需要地图数据，因此单独成一个函数（BootScene 拿到地图后调用，仅告警不致命）。
export function validateLevelReferences(level, mapData) {
  const errors = [];
  const spawnIds = new Set((mapData?.spawns ?? []).map(s => s.id).filter(Boolean));
  const cityIds = new Set((mapData?.cities ?? []).map(c => c.id).filter(Boolean));
  const anchors = level.anchors ?? {};

  const check = (ref, where) => {
    if (!ref || typeof ref !== 'object') return;
    if (isNonEmptyString(ref.anchor) && !anchors[ref.anchor]) errors.push(`${where}: 未定义的命名锚点 "${ref.anchor}"`);
    if (isNonEmptyString(ref.spawnId) && !spawnIds.has(ref.spawnId)) errors.push(`${where}: 地图中不存在出生点 "${ref.spawnId}"`);
    if (isNonEmptyString(ref.cityId) && !cityIds.has(ref.cityId)) errors.push(`${where}: 地图中不存在城市 "${ref.cityId}"`);
  };

  for (const [name, ref] of Object.entries(anchors)) check(ref, `anchors["${name}"]`);
  (level.forces ?? []).forEach((force, i) => check(force.at, `forces[${i}].at`));
  for (const [ti, trigger] of (level.ai?.triggers ?? []).entries()) {
    for (const [ai, action] of (trigger.actions ?? []).entries()) {
      const where = `ai.triggers[${ti}].actions[${ai}]`;
      if (action?.type === 'spawn') {
        check(action.at, `${where}.at`);
        check(action.order?.target, `${where}.order.target`);
      }
      if (action?.type === 'attackMove') check(action.target, `${where}.target`);
    }
  }
  check(level.ai?.fallback, 'ai.fallback');
  return errors;
}

// ---------- 兵力部署 ----------

// 按关卡 forces 部署初始兵力；anchors 为本关命名锚点表。返回实际生成的单位数组（便于测试与调试）
export function deployForces(world, forces, anchors = {}) {
  const spawned = [];
  for (const force of forces) {
    const anchor = resolvePoint(force.at, world, anchors);
    if (!anchor) continue; // 锚点解析不到（出生点/城市/锚点缺失）时跳过该编队，不中断开局
    for (const group of force.units) {
      const offset = group.offset ?? { x: 0, y: 0 };
      const spacing = group.spacing ?? { x: 0, y: 0 };
      for (let i = 0; i < group.count; i += 1) {
        spawned.push(world.spawnUnit(
          force.faction,
          group.type,
          anchor.x + offset.x + spacing.x * i,
          anchor.y + offset.y + spacing.y * i,
        ));
      }
    }
  }
  return spawned;
}
