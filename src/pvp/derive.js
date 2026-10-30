import { values } from '../config/index.js';
import { updateControlLine } from '../simulation/systems/controlLine.js';
import { refreshSupply } from '../simulation/systems/supply.js';

// 控制线 / 补给线的**客户端派生**（方案 B，见 docs/pvp-derive-draft.md）。
//
// 为什么可以本地算：
//   · 控制线只依赖「全部单位位置 + 城市/据点归属 + values」，输出 controlLinePaths（纯渲染量）；
//   · 补给分配只依赖「代价场 + 城市吞吐 + 各单位缺口」，输出 supplyEdges/supplied（同样只用于渲染）。
// 因此这里**只调用** updateControlLine() 与 refreshSupply() —— 二者都不改 hp / 存量 / 胜败。
// 绝不调用 updateSupply() / updateSupplyStock()（它们会回血、掉血、造兵）。
//
// 自愈：服务器每 3 s 发一份 world:derive（控制线折线 + 补给边），这里用它度量偏差并"轻拉"渲染折线；
// 只有严重偏离才硬切，连续三次严重偏离则降级为"只显示服务器折线"（mode='server'）。

const STEP_MS = values.simulation.fixedStep * 1000;
const RESAMPLE_POINTS = 32;      // 每条折线按弧长重采样到这个点数（便于逐点混合）
const GRID = 64;                 // 偏差度量用的采样网格边长
const SOFT_MISMATCH = 0.02;      // ≥2%：轻拉
const HARD_MISMATCH = 0.25;      // ≥25%：硬切
const FREEZE_AFTER = 3;          // 连续硬切次数 → 降级
const RECOVER_BELOW = 0.05;      // 降级后连续低于此值 → 恢复本地
const BIAS_MS = 900;             // 轻拉持续时间
const ALPHA = 0.15;              // 轻拉系数（决策 3：本地优先）

export function createDeriveController({ world, getSnapshot = () => null, now = () => performance.now() }) {
  const state = {
    mode: 'local',          // 'local' | 'server'
    tick: 0,
    acc: 0,
    localPaths: [],
    serverPaths: [],
    mismatch: 0,
    packets: 0,
    hardSwitches: 0,
    freezeStreak: 0,
    recoverStreak: 0,
    biasUntil: 0,
    lastPacketAt: 0,
    lastSeq: 0,
    suppliedOff: 0,
    supplyEdges: 0,
    computeMs: 0,
    stale: false,
  };

  function reset() {
    // 重连 / 快照跳变：清空本地场与折线，等下一份校正包再对齐
    world.controlLine = null;
    world.controlLineSegments = [];
    world.controlLinePaths = [];
    world.controlLineTick = 0;
    world.supplyFields = { blue: null, red: null };
    world.supplyMasks = { blue: null, red: null };
    world.supplyScratch = null;
    world.supplyTimer = Infinity;
    world.supplyFieldTimer = Infinity;
    world.citySupplyLoad?.clear?.();
    state.localPaths = [];
    state.serverPaths = [];
    state.mismatch = 0;
    state.packets = 0;
    state.hardSwitches = 0;
    state.freezeStreak = 0;
    state.recoverStreak = 0;
    state.biasUntil = 0;
    state.lastSeq = 0;
    state.mode = getSnapshot()?.fogAuthority === 'server' ? 'server' : 'local';
  }

  /** 每帧调用：按 60Hz 逻辑步长推进本地派生，并把"本地 + 校正"合成到 world.controlLinePaths */
  function update(deltaMs) {
    const snapshot = getSnapshot();
    if (snapshot?.fogAuthority === 'server') state.mode = 'server';
    if (!snapshot || snapshot.phase === 'prep') return;

    const timeMs = now();
    // 服务器内容没变时会跳过发送（省流量），所以"安静"不等于异常：这里只作为诊断量记录
    state.quietMs = state.lastPacketAt > 0 ? timeMs - state.lastPacketAt : 0;
    state.stale = state.quietMs > 12000;

    // ⚠️ 本地派生**两种模式都要跑**。
    // `mode === 'server'`（控制线和服务端差太多而"降级"）只应该影响**画哪条控制线**，
    // 绝不能连补给分配一起停掉：补给边一旦冻结，就会出现"占了城还画旧城的线 / 丢了城还画它的线"。
    {
      const started = timeMs;
      state.acc += Math.min(deltaMs, 250);          // 切后台回来时别补一大堆步
      let guard = 0;
      while (state.acc >= STEP_MS && guard < 8) {
        state.acc -= STEP_MS;
        guard += 1;
        state.tick += 1;
        if (state.tick % values.controlLine.refreshTicks === 0) {
          updateControlLine(world);
          state.localPaths = resamplePaths(world.controlLinePaths);
        }
        refreshSupply(world, values.simulation.fixedStep);
      }
      state.computeMs = timeMs - started;
      state.supplyEdges = countEdges(world);
    }

    // 合成渲染折线（只有这一步区分模式）
    if (state.mode === 'server') {
      if (state.serverPaths.length) world.controlLinePaths = state.serverPaths;
    } else if (state.serverPaths.length && timeMs < state.biasUntil) {
      world.controlLinePaths = blendPaths(state.localPaths, state.serverPaths, ALPHA);
    } else if (state.localPaths.length) {
      world.controlLinePaths = state.localPaths;
    }
  }

  /** 收到服务器的校正包 */
  function applyPacket(packet) {
    if (!packet?.controlLine || !Array.isArray(packet.controlLine.paths)) return;
    if (packet.seq && packet.seq <= state.lastSeq) return;   // 丢弃过期/重复
    state.lastSeq = packet.seq ?? state.lastSeq + 1;
    state.packets += 1;
    state.lastPacketAt = now();
    state.serverPaths = resamplePaths(packet.controlLine.paths);
    state.suppliedOff = packet.supply?.off?.length ?? 0;
    state.stale = false;

    const mismatch = comparePaths(state.localPaths, state.serverPaths, world.size);
    state.mismatch = mismatch;

    if (state.mode === 'server') {
      state.recoverStreak = mismatch < RECOVER_BELOW ? state.recoverStreak + 1 : 0;
      if (state.recoverStreak >= 2) { state.mode = 'local'; state.recoverStreak = 0; }
      return;
    }

    // 第一份包：本地还没收敛，直接对齐一次
    if (state.packets === 1 || !state.localPaths.length) {
      state.biasUntil = now() + BIAS_MS;
      return;
    }
    if (mismatch >= HARD_MISMATCH) {
      state.biasUntil = now() + BIAS_MS;
      state.hardSwitches += 1;
      state.freezeStreak += 1;
      if (state.freezeStreak >= FREEZE_AFTER) {
        state.mode = 'server';
        state.recoverStreak = 0;
      }
      return;
    }
    state.freezeStreak = 0;
    state.biasUntil = mismatch >= SOFT_MISMATCH ? now() + BIAS_MS : 0;
  }

  function stats() {
    return {
      mode: state.mode,
      mismatch: Math.round(state.mismatch * 10000) / 10000,
      packets: state.packets,
      hardSwitches: state.hardSwitches,
      stale: state.stale,
      quietMs: Math.round(state.quietMs ?? 0),
      localPaths: countPoints(state.localPaths),
      serverPaths: countPoints(state.serverPaths),
      supplyEdges: state.supplyEdges,
      suppliedOff: state.suppliedOff,
      computeMs: Math.round(state.computeMs * 100) / 100,
    };
  }

  return { update, applyPacket, reset, stats, state };
}

// ---------------- 几何工具（导出便于测试） ----------------

/** 把折线数组按弧长重采样为固定点数（两条折线点数不同时才能逐点混合）
 *  入参兼容两种写法：`{x, y}` 对象（本地算出来的）或 `[x, y]` 数组（服务器校正包） */
export function resamplePaths(paths) {
  const out = [];
  for (const raw of paths ?? []) {
    if (!raw || raw.length < 2) continue;
    const path = raw.map((point) => (Array.isArray(point) ? { x: point[0], y: point[1] } : point));
    const total = polylineLength(path);
    if (total <= 0) continue;
    const step = total / (RESAMPLE_POINTS - 1);
    const points = [];
    let target = 0;
    let walked = 0;
    for (let i = 0; i < path.length - 1 && points.length < RESAMPLE_POINTS; i += 1) {
      const a = path[i];
      const b = path[i + 1];
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      while (points.length < RESAMPLE_POINTS - 1 && walked + length >= target) {
        const t = length > 0 ? (target - walked) / length : 0;
        points.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
        target = points.length * step;
      }
      walked += length;
    }
    const last = path[path.length - 1];
    while (points.length < RESAMPLE_POINTS) points.push({ x: last.x, y: last.y });
    out.push(points);
  }
  // 按起点排序，保证本地/服务器两份折线的配对稳定
  out.sort((a, b) => (a[0].x - b[0].x) || (a[0].y - b[0].y));
  return out;
}

function polylineLength(path) {
  let total = 0;
  for (let i = 0; i < path.length - 1; i += 1) {
    total += Math.hypot(path[i + 1].x - path[i].x, path[i + 1].y - path[i].y);
  }
  return total;
}

/** 逐点混合两份折线（条数不同则直接以服务器为准） */
export function blendPaths(local, server, alpha) {
  if (!local.length) return server;
  if (local.length !== server.length) return server;
  const out = [];
  for (let i = 0; i < local.length; i += 1) {
    const points = [];
    const count = Math.min(local[i].length, server[i].length);
    for (let j = 0; j < count; j += 1) {
      points.push({
        x: local[i][j].x + (server[i][j].x - local[i][j].x) * alpha,
        y: local[i][j].y + (server[i][j].y - local[i][j].y) * alpha,
      });
    }
    out.push(points);
  }
  return out;
}

/** 偏差度量：网格采样，比较采样点相对两份折线最近段的左右侧符号 */
export function comparePaths(local, server, size) {
  if (!local.length || !server.length) return 0;
  // 注意：**不能**因为"折线条数不同"就直接判 1（完全不一致）。
  // 前线的折线是等值线串联出来的，形状稍有变化就会多/少一条，按条数判会误触发"硬切→降级"，
  // 然后进入不会自愈的 server 模式（补给边因此冻结）。这里对两侧的所有折线一起做侧向符号比较。
  const width = size?.width ?? 1280;
  const height = size?.height ?? 800;
  let differ = 0;
  let total = 0;
  for (let gx = 0; gx < GRID; gx += 1) {
    for (let gy = 0; gy < GRID; gy += 1) {
      const x = ((gx + 0.5) / GRID) * width;
      const y = ((gy + 0.5) / GRID) * height;
      const a = sideSign(local, x, y);
      const b = sideSign(server, x, y);
      if (a === 0 || b === 0) continue;
      total += 1;
      if (a !== b) differ += 1;
    }
  }
  return total ? differ / total : 0;
}

function sideSign(paths, x, y) {
  let best = Infinity;
  let sign = 0;
  for (const path of paths) {
    for (let i = 0; i < path.length - 1; i += 1) {
      const a = path[i];
      const b = path[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lengthSq = dx * dx + dy * dy;
      if (lengthSq === 0) continue;
      let t = ((x - a.x) * dx + (y - a.y) * dy) / lengthSq;
      t = Math.max(0, Math.min(1, t));
      const px = a.x + dx * t;
      const py = a.y + dy * t;
      const distance = (x - px) ** 2 + (y - py) ** 2;
      if (distance < best) {
        best = distance;
        sign = dx * (y - a.y) - dy * (x - a.x) > 0 ? 1 : -1;
      }
    }
  }
  return sign;
}

function countPoints(paths) {
  return (paths ?? []).reduce((sum, path) => sum + path.length, 0);
}

function countEdges(world) {
  let count = 0;
  for (const unit of world.units) {
    if (unit.state === 'dead') continue;
    count += (unit.supplyEdges ?? []).length;
  }
  return count;
}
