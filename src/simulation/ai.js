import { values } from '../config/index.js';
import { attackMoveCommand, holdCommand, moveCommand } from './commands.js';
import { resolvePoint } from './level.js';

const isNonEmptyString = (v) => typeof v === 'string' && v.length > 0;
const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);

// 脚本敌军（REQUIREMENTS.md §4.5）：解释关卡 JSON 里的「事件 → 动作」脚本。
// 只读世界状态 → 通过 world.issueCommands 下发指令（与人类输入共用统一命令接口），不直接改状态。
//
// script 结构（见 level.js 的字段说明）：
//   {
//     faction: 'red',
//     fallback: PointRef,                        // 无敌人时的进军目标（可选）
//     triggers: [
//       { id?, at: { time } | { enemyCrossX }, repeatEvery?, actions: [ ... ] }
//     ],
//     rules: [                                   // 条件驱动的持续指令（可选）
//       { id?, when: { capturePoint: 'p1', owner: 'self' }, then: [...], otherwise: [...] }
//     ]
//   }
// 所有点位（spawn 的 at、attackMove 的 target、retreat 的 to、fallback）都是 PointRef：
//   { x, y } | { spawn } | { spawnId } | { city } | { cityId } | { capturePointId } | { anchor }
// 其中 { anchor } 引用关卡根部的 anchors 命名锚点表，需通过构造参数 anchors 传入。
// 触发语义：条件首次满足时立即执行一次 actions；若给了 repeatEvery，此后每 repeatEvery 秒再执行一次。
// 规则语义：**条件变化才下发命令**——首次求值下发一次，之后只有当 true/false 翻转的那一帧才重新下发，
//   避免每帧重发指令把单位的行军路线反复重置。
// 动作类型：spawn / attackNearest / attackMove / hold / retreat（新增行为只需扩展 runActions 与 level.js 的校验）
export class ScriptedAI {
  constructor(world, { faction = 'red', script = {}, anchors = {} } = {}) {
    this.world = world;
    this.faction = faction;
    this.script = script;
    this.anchors = anchors; // 关卡命名锚点表（PointRef 里的 { anchor } 用）
    this.elapsed = 0;
    // 每个触发器一份运行时状态（是否已激活 / 是否已结束 / 重复计时）
    this.triggers = (script.triggers ?? []).map((spec, index) => ({
      spec,
      id: spec.id ?? `#${index}`,
      active: false,
      done: false,
      timer: 0,
    }));
    // 每个条件规则一份运行时状态：`value` 记录上一次的判定结果（undefined = 还没求过值）
    this.rules = (script.rules ?? []).map((spec, index) => ({
      spec,
      id: spec.id ?? `rule#${index}`,
      value: undefined,
      timer: 0,
    }));
  }

  update(dt) {
    this.elapsed += dt;
    for (const state of this.triggers) this.updateTrigger(state, dt);
    for (const state of this.rules) this.updateRule(state, dt);
  }

  /**
   * 条件规则：可选生效窗口 `[after, until]`（秒），窗口内按条件下发指令。
   * - 条件取值翻转（含首次求值）的那一帧下发对应分支；
   * - 给了 `repeatEvery` 时，条件成立期间每 n 秒重发一次 `then`（用于"持续施压"这类命令）；
   * - 窗口外完全不动，因此可以表达"到某个时刻看局势再决定"。
   */
  updateRule(state, dt) {
    const spec = state.spec;
    if (isFiniteNumber(spec.after) && this.elapsed < spec.after) return;
    if (isFiniteNumber(spec.until) && this.elapsed > spec.until) return;

    const met = this.conditionMet(spec.when, { persistent: true });
    if (state.value !== met) {
      state.value = met;
      state.timer = 0;
      const branch = met ? spec.then : spec.otherwise;
      // 没写对应分支（例如只写 then）时什么都不做
      if (branch !== undefined) this.runActions(Array.isArray(branch) ? branch : [branch]);
      return;
    }
    if (!met || !isFiniteNumber(spec.repeatEvery)) return;
    state.timer += dt;
    if (state.timer >= spec.repeatEvery) {
      state.timer = 0;
      this.runActions(Array.isArray(spec.then) ? spec.then : [spec.then]);
    }
  }

  updateTrigger(state, dt) {
    const { spec } = state;
    if (!state.active) {
      if (!this.conditionMet(spec.at)) return;
      state.active = true;
      state.timer = 0;
      this.runActions(spec.actions); // 触发瞬间立即执行一次
      if (!spec.repeatEvery) state.done = true;
      return;
    }
    if (state.done) return;
    state.timer += dt;
    if (state.timer >= spec.repeatEvery) {
      state.timer = 0;
      this.runActions(spec.actions);
    }
  }

  // 条件判定：
  //   触发器用 { time }（经过秒数）、{ enemyCrossX }（任一敌军越过该 x）
  //   规则（persistent）额外支持占领点/城市归属、双方兵力对比，让脚本能"看局势"下命令
  conditionMet(at, { persistent = false } = {}) {
    if (!at) return false;
    if (typeof at.time === 'number' && this.elapsed >= at.time) return true;
    if (typeof at.enemyCrossX === 'number') {
      return this.world.units.some(unit =>
        unit.state !== 'dead' && unit.faction !== this.faction && unit.x >= at.enemyCrossX);
    }
    if (!persistent) return false;
    if (typeof at.ownUnitsBelow === 'number') return this.ownUnits().length < at.ownUnitsBelow;
    if (typeof at.enemyUnitsBelow === 'number') return this.enemyUnits().length < at.enemyUnitsBelow;
    if (this.isIdList(at.capturePoint)) {
      return this.anyOwnerMatches(this.world.capturePoints, at.capturePoint, at.owner);
    }
    if (this.isIdList(at.city)) {
      return this.anyOwnerMatches(this.world.cities, at.city, at.owner);
    }
    return false;
  }

  isIdList(value) {
    return isNonEmptyString(value) || (Array.isArray(value) && value.length > 0);
  }

  // 指定的（一个或多个）据点里，是否有任意一个的归属符合 expected
  anyOwnerMatches(list, ids, expected) {
    const wanted = Array.isArray(ids) ? ids : [ids];
    return wanted.some((id) => {
      const entity = (list ?? []).find(item => item.id === id);
      return Boolean(entity) && this.ownerMatches(entity.faction, expected);
    });
  }

  // owner 支持 'self' / 'enemy'（相对脚本阵营）与 'blue' / 'red' / 'neutral'（绝对值）
  ownerMatches(actual, expected) {
    if (!expected) return false;
    const want = expected === 'self' ? this.faction
      : (expected === 'enemy' ? this.enemyFaction() : expected);
    if (want === 'neutral') return !['blue', 'red'].includes(actual);
    return actual === want;
  }

  enemyFaction() {
    return this.faction === 'blue' ? 'red' : 'blue';
  }

  enemyUnits() {
    return this.world.units.filter(unit => unit.state !== 'dead' && unit.faction !== this.faction);
  }

  runActions(actions) {
    for (const action of actions ?? []) {
      switch (action.type) {
        case 'spawn': this.doSpawn(action); break;
        case 'attackNearest': this.doAttackNearest(action); break;
        case 'attackMove': this.doAttackMove(action); break;
        case 'hold': this.doHold(action); break;
        case 'retreat': this.doRetreat(action); break;
        default: break;
      }
    }
  }

  /**
   * 本次动作要指挥哪些单位：省略 `action.units` = 全军；
   * 写 `{ group: 'x' }` = 只有 `unit.group === 'x'` 的那支编队（关卡 forces[].group / spawn.group 打标签）。
   * 选不到任何单位时什么都不做（不算错误——部队可能已经全灭或还没出生）。
   */
  ownUnits(selector) {
    const units = this.world.units.filter(unit => unit.state !== 'dead' && unit.faction === this.faction);
    if (!selector?.group) return units;
    return units.filter(unit => unit.group === selector.group);
  }

  // 向选中的单位统一下令；返回受令单位数（0 = 没选中任何单位）
  commandUnits(selector, command) {
    const ids = this.ownUnits(selector).map(unit => unit.id);
    if (ids.length > 0) this.world.issueCommands(ids, command);
    return ids.length;
  }

  // 生成增援：按锚点 + 间距批量出生，可打编队标签（group），并逐单位下达 order（缺省驻守）
  doSpawn(action) {
    const anchor = resolvePoint(action.at, this.world, this.anchors);
    if (!anchor) return;
    const spacing = action.spacing ?? { x: 0, y: 0 };
    for (let i = 0; i < action.count; i += 1) {
      const unit = this.world.spawnUnit(
        this.faction,
        action.unitType ?? 'light',
        anchor.x + spacing.x * i,
        anchor.y + spacing.y * i,
      );
      if (action.group) unit.group = action.group;
      const target = action.order?.type === 'attackMove'
        ? resolvePoint(action.order.target, this.world, this.anchors)
        : null;
      this.world.issueCommands([unit.id], target ? attackMoveCommand(target) : holdCommand());
    }
  }

  // 全军（或指定编队）向各自最近的敌军位置 attackMove；无敌人时向 fallback 目标进军
  //（保证失败条件可达，gdd.md §10 胜负对称）。
  doAttackNearest(action = {}) {
    const fallback = resolvePoint(this.script.fallback, this.world, this.anchors);
    for (const unit of this.ownUnits(action.units)) {
      const enemy = this.nearestEnemy(unit);
      const target = enemy ? { x: enemy.x, y: enemy.y } : fallback;
      if (!target) continue;
      this.world.issueCommands([unit.id], attackMoveCommand(target));
    }
  }

  doAttackMove(action) {
    const point = resolvePoint(action.target, this.world, this.anchors);
    if (!point) return;
    this.commandUnits(action.units, attackMoveCommand(point, { forced: action.forced === true }));
  }

  doHold(action = {}) {
    this.commandUnits(action.units, holdCommand());
  }

  // 撤退：选中的单位撤向 `to`（PointRef）；省略时退向最近的己方城市，无城可退就原地驻守。
  // 用 move 而不是 attackMove——撤退是"往后退"，中途照旧会自动接敌（attack-forward，gdd.md §4）。
  doRetreat(action = {}) {
    const units = this.ownUnits(action.units);
    if (units.length === 0) return;
    const fallbackCity = this.world.cities?.find(city => city.faction === this.faction);
    const target = resolvePoint(action.to, this.world, this.anchors)
      ?? (fallbackCity ? { x: fallbackCity.x, y: fallbackCity.y } : null);
    if (!target) {
      this.doHold(action); // 无路可退：原地固守
      return;
    }
    for (const unit of units) {
      this.world.issueCommands([unit.id], moveCommand([target], { forced: action.forced === true }));
    }
  }

  // 空间分区扩张半径查询，避免全单位扫描（REQUIREMENTS.md §5）
  nearestEnemy(unit) {
    const { spatial } = this.world;
    let radius = values.spatial.cellSize;
    while (radius <= Math.max(this.world.size.width, this.world.size.height)) {
      let nearest = null;
      let best = Infinity;
      for (const other of spatial.query(unit.x, unit.y, radius)) {
        if (other.state === 'dead' || other.faction === unit.faction) continue;
        const d = Math.hypot(other.x - unit.x, other.y - unit.y);
        if (d < best) {
          best = d;
          nearest = other;
        }
      }
      if (nearest) return nearest;
      radius *= 2;
    }
    return null; // 半径已覆盖全图仍未找到，即无敌人
  }
}
