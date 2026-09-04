import { values } from '../config/index.js';
import { attackMoveCommand, holdCommand } from './commands.js';

// 脚本敌军（REQUIREMENTS.md §4.5）：驻守、定时增援、条件触发进攻、向预设目标移动。
// 只读世界状态 → 通过 world.issueCommands 下发指令（与人类输入共用统一命令接口），不直接改状态。
// script 结构：
// {
//   reinforcement: { atTime, count, unitType, spawn: { x, y }, moveTo: { x, y } },
//   trigger: { onEnemyCrossX, retargetInterval },  // 敌军越过 onEnemyCrossX 后全军进攻并周期性重选目标
// }
export class ScriptedAI {
  constructor(world, { faction = 'red', script = {} } = {}) {
    this.world = world;
    this.faction = faction;
    this.script = script;
    this.elapsed = 0;
    this.fired = new Set();
    this.retargetTimer = 0;
  }

  update(dt) {
    this.elapsed += dt;
    this.handleReinforcement();
    this.handleTrigger(dt);
  }

  handleReinforcement() {
    const { reinforcement } = this.script;
    if (!reinforcement || this.fired.has('reinforcement') || this.elapsed < reinforcement.atTime) return;
    this.fired.add('reinforcement');
    for (let i = 0; i < reinforcement.count; i += 1) {
      const unit = this.world.spawnUnit(
        this.faction,
        reinforcement.unitType ?? 'light',
        reinforcement.spawn.x + i * values.input.routeUnitOffset,
        reinforcement.spawn.y,
      );
      this.world.issueCommands([unit.id], reinforcement.moveTo
        ? attackMoveCommand(reinforcement.moveTo)
        : holdCommand());
    }
  }

  handleTrigger(dt) {
    const { trigger } = this.script;
    if (!trigger) return;
    const enemyCrossed = this.world.units.some(unit =>
      unit.state !== 'dead' && unit.faction !== this.faction && unit.x >= trigger.onEnemyCrossX);
    if (enemyCrossed && !this.fired.has('attack')) {
      this.fired.add('attack');
      this.retargetTimer = trigger.retargetInterval ?? 5; // 触发即进攻，此后周期性重选目标
    }
    if (!this.fired.has('attack')) return;
    this.retargetTimer += dt;
    if (this.retargetTimer >= (trigger.retargetInterval ?? 5)) {
      this.retargetTimer = 0;
      this.retargetNearestEnemy();
    }
  }

  // 全军向各自最近的敌军位置 attackMove
  retargetNearestEnemy() {
    for (const unit of this.world.units) {
      if (unit.state === 'dead' || unit.faction !== this.faction) continue;
      const enemy = this.nearestEnemy(unit);
      if (!enemy) continue;
      this.world.issueCommands([unit.id], attackMoveCommand({ x: enemy.x, y: enemy.y }));
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
