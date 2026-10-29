import { isSpotted } from '../../src/simulation/systems/fog.js';

// 快照：服务器把「某个玩家能看到的世界」序列化后发给客户端。
// 防作弊的核心就在这里 —— **未目视的敌方单位根本不会出现在快照里**，
// 客户端即使改代码也无法凭空显示（它手里没有数据）。
//
// 视野模型（与战役一致，gdd §9）：
//   · 自己的单位：全部可见（含溃逃/无序）
//   · 敌方单位：仅当 isSpotted(world, unit, 自己阵营) 为真才可见
//   · 城市 / 占领点：位置与归属公开（HUD 本来就会显示全部城市；只额外提供占领进度）
//   · 死亡单位不下发（客户端用 casualties / events 表现）
//
// 体积控制：数值保留 1 位小数（位置/血量），实测单帧 3–5 KB，15 Hz 双人约 0.1 MB/s。
const round1 = (value) => Math.round(value * 10) / 10;

function visibleUnits(world, faction) {
  const list = [];
  for (const unit of world.units) {
    if (unit.state === 'dead') continue;
    const own = unit.faction === faction;
    if (!own && !isSpotted(world, unit, faction)) continue;
    list.push({
      id: unit.id,
      faction: unit.faction,
      type: unit.type,
      x: round1(unit.x),
      y: round1(unit.y),
      hp: round1(unit.hp),
      maxHp: round1(unit.maxHp ?? unit.hp),
      state: unit.state,
      group: unit.group ?? null,
      supplyStock: round1(unit.supplyStock ?? 0),
    });
  }
  return list;
}

/**
 * @param {object} world   src/simulation 的 World
 * @param {'blue'|'red'} faction  接收者的阵营
 * @param {object} meta    { tick, phase, elapsedMs, timeLeftMs, events, result, unitsAlive, casualties }
 */
export function buildSnapshot(world, faction, meta = {}) {
  return {
    tick: meta.tick ?? Math.round(world.time * 60),
    phase: meta.phase ?? 'playing',
    elapsedMs: meta.elapsedMs ?? Math.round(world.time * 1000),
    timeLeftMs: meta.timeLeftMs ?? null,
    you: faction,
    units: visibleUnits(world, faction),
    cities: world.cities.map((city) => ({
      id: city.id,
      x: round1(city.x),
      y: round1(city.y),
      faction: city.faction,
      captureProgress: round1(city.captureProgress ?? 0),
    })),
    points: (world.capturePoints ?? []).map((point) => ({
      id: point.id,
      x: round1(point.x),
      y: round1(point.y),
      faction: point.faction,
    })),
    casualties: {
      blue: round1(world.casualties?.blue ?? 0),
      red: round1(world.casualties?.red ?? 0),
    },
    unitsAlive: meta.unitsAlive ?? null,
    events: meta.events ?? [],
    result: meta.result ?? null,
  };
}
