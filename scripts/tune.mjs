#!/usr/bin/env node
// 离线调参基建（docs/ai-design.md 阶段六 / §3.9）：headless 批量对局 + 粗网格参数扫描。
//
// 做什么：
//   1. 用固定步长跑若干个**确定性**场景（敌我双方都是 ScriptedAI，无渲染、无 Phaser）；
//   2. 逐参数做一次 OAT 扫描（一次只改一个值），再对影响力最大的两个参数做二维粗网格；
//   3. 打印指标表 + 输出 JSON，并在末尾给出"值不值得改"的建议（**不自动改源码**）。
//
// 怎么读结果（重要）：
//   · fitness 是**启发式**的（各场景归一化指标加权），只用来排序，不要当成"真理"；
//   · 所以表里同时给出原始指标（交换比 / 断补率 / 任务数 / 耗时），并且：
//       - 我方断补率 > 5% 或我方全灭 → 该次运行标 `warn`，不参与推荐；
//       - 只有"与现值相比提升 ≥ 2%"且单调的取值才会进 recommendations，否则写"保持现值"。
//   · 想真正改 values.js：跑完看建议，人工改 + 同步 docs/gdd.md §12 与镜像测试。
//
// 用法：
//   npm run tune                              # 默认：3 个场景 × 180 s × OAT + 二维网格
//   node scripts/tune.mjs --seconds=90         # 短局快跑（结论更粗）
//   node scripts/tune.mjs --mode=oat           # 只做单参数扫描
//   node scripts/tune.mjs --scenarios=interdict,siege
//   node scripts/tune.mjs --out=test-results/tune.json

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
import { values } from '../src/config/index.js';
// 复用单测的造图/造世界工具（避免第二套地图构造；这个脚本不进构建产物，也不进测试套件）
import { makePlainMap, makeWorld } from '../tests/unit/helpers.js';
import { ScriptedAI } from '../src/simulation/ai.js';

const STEP = values.simulation.fixedStep;

// ── 命令行 ───────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { mode: 'both', seconds: 180, scenarios: null, out: null, quiet: false, top: 5 };
  for (const raw of argv.slice(2)) {
    const [key, value] = raw.replace(/^--/, '').split('=');
    if (key === 'mode') args.mode = value;
    else if (key === 'seconds') args.seconds = Number(value);
    else if (key === 'scenarios') args.scenarios = value.split(',').map(s => s.trim()).filter(Boolean);
    else if (key === 'out') args.out = value;
    else if (key === 'top') args.top = Number(value);
    else if (key === 'quiet') args.quiet = true;
  }
  return args;
}

// ── 场景 ─────────────────────────────────────────────────────────────────────
// 每个场景：造世界 → 布阵 → 双方都是 ScriptedAI → 跑固定秒数 → 采样指标。
// 指标口径：断补率 = 每秒采样的"supplied === false"占存活单位·采样的比例。

function compactMap(extraCities = []) {
  return makePlainMap({
    width: 1800,
    height: 800,
    cities: [
      { id: 'c1', x: 150, y: 400, faction: 'blue' },
      ...extraCities,
      { id: 'c2', x: 1650, y: 400, faction: 'red' },
    ],
    spawns: [{ faction: 'blue', x: 150, y: 400 }, { faction: 'red', x: 1650, y: 400 }],
  });
}

function squad(world, xs, y = 400, group = 'main', faction = 'blue') {
  return xs.map((x, i) => {
    const unit = world.spawnUnit(faction, 'light', x, y + (i % 2) * 40);
    unit.group = group;
    return unit;
  });
}

// 在指定坐标上排一队（编队标签写进 unit.group，脚本动作按 group 选人）
function place(world, faction, group, points, type = 'light') {
  return points.map(([x, y]) => {
    const unit = world.spawnUnit(faction, type, x, y);
    unit.group = group;
    return unit;
  });
}

// 蓝方的脚本：一个 engage 意图（目标点 + 编队），其余交给战术层 —— 与关卡里的写法一致
function engageScript(objective, tuning) {
  return {
    rules: [{ when: { time: 0 }, then: [{ type: 'engage', target: objective, units: { group: 'main' } }] }],
    preset: 'standard',
    tuning,
  };
}

// 交换比打分：敌方掉血 ÷ 我方掉血，3:1 记满分。
// 为什么要有它：只看"敌掉血比例"会奖励"拿命换命"甚至"自杀式换家"，
// 所以每个场景的 fitness 都用它打底，再叠加各自的专属项（断补率 / 守城 / 撤退去向）。
const EXCHANGE_FULL = 3;
function exchangeScoreOf(redLoss, blueLoss) {
  if (blueLoss <= 1e-6) return redLoss > 1e-6 ? 1 : 0;
  return Math.min(1, redLoss / blueLoss / EXCHANGE_FULL);
}

const SCENARIOS = {
  // ① 断粮：红方有一条够长的补给走廊，蓝方有 50% 预备队可以派出去压它
  interdict: {
    label: '断粮（走廊可压）',
    build() {
      const world = makeWorld(compactMap());
      const blues = place(world, 'blue', 'main', [[500, 380], [540, 420], [580, 380], [620, 420]]);
      const reds = place(world, 'red', 'red', [[1000, 340], [1000, 460]]);
      const holders = place(world, 'red', 'red', [[1300, 360], [1300, 440]]);
      return { world, blues, reds: [...reds, ...holders] };
    },
    blue: engageScript({ x: 1500, y: 400 }, { reserveRatio: 0.5 }),
    red: { rules: [{ when: { time: 0 }, then: [{ type: 'hold', units: { group: 'red' } }] }] },
    // 交换比打底 + 保留战力 + 敌断补率 + 敌掉血
    fitness: (m) => 0.4 * m.exchangeScore + 0.3 * (1 - m.blueLossRatio) + 0.2 * m.redCutRate + 0.1 * m.redLossRatio,
  },
  // ② 解围：蓝城被围（守军残血），红方有一座近城所以围城部队自己吃得上饭
  siege: {
    label: '解围（己城被围）',
    build() {
      const world = makeWorld(compactMap([{ id: 'c3', x: 480, y: 130, faction: 'red' }]));
      const garrison = world.spawnUnit('blue', 'light', 150, 400);
      garrison.hp = 40;
      const blues = place(world, 'blue', 'main', [[420, 380], [460, 420], [500, 380], [540, 420], [580, 380], [620, 420]]);
      const besiegers = place(world, 'red', 'red', [[150, 425], [150, 375]], 'heavy');
      const holders = place(world, 'red', 'red', [[1300, 360], [1300, 440]]);
      return { world, blues, reds: [...besiegers, ...holders], cities: ['c1'] };
    },
    blue: engageScript({ x: 1500, y: 400 }, { reserveRatio: 0.5 }),
    red: { rules: [{ when: { time: 0 }, then: [{ type: 'hold', units: { group: 'red' } }] }] },
    fitness: (m) => 0.4 * (m.citiesHeld ? 1 : 0) + 0.25 * m.exchangeScore
      + 0.2 * (1 - m.blueLossRatio) + 0.15 * m.redLossRatio,
  },
  // ③ 撤退选城：小队缺补要回城，最近的那座己城正被围 —— 该不该去？
  //    （阶段五实测里"解围"很难造出可测差异，但"撤退避开被围的城"是每天在用的那一条）
  retreat: {
    label: '撤退选城（避围城）',
    build() {
      const world = makeWorld(makePlainMap({
        width: 1800,
        height: 800,
        cities: [
          { id: 'c1', x: 300, y: 400, faction: 'blue' },   // 被围：代价最低（≈320），但去了挨打
          { id: 'c3', x: 1000, y: 750, faction: 'blue' },  // 安全：绕远（≈590）
          { id: 'c2', x: 1650, y: 400, faction: 'red' },
        ],
        spawns: [{ faction: 'blue', x: 300, y: 400 }, { faction: 'red', x: 1650, y: 400 }],
      }));
      const blues = place(world, 'blue', 'main', [[560, 280], [600, 320], [640, 280], [680, 320]]);
      for (const unit of blues) unit.supplyStock = unit.maxSupplyStock * 0.15; // 触发回城休整
      // 围城部队待在城的**另一侧**（西边）：既不堵住我们回城的路，也不触发占领，
      // 于是"撤退要不要去那座城"完全由被围罚分决定（否则补给代价场自己就会绕开）
      const besiegers = place(world, 'red', 'red', [[240, 400], [240, 360]]);
      return { world, blues, reds: besiegers };
    },
    blue: engageScript({ x: 1500, y: 400 }, { reserveRatio: 0.5 }),
    red: { rules: [{ when: { time: 0 }, then: [{ type: 'hold', units: { group: 'red' } }] }] },
    // 唯一指标：小队最终靠向的那座城，是不是避开了被围的那座
    fitness: (m) => (m.retreatSafe ? 1 : 0),
  },
  // ④ 开阔地正面对撞：红方缩在城边（走廊太短，断不了）→ 检查改动没有把正面打坏
  open: {
    label: '正面（无可断走廊）',
    build() {
      const world = makeWorld(compactMap());
      const blues = place(world, 'blue', 'main', [[500, 380], [540, 420], [580, 380], [620, 420]]);
      const reds = place(world, 'red', 'red', [[900, 380], [940, 420], [980, 380], [1020, 420]]);
      return { world, blues, reds };
    },
    blue: engageScript({ x: 1200, y: 400 }, { reserveRatio: 0.5 }),
    red: { rules: [{ when: { time: 0 }, then: [{ type: 'hold', units: { group: 'red' } }] }] },
    fitness: (m) => 0.5 * m.exchangeScore + 0.3 * (1 - m.blueLossRatio) + 0.2 * m.redLossRatio,
  },
};

// 指标用的"被围"半径：固定 200px，故意不跟 relief.threatRadius 联动
// （否则扫 threatRadius 时会同时改"判定"和"评价标准"，变成自己给自己打分）
const THREAT_METRIC_RADIUS = 200;

function cityUnderThreat(world, city) {
  return world.units.some(unit => unit.state !== 'dead' && unit.faction !== city.faction
    && Math.hypot(unit.x - city.x, unit.y - city.y) <= THREAT_METRIC_RADIUS);
}

// 记录 AI 领到过哪些任务（去重后的签名）+ 撤退选城的实际去向，
// 用来验证参数确实改变了行为（而不是只看结果指标）。
// 注意：被围与否要在**决策当时**记下来——等到跑完再看，围城的敌人早被打死了。
class TuningAI extends ScriptedAI {
  constructor(...args) {
    super(...args);
    this.missionLabels = new Set();
    this.retreatPicks = [];
  }

  reserveMission(...args) {
    const mission = super.reserveMission(...args);
    if (mission) this.missionLabels.add(mission.label);
    return mission;
  }

  retreatCity(point) {
    const city = super.retreatCity(point);
    if (city) {
      this.retreatPicks.push({ id: city.id, threatened: cityUnderThreat(this.world, city) });
    }
    return city;
  }
}

function hpOf(units) {
  return units.reduce((sum, unit) => (unit.state === 'dead' ? sum : sum + unit.hp), 0);
}

function runCase(scenario, tuning, seconds) {
  const { world, blues, reds, cities = [] } = scenario.build();
  const blueHp0 = hpOf(blues);
  const redHp0 = hpOf(reds);
  const cityState = cities.map(id => ({ id, held: true }));
  const blueAi = new TuningAI(world, {
    faction: 'blue',
    script: { ...scenario.blue, tuning: { ...scenario.blue.tuning, ...tuning } },
  });
  const redAi = new ScriptedAI(world, { faction: 'red', script: scenario.red });

  const cut = { blue: 0, blueTotal: 0, red: 0, redTotal: 0 };
  let nextSample = 0;
  const started = performance.now();
  while (world.time < seconds && !world.winner) {
    world.tick(STEP);
    blueAi.update(STEP);
    redAi.update(STEP);
    if (world.time >= nextSample) {
      nextSample += 1;
      for (const unit of blues) {
        if (unit.state === 'dead') continue;
        cut.blueTotal += 1;
        if (!unit.supplied) cut.blue += 1;
      }
      for (const unit of reds) {
        if (unit.state === 'dead') continue;
        cut.redTotal += 1;
        if (!unit.supplied) cut.red += 1;
      }
      for (const entry of cityState) {
        if (world.cities.find(city => city.id === entry.id)?.faction !== 'blue') entry.held = false;
      }
    }
  }
  const elapsedMs = performance.now() - started;

  // 撤退去向：取 AI 第一次真正选定的那座城，以及**当时**它是否被围
  const firstPick = blueAi.retreatPicks[0] ?? null;
  const retreatCityId = firstPick?.id ?? null;

  const blueLost = blueHp0 - hpOf(blues);
  const redLost = redHp0 - hpOf(reds);
  const metrics = {
    blueLossRatio: blueLost / Math.max(1, blueHp0),
    redLossRatio: redLost / Math.max(1, redHp0),
    // 交换比（敌方掉血 ÷ 我方掉血）与它的归一化打分：3:1 记满分
    exchangeRatio: blueLost <= 1e-6 ? (redLost > 1e-6 ? null : 0) : redLost / blueLost,
    exchangeScore: exchangeScoreOf(redLost, blueLost),
    blueCutRate: cut.blue / Math.max(1, cut.blueTotal),
    redCutRate: cut.red / Math.max(1, cut.redTotal),
    blueAlive: blues.filter(unit => unit.state !== 'dead').length,
    redAlive: reds.filter(unit => unit.state !== 'dead').length,
    citiesHeld: cityState.every(entry => entry.held),
    citiesLost: cityState.filter(entry => !entry.held).map(entry => entry.id),
    retreatCity: retreatCityId,
    retreatSafe: firstPick ? !firstPick.threatened : true,
    retreatPicks: blueAi.retreatPicks,
    interdictMissions: [...blueAi.missionLabels].filter(label => label.startsWith('interdict:')).length,
    reliefMissions: [...blueAi.missionLabels].filter(label => label.startsWith('relief:')).length,
    winner: world.winner ?? null,
    elapsedMs: Math.round(elapsedMs),
  };
  const warnings = [];
  if (metrics.blueCutRate > 0.05) warnings.push('blue-starved');
  if (metrics.blueAlive === 0) warnings.push('blue-wiped');
  return { metrics, fitness: scenario.fitness(metrics), warnings };
}

// ── 扫描表 ───────────────────────────────────────────────────────────────────
// OAT：一次只改一个参数（其余取 values.ai 现值）。区间按"现值附近 + 关闭档"取粗网格。
const OAT = [
  { path: 'weights.interdiction', values: [0, 0.1, 0.2, 0.35, 0.6] },
  { path: 'interdiction.minCuts', values: [1, 2, 3, 4] },
  { path: 'interdiction.maxDistance', values: [500, 700, 900, 1200] },
  { path: 'interdiction.minDistance', values: [0, 160, 300] },
  { path: 'interdiction.cutRadius', values: [100, 140, 180] },
  { path: 'interdiction.minCorridor', values: [120, 240, 400] },
  { path: 'supply.lowRatio', values: [0.2, 0.3, 0.4] },
  { path: 'supply.squadCutFraction', values: [0.3, 0.5, 0.7] },
  { path: 'relief.threatRadius', values: [120, 200, 300] },
  { path: 'relief.forceRatio', values: [0.3, 0.5, 0.8] },
  { path: 'relief.maxDistance', values: [600, 1200, 1800] },
  { path: 'relief.retreatThreatPenalty', values: [0, 400, 900] },
];

// 二维网格：影响力最大的两个参数（权重 × 门槛）
const GRID = {
  x: { path: 'weights.interdiction', values: [0, 0.2, 0.4, 0.7] },
  y: { path: 'interdiction.minCuts', values: [1, 2, 3] },
};

function tuningFor(path, value) {
  const [group, key] = path.split('.');
  return { [group]: { [key]: value } };
}

function currentValue(path) {
  const [group, key] = path.split('.');
  return values.ai[group][key];
}

function evaluate(scenarios, tuning, seconds) {
  const perScenario = {};
  let fitness = 0;
  let warnings = [];
  let elapsed = 0;
  for (const scenario of scenarios) {
    const result = runCase(scenario, tuning, seconds);
    perScenario[scenario.name] = result;
    fitness += result.fitness;
    warnings = warnings.concat(result.warnings.map(w => `${scenario.name}:${w}`));
    elapsed += result.metrics.elapsedMs;
  }
  return { fitness: fitness / scenarios.length, perScenario, warnings, elapsedMs: elapsed };
}

const fmt = (value, digits = 3) => Number(value).toFixed(digits);
const pct = (value) => `${(value * 100).toFixed(1)}%`;

function printScenarioHeader(scenarios) {
  console.log(`\n场景（各 ${args.seconds}s，固定步长 ${STEP.toFixed(4)}s，确定性）：`);
  for (const scenario of scenarios) console.log(`  · ${scenario.name.padEnd(10)} ${scenario.label}`);
}

function printRow(label, result) {
  const m = (name) => result.perScenario[name]?.metrics;
  const cells = scenarios.map(scenario => {
    const metrics = m(scenario.name);
    if (!metrics) return '—'.padEnd(30);
    // 撤退场景额外显示"退向哪座城 + 那座城安不安全"，其余显示断补率 + 交换比
    const tail = scenario.name === 'retreat'
      ? `→${metrics.retreatCity ?? '无'}/${metrics.retreatSafe ? '安全' : '被围'}`
      : `${pct(metrics.redCutRate)} x${metrics.exchangeRatio === null ? '∞' : fmt(metrics.exchangeRatio, 1)}`;
    return `${fmt(metrics.redLossRatio)}/${fmt(metrics.blueLossRatio)}/${tail}`.padEnd(30);
  });
  console.log(
    `  ${label.padEnd(34)}${fmt(result.fitness)}   ${cells.join('')}${result.elapsedMs}ms`
    + `${result.warnings.length ? `  ⚠ ${result.warnings.join(',')}` : ''}`,
  );
}

// ── 主流程 ───────────────────────────────────────────────────────────────────
const args = parseArgs(process.argv);
const scenarios = Object.entries(SCENARIOS)
  .filter(([name]) => !args.scenarios || args.scenarios.includes(name))
  .map(([name, spec]) => ({ name, ...spec }));
if (scenarios.length === 0) {
  console.error('没有匹配的场景；可选：' + Object.keys(SCENARIOS).join(', '));
  process.exit(1);
}

console.log('离线调参（docs/ai-design.md §3.9）—— headless 批量对局 + 粗网格扫描');
printScenarioHeader(scenarios);
console.log('\n每格 = 敌掉血比例 / 我掉血比例 / 敌断补率 + 交换比（撤退场景显示撤退去向）\n');
console.log(`  ${'参数'.padEnd(32)}fitness  ${scenarios.map(s => s.name.padEnd(30)).join('')}耗时`);

const baseline = evaluate(scenarios, {}, args.seconds);
printRow('现值（baseline）', baseline);

const report = { generatedAt: new Date().toISOString(), seconds: args.seconds, baseline: {}, oat: [], grid: [], recommendations: [] };
report.baseline = {
  fitness: baseline.fitness,
  perScenario: Object.fromEntries(Object.entries(baseline.perScenario)
    .map(([name, r]) => [name, r.metrics])),
};

// ① OAT
if (args.mode === 'oat' || args.mode === 'both') {
  console.log('\n── 单参数扫描（OAT：一次只改一个值）');
  for (const param of OAT) {
    const current = currentValue(param.path);
    const rows = [];
    for (const value of param.values) {
      const result = value === current ? baseline : evaluate(scenarios, tuningFor(param.path, value), args.seconds);
      rows.push({ value, result });
      printRow(`${param.path} = ${value}${value === current ? ' *' : ''}`, result);
    }
    const currentRow = rows.find(row => row.value === current) ?? { result: baseline };
    const valid = rows.filter(row => row.result.warnings.length === 0);
    const best = valid.reduce((a, b) => (b.result.fitness > a.result.fitness ? b : a), currentRow);
    const gain = (best.result.fitness - currentRow.result.fitness) / Math.max(1e-9, Math.abs(currentRow.result.fitness));
    report.oat.push({
      path: param.path,
      current,
      rows: rows.map(row => ({
        value: row.value,
        fitness: row.result.fitness,
        warnings: row.result.warnings,
        metrics: Object.fromEntries(Object.entries(row.result.perScenario).map(([name, r]) => [name, r.metrics])),
      })),
      best: best.value,
      gain,
    });
    console.log(`  → ${param.path}：现值 ${current}（fitness ${fmt(currentRow.result.fitness)}）`
      + `，扫描最优 ${best.value}（fitness ${fmt(best.result.fitness)}，${gain >= 0 ? '+' : ''}${(gain * 100).toFixed(1)}%）`
      + `${valid.length < rows.length ? `（${rows.length - valid.length} 个取值有告警，已排除）` : ''}\n`);
  }
}

// ② 二维粗网格
if (args.mode === 'grid' || args.mode === 'both') {
  console.log('\n── 二维粗网格：' + `${GRID.x.path} × ${GRID.y.path}`);
  const gridRows = [];
  for (const y of GRID.y.values) {
    const cells = [];
    for (const x of GRID.x.values) {
      const tuning = { ...tuningFor(GRID.x.path, x), ...tuningFor(GRID.y.path, y) };
      const result = evaluate(scenarios, tuning, args.seconds);
      gridRows.push({ x, y, result });
      cells.push(`${fmt(result.fitness)}${result.warnings.length ? '⚠' : ' '}`);
    }
    console.log(`  ${GRID.y.path}=${String(y).padEnd(4)}  ${GRID.x.values.map((x, i) => `${String(x).padStart(5)}: ${cells[i]}`).join('  ')}`);
  }
  const valid = gridRows.filter(row => row.result.warnings.length === 0);
  const ranked = [...valid].sort((a, b) => b.result.fitness - a.result.fitness);
  const currentTuning = {
    ...tuningFor(GRID.x.path, currentValue(GRID.x.path)),
    ...tuningFor(GRID.y.path, currentValue(GRID.y.path)),
  };
  report.grid = {
    x: GRID.x.path, y: GRID.y.path,
    current: currentValue(GRID.x.path) + ' / ' + currentValue(GRID.y.path),
    rows: ranked.map(row => ({
      x: row.x, y: row.y, fitness: row.result.fitness,
      warnings: row.result.warnings,
      metrics: Object.fromEntries(Object.entries(row.result.perScenario).map(([name, r]) => [name, r.metrics])),
    })),
  };
  report.grid.currentTuning = currentTuning;
  console.log(`\n  最优 ${args.top} 组：`);
  for (const row of ranked.slice(0, args.top)) {
    console.log(`    ${GRID.x.path}=${String(row.x).padEnd(5)} ${GRID.y.path}=${String(row.y).padEnd(3)} fitness ${fmt(row.result.fitness)}`
      + `  敌掉血 ${scenarios.map(s => fmt(row.result.perScenario[s.name].metrics.redLossRatio, 2)).join('/')}`
      + `  我掉血 ${scenarios.map(s => fmt(row.result.perScenario[s.name].metrics.blueLossRatio, 2)).join('/')}`);
  }
}

// ③ 建议
console.log('\n── 建议（不自动改源码；改动要同步 docs/gdd.md §12 与镜像测试）');
for (const entry of report.oat) {
  const significant = entry.gain >= 0.02 && entry.best !== entry.current;
  const recommendation = significant
    ? `建议 ${entry.path}: ${entry.current} → ${entry.best}（+${(entry.gain * 100).toFixed(1)}%）`
    : `保持 ${entry.path} = ${entry.current}（扫描最优 ${entry.best}，提升 ${(entry.gain * 100).toFixed(1)}% < 2% 阈值）`;
  report.recommendations.push({ path: entry.path, current: entry.current, best: entry.best, gain: entry.gain, recommendation });
  console.log(`  · ${recommendation}`);
}

const out = args.out ?? `test-results/tune-${Date.now()}.json`;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(report, null, 2));
console.log(`\nJSON 已写入 ${out}`);
