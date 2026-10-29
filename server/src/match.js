import { performance } from 'node:perf_hooks';
import { values } from '../../src/config/index.js';
import { World } from '../../src/simulation/world.js';
import { buildMission, deployForces, parseLevel } from '../../src/simulation/level.js';
import { validateCommand } from '../../src/simulation/commands.js';
import { buildSnapshot } from './snapshot.js';

// 权威对局（P2）。
// 复用 src/simulation 的完整引擎（movement → combat → supply → supplyStock → capture → fog →
// controlLine → victory），服务器是唯一推进模拟的地方；客户端只发命令、收快照（P4）。
//
// 时间模型：
//   · 固定步长 1/60 s（values.simulation.fixedStep），tick 数才是"权威时间"
//   · update(now) 用单调时钟累加补步，单次最多补 5 步（和客户端一致），掉太多就丢积压
//   · 对战时长判定也按模拟时间（ticks），不受服务器卡顿影响
//
// 阶段：
//   prep（复用 values.prep.seconds，期间可下预备命令，模拟不推进）
//     → playing（60Hz 推进）→ finished（结算，只发生一次）
export const MATCH_PHASES = ['prep', 'playing', 'finished'];
const STEP_SECONDS = values.simulation.fixedStep;
export const STEP_MS = STEP_SECONDS * 1000;
const MAX_CATCH_UP_STEPS = 5;
const MAX_FRAME_MS = 1000;
const COMMANDS_PER_SECOND = 20;
const MAX_STORED_EVENTS = 200;

const summarizeEvent = (event) => {
  if (!event || typeof event !== 'object') return null;
  const copy = {};
  for (const key of ['type', 'at', 'winner', 'cityId', 'from', 'to', 'unitId', 'faction', 'cause']) {
    if (event[key] !== undefined) copy[key] = event[key];
  }
  if (Number.isFinite(event.x)) copy.x = Math.round(event.x);
  if (Number.isFinite(event.y)) copy.y = Math.round(event.y);
  return copy;
};

export class MatchSim {
  constructor({ level, map, levelId = level?.id ?? 'pvp', timeLimitMs = 600_000, prepMs = values.prep.seconds * 1000, now = () => Date.now() }) {
    if (!level || !map) throw new Error('[match] 需要 level 与 map');
    this.levelId = levelId;
    this.level = level.scripts ? level : parseLevel(level);   // 允许传原始 JSON 或已解析的关卡
    this.world = new World(map);
    deployForces(this.world, this.level.forces, this.level.anchors);
    this.world.mess = buildMission(this.level, this.world);

    this.factions = ['blue', 'red'];
    const counts = this.unitCounts();
    if (!counts.blue || !counts.red) {
      throw new Error(`[match] 关卡 ${this.levelId} 缺少某一阵营的兵力（blue=${counts.blue} red=${counts.red}）`);
    }

    this.now = now;
    this.prepMs = prepMs;
    this.timeLimitMs = timeLimitMs;
    this.phase = 'prep';
    this.ticks = 0;
    this.accumulatorMs = 0;
    this.lastUpdateAt = null;
    this.prepEndsAt = null;
    this.result = null;
    this.events = [];
    this.eventCursor = 0;
    this.stats = { tickMsTotal: 0, tickMsMax: 0, commands: { blue: 0, red: 0 }, rejected: 0 };
    this.commandWindows = { blue: { start: 0, count: 0 }, red: { start: 0, count: 0 } };
  }

  // ---------- 生命周期 ----------
  start(nowMs = this.now()) {
    this.phase = 'prep';
    this.prepEndsAt = nowMs + this.prepMs;
    this.lastUpdateAt = nowMs;
    if (this.prepMs <= 0) this.startPlaying();
    return this;
  }

  startPlaying() {
    if (this.phase === 'finished') return;
    this.phase = 'playing';
    this.accumulatorMs = 0;
    return this;
  }

  /** 实时驱动（P3/P4 的对局循环调用；测试里用 step()） */
  update(nowMs = this.now()) {
    if (this.phase === 'finished') return 0;
    if (this.lastUpdateAt === null) {
      this.start(nowMs);
      return 0;
    }
    if (this.phase === 'prep') {
      this.lastUpdateAt = nowMs;
      if (nowMs >= this.prepEndsAt) this.startPlaying();
      return 0;
    }

    const delta = Math.max(0, Math.min(nowMs - this.lastUpdateAt, MAX_FRAME_MS));
    this.lastUpdateAt = nowMs;
    this.accumulatorMs += delta;

    let steps = 0;
    while (this.accumulatorMs >= STEP_MS && steps < MAX_CATCH_UP_STEPS && this.phase === 'playing') {
      this.tickOnce();
      this.accumulatorMs -= STEP_MS;
      steps += 1;
    }
    if (this.accumulatorMs < 0) this.accumulatorMs = 0;
    return steps;
  }

  /** 直接推进 n 个固定步（确定性测试 / 无头自检用） */
  step(count = 1) {
    let done = 0;
    while (done < count && this.phase === 'playing') {
      this.tickOnce();
      done += 1;
    }
    return done;
  }

  tickOnce() {
    if (this.phase !== 'playing') return;
    const beganAt = performance.now();
    this.world.tick(STEP_SECONDS);
    const cost = performance.now() - beganAt;
    this.stats.tickMsTotal += cost;
    if (cost > this.stats.tickMsMax) this.stats.tickMsMax = cost;

    this.ticks += 1;
    this.collectEvents();

    if (this.world.winner) {
      this.finish(this.world.winner, 'captured-all-cities');
      return;
    }
    if (this.elapsedMs() >= this.timeLimitMs) {
      this.finish(this.scoreWinner(), 'time-limit');
    }
  }

  // ---------- 命令 ----------
  /**
   * @param {'blue'|'red'} faction
   * @param {{unitIds?: number[], command: object}} payload
   * @returns {{ok: boolean, code?: string, units?: number, message?: string}}
   */
  queueCommand(faction, payload) {
    if (this.phase === 'finished') return { ok: false, code: 'MATCH_OVER' };
    if (!this.factions.includes(faction)) return { ok: false, code: 'BAD_FACTION' };
    if (!this.consumeCommandBudget(faction)) {
      this.stats.rejected += 1;
      return { ok: false, code: 'RATE_LIMITED' };
    }

    let command;
    try {
      command = validateCommand(payload?.command);
    } catch (error) {
      this.stats.rejected += 1;
      return { ok: false, code: 'BAD_COMMAND', message: error.message };
    }

    const requested = Array.isArray(payload?.unitIds) ? payload.unitIds : [];
    const owned = this.world.units
      .filter((unit) => unit.faction === faction && unit.state !== 'dead' && requested.includes(unit.id))
      .map((unit) => unit.id);
    if (owned.length === 0) {
      this.stats.rejected += 1;
      return { ok: false, code: 'NO_UNITS' };
    }

    this.world.issueCommands(owned, command);
    this.stats.commands[faction] += 1;
    return { ok: true, units: owned.length };
  }

  consumeCommandBudget(faction) {
    const window = this.commandWindows[faction];
    const nowMs = performance.now();
    if (nowMs - window.start >= 1000) {
      window.start = nowMs;
      window.count = 0;
    }
    window.count += 1;
    return window.count <= COMMANDS_PER_SECOND;
  }

  // ---------- 结算 ----------
  finish(winner, reason) {
    if (this.phase === 'finished') return;
    this.phase = 'finished';
    this.result = {
      winner: winner ?? 'draw',
      reason,
      atMs: Math.round(this.elapsedMs()),
      ticks: this.ticks,
      cities: { blue: this.cityCount('blue'), red: this.cityCount('red') },
      casualties: {
        blue: Math.round(this.world.casualties?.blue ?? 0),
        red: Math.round(this.world.casualties?.red ?? 0),
      },
      stats: {
        tickMsAvg: this.ticks ? this.stats.tickMsTotal / this.ticks : 0,
        tickMsMax: this.stats.tickMsMax,
      },
    };
    this.events.push({ type: 'matchEnd', winner: this.result.winner, at: Math.round(this.elapsedMs()), reason });
    if (this.events.length > MAX_STORED_EVENTS) this.events = this.events.slice(-MAX_STORED_EVENTS);
  }

  /** 超时判定：城市数多者胜 → 相同则存活单位总血量高者胜 → 仍相同判平 */
  scoreWinner() {
    const cities = this.factions.map((faction) => [faction, this.cityCount(faction)]);
    const [blueCities, redCities] = [cities[0][1], cities[1][1]];
    if (blueCities !== redCities) return blueCities > redCities ? 'blue' : 'red';

    const hp = this.factions.map((faction) => [faction, this.hpSum(faction)]);
    if (Math.abs(hp[0][1] - hp[1][1]) > 0.5) return hp[0][1] > hp[1][1] ? 'blue' : 'red';
    return 'draw';
  }

  collectEvents() {
    const history = this.world.history ?? [];
    for (; this.eventCursor < history.length; this.eventCursor += 1) {
      const summary = summarizeEvent(history[this.eventCursor]);
      if (summary) this.events.push(summary);
    }
    if (this.events.length > MAX_STORED_EVENTS) this.events = this.events.slice(-MAX_STORED_EVENTS);
  }

  // ---------- 查询 ----------
  elapsedMs() {
    return Math.round(this.ticks * STEP_MS);
  }

  timeLeftMs() {
    return Math.max(0, this.timeLimitMs - this.elapsedMs());
  }

  /** 准备阶段剩余毫秒（客户端据此显示 5 秒读秒；非准备阶段返回 0） */
  prepRemainingMs(nowMs = this.now()) {
    if (this.phase !== 'prep' || this.prepEndsAt === null) return 0;
    return Math.max(0, this.prepEndsAt - nowMs);
  }

  cityCount(faction) {
    return this.world.cities.filter((city) => city.faction === faction).length;
  }

  hpSum(faction) {
    return this.world.units
      .filter((unit) => unit.faction === faction && unit.state !== 'dead')
      .reduce((sum, unit) => sum + Math.max(0, unit.hp), 0);
  }

  unitCounts() {
    const counts = {};
    for (const unit of this.world.units) {
      if (unit.state === 'dead') continue;
      counts[unit.faction] = (counts[unit.faction] ?? 0) + 1;
    }
    return counts;
  }

  /** 某个玩家能看到的快照（已按阵营过滤视野，见 server/src/snapshot.js） */
  snapshotFor(faction) {
    return buildSnapshot(this.world, faction, {
      tick: this.ticks,
      phase: this.phase,
      elapsedMs: this.elapsedMs(),
      timeLeftMs: this.timeLeftMs(),
      events: this.events.slice(-20),
      result: this.result,
      unitsAlive: this.unitCounts(),
    });
  }

  get state() {
    return {
      levelId: this.levelId,
      phase: this.phase,
      ticks: this.ticks,
      elapsedMs: this.elapsedMs(),
      timeLeftMs: this.timeLeftMs(),
      cities: { blue: this.cityCount('blue'), red: this.cityCount('red') },
      units: this.unitCounts(),
      result: this.result,
    };
  }

  stop() {
    // 目前由外部驱动（update/step），没有内部定时器；保留接口给 P3 的对局循环
    this.phase = this.phase === 'finished' ? 'finished' : this.phase;
  }
}

/**
 * 预热引擎：用**一次性**的 World 空跑若干 tick，把模拟各系统的 JIT 路径与内存分配走一遍。
 * 为什么需要：实测冷启动时首帧 tick 会出现 28–34 ms 的尖峰（见 docs/pvp-plan.md §3.10），
 * 在 1 核服务器上会让开局瞬间卡一下。P3 建局时先调一次本函数（约 40 ms），再开始真正的对局。
 * 注意：完全不碰真实对局的 world，只是让共享的引擎代码先热起来。
 */
export function warmupEngine({ level, map, ticks = 60 }) {
  const warm = new MatchSim({ level, map, prepMs: 0 });
  warm.start(0);
  warm.startPlaying();
  for (let i = 0; i < ticks && warm.phase === 'playing'; i += 1) warm.tickOnce();
  return { ticks: warm.ticks, stats: { ...warm.stats } };
}
