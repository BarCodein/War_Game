import { makeUnit, makeCity } from './entities.js';
import { parseMap } from './map.js';
import { SpatialGrid } from './spatial.js';
import { validateCommand } from './commands.js';
import { updateMovement } from './systems/movement.js';
import { updateCombat } from './systems/combat.js';
import { updateMorale } from './systems/morale.js';
import { updateSupply } from './systems/supply.js';
import { updateCapture } from './systems/capture.js';
import { updateFog, createFogGrid } from './systems/fog.js';
import { updateVictory } from './systems/victory.js';

// tick 内系统执行顺序固定，保证确定性（architecture.md §4）：
// movement → combat → morale → supply → capture → fog → victory
const TICK_ORDER = [updateMovement, updateCombat, updateMorale, updateSupply, updateCapture, updateFog, updateVictory];

// 世界状态容器：纯数据 + tick 编排 + 统一命令入口。
// 无 Phaser/DOM 依赖，可在 Node 环境 headless 运行完整对局。
export class World {
  constructor(mapData) {
    const map = parseMap(mapData);
    this.time = 0;
    this.map = map;
    this.terrain = map.terrain;
    this.size = map.size;
    this.cities = map.cities.map(city => makeCity(city));
    this.units = [];
    this.fog = { blue: createFogGrid(map.terrain), red: createFogGrid(map.terrain) };
    this.events = [];   // 本 tick 产生的事件（morale 消费 unitDied 后于 tick 末清空）
    this.history = [];  // 事件日志（HUD 战场通讯用）
    this.winner = null;
    this.endTime = null;
    this.spatial = new SpatialGrid(map.size.width, map.size.height);
    this.nextUnitId = 1;
  }

  spawnUnit(faction, type = 'light', x, y) {
    const unit = makeUnit({ id: this.nextUnitId, faction, type, x, y });
    this.nextUnitId += 1;
    this.units.push(unit);
    return unit;
  }

  // 按地图 spawns 建立初始兵力
  spawnInitial(spawns = this.map.spawns) {
    for (const spawn of spawns) this.spawnUnit(spawn.faction, spawn.unitType ?? 'light', spawn.x, spawn.y);
  }

  // 统一命令入口（architecture.md §5）：人类、脚本敌军、未来 AI 共用；
  // 溃逃与阵亡单位不受指挥。
  issueCommands(unitIds, command) {
    validateCommand(command);
    const ids = new Set(unitIds);
    for (const unit of this.units) {
      if (unit.state === 'dead' || unit.state === 'rout' || !ids.has(unit.id)) continue;
      applyCommand(unit, command);
    }
  }

  killUnit(unit, cause) {
    unit.state = 'dead';
    unit.hp = 0;
    unit.deadAt = this.time;
    unit.route = [];
    unit.routeIndex = 0;
    unit.command = null;
    unit.targetId = null;
    this.events.push({
      type: 'unitDied', unitId: unit.id, faction: unit.faction,
      x: unit.x, y: unit.y, cause, at: this.time,
    });
  }

  nearestOwnCity(unit) {
    let nearest = null;
    let best = Infinity;
    for (const city of this.cities) {
      if (city.faction !== unit.faction) continue;
      const d = Math.hypot(city.x - unit.x, city.y - unit.y);
      if (d < best) {
        best = d;
        nearest = city;
      }
    }
    return nearest;
  }

  tick(dt) {
    this.time += dt;
    this.spatial.rebuild(this.units);
    for (const system of TICK_ORDER) system(this, dt);
    for (const event of this.events) this.history.push(event);
    this.events = [];
  }
}

function applyCommand(unit, command) {
  unit.command = command;
  unit.targetId = null;
  if (command.type === 'hold') {
    unit.route = [];
    unit.routeIndex = 0;
    unit.state = 'hold';
    return;
  }
  if (command.type === 'move' || command.type === 'attackMove') {
    unit.route = command.type === 'move'
      ? command.path.map(point => ({ x: point.x, y: point.y }))
      : [{ x: command.target.x, y: command.target.y }];
    unit.routeIndex = 0;
    unit.pathDirty = true;
    unit.state = 'moving';
    return;
  }
  if (command.type === 'attack') {
    unit.targetId = command.targetId;
  }
}
