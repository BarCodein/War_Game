import { describe, expect, it } from 'vitest';
import { MatchSim } from '../../server/src/match.js';
import { loadPvpLevel } from '../../server/src/levels.js';
import { holdCommand, enqueueRouteCommand, moveCommand } from '../../src/simulation/commands.js';

// §11.15 验收：行军路线"变化才发 + 只发己方 + 重连全量"。
function makeMatch(overrides = {}) {
  const { level, map } = loadPvpLevel('dujiang_pvp');
  const match = new MatchSim({ level, map, prepMs: 0, ...overrides });
  match.start(0);
  match.startPlaying();
  return match;
}

const own = (match, faction = 'blue') => match.world.units.filter((unit) => unit.faction === faction);

describe('快照路线下发：变化才发', () => {
  it('首帧不塞空路线；有路线之后下一帧不再带', () => {
    const match = makeMatch();
    // 开局双方都没有路线：空数组不必发（客户端镜像默认就是空的）
    const first = match.snapshotFor('blue');
    expect(first.units.filter((unit) => 'route' in unit)).toHaveLength(0);

    const ids = own(match).map((unit) => unit.id);
    match.queueCommandBatch('blue', ids.map((id) => ({
      unitIds: [id],
      command: moveCommand([{ x: 900, y: 700 }]),
    })));
    const ordered = match.snapshotFor('blue');
    expect(ordered.units.filter((unit) => Array.isArray(unit.route))).toHaveLength(40);

    const second = match.snapshotFor('blue');
    expect(second.units.filter((unit) => 'route' in unit)).toHaveLength(0);
    expect(second.units.filter((unit) => 'routeIndex' in unit)).toHaveLength(0);
  });

  it('下令那一帧带 route/routeIndex，之后只在过路点时带 routeIndex', () => {
    const match = makeMatch();
    match.snapshotFor('blue');   // 把首帧全量消耗掉
    const ids = own(match).map((unit) => unit.id);
    match.queueCommandBatch('blue', ids.map((id) => ({
      unitIds: [id],
      command: moveCommand([{ x: 900, y: 700 }]),
    })));

    const ordered = match.snapshotFor('blue');
    const withRoute = ordered.units.filter((unit) => Array.isArray(unit.route));
    expect(withRoute).toHaveLength(40);
    expect(withRoute[0].route.length).toBeGreaterThan(0);
    // routeIndex 还是 0（没变）→ 按"变化才发"的规则不会重复带这个字段；客户端缓存里本来就是 0
    expect(withRoute[0].routeIndex ?? 0).toBe(0);
    expect(ordered.units.filter((unit) => 'routeIndex' in unit)).toHaveLength(0);

    const steady = match.snapshotFor('blue');
    expect(steady.units.filter((unit) => 'route' in unit)).toHaveLength(0);
  });

  it('hold 之后路线清空（只带 route: []）', () => {
    const match = makeMatch();
    match.snapshotFor('blue');
    const [unit] = own(match);
    match.queueCommand('blue', { unitIds: [unit.id], command: moveCommand([{ x: 900, y: 700 }]) });
    match.snapshotFor('blue');
    match.queueCommand('blue', { unitIds: [unit.id], command: holdCommand() });
    const snapshot = match.snapshotFor('blue');
    const entry = snapshot.units.find((item) => item.id === unit.id);
    expect(entry.route).toEqual([]);
  });

  it('排队（enqueueRoute）会带 pendingQueue；只在变化时带', () => {
    const match = makeMatch();
    match.snapshotFor('blue');
    const units = own(match).slice(0, 2);
    match.queueCommandBatch('blue', units.map((unit) => ({
      unitIds: [unit.id],
      command: moveCommand([{ x: 500, y: 500 }]),
    })));
    match.snapshotFor('blue');

    match.queueCommandBatch('blue', units.map((unit) => ({
      unitIds: [unit.id],
      command: enqueueRouteCommand({ x: 300, y: 300 }),
    })));
    const queued = match.snapshotFor('blue');
    const entries = queued.units.filter((unit) => Array.isArray(unit.pendingQueue));
    expect(entries).toHaveLength(2);
    expect(entries[0].pendingQueue.length).toBeGreaterThan(0);

    const steady = match.snapshotFor('blue');
    expect(steady.units.filter((unit) => 'pendingQueue' in unit)).toHaveLength(0);
  });

  it('敌方单位永远不带路线字段（任何一帧）', () => {
    const match = makeMatch();
    const ids = own(match, 'red').map((unit) => unit.id);
    match.queueCommandBatch('red', ids.map((id) => ({
      unitIds: [id],
      command: moveCommand([{ x: 200, y: 700 }]),
    })));
    for (let i = 0; i < 3; i += 1) {
      const snapshot = match.snapshotFor('blue');
      for (const unit of snapshot.units.filter((item) => item.faction === 'red')) {
        expect(unit).not.toHaveProperty('route');
        expect(unit).not.toHaveProperty('routeIndex');
        expect(unit).not.toHaveProperty('pendingQueue');
        expect(unit).not.toHaveProperty('forcedMarch');
      }
    }
  });

  it('ack 全量覆盖己方全部存活单位；resetRouteSync 后下一帧再发全量', () => {
    const match = makeMatch();
    const ids = own(match).map((unit) => unit.id);
    match.queueCommandBatch('blue', ids.map((id) => ({
      unitIds: [id],
      command: moveCommand([{ x: 900, y: 700 }]),
    })));
    match.snapshotFor('blue');   // 发过一次增量

    const routes = match.routesSnapshot('blue');
    expect(routes).toHaveLength(40);
    for (const entry of routes) {
      expect(Object.keys(entry).sort()).toEqual(['forcedMarch', 'id', 'pendingQueue', 'route', 'routeIndex']);
      expect(entry.route.length).toBeGreaterThan(0);
    }
    // 红方视角不会拿到蓝方路线
    expect(match.routesSnapshot('red').every((entry) => entry.id !== routes[0].id)).toBe(true);

    match.resetRouteSync('blue');
    const again = match.snapshotFor('blue');
    expect(again.units.filter((unit) => Array.isArray(unit.route))).toHaveLength(40);
  });

  it('PVP_SEND_ROUTES=0（sendRoutes=false）时完全不发路线', () => {
    const match = makeMatch({ sendRoutes: false });
    const snapshot = match.snapshotFor('blue');
    expect(snapshot.units.filter((unit) => 'route' in unit)).toHaveLength(0);
    expect(match.routesSnapshot('blue')).toEqual([]);
  });

  it('增量帧的体积：下令帧变大，稳态帧回到基线', () => {
    const match = makeMatch();
    match.snapshotFor('blue');   // 消耗首帧全量（空路线不发，体积已与稳态一致）
    const base = Buffer.byteLength(JSON.stringify(match.snapshotFor('blue').units));
    const ids = own(match).map((unit) => unit.id);
    match.queueCommandBatch('blue', ids.map((id) => ({
      unitIds: [id],
      command: moveCommand([{ x: 900, y: 700 }]),
    })));
    const ordered = Buffer.byteLength(JSON.stringify(match.snapshotFor('blue').units));
    const steady = Buffer.byteLength(JSON.stringify(match.snapshotFor('blue').units));
    expect(ordered).toBeGreaterThan(base);
    expect(steady - base).toBeLessThan(200);      // 稳态最多只剩少量 routeIndex 增量
    expect(ordered - base).toBeLessThan(4000);    // 单点路径很小；长拖也不会超过 ~4 KB
  });
});
