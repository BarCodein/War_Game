import { values } from '../config/index.js';

// 关卡（Level）标准格式 v1（architecture.md §7.1）：
// 把「地图 + 兵力部署 + 增援 + 关卡类型 + AI 脚本」全部数据化，
// 引擎不再包含任何具体关卡的特例代码（GameScene 只按本模块的接口消费数据）。
//
// 字段总览
//   version     number    关卡格式版本
//   id          string    关卡唯一标识（同时是 URL ?level=<id> 与存档 key）
//   name / subtitle / description / difficulty / order   展示用元数据
//   type        string    'offensive'（进攻）| 'defensive'（防守）| 'annihilative' （歼灭）；当前仅作元数据与 UI 展示
//   map         string    地图 JSON 路径（与关卡分离，编辑器产出的地图可被多个关卡复用）
//   anchors     object    可选：命名锚点表，把常用坐标起名，供 at / target 用 { anchor: '名字' } 引用
//   forces      Force[]   初始兵力（编队式描述）
//   ai          AiScript  敌方脚本（事件 → 动作）
//   victory     object    预留：胜负条件。当前引擎不读取，判定仍见 gdd.md §10（失去全部城市即负）
//
// Force      { faction, at: PointRef, group?: 编队标签, units: [{ type, count, offset?, spacing? }] }
//            第 i 个单位的落点 = 锚点坐标 + offset + spacing × i（offset / spacing 省略即 0）
//            group 会写到 unit.group；AI 动作可用 units: { group: 'x' } 只指挥该编队（见下）
//
// PointRef（坐标引用）——at / target / fallback / anchors 的值都用它，七选一：
//   { x, y }               绝对坐标
//   { spawn: 'blue' }      该阵营在地图中的【第一个】出生点（兼容写法；多出生点请用 spawnId）
//   { spawnId: 's3' }      指定 id 的出生点（编辑器产出的出生点自带 id；手写地图的出生点会在解析时自动补 id）
//   { city: 'blue' }       该阵营当前拥有的第一座城市（调用时解析，跟随城市易主）
//   { cityId: 'c2' }       指定 id 的城市（城市 id 在地图中必填）
//   { capturePointId: 'p1' } 指定 id 的占领点（编辑器里放的「中立/蓝/红占领点」；位置固定，归属易主不影响坐标）
//   { anchor: 'east' }     引用本关 anchors 表中的命名锚点
//
// AiScript   { faction, fallback?: PointRef, triggers: Trigger[], rules?: Rule[] }
// Trigger    { id?, at: Condition, repeatEvery?: number, actions: Action[] }
// Rule       { id?, when: Condition, then: Action | Action[], otherwise?: Action | Action[],
//              after?, until?, repeatEvery? }
//             —— 条件驱动的**持续**指令（gdd.md §10）：条件成立走 then、不成立走 otherwise，
//                只在"条件取值发生变化"的那一帧下发（首次求值也会下发一次），不会每帧刷命令。
//                `after` / `until` 限定生效时间窗（秒，"到某个时刻再看局势"）；
//                `repeatEvery` 让条件成立期间每 n 秒重发一次 then（持续施压用）。
//                例：占领点 p1 还在自己手里就坚守，丢了就撤退。
// Condition  { time: 秒 } | { enemyCrossX: x }
//            | { capturePoint: 'p1' | ['p1','p3'], owner: 'self' | 'enemy' | 'neutral' | 'blue' | 'red' }
//            | { city: 'c1' | [...], owner: ... }
//            | { ownUnitsBelow: n } | { enemyUnitsBelow: n }
//            （据点条件支持 id 数组：任意一个的归属符合 owner 即成立）
// Action     { type: 'spawn', ..., group? } | { type: 'attackNearest', units? } | { type: 'attackMove', target, forced?, units? }
//            | { type: 'hold', units? } | { type: 'retreat', to?, forced?, units? }
//            `units: { group: 'x' }` = 只指挥该编队（省略 = 全军）；spawn 的 group 给新兵打标签
// 触发语义   条件首次满足 → 立即执行一次 actions；若给了 repeatEvery → 此后每 repeatEvery 秒再执行一次

export const LEVEL_VERSION = 1;
export const LEVEL_TYPES = ['offensive', 'defensive', 'annihilative'];
export const AI_ACTION_TYPES = ['spawn', 'attackNearest', 'attackMove', 'hold', 'retreat'];
// 条件里的 owner 可写 'self' / 'enemy'（相对脚本阵营，推荐）或直接写 'blue' / 'red' / 'neutral'
export const AI_CONDITION_OWNERS = ['self', 'enemy', 'blue', 'red', 'neutral'];
// victory 判定方式：captureAll = 占领全部敌方城市（基础失城判负天然覆盖，不做额外判定）；
// defend = 坚守时限与据点；attack = 时限内夺取据点；annihilative = 消灭全部**指定单位**。
// 见 buildMission 与 systems/victory.js。
export const VICTORY_MODES = ['captureAll', 'defend', 'attack', 'annihilative'];
// 编队目标标记：带 "objective": "annihilate" 的编队，其部署出的单位就是歼灭胜负条件的目标单位。
export const OBJECTIVE_ANNIHILATE = 'annihilate';
export const FORCE_OBJECTIVES = [OBJECTIVE_ANNIHILATE];
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
  if (isNonEmptyString(ref.capturePointId)) return true;
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
  // 引用了命名锚点时，该名字必须已定义。
  // 锚点名区分大小写（JSON 键是精确匹配），写错时直接点出「哪个名字没定义 + 本关已定义的名字有哪些」，
  // 否则只会得到一句泛泛的 invalid anchor，很难定位（例如 redBase 写成 redbase、roadblock 写成 redblock）。
  const refOk = (ref) => isPointRef(ref) && (!isNonEmptyString(ref.anchor) || Boolean(anchors[ref.anchor]));
  const refHint = '{x,y} | {spawn} | {spawnId} | {city} | {cityId} | {capturePointId} | {anchor}';
  const definedNames = Object.keys(anchors);
  const anchorListHint = definedNames.length
    ? `（本关已定义的锚点：${definedNames.join(' / ')}）`
    : '（本关没有定义任何 anchors）';
  const refError = (ref, where) => {
    if (isNonEmptyString(ref?.anchor) && !anchors[ref.anchor]) {
      return `${where} 引用了未定义的命名锚点 "${ref.anchor}"${anchorListHint}`;
    }
    return `${where} invalid anchor (need ${refHint})`;
  };

  // 兵力部署
  if (!Array.isArray(data.forces) || data.forces.length === 0) {
    errors.push('forces must be a non-empty array');
  } else {
    data.forces.forEach((force, fi) => {
      if (!force || !FACTIONS.includes(force.faction)) errors.push(`forces[${fi}] invalid faction`);
      if (!refOk(force.at)) errors.push(refError(force.at, `forces[${fi}].at`));
      // 编队标签（可选）：AI 可用 units: { group } 只指挥这一支
      if (force?.group !== undefined && !isNonEmptyString(force.group)) {
        errors.push(`forces[${fi}].group must be a non-empty string`);
      }
      // 编队目标（可选）：标记为歼灭目标的编队，其单位会带上 unit.objective
      if (force?.objective !== undefined && !FORCE_OBJECTIVES.includes(force.objective)) {
        errors.push(`forces[${fi}] invalid objective: ${force.objective} (expected ${FORCE_OBJECTIVES.join(' | ')})`);
      }
      if (!Array.isArray(force?.units) || force.units.length === 0) {
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
    if (ai?.fallback !== undefined && !refOk(ai.fallback)) errors.push(refError(ai.fallback, 'ai.fallback'));
    // 条件：触发器的 at 与规则的 when 共用
    const isIdList = (value) => isNonEmptyString(value)
      || (Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString));
    const conditionError = (at, where) => {
      if (!at || typeof at !== 'object') return `${where} invalid condition`;
      if (isFiniteNumber(at.time) || isFiniteNumber(at.enemyCrossX)) return null;
      if (isFiniteNumber(at.ownUnitsBelow) || isFiniteNumber(at.enemyUnitsBelow)) return null;
      const pointKey = isIdList(at.capturePoint) ? 'capturePoint'
        : (isIdList(at.city) ? 'city' : null);
      if (pointKey) {
        if (!AI_CONDITION_OWNERS.includes(at.owner)) {
          return `${where}.owner must be one of ${AI_CONDITION_OWNERS.join(' | ')}`;
        }
        return null;
      }
      return `${where} invalid condition (need { time } | { enemyCrossX } | { capturePoint, owner } | { city, owner } | { ownUnitsBelow } | { enemyUnitsBelow })`;
    };
    // 动作：触发器与规则共用同一套校验
    const checkAction = (action, where) => {
      if (!action || !AI_ACTION_TYPES.includes(action.type)) {
        errors.push(`${where} unknown action: ${action?.type}`);
        return;
      }
      if (action.forced !== undefined && typeof action.forced !== 'boolean') {
        errors.push(`${where}.forced must be a boolean`);
      }
      // 单位选择器（可选）：目前只支持编队标签；省略 = 全军
      if (action.units !== undefined
        && (!action.units || typeof action.units !== 'object' || !isNonEmptyString(action.units.group))) {
        errors.push(`${where}.units must be { group: '<编队标签>' }`);
      }
      if (action.type === 'spawn') {
        if (!values.units[action.unitType]) errors.push(`${where} unknown unitType`);
        if (!Number.isInteger(action.count) || action.count < 1) errors.push(`${where} count must be a positive integer`);
        if (!refOk(action.at)) errors.push(refError(action.at, `${where}.at`));
        if (action.group !== undefined && !isNonEmptyString(action.group)) {
          errors.push(`${where}.group must be a non-empty string`);
        }
        if (action.spacing !== undefined && !isPoint(action.spacing)) errors.push(`${where} invalid spacing`);
        if (action.order !== undefined && !['attackMove', 'hold'].includes(action.order?.type)) {
          errors.push(`${where} order.type must be attackMove | hold`);
        }
        if (action.order?.type === 'attackMove' && !refOk(action.order.target)) {
          errors.push(refError(action.order.target, `${where}.order.target`));
        }
      }
      if (action.type === 'attackMove' && !refOk(action.target)) {
        errors.push(refError(action.target, `${where}.target`));
      }
      // retreat 的 to 可省略：省略时撤向最近的己方城市（与溃逃一致）
      if (action.type === 'retreat' && action.to !== undefined && !refOk(action.to)) {
        errors.push(refError(action.to, `${where}.to`));
      }
    };
    const checkActions = (actions, where) => {
      if (Array.isArray(actions)) {
        if (actions.length === 0) errors.push(`${where} must be a non-empty array`);
        actions.forEach((action, index) => checkAction(action, `${where}[${index}]`));
        return;
      }
      checkAction(actions, where); // 规则允许写单个动作对象
    };

    // triggers 与 rules 至少要有一套：只用条件规则（纯反应式 AI）也是合法脚本
    const triggerList = Array.isArray(ai?.triggers) ? ai.triggers : null;
    const ruleList = Array.isArray(ai?.rules) ? ai.rules : null;
    if (!triggerList && !ruleList) {
      errors.push('ai must have triggers[] and/or rules[]');
    } else if (triggerList && triggerList.length === 0 && !(ruleList && ruleList.length > 0)) {
      errors.push('ai.triggers must be a non-empty array (或改用非空的 ai.rules)');
    }
    if (triggerList) {
      triggerList.forEach((trigger, ti) => {
        const where = `ai.triggers[${ti}]`;
        const problem = conditionError(trigger?.at, `${where}.at`);
        if (problem) errors.push(problem);
        if (trigger?.repeatEvery !== undefined && !(isFiniteNumber(trigger.repeatEvery) && trigger.repeatEvery > 0)) {
          errors.push(`${where} repeatEvery must be > 0`);
        }
        if (!Array.isArray(trigger?.actions) || trigger.actions.length === 0) {
          errors.push(`${where} actions must be a non-empty array`);
          return;
        }
        trigger.actions.forEach((action, ai2) => checkAction(action, `${where}.actions[${ai2}]`));
      });
    }

    // 条件规则的 when 必须给全，then / otherwise 至少写一个
    if (ai?.rules !== undefined) {
      if (!Array.isArray(ai.rules)) {
        errors.push('ai.rules must be an array');
      } else {
        ai.rules.forEach((rule, ri) => {
          const where = `ai.rules[${ri}]`;
          if (!rule || typeof rule !== 'object') {
            errors.push(`${where} must be an object`);
            return;
          }
          const problem = conditionError(rule.when, `${where}.when`);
          if (problem) errors.push(problem);
          // 生效时间窗与周期重发（可选）
          if (rule.after !== undefined && !(isFiniteNumber(rule.after) && rule.after >= 0)) {
            errors.push(`${where}.after must be >= 0`);
          }
          if (rule.until !== undefined && !(isFiniteNumber(rule.until) && rule.until >= 0)) {
            errors.push(`${where}.until must be >= 0`);
          }
          if (isFiniteNumber(rule.after) && isFiniteNumber(rule.until) && rule.until < rule.after) {
            errors.push(`${where}.until must be >= after`);
          }
          if (rule.repeatEvery !== undefined && !(isFiniteNumber(rule.repeatEvery) && rule.repeatEvery > 0)) {
            errors.push(`${where}.repeatEvery must be > 0`);
          }
          // then / otherwise 至少要有一个；只写 otherwise 表示"条件不成立才下命令"
          if (rule.then === undefined && rule.otherwise === undefined) {
            errors.push(`${where} needs then and/or otherwise`);
          }
          if (rule.then !== undefined) checkActions(rule.then, `${where}.then`);
          if (rule.otherwise !== undefined) checkActions(rule.otherwise, `${where}.otherwise`);
        });
      }
    }
  }

  // 胜负条件（可选）：声明了就必须合法，避免写错后静默不生效
  if (data.victory !== undefined && data.victory !== null) {
    const victory = data.victory;
    if (typeof victory !== 'object' || Array.isArray(victory)) {
      errors.push('victory must be an object');
    } else {
      const mode = victory.mode ?? victory.type;
      if (mode !== undefined && !VICTORY_MODES.includes(mode)) {
        errors.push(`victory invalid mode: ${mode} (expected ${VICTORY_MODES.join(' | ')})`);
      }
      if (victory.faction !== undefined && !FACTIONS.includes(victory.faction)) {
        errors.push('victory invalid faction');
      }
      if (victory.time !== undefined && !(isFiniteNumber(victory.time) && victory.time > 0)) {
        errors.push('victory.time must be a positive number (seconds)');
      }
      if (victory.points !== undefined
        && (!Array.isArray(victory.points) || victory.points.some(id => !isNonEmptyString(id)))) {
        errors.push('victory.points must be an array of ids');
      }
      // mode 为 defend / attack / annihilative 时必须有判定视角阵营
      if (['defend', 'attack', 'annihilative'].includes(mode) && !FACTIONS.includes(victory.faction)) {
        errors.push(`victory.mode=${mode} 必须声明 faction（${FACTIONS.join(' | ')}）`);
      }
      // 歼灭战必须有「指定单位」，否则判定永远不会触发（写错了要能立刻发现）
      if (mode === 'annihilative'
        && !(Array.isArray(data.forces) ? data.forces : []).some(force => force?.objective === OBJECTIVE_ANNIHILATE)) {
        errors.push(`victory.mode=annihilative 需要在至少一个编队上标记 "objective": "${OBJECTIVE_ANNIHILATE}"（歼灭的指定单位）`);
      }
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
    victory: data.victory ?? null, // { mode|type, faction?, time?, points? } → buildMission 消费
  };
}

// 关卡 victory → 运行时任务规则（world.mess）。没有任务规则时返回 null。
//   { "victory": { "mode": "defend", "faction": "blue", "time": 300, "points": ["p1", "c2"] } }
//   - mode  : 'defend'（坚守）| 'attack'（夺取据点）| 'annihilative'（消灭全部指定单位——
//             指定单位 = 编队上标了 "objective": "annihilate" 的那些单位）。
//             'captureAll' 与缺省都返回 null——"占领全部敌方城市" 已由基础的失城判负规则覆盖。
//   - faction: 判定视角阵营（defend = 防守方，attack / annihilative = 我方），缺省 blue（玩家方）。
//   - time  : 时限（秒），缺省 null = 不限时。
//   - points: 据点 id 列表（defend / attack 用），先在占领点里找、再在城市里找；
//             缺省 = 地图上全部占领点。
export function buildMission(level, world) {
  const victory = level?.victory;
  const mode = victory?.mode ?? victory?.type;
  if (mode !== 'defend' && mode !== 'attack' && mode !== 'annihilative') return null;
  const ids = victory.points ?? (world.capturePoints ?? []).map(point => point.id);
  const points = ids
    .map(id => (world.capturePoints ?? []).find(point => point.id === id)
      ?? world.cities.find(city => city.id === id))
    .filter(Boolean);
  return {
    mode,
    faction: victory.faction ?? 'blue',
    time: isFiniteNumber(victory.time) ? victory.time : null,
    points,
  };
}

// ---------- 坐标解析 ----------

// 坐标引用 → 世界坐标。anchors 为本关的命名锚点表（可选）。
// 解析顺序：绝对坐标 → 命名锚点 → 出生点 id → 阵营首个出生点 → 城市 id → 占领点 id → 阵营首座城市。
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
  if (isNonEmptyString(ref.capturePointId)) {
    // 占领点位置固定（只有归属会易主），因此可以安全地当作出生点/目标点使用
    const point = (world.capturePoints ?? []).find(p => p.id === ref.capturePointId);
    return point ? { x: point.x, y: point.y } : null;
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

// 交叉校验：把关卡里引用的 spawnId / cityId / capturePointId / anchor 与真实地图对照，找出拼错或已删除的目标。
// 需要地图数据，因此单独成一个函数（BootScene 拿到地图后调用，仅告警不致命）。
export function validateLevelReferences(level, mapData) {
  const errors = [];
  const spawnIds = new Set((mapData?.spawns ?? []).map(s => s.id).filter(Boolean));
  const cityIds = new Set((mapData?.cities ?? []).map(c => c.id).filter(Boolean));
  const pointIds = new Set((mapData?.capturePoints ?? []).map(p => p.id).filter(Boolean));
  const anchors = level.anchors ?? {};

  const check = (ref, where) => {
    if (!ref || typeof ref !== 'object') return;
    if (isNonEmptyString(ref.anchor) && !anchors[ref.anchor]) errors.push(`${where}: 未定义的命名锚点 "${ref.anchor}"`);
    if (isNonEmptyString(ref.spawnId) && !spawnIds.has(ref.spawnId)) errors.push(`${where}: 地图中不存在出生点 "${ref.spawnId}"`);
    if (isNonEmptyString(ref.cityId) && !cityIds.has(ref.cityId)) errors.push(`${where}: 地图中不存在城市 "${ref.cityId}"`);
    if (isNonEmptyString(ref.capturePointId) && !pointIds.has(ref.capturePointId)) errors.push(`${where}: 地图中不存在占领点 "${ref.capturePointId}"`);
  };

  for (const [name, ref] of Object.entries(anchors)) check(ref, `anchors["${name}"]`);
  (level.forces ?? []).forEach((force, i) => check(force.at, `forces[${i}].at`));
  const checkActionRefs = (action, where) => {
    if (action?.type === 'spawn') {
      check(action.at, `${where}.at`);
      check(action.order?.target, `${where}.order.target`);
    }
    if (action?.type === 'attackMove') check(action.target, `${where}.target`);
    if (action?.type === 'retreat' && action.to !== undefined) check(action.to, `${where}.to`);
  };
  const checkActionList = (actions, where) => {
    const list = Array.isArray(actions) ? actions : [actions];
    list.forEach((action, index) => checkActionRefs(action, Array.isArray(actions) ? `${where}[${index}]` : where));
  };
  for (const [ti, trigger] of (level.ai?.triggers ?? []).entries()) {
    checkActionList(trigger?.actions, `ai.triggers[${ti}].actions`);
  }
  for (const [ri, rule] of (level.ai?.rules ?? []).entries()) {
    checkActionList(rule?.then, `ai.rules[${ri}].then`);
    if (rule?.otherwise !== undefined) checkActionList(rule.otherwise, `ai.rules[${ri}].otherwise`);
  }
  check(level.ai?.fallback, 'ai.fallback');
  // victory.points 是据点 id 列表（占领点优先，其次城市）
  (level.victory?.points ?? []).forEach((id, i) => {
    if (!pointIds.has(id) && !cityIds.has(id)) errors.push(`victory.points[${i}]: 地图中不存在据点 "${id}"`);
  });
  return errors;
}

// ---------- 兵力部署 ----------

// 按关卡 forces 部署初始兵力；anchors 为本关命名锚点表。返回实际生成的单位数组（便于测试与调试）。
// 编队上的 objective 会写到单位上（unit.objective），供胜负判定识别「指定单位」；
// forces[].group 写到 unit.group，供 AI 用 units: { group } 只指挥该编队。
export function deployForces(world, forces, anchors = {}) {
  const spawned = [];
  for (const force of forces) {
    const anchor = resolvePoint(force.at, world, anchors);
    if (!anchor) continue; // 锚点解析不到（出生点/城市/锚点缺失）时跳过该编队，不中断开局
    for (const group of force.units) {
      const offset = group.offset ?? { x: 0, y: 0 };
      const spacing = group.spacing ?? { x: 0, y: 0 };
      for (let i = 0; i < group.count; i += 1) {
        const unit = world.spawnUnit(
          force.faction,
          group.type,
          anchor.x + offset.x + spacing.x * i,
          anchor.y + offset.y + spacing.y * i,
        );
        if (force.objective) unit.objective = force.objective;
        if (force.group) unit.group = force.group; // 编队标签：AI 可只指挥这一支（units: { group }）
        spawned.push(unit);
      }
    }
  }
  return spawned;
}
