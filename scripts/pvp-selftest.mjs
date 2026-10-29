#!/usr/bin/env node
import { performance } from 'node:perf_hooks';
import { MatchSim, STEP_MS, warmupEngine } from '../server/src/match.js';
import { loadPvpLevel, PVP_LEVELS } from '../server/src/levels.js';
import { attackMoveCommand } from '../src/simulation/commands.js';

// PvP 无头自检（P2 验收工具，没有 UI 也能验证权威对局）：
//   node scripts/pvp-selftest.mjs                 # 默认：渡江 1v1，打 180 秒或到胜负
//   node scripts/pvp-selftest.mjs --level pingjin_pvp --seconds 300
//   node scripts/pvp-selftest.mjs --verify        # 同一脚本跑两遍，逐 tick 比对快照哈希（确定性）
//   node scripts/pvp-selftest.mjs --no-prep       # 跳过 5 秒准备阶段
//
// 它做的事：在 Node 里用**和浏览器完全相同的引擎**跑一局 1v1，
// 双方各自 attackMove 去打对方最近的城市，然后打印 tick 成本、快照体积、事件与结算。
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (argv[index + 1]?.startsWith('--') ? true : argv[index + 1]);
};
const has = (name) => argv.includes(`--${name}`);

const levelId = String(flag('level', 'dujiang_pvp'));
const seconds = Number(flag('seconds', 180));
const verify = has('verify');
const noPrep = has('no-prep');

if (!PVP_LEVELS.includes(levelId)) {
  console.error(`未知关卡 ${levelId}，可选：${PVP_LEVELS.join(' / ')}`);
  process.exit(1);
}

function enemyNearestCity(match, faction) {
  const enemy = faction === 'blue' ? 'red' : 'blue';
  const ownUnits = match.world.units.filter((unit) => unit.faction === faction && unit.state !== 'dead');
  const anchor = ownUnits[0] ?? { x: 640, y: 400 };
  const cities = match.world.cities.filter((city) => city.faction === enemy);
  if (!cities.length) return { x: 640, y: 400 };
  return cities.reduce((best, city) => (
    Math.hypot(city.x - anchor.x, city.y - anchor.y) < Math.hypot(best.x - anchor.x, best.y - anchor.y) ? city : best
  ), cities[0]);
}

function issueOpeningOrders(match) {
  for (const faction of ['blue', 'red']) {
    const ids = match.world.units
      .filter((unit) => unit.faction === faction && unit.state !== 'dead')
      .map((unit) => unit.id);
    const target = enemyNearestCity(match, faction);
    const result = match.queueCommand(faction, { unitIds: ids, command: attackMoveCommand({ x: target.x, y: target.y }) });
    if (!result.ok) console.error(`[warn] ${faction} 开局命令被拒：${result.code}`);
  }
}

function hashOf(snapshot) {
  const payload = JSON.stringify({
    tick: snapshot.tick,
    units: snapshot.units.map((unit) => [unit.id, unit.faction, unit.x, unit.y, unit.hp, unit.state]),
    cities: snapshot.cities.map((city) => [city.id, city.faction, city.captureProgress]),
  });
  let hash = 2166136261;
  for (let i = 0; i < payload.length; i += 1) {
    hash ^= payload.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function runOnce({ collectHashes = false } = {}) {
  const { level, map } = loadPvpLevel(levelId);
  const match = new MatchSim({ level, map, prepMs: noPrep ? 0 : undefined });
  match.start(0);
  // 无头环境没有真实时钟：直接让"准备阶段"走完（noPrep 则立刻开打）
  if (noPrep) match.startPlaying();
  else match.update(5000);
  issueOpeningOrders(match);

  const ticks = Math.round(seconds / (STEP_MS / 1000));
  const hashes = [];
  const beganAt = performance.now();
  for (let i = 0; i < ticks && match.phase === 'playing'; i += 1) {
    match.step(1);
    if (collectHashes) hashes.push(hashOf(match.snapshotFor('blue')));
  }
  const wallMs = performance.now() - beganAt;

  const blueSnapshot = match.snapshotFor('blue');
  const redSnapshot = match.snapshotFor('red');
  return {
    match,
    wallMs,
    ticks: match.ticks,
    hashes,
    snapshotBytes: {
      blue: Buffer.byteLength(JSON.stringify(blueSnapshot)),
      red: Buffer.byteLength(JSON.stringify(redSnapshot)),
    },
    blueSnapshot,
    redSnapshot,
  };
}

function report(result) {
  const { match } = result;
  const alive = match.unitCounts();
  const redTotal = match.world.units.filter((unit) => unit.faction === 'red').length;
  const blueTotal = match.world.units.filter((unit) => unit.faction === 'blue').length;
  const visibleRed = result.blueSnapshot.units.filter((unit) => unit.faction === 'red').length;
  const visibleBlue = result.redSnapshot.units.filter((unit) => unit.faction === 'blue').length;

  console.log('');
  console.log(`关卡          ${match.levelId}（${match.level.name}）`);
  console.log(`阶段/推进     ${match.phase} · ${match.ticks} tick ≈ ${(match.ticks * STEP_MS / 1000).toFixed(1)}s 模拟时间 · 真实耗时 ${(result.wallMs / 1000).toFixed(2)}s`);
  console.log(`tick 成本     平均 ${(match.stats.tickMsTotal / Math.max(1, match.ticks)).toFixed(3)} ms · 最大 ${match.stats.tickMsMax.toFixed(2)} ms`);
  console.log(`兵力          开局 blue=${blueTotal} red=${redTotal} · 存活 blue=${alive.blue ?? 0} red=${alive.red ?? 0}`);
  console.log(`城市          blue=${match.cityCount('blue')} red=${match.cityCount('red')}`);
  console.log(`快照体积      blue ${(result.snapshotBytes.blue / 1024).toFixed(2)} KB · red ${(result.snapshotBytes.red / 1024).toFixed(2)} KB`);
  console.log(`视野过滤      blue 只看到 ${visibleRed}/${redTotal} 个红军 · red 只看到 ${visibleBlue}/${blueTotal} 个蓝军`);
  console.log(`事件          累计 ${match.events.length} 条（最近：${match.events.slice(-3).map((event) => event.type).join(', ') || '无'}）`);
  if (match.result) {
    console.log(`结算          winner=${match.result.winner} reason=${match.result.reason} at=${(match.result.atMs / 1000).toFixed(1)}s`);
    console.log(`              伤亡 blue=${match.result.casualties.blue} red=${match.result.casualties.red} · 城市 blue=${match.result.cities.blue} red=${match.result.cities.red}`);
  } else {
    console.log(`结算          未结束（到达 ${seconds}s 上限）—— 加大 --seconds 或检查是否在交战`);
  }
  console.log('');
}

console.log(`PvP 自检：${levelId} · ${seconds}s 模拟${noPrep ? ' · 跳过准备' : ''}${verify ? ' · 开启确定性校验' : ''}`);

// 先预热（P3 建局也会这么做）：冷启动的首帧 tick 会有几十毫秒尖峰
const warm = warmupEngine({ ...loadPvpLevel(levelId), ticks: 60 });
console.log(`预热          60 tick · 最大 ${warm.stats.tickMsMax.toFixed(2)} ms（正式对局不计入）`);

const first = runOnce({ collectHashes: verify });
report(first);

if (verify) {
  const second = runOnce({ collectHashes: true });
  const identical = second.hashes.length === first.hashes.length
    && second.hashes.every((hash, index) => hash === first.hashes[index]);
  console.log(identical
    ? `确定性        ✅ 两次重放的 ${first.hashes.length} 个 tick 快照哈希完全一致`
    : `确定性        ❌ 两次重放出现差异（第一次 ${first.hashes.length} tick，第二次 ${second.hashes.length} tick）`);
  process.exit(identical ? 0 : 2);
}
