import { values } from '../config/index.js';
import { attackMoveCommand, holdCommand } from './commands.js';
import { resolvePoint } from './level.js';

// 脚本敌军（REQUIREMENTS.md §4.5）：解释关卡 JSON 里的「事件 → 动作」脚本。
// 只读世界状态 → 通过 world.issueCommands 下发指令（与人类输入共用统一命令接口），不直接改状态。
//
// script 结构（见 level.js 的字段说明）：
//   {
//     faction: 'red',
//     fallback: PointRef,                        // 无敌人时的进军目标（可选）
//     triggers: [
//       { id?, at: { time } | { enemyCrossX }, repeatEvery?, actions: [ ... ] }
//     ]
//   }
// 所有点位（spawn 的 at、attackMove 的 target、fallback）都是 PointRef：
//   { x, y } | { spawn } | { spawnId } | { city } | { cityId } | { anchor }
// 其中 { anchor } 引用关卡根部的 anchors 命名锚点表，需通过构造参数 anchors 传入。
// 触发语义：条件首次满足时立即执行一次 actions；若给了 repeatEvery，此后每 repeatEvery 秒再执行一次。
// 动作类型：spawn / attackNearest / attackMove / hold（新增行为只需扩展 runActions 与 level.js 的校验）
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
  }

  update(dt) {
    this.elapsed += dt;
    for (const state of this.triggers) this.updateTrigger(state, dt);
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

  // 条件判定：支持 { time }（经过秒数）与 { enemyCrossX }（任一敌军越过该 x）
  conditionMet(at) {
    if (!at) return false;
    if (typeof at.time === 'number' && this.elapsed >= at.time) return true;
    if (typeof at.enemyCrossX === 'number') {
      return this.world.units.some(unit =>
        unit.state !== 'dead' && unit.faction !== this.faction && unit.x >= at.enemyCrossX);
    }
    return false;
  }

  runActions(actions) {
    for (const action of actions ?? []) {
      switch (action.type) {
        case 'spawn': this.doSpawn(action); break;
        case 'attackNearest': this.doAttackNearest(); break;
        case 'attackMove': this.doAttackMove(action.target); break;
        case 'hold': this.doHold(); break;
        default: break;
      }
    }
  }

  ownUnits() {
    return this.world.units.filter(unit => unit.state !== 'dead' && unit.faction === this.faction);
  }

  // 生成增援：按锚点 + 间距批量出生，并逐单位下达 order（缺省驻守）
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
      const target = action.order?.type === 'attackMove'
        ? resolvePoint(action.order.target, this.world, this.anchors)
        : null;
      this.world.issueCommands([unit.id], target ? attackMoveCommand(target) : holdCommand());
    }
  }

  // 全军向各自最近的敌军位置 attackMove；无敌人时向 fallback 目标进军
  //（保证失败条件可达，gdd.md §10 胜负对称）。
  doAttackNearest() {
    for (const unit of this.ownUnits()) {
      const enemy = this.nearestEnemy(unit);
      const target = enemy ? { x: enemy.x, y: enemy.y } : resolvePoint(this.script.fallback, this.world, this.anchors);
      if (!target) continue;
      this.world.issueCommands([unit.id], attackMoveCommand(target));
    }
  }

  doAttackMove(target) {
    const point = resolvePoint(target, this.world, this.anchors);
    if (!point) return;
    this.world.issueCommands(this.ownUnits().map(unit => unit.id), attackMoveCommand(point));
  }

  doHold() {
    this.world.issueCommands(this.ownUnits().map(unit => unit.id), holdCommand());
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
