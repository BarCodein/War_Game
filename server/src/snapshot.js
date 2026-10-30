import { isSpotted } from '../../src/simulation/systems/fog.js';

// 快照：服务器把世界状态序列化后按阵营发给客户端。
//
// **迷雾归属（PVP_FOG_AUTHORITY）**——两种模式：
//   · 'client'（默认，2026-10-30 起）：**服务器不做视野过滤**，快照里包含全部存活单位；
//     迷雾完全由客户端本地计算（updateFog 只依赖己方单位/城市/占领点），渲染层用
//     isSpotted() 决定画不画敌军与"最后已知位置虚影"。
//     → 好处：客户端能做完整的战争迷雾表现、便于调参与排查；代价：**失去防透视**
//       （任何人打开 DevTools 都能看到全图敌军），只适合朋友之间的对局。
//   · 'server'（严格模式）：只下发 `isSpotted` 为真的敌军，未目视敌军的坐标根本不到客户端，
//     改前端也看不到 —— 这是有防作弊需求时的模式。
//
// 城市 / 占领点：位置与归属始终公开（HUD 本来就会显示全部城市）。
// 死亡单位不下发（客户端用 casualties / events 表现）。
// 体积控制：数值保留 1 位小数（位置/血量）；实测 24 单位 ≈ 4.7 KB、32 单位 ≈ 5.6 KB。
const round1 = (value) => Math.round(value * 10) / 10;

function visibleUnits(world, faction, fogAuthority = 'client', routeDeltas = null) {
  const list = [];
  for (const unit of world.units) {
    if (unit.state === 'dead') continue;
    const own = unit.faction === faction;
    if (!own && fogAuthority === 'server' && !isSpotted(world, unit, faction)) continue;
    const entry = {
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
    };
    // 行军路线：**只给己方**，且只带"自上次发送以来变化的字段"（见 docs/pvp-plan.md §11.15）。
    // 敌方单位永远不带路线 —— 路线是"意图"，泄露它比泄露位置更严重；渲染层也就无从画起。
    if (own) {
      const patch = routeDeltas?.get(unit.id);
      if (patch) Object.assign(entry, patch);
    }
    list.push(entry);
  }
  return list;
}

/**
 * @param {object} world   src/simulation 的 World
 * @param {'blue'|'red'} faction  接收者的阵营
 * @param {object} meta    { tick, phase, elapsedMs, timeLeftMs, events, result, unitsAlive, casualties, routeDeltas }
 */
export function buildSnapshot(world, faction, meta = {}) {
  const fogAuthority = meta.fogAuthority === 'server' ? 'server' : 'client';
  return {
    tick: meta.tick ?? Math.round(world.time * 60),
    phase: meta.phase ?? 'playing',
    elapsedMs: meta.elapsedMs ?? Math.round(world.time * 1000),
    timeLeftMs: meta.timeLeftMs ?? null,
    you: faction,
    // 迷雾归属：'client' 时这里是全部存活单位（客户端本地过滤视野），'server' 时已过滤
    fogAuthority,
    units: visibleUnits(world, faction, fogAuthority, meta.routeDeltas),
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
