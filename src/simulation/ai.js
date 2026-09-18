import { values } from '../config/index.js';
import { attackCommand, attackMoveCommand, holdCommand, moveCommand } from './commands.js';
import { resolvePoint } from './level.js';
import { assignSlots, cohesionRatio, facingTo, formationSlots, isRushingAhead, needsColumn, squadAnchor, squadCentroid } from './ai/squad.js';
import { chooseTarget, combatPower, enemiesWithin, scoreAttack } from './ai/tactics.js';
import { approachWaypoint, chooseApproach, chooseWeakSpot, feintAxis } from './ai/front.js';
import { perceive, unexploredFrontier, visibleEnemies } from './ai/perception.js';
import { resolveAiConfig } from './ai/presets.js';
import {
  bestSupplyCity, clampToSupply, isLowSupply, squadLowSupply, supplyPolicy, withinSupply,
} from './ai/supply.js';

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
    // ---- 战术层（engage）运行时状态 ----
    // intents：编队 → 当前战术意图（目标点）。脚本的 hold / retreat / attackMove 会清掉对应编队的意图，
    // 所以"脚本意图优先"这条铁律由 clearIntents 保证。
    this.intents = new Map();      // group 名 → { objective, anchor }
    this.tacticsTimer = 0;
    this.lastOrders = new Map();   // unit.id → 上一次下发的命令签名（避免重复下令重置路线）
    this.currentTargets = new Map(); // unit.id → 当前选中的敌人 id（用于换目标迟滞）
    this.squadStates = new Map();  // group 名 → 战术状态（休整状态机 / 接近轴 / 预备队）
    // 本局 AI 配置：presets[preset] 覆盖 values.ai，关卡的 ai.tuning 再覆盖一层（docs/ai-design.md §2）
    this.cfg = resolveAiConfig(script.preset, script.tuning);
    // 迷雾公平模式（阶段三）：关卡写 "fog": true 才开启，默认全知（旧关卡行为不变）
    this.fogAware = typeof script.fog === 'boolean' ? script.fog : values.ai.fog;
    // 补给策略（docs/ai-design.md §3.7）：由档位 supplyCaution 插值出活动范围 / 打分倍率 /
    // 急行军门槛 / 回城阈值；cfg 一局固定，所以这里算一次即可。
    this.policy = supplyPolicy(this.cfg);
  }

  update(dt) {
    this.elapsed += dt;
    for (const state of this.triggers) this.updateTrigger(state, dt);
    for (const state of this.rules) this.updateRule(state, dt);
    // 战术层：按固定节奏（模拟时间）跑一次，与渲染帧率无关（docs/ai-design.md §4）
    this.tacticsTimer += dt;
    if (this.intents.size > 0 && this.tacticsTimer >= values.ai.decisionIntervalSeconds) {
      this.tacticsTimer = 0;
      this.runTactics();
    }
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
      // 公平模式下"敌军越过某条线"也只认看得见的敌人（默认全知）
      const enemies = this.fogAware
        ? visibleEnemies(this.world, this.faction)
        : this.world.units.filter(unit => unit.state !== 'dead' && unit.faction !== this.faction);
      return enemies.some(unit => unit.x >= at.enemyCrossX);
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
    if (this.fogAware) return visibleEnemies(this.world, this.faction);
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
        case 'engage': this.doEngage(action); break;
        default: break;
      }
    }
  }

  // 编队名（没有打标签的单位归入默认小队，按阵营区分）
  groupOf(unit) {
    return unit.group ?? `#ungrouped-${this.faction}`;
  }

  // 清掉指定编队的战术意图（脚本下了 hold / retreat / attackMove 时，"意图优先"）
  clearIntents(selector) {
    if (!selector?.group) {
      this.intents.clear();
      return;
    }
    this.intents.delete(selector.group);
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
    this.clearIntents(action.units); // 明确的行军命令接管这些编队
    this.commandUnits(action.units, attackMoveCommand(point, { forced: action.forced === true }));
  }

  doHold(action = {}) {
    this.clearIntents(action.units);
    this.commandUnits(action.units, holdCommand());
  }

  // 撤退：选中的单位撤向 `to`（PointRef）；省略时退向最近的己方城市，无城可退就原地驻守。
  // 用 move 而不是 attackMove——撤退是"往后退"，中途照旧会自动接敌（attack-forward，gdd.md §4）。
  doRetreat(action = {}) {
    this.clearIntents(action.units);
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

  // ---- 战术层（docs/ai-design.md 阶段一）----------------------------------------
  //
  // engage = "聪明地执行 attackMove"：脚本给出目标点与编队，战术层负责
  //   ① 队形推进（line / 窄口自动纵队）② 不添油（脱离队形的先锋原地等）③ 集中火力（同目标 ≤ N 人）
  //   ④ 优先追击溃逃/失序目标。决策节奏固定 0.5s，只在"决策变化"时下令，避免重置行军路线。
  doEngage(action) {
    const objective = resolvePoint(action.target, this.world, this.anchors);
    if (!objective) return;
    const groups = new Set(this.ownUnits(action.units).map(unit => this.groupOf(unit)));
    for (const group of groups) this.intents.set(group, { objective });
  }

  runTactics() {
    const cfg = this.cfg;
    // 情报：全知模式下就是全部敌军；公平模式下是"看得见 + 记得住"（阶段三）
    const knowns = perceive(this.world, this.faction, cfg, this.fogAware);
    for (const [group, intent] of this.intents) {
      const units = this.ownUnits({ group });
      if (units.length === 0) continue;
      const { objective } = intent;
      const state = this.squadState(group);
      state.cooldown = Math.max(0, state.cooldown - cfg.decisionIntervalSeconds);
      const centroid = squadCentroid(units);
      const avgHp = units.reduce((sum, unit) => sum
        + unit.hp / values.units[unit.type].hp, 0) / units.length;
      // 补给存量也按**比例**取平均：各兵种存量上限不同（values.units.*.supplyStock）
      const avgStock = units.reduce((sum, unit) => sum
        + (unit.maxSupplyStock > 0 ? unit.supplyStock / unit.maxSupplyStock : 0), 0) / units.length;

      // ① 休整状态机（阶段二）：打残/缺补 → 撤回**补给代价最低**的己城，恢复够了再回归
      //    lowSupply（补给线断了，或平均存量跌破警戒线）直接视同"该回去补给了"
      const lowSupply = squadLowSupply(units, this.policy);
      if (this.updateRegroupState(state, group, units, centroid, avgHp, avgStock, cfg, lowSupply)) continue;

      // ② 主攻方向（阶段二 B）：复用战线的薄弱点 → 接近轴端点；没有战线时就是脚本目标
      //    然后再把目标点**夹进补给可达区**（行动边界，docs/ai-design.md §3.7）
      const rawWaypoint = this.resolveWaypoint(state, group, units, centroid, objective, cfg, knowns);
      const clamped = clampToSupply(this.world, this.faction, centroid, rawWaypoint, this.policy.hardReachCost);
      const waypoint = clamped.clamped ? clamped : rawWaypoint;
      const anchor = squadAnchor(units, waypoint);
      const template = needsColumn(this.world.terrain, anchor.centroid, waypoint) ? 'column' : 'line';
      const slots = formationSlots(units.length, template, anchor.facing);
      const cohesive = cohesionRatio(units, anchor.centroid) >= cfg.squad.cohesionRatio;
      const targetCounts = new Map();

      // ③ 分兵（阶段二 F）：预备队留在后方；sly 档再派一个单位去侧翼佯动
      const feintId = cfg.feint ? this.pickFeintUnit(state, group, units, waypoint, cfg) : null;
      const reserve = this.pickReserve(state, group, units, waypoint, cfg, feintId);
      const forced = this.shouldForceMarch(units, waypoint, cfg);

      // ③b 侦察兵（阶段三）：公平模式下抽人做前沿探索，暂时脱离队形
      const scouts = this.pickScouts(state, units, objective, feintId, cfg);

      for (const { unit, point } of assignSlots(units, anchor, slots)) {
        // ③c 个别单位自己断补/存量告急（小队整体还算健康）：先回补给区，不再往前顶
        //    —— 主动接战一律不下（contact 时 combat 系统仍会照常交战 = 只反击）
        if (isLowSupply(unit, this.policy)) {
          const back = bestSupplyCity(this.world, this.faction, unit.x, unit.y);
          if (back) {
            const label = back.cost === Infinity ? 'resupply-blind' : 'resupply';
            this.issueOnce(unit, moveCommand([{ x: back.city.x, y: back.city.y }]), `${label}:${back.city.id}`);
            continue;
          }
        }
        if (scouts.has(unit.id)) {
          const frontier = this.scoutFrontier(state, unit, objective, cfg);
          if (frontier) {
            this.issueOnce(unit, attackMoveCommand(frontier, { forced: false }), `scout:${Math.round(frontier.x)},${Math.round(frontier.y)}`);
          } else {
            this.issueOnce(unit, holdCommand(), 'scout-idle');
          }
          continue;
        }
        if (feintId !== null && unit.id === feintId) {
          this.issueOnce(unit, attackMoveCommand(state.feintPoint, { forced }), `feint:${Math.round(state.feintPoint.x)},${Math.round(state.feintPoint.y)}`);
          continue;
        }
        if (reserve.has(unit.id)) {
          // 预备队：在主力后方待命（投入条件见 shouldCommitReserve）
          const rally = {
            x: centroid.x - anchor.facing.x * cfg.reserve.rallyBehind,
            y: centroid.y - anchor.facing.y * cfg.reserve.rallyBehind,
          };
          const holdAt = Math.hypot(unit.x - rally.x, unit.y - rally.y) > cfg.squad.cohesionRadius ? rally : null;
          if (holdAt) this.issueOnce(unit, attackMoveCommand(holdAt, { forced }), `reserve:${Math.round(holdAt.x)},${Math.round(holdAt.y)}`);
          else this.issueOnce(unit, holdCommand(), 'reserve-hold');
          continue;
        }
        // ④ 队形纪律：队形散了 + 这个单位跑在前面 → 原地等主力（不添油）
        if (!cohesive && isRushingAhead(unit, anchor.centroid, waypoint)) {
          this.issueOnce(unit, holdCommand(), 'hold');
          continue;
        }
        // ⑤ 选目标：集中火力上限内的最高分；已有目标且优势不足时保持（迟滞，防横跳）
        const ctx = { targetCounts, cfg, knowns: this.fogAware ? knowns : null, policy: this.policy };
        const chosen = this.chooseWithHysteresis(unit, ctx);
        if (chosen) {
          targetCounts.set(chosen.enemy.id, (targetCounts.get(chosen.enemy.id) ?? 0) + 1);
          this.currentTargets.set(unit.id, chosen.enemy.id);
          // 签名带上目标的粗粒度位置：目标跑远了才会重发攻击命令（追上去）
          const sx = Math.round(chosen.enemy.x / 48);
          const sy = Math.round(chosen.enemy.y / 48);
          this.issueOnce(unit, attackCommand(chosen.enemy.id), `attack:${chosen.enemy.id}:${sx},${sy}`);
          continue;
        }
        // ⑥ 没有值得打的目标：按队形槽位继续推进（attack-forward 会在接触时自动交战）
        this.lastOrders.delete(unit.id);
        this.currentTargets.delete(unit.id);
        this.issueOnce(unit, attackMoveCommand(point, { forced }), `advance:${Math.round(point.x)},${Math.round(point.y)}`);
      }
    }
  }

  // 每个编队一份战术状态（模式 / 休整冷却 / 接近轴 / 主力战力基线 / 佯动点）
  squadState(group) {
    let state = this.squadStates.get(group);
    if (!state) {
      state = { mode: 'engage', cooldown: 0, objective: null, axis: null, weakness: null, mainPower: null, feintPoint: null };
      this.squadStates.set(group, state);
    }
    return state;
  }

  /**
   * 回城休整状态机（阶段二）：
   *   engage --(平均血量/存量比例低于阈值，或整队断补)--> regroup --(进入己城恢复半径)--> recover
   *   recover --(恢复到阈值)--> engage（带冷却，防止来回抖动）
   * 返回 true 表示本轮已经处理（调用方跳过队形/选目标逻辑）。
   * 补给相关（docs/ai-design.md §3.7）：触发条件多一条 `lowSupply`（断补或平均存量跌破警戒线）；
   * 撤退目标是**补给代价最低**的己城（用 `world.supplyFields` 的代价场，而不是欧氏最近——
   * 后者可能正好是被切断的那座，越撤越惨）。
   */
  updateRegroupState(state, group, units, centroid, avgHp, avgStock, cfg, lowSupply = false) {
    const city = this.retreatCity(centroid);
    const inRecovery = city && Math.hypot(centroid.x - city.x, centroid.y - city.y) <= values.cities.recovery.radius;
    if (state.mode === 'engage') {
      const tired = avgHp < cfg.regroup.hpRatio
        || avgStock < this.policy.regroupRatio
        || lowSupply;
      if (!tired || state.cooldown > 0 || !city) return false;
      state.mode = 'regroup';
    }
    if (state.mode === 'regroup') {
      if (!city) {
        state.mode = 'engage'; // 无城可退：继续打
        return false;
      }
      if (inRecovery) {
        state.mode = 'recover';
      } else {
        this.clearIntentsForTargets(units); // 逐单位撤向己城
        for (const unit of units) {
          this.issueOnce(unit, moveCommand([{ x: city.x, y: city.y }]), `regroup:${city.id}`);
        }
        return true;
      }
    }
    // recover：在恢复半径内原地待命（+3hp/s 由 supply 结算；补给存量靠城里的补给线进货）
    if (avgHp >= cfg.regroup.recoverHpRatio && avgStock >= cfg.regroup.recoverSupplyRatio) {
      state.mode = 'engage';
      state.cooldown = cfg.regroup.cooldownSeconds;
      state.mainPower = null; // 重新集结后重新记基线
      this.lastOrders.clear();
      return false;
    }
    for (const unit of units) this.issueOnce(unit, holdCommand(), 'recover-hold');
    return true;
  }

  // 主攻方向：优先"战线上的薄弱点"（阶段二 B），否则退回脚本目标；sly 档额外算侧翼佯动点
  resolveWaypoint(state, group, units, centroid, objective, cfg, knowns = null) {
    const objectiveChanged = state.objective?.x !== objective.x || state.objective?.y !== objective.y;
    if (objectiveChanged || state.axis === undefined) {
      state.objective = { x: objective.x, y: objective.y };
      const fogArgs = { knowns, fogAware: this.fogAware };
      // 权限边界：只选"从哪个方向接近"，脚本给的目标点不变
      state.axis = chooseApproach(this.world, { unit: units[0], objective, faction: this.faction, cfg, ...fogArgs }) ?? null;
      state.weakness = chooseWeakSpot(this.world, { objective, faction: this.faction, cfg, ...fogArgs });
      state.feintPoint = cfg.feint
        ? feintAxis(this.world, { mainAxis: state.axis, objective, faction: this.faction, cfg, ...fogArgs })
        : null;
      state.mainPower = null;
    }
    const useWeak = state.weakness && (!state.axis || state.weakness.score >= state.axis.score);
    const pick = useWeak
      ? { x: state.weakness.x, y: state.weakness.y }
      : (state.axis ? { x: state.axis.x, y: state.axis.y } : null);
    if (!pick) return objective;
    return approachWaypoint(pick, objective, centroid);
  }

  // 预备队名单：离推进点最远的那一部分单位（确定性：距离相同按 id）
  pickReserve(state, group, units, waypoint, cfg, feintId) {
    const ratio = cfg.reserveRatio ?? 0;
    if (!(ratio > 0)) return new Set();
    if (this.shouldCommitReserve(state, units, waypoint, cfg)) {
      state.committed = true;
      return new Set();
    }
    const candidates = units.filter(unit => unit.id !== feintId);
    const count = Math.floor(candidates.length * ratio);
    if (count <= 0) return new Set();
    const sorted = [...candidates].sort((a, b) => {
      const da = Math.hypot(a.x - waypoint.x, a.y - waypoint.y);
      const db = Math.hypot(b.x - waypoint.x, b.y - waypoint.y);
      if (da !== db) return db - da; // 越远越靠后
      return a.id - b.id;
    });
    return new Set(sorted.slice(0, count).map(unit => unit.id));
  }

  // 预备队投入条件：主力战力掉到基线比例以下，或目标方向我方优势已经很大（扩大战果）
  shouldCommitReserve(state, units, waypoint, cfg) {
    if (state.committed) return true;
    const power = units.reduce((sum, unit) => sum + combatPower(unit, this.world), 0);
    if (state.mainPower === null) state.mainPower = power;
    const weakened = state.mainPower > 0 && power < state.mainPower * cfg.reserve.commitMainRatio;
    const weakness = state.weakness?.ratio ?? state.axis?.ratio ?? 0;
    return weakened || weakness >= cfg.reserve.commitWeaknessRatio;
  }

  // sly 档的佯动分队：挑离侧翼轴最近的那个单位（确定性：距离相同按 id）
  pickFeintUnit(state, group, units, waypoint, cfg) {
    if (!state.feintPoint || units.length < 3) return null;
    const candidates = [...units].sort((a, b) => {
      const da = Math.hypot(a.x - state.feintPoint.x, a.y - state.feintPoint.y);
      const db = Math.hypot(b.x - state.feintPoint.x, b.y - state.feintPoint.y);
      if (da !== db) return da - db;
      return a.id - b.id;
    });
    return candidates[0].id;
  }

  // 急行军：档位允许 + 距推进点足够远（代价是补给与掉血，见 gdd §4）
  /**
   * 急行军：档位允许 + 距推进点足够远（代价是补给 −10/s、掉血 1.5/s）。
   * 补给约束（docs/ai-design.md §3.7）：**存量够、路通、且目的地还在补给可达区内**才允许——
   * 急行军是一台烧存量（和血）的机器，断补时开急行军等于自杀。
   */
  shouldForceMarch(units, waypoint, cfg) {
    if (!cfg.useForcedMarch) return false;
    const alive = units.filter(unit => unit.state !== 'dead');
    if (alive.length === 0) return false;
    // 全队都要满足最低存量门槛，且没有一个人断补
    const stockOk = alive.every(unit => (unit.maxSupplyStock > 0
      ? unit.supplyStock / unit.maxSupplyStock : 0) >= this.policy.forcedMarchStock);
    if (!stockOk || alive.some(unit => !unit.supplied)) return false;
    if (!withinSupply(this.world, this.faction, waypoint.x, waypoint.y, this.policy.hardReachCost)) return false;
    const centroid = squadCentroid(units);
    return Math.hypot(waypoint.x - centroid.x, waypoint.y - centroid.y) >= cfg.march.minDistance;
  }

  nearestOwnCity(point) {
    let best = null;
    let bestDistance = Infinity;
    for (const city of this.world.cities ?? []) {
      if (city.faction !== this.faction) continue;
      const distance = Math.hypot(city.x - point.x, city.y - point.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = city;
      }
    }
    return best;
  }

  /**
   * 撤退/休整该去哪座城：**补给代价最低**的那座（够不着任何城时才退回欧氏最近）。
   * 代价来自 `world.supplyFields[faction]`——它已经含地形权重与敌方实际控制区阻断，
   * 所以"能走到、且离补给最近"这件事不需要 AI 自己再寻路。
   */
  retreatCity(point) {
    return bestSupplyCity(this.world, this.faction, point.x, point.y)?.city
      ?? this.nearestOwnCity(point);
  }

  // 撤退/休整时不需要清意图表（意图是"打哪"，退是为了接着打），但要清掉旧命令签名
  clearIntentsForTargets(units) {
    for (const unit of units) this.currentTargets.delete(unit.id);
  }

  // 迟滞：旧目标仍可用，且没有哪个候选比它高出 hysteresis 那么多 → 保持旧目标
  chooseWithHysteresis(unit, ctx) {
    const next = chooseTarget(this.world, unit, this.attackCandidates(unit), ctx);
    const previousId = this.currentTargets.get(unit.id);
    if (previousId === undefined) return next;
    const previous = this.world.units.find(candidate => candidate.id === previousId);
    if (!previous || previous.state === 'dead') return next;
    const current = scoreAttack(this.world, unit, previous, ctx);
    if (!current) return next; // 旧目标已达集中火力上限等情况：直接换
    if (!next || next.enemy.id === previousId) return current;
    const better = next.score > current.score * (1 + values.ai.hysteresis);
    return better ? next : current;
  }

  // 可攻击的目标候选：默认半径内所有敌军；公平模式下只认"看得见"的（记忆只能当坐标，不能当靶子）
  attackCandidates(unit) {
    const radius = this.cfg.engageRadius ?? values.ai.engageRadius;
    const nearby = enemiesWithin(this.world, unit, radius);
    if (!this.fogAware) return nearby;
    const visible = new Set(visibleEnemies(this.world, this.faction).map(enemy => enemy.id));
    return nearby.filter(enemy => visible.has(enemy.id));
  }

  // 侦察兵名单（阶段三）：公平模式 + 开启侦察 + 编队够大时，抽最健康的几个
  pickScouts(state, units, objective, feintId, cfg) {
    if (!this.fogAware || !cfg.scout.enabled) return new Set();
    // 补给约束：库存告急或已断补的单位不去侦察（侦察兵本来就最容易脱离补给线）
    const pool = units.filter(unit => unit.id !== feintId && !isLowSupply(unit, this.policy));
    if (pool.length < cfg.scout.minSquadSize) return new Set();
    const sorted = [...pool].sort((a, b) => {
      if (b.hp !== a.hp) return b.hp - a.hp; // 最健康的去侦察（更可能活着回来）
      return a.id - b.id;
    });
    return new Set(sorted.slice(0, cfg.scout.perGroup).map(unit => unit.id));
  }

  // 侦察兵的前沿目标：只在"没走到/走过头"时重算，避免每 0.5 秒改目的地
  // 补给约束：前沿点也夹进补给可达区（侦察兵不是一次性消耗品），夹不动就原地待命
  scoutFrontier(state, unit, objective, cfg) {
    const current = state.scoutTargets?.get(unit.id);
    if (current && Math.hypot(unit.x - current.x, unit.y - current.y) > 60) return current;
    const prefer = [];
    const enemyCity = (this.world.cities ?? []).find(city => city.faction !== this.faction);
    if (enemyCity) prefer.push({ x: enemyCity.x, y: enemyCity.y });
    prefer.push(objective);
    const raw = unexploredFrontier(this.world, this.faction, unit, { cfg, prefer });
    const frontier = raw
      ? clampToSupply(this.world, this.faction, { x: unit.x, y: unit.y }, raw, this.policy.hardReachCost)
      : null;
    const target = frontier && Math.hypot(frontier.x - unit.x, frontier.y - unit.y) > 40 ? frontier : null;
    state.scoutTargets ??= new Map();
    state.scoutTargets.set(unit.id, target);
    return target;
  }

  // 同一决策重复下发同样的命令会重置行军路线，所以只有签名变化时才真下单
  issueOnce(unit, command, signature) {
    if (this.lastOrders.get(unit.id) === signature) return false;
    this.lastOrders.set(unit.id, signature);
    this.world.issueCommands([unit.id], command);
    return true;
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
