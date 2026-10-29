import { describe, expect, it } from 'vitest';
import { World } from '../../src/simulation/world.js';
import { deployForces, parseLevel } from '../../src/simulation/level.js';
import { updateFog } from '../../src/simulation/systems/fog.js';
import { MatchSim } from '../../server/src/match.js';
import { loadPvpLevel } from '../../server/src/levels.js';

// P4/P5 关注点：**双方看到的迷雾是不是同一片？**
//   · 迷雾 = 己方单位视野圆 ∪ 己方城市视野圆 ∪ 己方占领点视野圆（src/simulation/systems/fog.js）
//     因此**双方看到的可见区域必然不同**（除非两军位置完全重合）。
//   · 客户端不跑模拟，但它的迷雾是用"自己那份快照"里的己方单位/城市/占领点本地算的 ——
//     本文件验证：这样算出来的网格与服务端同一阵营的网格一致（误差只可能来自快照里坐标的 0.1 舍入）。
function clientMirror(snapshot) {
  const { level, map } = loadPvpLevel(snapshot.levelId ?? 'dujiang_pvp');
  const world = new World(map);
  deployForces(world, level.forces, level.anchors ?? {});
  for (const unit of snapshot.units) {
    const local = world.units.find((item) => item.id === unit.id);
    if (!local) continue;
    local.x = unit.x; local.y = unit.y;
    local.faction = unit.faction;
    local.state = unit.state;
  }
  for (const city of snapshot.cities) {
    const local = world.cities.find((item) => item.id === city.id);
    if (local) local.faction = city.faction;
  }
  for (const point of snapshot.points) {
    const local = world.capturePoints.find((item) => item.id === point.id);
    if (local) local.faction = point.faction;
  }
  updateFog(world);
  return world;
}

function fogStats(grid) {
  let visible = 0;
  let explored = 0;
  for (const value of grid) {
    if (value === 2) visible += 1;
    else if (value === 1) explored += 1;
  }
  return { visible, explored, cells: grid.length };
}

function makeMatch(levelId = 'dujiang_pvp', ticks = 60) {
  const { level, map } = loadPvpLevel(levelId);
  const match = new MatchSim({ level, map, prepMs: 0 });
  match.start(0);
  match.startPlaying();
  match.step(ticks);
  return match;
}

describe('PvP 迷雾：双方看到的是不同的区域', () => {
  it('同一时刻，蓝方与红方的可见区域互不相同（迷雾是按阵营算的）', () => {
    const match = makeMatch();
    const blue = match.world.fog.blue;
    const red = match.world.fog.red;

    let bothVisible = 0;
    let blueOnly = 0;
    let redOnly = 0;
    for (let i = 0; i < blue.length; i += 1) {
      if (blue[i] === 2 && red[i] === 2) bothVisible += 1;
      else if (blue[i] === 2) blueOnly += 1;
      else if (red[i] === 2) redOnly += 1;
    }

    // 各自都有自己的"看得见而对方看不见"的区域
    expect(blueOnly).toBeGreaterThan(100);
    expect(redOnly).toBeGreaterThan(100);
    // 完全相同是错误（说明迷雾没按阵营分开）
    expect(blue).not.toEqual(red);

    const blueStats = fogStats(blue);
    const redStats = fogStats(red);
    expect(blueStats.visible).toBeGreaterThan(1000);
    expect(redStats.visible).toBeGreaterThan(1000);
  });

  it('两边的快照也不同：各自只包含自己可见的敌军', () => {
    const match = makeMatch();
    const blueSnapshot = match.snapshotFor('blue');
    const redSnapshot = match.snapshotFor('red');

    const blueSeesRed = blueSnapshot.units.filter((unit) => unit.faction === 'red').length;
    const redSeesBlue = redSnapshot.units.filter((unit) => unit.faction === 'blue').length;
    const redTotal = match.world.units.filter((unit) => unit.faction === 'red').length;

    expect(blueSeesRed).toBeLessThan(redTotal);   // 蓝方看不到全部红军
    expect(redSeesBlue).toBeLessThan(redTotal);   // 红方也看不到全部蓝军
    expect(blueSnapshot.units.length).not.toBe(redSnapshot.units.length);
  });
});

describe('PvP 迷雾：客户端本地算的结果与服务端一致', () => {
  it.each(['blue', 'red'])('用 %s 的快照重建客户端镜像后，己方迷雾网格与服务端逐格一致', (faction) => {
    const match = makeMatch('dujiang_pvp', 120);
    const snapshot = match.snapshotFor(faction);
    snapshot.levelId = match.levelId;
    const mirror = clientMirror(snapshot);

    const serverGrid = match.world.fog[faction];
    const clientGrid = mirror.fog[faction];

    let identical = 0;
    let visibleDiff = 0;
    for (let i = 0; i < serverGrid.length; i += 1) {
      if (serverGrid[i] === clientGrid[i]) identical += 1;
      if ((serverGrid[i] === 2) !== (clientGrid[i] === 2)) visibleDiff += 1;
    }
    const ratio = identical / serverGrid.length;
    // 快照坐标保留 1 位小数，理论误差极小；这里要求 99% 以上逐格相同
    expect(ratio).toBeGreaterThan(0.99);
    // "可见/不可见"的判定差异必须非常少（影响的是"能不能看见敌人"）
    expect(visibleDiff / serverGrid.length).toBeLessThan(0.005);
  });
});
