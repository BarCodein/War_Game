import { describe, expect, it } from 'vitest';
import { MatchSim } from '../../server/src/match.js';
import { loadPvpLevel } from '../../server/src/levels.js';
import { buildDerive, deriveBytes, deriveHash } from '../../server/src/derive.js';
import { World } from '../../src/simulation/world.js';
import { deployForces } from '../../src/simulation/level.js';
import { comparePaths, createDeriveController, resamplePaths } from '../../src/pvp/derive.js';

// 方案 B（docs/pvp-derive-draft.md）验收：
//   1) 服务器校正包只含"渲染要用的最小数据"（控制线 + 补给边 + 断补列表）
//   2) 客户端本地算出的控制线/补给边与服务器一致（稳态 mismatch < 2%、边一致率 > 98%）
//   3) 收敛/降级判定按草案 §4 工作

function makeMatch(levelId = 'dujiang_pvp', ticks = 600) {
  const { level, map } = loadPvpLevel(levelId);
  const match = new MatchSim({ level, map, prepMs: 0 });
  match.start(0);
  match.startPlaying();
  for (let i = 0; i < ticks; i += 1) match.tickOnce();
  return { match, level, map };
}

function makeMirror(level, map, nowRef) {
  const world = new World(map);
  deployForces(world, level.forces, level.anchors ?? {});
  const derive = createDeriveController({
    world,
    getSnapshot: () => ({ phase: 'playing', fogAuthority: 'client' }),
    now: () => nowRef.value,
  });
  return { world, derive };
}

function syncWorld(from, to) {
  for (const unit of to.units) {
    const source = from.units.find((item) => item.id === unit.id);
    if (!source) { unit.state = 'dead'; continue; }
    unit.x = source.x;
    unit.y = source.y;
    unit.hp = source.hp;
    unit.state = source.state;
    unit.supplyStock = source.supplyStock;
    unit.maxSupplyStock = source.maxSupplyStock;
    unit.faction = source.faction;
  }
}

describe('world:derive 校正包', () => {
  it('只含控制线折线 + 补给边 + 断补列表，坐标是整数且按 lod 抽样', () => {
    const { match } = makeMatch();
    const payload = buildDerive(match, { lod: 2 });

    expect(payload.controlLine.lod).toBe(2);
    expect(payload.controlLine.paths.length).toBeGreaterThan(0);
    for (const path of payload.controlLine.paths) {
      expect(path.length).toBeGreaterThan(1);
      for (const [x, y] of path) {
        expect(Number.isInteger(x)).toBe(true);
        expect(Number.isInteger(y)).toBe(true);
      }
    }
    // 不含任何结算输入
    expect(payload).not.toHaveProperty('units');
    expect(JSON.stringify(payload)).not.toMatch(/supplyIntake|supplyStock|hp/);

    // 补给边是 [unitId, cityIdx]，断补列表是 unitId
    const cityIds = payload.supply.cityIds;
    expect(cityIds).toHaveLength(match.world.cities.length);
    for (const [unitId, cityIdx] of payload.supply.edges) {
      expect(typeof unitId).toBe('number');
      expect(cityIdx).toBeGreaterThanOrEqual(0);
      expect(cityIdx).toBeLessThan(cityIds.length);
    }
    for (const unitId of payload.supply.off) expect(typeof unitId).toBe('number');

    // 体积：3 s 一包，应远小于"塞进 15Hz 快照"
    expect(deriveBytes(payload)).toBeLessThan(4000);
  });

  it('内容没变时哈希相同（driver 据此跳过发送），变一下就必须变', () => {
    const { match } = makeMatch();
    const a = buildDerive(match, { lod: 2 });
    const b = buildDerive(match, { lod: 2 });
    expect(deriveHash(a)).toBe(deriveHash(b));

    const changed = JSON.parse(JSON.stringify(a));
    changed.controlLine.paths[0][0][0] += 3;
    expect(deriveHash(changed)).not.toBe(deriveHash(a));

    const edgesChanged = JSON.parse(JSON.stringify(a));
    edgesChanged.supply.off.push(99999);
    expect(deriveHash(edgesChanged)).not.toBe(deriveHash(a));
  });
});

describe('客户端派生 vs 服务器（稳态一致性）', () => {
  it('控制线：5 秒后 mismatch < 2%，补给边一致率 > 98%', () => {
    const { match, level, map } = makeMatch('dujiang_pvp', 60);
    const nowRef = { value: 1000 };
    const { world, derive } = makeMirror(level, map, nowRef);

    // 双方各跑 5 秒：服务器 tickOnce，客户端按 60Hz 喂 update()
    for (let i = 0; i < 300; i += 1) {
      match.tickOnce();
      syncWorld(match.world, world);
      nowRef.value += 1000 / 60;
      derive.update(1000 / 60);
    }

    const serverPaths = resamplePaths(match.world.controlLinePaths);
    const clientPaths = resamplePaths(world.controlLinePaths);
    expect(serverPaths.length).toBeGreaterThan(0);
    expect(clientPaths.length).toBe(serverPaths.length);

    const mismatch = comparePaths(clientPaths, serverPaths, world.size);
    expect(mismatch).toBeLessThan(0.02);

    // 补给边：每个单位"连到哪几座城"应基本一致
    let agree = 0;
    let total = 0;
    for (const unit of match.world.units) {
      if (unit.state === 'dead') continue;
      const mine = world.units.find((item) => item.id === unit.id);
      if (!mine) continue;
      const serverCities = [...new Set((unit.supplyEdges ?? []).map((edge) => edge.cityId))].sort();
      const clientCities = [...new Set((mine.supplyEdges ?? []).map((edge) => edge.cityId))].sort();
      total += 1;
      if (serverCities.join(',') === clientCities.join(',')) agree += 1;
    }
    expect(total).toBeGreaterThan(0);
    expect(agree / total).toBeGreaterThan(0.98);
  });

  it('本地派生只写渲染量：不改 hp / 补给存量', () => {
    const { match, level, map } = makeMatch('dujiang_pvp', 120);
    const nowRef = { value: 0 };
    const { world, derive } = makeMirror(level, map, nowRef);
    syncWorld(match.world, world);

    const before = world.units.map((unit) => ({ id: unit.id, hp: unit.hp, stock: unit.supplyStock }));
    for (let i = 0; i < 120; i += 1) {
      nowRef.value += 1000 / 60;
      derive.update(1000 / 60);
    }
    for (const unit of world.units) {
      const snapshot = before.find((item) => item.id === unit.id);
      expect(unit.hp).toBe(snapshot.hp);
      expect(unit.supplyStock).toBe(snapshot.stock);
    }
    expect(world.units.some((unit) => (unit.supplyEdges ?? []).length > 0)).toBe(true);
  });
});

describe('校正策略', () => {
  it('第一份包只对齐不计数；严重偏离 → 硬切；连续 3 次 → 降级为 server 模式', () => {
    const { level, map } = loadPvpLevel('dujiang_pvp');
    const world = new World(map);
    deployForces(world, level.forces, level.anchors ?? {});
    const nowRef = { value: 0 };
    const derive = createDeriveController({
      world,
      getSnapshot: () => ({ phase: 'playing', fogAuthority: 'client' }),
      now: () => nowRef.value,
    });

    // 造一条"本地折线"（场景还没起也能验证策略分支）
    derive.state.localPaths = resamplePaths([[
      { x: 100, y: 100 }, { x: 900, y: 700 },
    ]]);
    derive.state.packets = 1;   // 假装已经收过第一份包

    // 完全不同的一条线 → mismatch = 1 → 每次都硬切
    const farPacket = (seq) => ({
      seq,
      controlLine: { lod: 1, paths: [[[1100, 700], [200, 120]]] },
      supply: { cityIds: [], edges: [], off: [] },
    });

    derive.applyPacket(farPacket(1));
    expect(derive.state.hardSwitches).toBe(1);
    expect(derive.state.mode).toBe('local');

    derive.applyPacket(farPacket(2));
    derive.applyPacket(farPacket(3));
    expect(derive.state.hardSwitches).toBe(3);
    expect(derive.state.mode).toBe('server');
  });

  it('过期/重复的校正包被丢弃', () => {
    const { level, map } = loadPvpLevel('dujiang_pvp');
    const world = new World(map);
    deployForces(world, level.forces, level.anchors ?? {});
    const derive = createDeriveController({ world, getSnapshot: () => ({ phase: 'playing' }), now: () => 0 });
    const packet = (seq) => ({ seq, controlLine: { lod: 1, paths: [[[0, 0], [10, 10]]] }, supply: { cityIds: [], edges: [], off: [] } });
    derive.applyPacket(packet(5));
    derive.applyPacket(packet(4));
    derive.applyPacket(packet(5));
    expect(derive.state.packets).toBe(1);
  });
});

// §11.16.2 回归：降级（mode='server'）只影响"画哪条控制线"，**不能**冻结补给分配；
// 以及"折线条数不同"不能直接判 mismatch=1（会把客户端推入不会自愈的降级）。
describe('降级为 server 模式后，补给仍然实时派生', () => {
  it('mode=server 时 refreshSupply 继续运行：新占领的城市会成为补给源', () => {
    const { level, map } = loadPvpLevel('dujiang_pvp');
    const world = new World(map);
    deployForces(world, level.forces, level.anchors ?? {});
    const nowRef = { value: 0 };
    const derive = createDeriveController({
      world,
      getSnapshot: () => ({ phase: 'playing', fogAuthority: 'client' }),
      now: () => nowRef.value,
    });
    derive.state.mode = 'server';   // 模拟已经降级

    // 一个蓝方单位站在红城旁边、缺补给
    const unit = world.units.find((item) => item.faction === 'blue');
    const city = world.cities.find((item) => item.faction === 'red');
    unit.x = city.x + 20;
    unit.y = city.y + 10;
    unit.supplyStock = 0;
    unit.state = 'hold';
    city.faction = 'blue';           // 刚被占领（客户端归属已更新）

    for (let i = 0; i < 180; i += 1) {
      nowRef.value += 1000 / 60;
      derive.update(1000 / 60);
    }

    const edges = (unit.supplyEdges ?? []).map((edge) => edge.cityId);
    expect(edges).toContain(city.id);
    expect(derive.state.supplyEdges).toBeGreaterThan(0);
  });

  it('失去的城市不会再作为补给源（边被重新分配）', () => {
    const { level, map } = loadPvpLevel('dujiang_pvp');
    const world = new World(map);
    deployForces(world, level.forces, level.anchors ?? {});
    const nowRef = { value: 0 };
    const derive = createDeriveController({
      world,
      getSnapshot: () => ({ phase: 'playing', fogAuthority: 'client' }),
      now: () => nowRef.value,
    });
    derive.state.mode = 'server';
    const unit = world.units.find((item) => item.faction === 'blue');
    const city = world.cities.find((item) => item.faction === 'blue' && item.id !== 'c13');
    unit.x = city.x + 20;
    unit.y = city.y + 10;
    unit.supplyStock = 0;
    unit.state = 'hold';

    for (let i = 0; i < 180; i += 1) {
      nowRef.value += 1000 / 60;
      derive.update(1000 / 60);
    }
    expect((unit.supplyEdges ?? []).map((edge) => edge.cityId)).toContain(city.id);

    // 这座城被敌方夺走 → 下一次分配不应再指向它
    city.faction = 'red';
    for (let i = 0; i < 180; i += 1) {
      nowRef.value += 1000 / 60;
      derive.update(1000 / 60);
    }
    expect((unit.supplyEdges ?? []).map((edge) => edge.cityId)).not.toContain(city.id);
  });

  it('折线条数不同不再判成完全不一致（mismatch 不会因此变 1）', () => {
    const size = { width: 1280, height: 800 };
    const one = resamplePaths([[[100, 100], [1100, 700]]]);
    const two = resamplePaths([[[100, 100], [600, 400]], [[600, 400], [1100, 700]]]);
    const mismatch = comparePaths(one, two, size);
    expect(mismatch).toBeLessThan(0.25);
  });
});
