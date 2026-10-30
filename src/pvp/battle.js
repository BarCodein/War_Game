import Phaser from 'phaser';
import { World } from '../simulation/world.js';
import { deployForces } from '../simulation/level.js';
import { isSpotted, updateFog } from '../simulation/systems/fog.js';
import { createTerrainRenderer } from '../rendering/terrainRenderer.js';
import { createFogRenderer } from '../rendering/fogRenderer.js';
import { UNIT_TEXTURES, createUnitRenderer } from '../rendering/unitRenderer.js';
import { createControlLineRenderer } from '../rendering/controlLineRenderer.js';
import { createSupplyLines } from '../rendering/supplyLines.js';
import { createMapCamera } from '../rendering/cameraView.js';
import { createSelection } from '../input/selection.js';
import { createOrders } from '../input/orders.js';
import { alphaFor, interpolatePosition } from './interpolate.js';
import { markVanishedUnits } from './missingUnits.js';
import { createDeriveController } from './derive.js';
import { createCommandQueue } from './commandQueue.js';
import { createKeyboard } from '../input/keyboard.js';
import { drawBattleOverlays, drawDashedPath } from '../rendering/battleOverlay.js';
import { applyRoutePatch, applyRoutesFull, clearRoutesOfDead, countRoutes } from './routeState.js';
import { t } from '../i18n/index.js';
import { applyStaticI18n } from '../i18n/apply.js';
import { previewForCommand, prunePreviews } from './routePreview.js';

// PvP 对局页（P4）：**只渲染服务器发来的快照**，本地不推进任何模拟。
//
// 数据流：
//   /socket.io ──tick(快照, 按阵营过滤)──► applySnapshot() ──► 镜像 world（只读给渲染层）
//        ▲                                                        │
//        └── cmd({unitIds, command}) ── 玩家点选/右键 ──────────────┘
//
// 关键设计：
//   · 镜像 world = 用**同一份关卡/地图数据**建出来的 World，单位 id 与服务器一致，
//     之后只被快照覆盖（位置/血量/归属），从不 tick；
//   · 迷雾在客户端本地算（updateFog 只依赖**己方**单位/城市/占领点，与服务器同源），
//     所以敌方单位"看不见就不画"，而且服务器压根没把它们的坐标发过来；
//   · 15Hz 快照 + 60FPS 渲染之间做线性插值（src/pvp/interpolate.js），静止时精确等于快照坐标。
const SNAPSHOT_INTERVAL_MS = 1000 / 15;

const params = new URLSearchParams(location.search);
const roomCode = (params.get('room') ?? '').toUpperCase();
const levelId = params.get('level') ?? 'dujiang_pvp';

const hud = {
  room: document.getElementById('hudRoom'),
  timer: document.getElementById('hudTimer'),
  cities: document.getElementById('hudCities'),
  enemies: document.getElementById('hudEnemies'),
  net: document.getElementById('hudNet'),
  prep: document.getElementById('prepOverlay'),
  prepNumber: document.getElementById('prepNumber'),
  status: document.getElementById('battleStatus'),
  banner: document.getElementById('connBanner'),
  result: document.getElementById('resultOverlay'),
  resultTitle: document.getElementById('resultTitle'),
  resultDetail: document.getElementById('resultDetail'),
};

// ---------------- 调试/测试钩子（Playwright 用；线上也无害） ----------------
const debug = {
  roomCode,
  levelId,
  myFaction: null,
  socketConnected: false,
  snapshotCount: 0,
  lastSnapshot: null,
  lastSnapshotAt: 0,
  visibleEnemies: 0,
  commandsSent: 0,
  commandErrors: [],
  rttMs: null,
  result: null,
  world: null,
  selection: null,
};
window.__pvp = debug;

const socket = window.io
  ? window.io({ transports: ['websocket', 'polling'], timeout: 8000 })
  : null;function setStatus(text, isError = false) {
  if (!hud.status) return;
  hud.status.textContent = text ?? '';
  hud.status.className = isError ? 'status bad' : 'status';
}

function fmtClock(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '--:--';
  const total = Math.ceil(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// ---------------- 命令回执（U1/U2）----------------
// 服务器 ack 回来了：把"生效单位数 / 被拒原因"用一条短提示告诉玩家
function reportOrder(result, queue) {
  debug.lastOrderResult = result;
  if (!result) return;
  const textOf = queue?.textFor ?? ((code) => code);
  if (result.ok) {
    const rejected = result.rejected ?? [];
    if (rejected.length === 0) {
      flashOrderToast(t('pvp.toast.orderAccepted', { units: result.units ?? 0 }), 'ok');
    } else {
      const reasons = [...new Set(rejected.map((item) => textOf(item.code)))].join('、');
      flashOrderToast(t('pvp.toast.orderPartiallyRejected', {
        units: result.units ?? 0,
        count: rejected.length,
        reasons,
      }), 'warn');
    }
    return;
  }
  flashOrderToast(textOf(result.code), 'bad');
}

function flashOrderToast(text, tone = 'ok') {
  debug.lastToast = { text, tone, at: performance.now() };
  const element = document.getElementById('orderToast');
  if (!element || !text) return;
  element.textContent = text;
  element.className = `order-toast ${tone}`;
  element.hidden = false;
  window.clearTimeout(flashOrderToast.timer);
  flashOrderToast.timer = window.setTimeout(() => { element.hidden = true; }, 1800);
}

// ---------------- 预计路线（U3）----------------
// 仅用于渲染：本地用同一套 planRoute 算一遍"预计怎么走"；服务器快照一到，偏离就丢弃（见 routePreview.js）
function applyPreviewRoutes(world, unitIds, command) {
  if (!world || !command || !Array.isArray(unitIds)) return;
  const now = performance.now();
  for (const id of unitIds) {
    const unit = world.units.find((item) => item.id === id);
    if (!unit) continue;
    if (command.type === 'hold' || command.type === 'lock') {
      unit.previewRoute = null;
      continue;
    }
    unit.previewRoute = previewForCommand(unit, command, world, now);
  }
}

// ---------------- 关卡/地图加载 ----------------
async function loadLevelData(id) {
  const levelResponse = await fetch(`/assets/pvp/${id}.json`, { cache: 'no-cache' });
  if (!levelResponse.ok) throw new Error(`关卡 ${id} 加载失败（HTTP ${levelResponse.status}）`);
  const level = await levelResponse.json();
  const mapResponse = await fetch(level.map, { cache: 'no-cache' });
  if (!mapResponse.ok) throw new Error(`地图 ${level.map} 加载失败（HTTP ${mapResponse.status}）`);
  const map = await mapResponse.json();
  return { level, map };
}

// ---------------- 场景 ----------------
class BattleScene extends Phaser.Scene {
  constructor() {
    super({ key: 'Battle' });
  }

  preload() {
    for (const faction of Object.values(UNIT_TEXTURES)) {
      for (const { key, url } of Object.values(faction)) {
        if (!this.textures.exists(key)) this.load.image(key, url);
      }
    }
  }

  create() {
    const { level, map } = window.__battleData;
    const world = new World(map);
    deployForces(world, level.forces, level.anchors ?? {});
    updateFog(world);
    this.world = world;
    debug.world = world;

    this.selection = createSelection(this, world, { getFaction: () => debug.myFaction ?? 'blue' });
    debug.selection = this.selection;

    createTerrainRenderer(this, world);
    // 渲染层按"我是哪一方"过滤敌军 / 画迷雾 / 显示己方血条。
    // 传函数而不是值：socket 握手完成后才知道自己是蓝方还是红方，而场景可能先建好。
    const viewerFaction = () => debug.myFaction ?? 'blue';
    this.fogRenderer = createFogRenderer(this, world, { faction: viewerFaction });
    this.unitRenderer = createUnitRenderer(this, world, this.selection, { faction: viewerFaction });
    this.mapCamera = createMapCamera(this, world);
    this.overlay = this.add.graphics().setDepth(30);

    // 控制线 / 补给线：与战役同款渲染器（控制线常显，补给线只在选中单位时画）。
    // 数据由 src/pvp/derive.js 本地派生（服务器只按 3s 发一份校正包），见 docs/pvp-derive-draft.md。
    this.controlLineRenderer = createControlLineRenderer(this, world);
    this.supplyLines = createSupplyLines(this, world, this.selection);
    this.derive = createDeriveController({ world, getSnapshot: () => debug.lastSnapshot });
    debug.derive = this.derive;

    this.input.mouse?.disableContextMenu();
    // 命令流水线（U1/U2/U3）：
    //   createOrders 产出「每单位一条绝对路径」→ commandQueue 打包成一条 cmd → 服务器整批执行
    //   同时用 planRoute 在本地算一条"预计路线"给渲染层画虚线（服务器快照一到就按偏离判断丢弃）
    this.commandQueue = createCommandQueue({
      getSocket: () => socket,
      onResult: (result) => reportOrder(result, this.commandQueue),
      onError: (code) => flashOrderToast(this.commandQueue?.textFor(code) ?? t('pvp.reject.SEND_FAILED'), 'bad'),
    });
    debug.commandQueue = this.commandQueue;
    const issue = (unitIds, command) => {
      this.commandQueue.enqueue(unitIds, command);
      applyPreviewRoutes(world, unitIds, command);
      debug.commandsSent = (debug.commandsSent ?? 0) + unitIds.length;
    };
    this.orders = createOrders(this, world, this.selection, {
      issue,
      getFaction: () => debug.myFaction ?? 'blue',
    });
    // 键盘与战役共用（src/input/keyboard.js）：不传 controller → 暂停/变速只提示，S 走 issue
    this.keyboard = createKeyboard(this, this.selection, {
      issue,
      onHint: (text) => flashOrderToast(text, 'warn'),
    });
    debug.orders = this.orders;

    this.scale.on('resize', () => this.cameras.main.setSize(this.scale.width, this.scale.height));
    debug.scene = this;
    // 测试辅助：世界坐标 → 屏幕坐标（Playwright 要点中某个单位/地面）
    debug.projectToScreen = (x, y) => {
      const camera = this.cameras.main;
      const view = camera.worldView;
      if (!view || !view.width) return null;
      return {
        x: (x - view.x) / view.width * camera.width,
        y: (y - view.y) / view.height * camera.height,
      };
    };
    // 注意：这里不再覆盖 #battleStatus —— 状态文案由 socket 流程负责（"已进入对局（蓝方）"等）
    // 快照可能比场景先到（关卡 JSON 加载中）：补应用最后一份
    if (debug.pendingSnapshot) {
      const pending = debug.pendingSnapshot;
      debug.pendingSnapshot = null;
      window.setTimeout(() => applySnapshot(pending), 0);
    }
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { /* 清理交给页面卸载 */ });
  }

  update(time, delta) {
    this.mapCamera.update(delta / 1000);
    this.interpolate(performance.now());
    // 派生：控制线 10Hz / 补给分配 2Hz（本地算，服务器每 3s 校正一次）
    this.derive.update(delta);
    // U3：预计路线超时或被服务器改了道就丢弃
    debug.previewCount = prunePreviews(this.world, performance.now());
    this.unitRenderer.draw(delta / 1000);
    this.controlLineRenderer.draw();
    this.supplyLines.draw();
    this.fogRenderer.sync();
    this.drawOverlay();
    debug.deriveStats = {
      ...this.derive.stats(),
      supplySelected: this.supplyLines.state.selected,
      supplyLines: this.supplyLines.state.lines,
      supplyCuts: this.supplyLines.state.cuts,
      // 补给线路径缓存诊断：backtrack 是"折回上一个位置"的像素（修复前会到几十 px，修复后≈0）
      supplyOffsetPx: Math.round(this.supplyLines.state.startOffsetPx * 10) / 10,
      supplyBacktrackPx: Math.round(this.supplyLines.state.backtrackPx * 10) / 10,
      supplyBacktrackRawMax: Math.round(this.supplyLines.state.maxBacktrackRawPx * 10) / 10,
      supplyBacktrackDrawnMax: Math.round(this.supplyLines.state.maxBacktrackDrawnPx * 10) / 10,
      supplyRepath: this.supplyLines.state.repath,
      // 排查"选中单位却没有任何补给线"：兜底/跳过计数 + 每个单位本帧画了什么
      supplyMissingCity: this.supplyLines.state.missingCity,
      supplyPathFallback: this.supplyLines.state.pathFallback,
      supplyStraightFallback: this.supplyLines.state.straightFallback,
      supplyNoEdge: this.supplyLines.state.noEdgeSupplied,
      supplyRows: this.supplyLines.state.debugRows,
    };
    // §11.15 路线同步诊断（e2e 用）：带路线的己方单位数 / 应用过的增量条数 / 仍在占位的预计路线数
    debug.routeStats = {
      ownWithRoute: countRoutes(this.world, debug.myFaction ?? 'blue'),
      deltasApplied: debug.routeDeltasApplied ?? 0,
      previews: debug.previewCount ?? 0,
    };
    updateHud();
  }

  /** 15Hz 快照 → 60FPS：在上一帧位置与快照位置之间线性插值（静止时精确等于快照） */
  interpolate(nowMs) {
    if (!debug.lastSnapshotAt) return;
    const alpha = alphaFor(nowMs - debug.lastSnapshotAt, SNAPSHOT_INTERVAL_MS);
    for (const unit of this.world.units) {
      if (!unit.target) continue;
      const position = interpolatePosition(unit.prev, unit.target, alpha);
      unit.x = position.x;
      unit.y = position.y;
    }
  }

  drawOverlay() {
    // 与战役共用同一套覆盖层绘制（rendering/battleOverlay.js）：
    // 框选矩形、拖动轨迹、己方行军路线（实线 + 末端箭头）、排队路线（虚线）。
    drawBattleOverlays(this.overlay, {
      world: this.world,
      viewerFaction: debug.myFaction ?? 'blue',
      selection: this.selection,
      routing: this.orders?.getCurrentRoute?.() ?? null,
      forcedRouting: this.orders?.isForcedRouting?.() ?? false,
    });

    // §11.15：真实路线由服务器下发（变化才发），在它到达之前用本地"预计路线"占位（半透明虚线）。
    for (const unit of this.world.units) {
      const preview = unit.previewRoute;
      if (!preview) continue;
      this.overlay.lineStyle(2, 0x6fc3ff, 0.4);
      drawDashedPath(this.overlay, preview.points, 12, 8);
      this.overlay.strokePath();
    }

    // 选中单位脚下画一圈
    this.overlay.lineStyle(2, 0xffe9b8, 0.55);
    for (const unit of this.world.units) {
      if (unit.state === 'dead' || !this.selection.isSelected(unit.id)) continue;
      this.overlay.strokeCircle(unit.x, unit.y, 20);
    }
  }
}
// ---------------- 快照应用 ----------------
function applySnapshot(snapshot) {
  const world = debug.world;
  if (!world) {
    // 场景还没建好（关卡 JSON 仍在加载）：先留着最后一份，create() 里补上
    debug.pendingSnapshot = snapshot;
    debug.lastSnapshot = snapshot;
    debug.lastSnapshotAt = performance.now();
    return;
  }
  debug.snapshotCount += 1;
  debug.lastSnapshot = snapshot;
  debug.lastSnapshotAt = performance.now();

  const myFaction = debug.myFaction ?? snapshot.you;
  debug.myFaction = myFaction;

  // 城市与占领点（归属/进度公开）
  for (const city of snapshot.cities ?? []) {
    const local = world.cities.find((item) => item.id === city.id);
    if (!local) continue;
    local.faction = city.faction;
    local.captureProgress = city.captureProgress;
  }
  for (const point of snapshot.points ?? []) {
    const local = world.capturePoints.find((item) => item.id === point.id);
    if (!local) continue;
    local.faction = point.faction;
  }

  const seen = new Set();
  for (const unit of snapshot.units ?? []) {
    seen.add(unit.id);
    let local = world.units.find((item) => item.id === unit.id);
    if (!local) {
      // 镜像 world 已按同一关卡部署过（id 与服务器一致）；真出现新 id 时补建，避免渲染缺单位
      local = world.spawnUnit(unit.faction, unit.type, unit.x, unit.y);
      if (local.id !== unit.id) continue;
    }
    local.prev = { x: local.x, y: local.y };
    local.target = { x: unit.x, y: unit.y };
    local.faction = unit.faction;
    local.type = unit.type;
    local.hp = unit.hp;
    local.maxHp = unit.maxHp;
    local.state = unit.state;
    local.supplyStock = unit.supplyStock;

    // §11.15：服务器只在"路线变化"时带 route/routeIndex/pendingQueue/forcedMarch；
    // 缺失 = 保持缓存（合并语义在 routeState.js 里，有单测）。
    if (applyRoutePatch(local, unit) && Array.isArray(unit.route)) {
      local.previewRoute = null;   // 真实路线到手 → 丢弃本地"预计路线"占位
      debug.routeDeltasApplied = (debug.routeDeltasApplied ?? 0) + 1;
    }
  }

  // 迷雾完全由客户端本地算：只用到己方单位/城市/占领点（与服务器同一套规则）
  debug.fogAuthority = snapshot.fogAuthority ?? 'client';
  updateFog(world);

  // 快照里消失的单位 → 判定阵亡（规则见 src/pvp/missingUnits.js 与 docs/pvp-plan.md §11.13）
  debug.vanishedUnits = markVanishedUnits(world, seen, myFaction, debug.fogAuthority);
  // 阵亡单位的路线缓存要一起清掉，否则"尸体还在画路线"
  clearRoutesOfDead(world);

  // "可见敌军"由客户端用迷雾判定（服务端不再替我们过滤）
  debug.visibleEnemies = world.units
    .filter((unit) => unit.faction !== myFaction && unit.state !== 'dead' && isSpotted(world, unit, myFaction))
    .length;
  debug.enemyUnitsKnown = world.units
    .filter((unit) => unit.faction !== myFaction && unit.state !== 'dead')
    .length;
  debug.ownUnits = (snapshot.units ?? []).filter((unit) => unit.faction === myFaction).length;
  updateHud();
}

// ---------------- HUD ----------------
function updateHud() {
  const snapshot = debug.lastSnapshot;
  if (hud.room) {
    hud.room.textContent = t('pvp.room.label', {
      code: roomCode || '—',
      faction: debug.myFaction === 'red' ? t('pvp.faction.red') : t('pvp.faction.blue'),
    });
  }
  if (!snapshot) return;
  if (hud.timer) hud.timer.textContent = snapshot.phase === 'prep' ? t('pvp.hud.prep') : fmtClock(snapshot.timeLeftMs);
  const cities = snapshot.cities ?? [];
  const blue = cities.filter((city) => city.faction === 'blue').length;
  const red = cities.filter((city) => city.faction === 'red').length;
  if (hud.cities) hud.cities.textContent = t('pvp.hud.cities', { blue, red });
  if (hud.enemies) hud.enemies.textContent = t('pvp.hud.enemies', { count: debug.visibleEnemies ?? 0 });
  if (hud.net) {
    hud.net.textContent = debug.rttMs === null ? t('pvp.hud.rttNone') : t('pvp.hud.rtt', { ms: debug.rttMs });
  }
  if (hud.prep) {
    const prepping = snapshot.phase === 'prep';
    hud.prep.hidden = !prepping;
    if (prepping && hud.prepNumber) {
      const seconds = Math.max(1, Math.ceil((debug.prepRemainingMs ?? 0) / 1000));
      hud.prepNumber.textContent = String(seconds);
      debug.prepRemainingMs = Math.max(0, (debug.prepRemainingMs ?? 0) - 1000);
    }
  }
}

function showResult(result) {
  debug.result = result;
  if (!hud.result) return;
  hud.result.hidden = false;
  const title = result?.winner === 'draw'
    ? t('pvp.result.draw')
    : (result?.winner === debug.myFaction ? t('pvp.result.win') : t('pvp.result.lose'));
  if (hud.resultTitle) hud.resultTitle.textContent = title;
  const reasonText = {
    'captured-all-cities': t('pvp.reason.capturedAllCities'),
    'time-limit': t('pvp.reason.timeLimit'),
    forfeit: t('pvp.reason.forfeit'),
    'disconnect-timeout': t('pvp.reason.disconnectTimeout'),
    aborted: t('pvp.reason.aborted'),
  }[result?.reason] ?? (result?.reason ?? '');
  if (hud.resultDetail) {
    hud.resultDetail.textContent = `${reasonText} · 用时 ${fmtClock(result?.atMs ?? 0)}`
      + (result?.casualties ? ` · 伤亡 蓝 ${result.casualties.blue} / 红 ${result.casualties.red}` : '');
  }
  setStatus(t('pvp.status.finished'));
}

// ---------------- 断线重连（P5） ----------------
// 重连凭证：服务端在 match:join 的 ack 里下发，存在 sessionStorage（按房间码），
// 页面被关掉再打开（同一标签页/同一浏览器）就能凭它续局。
const tokenKey = () => `pvp:token:${roomCode}`;
const readToken = () => {
  try { return sessionStorage.getItem(tokenKey()); } catch { return null; }
};
const saveToken = (token) => {
  try { if (token) sessionStorage.setItem(tokenKey(), token); } catch { /* 隐私模式忽略 */ }
};

function showBanner(text, tone = 'warn') {
  if (!hud.banner) return;
  hud.banner.hidden = !text;
  hud.banner.textContent = text ?? '';
  hud.banner.className = `banner ${tone}`;
}

// ---------------- 网络 ----------------
// ⚠️ socket 在模块顶层就 `io()` 开始了连接，而关卡/地图是异步 fetch 的：
// 如果等 boot() 里再挂监听，connect 事件可能已经错过（只触发一次）。
// 所以这里在创建 socket 之后**立刻**绑定监听，并在已连接时补一次 onConnect。
function onConnect() {
  debug.socketConnected = true;
  setStatus(t('pvp.status.connecting'));
  showBanner('');
  socket.emit('match:join', { roomCode, reconnectToken: readToken() }, (response) => {
    if (!response?.ok) {
      const code = response?.code ?? 'UNKNOWN';
      if (code === 'RECONNECT_EXPIRED') {
        setStatus(t('pvp.status.expired'), true);
        showBanner(t('pvp.banner.expired'), 'bad');
      } else if (code === 'ROOM_NOT_FOUND' && readToken()) {
        setStatus(t('pvp.status.aborted'), true);
        showBanner(t('pvp.banner.aborted'), 'bad');
      } else {
        setStatus(t('pvp.status.joinFailed', { code }), true);
      }
      return;
    }
    debug.myFaction = response.room?.you?.faction ?? null;
    debug.myUserId = response.room?.you?.id ?? null;
    debug.matchId = response.match?.matchId ?? null;
    debug.prepRemainingMs = response.match?.prepRemainingMs ?? 0;
    debug.phase = response.match?.phase ?? 'prep';
    debug.reconnectGraceMs = response.match?.reconnectGraceMs ?? 30000;
    saveToken(response.reconnectToken ?? response.room?.you?.reconnectToken);
    setStatus(t(response.reconnected ? 'pvp.status.reconnected' : 'pvp.status.joined', {
      faction: debug.myFaction === 'red' ? t('pvp.faction.red') : t('pvp.faction.blue'),
    }));
    if (response.match?.result) showResult(response.match.result);
    // 重连/首次进入：清空本地派生的控制线场与折线，等下一份校正包重新对齐
    debug.derive?.reset();
    // §11.15：新进入/重连拿不到"变化才发"的历史增量 → 用 ack 里的全量路线覆盖己方单位
    if (debug.world && Array.isArray(response.routes) && response.routes.length) {
      debug.routeFullApplied = applyRoutesFull(debug.world, response.routes);
      for (const unit of debug.world.units) unit.previewRoute = null;   // 有真实路线就不再占位
    }
    updateHud();
  });
  setInterval(() => {
    if (!socket.connected) return;
    const sentAt = performance.now();
    socket.timeout(3000).emit('link:ping', { t: Date.now() }, (error) => {
      if (error) return;
      debug.rttMs = Math.round(performance.now() - sentAt);
      updateHud();
    });
  }, 2000);
}

function bindSocket() {
  if (!socket) {
    setStatus(t('pvp.status.loadingIo'), true);
    return;
  }
  socket.on('connect', onConnect);
  socket.on('tick', (snapshot) => applySnapshot(snapshot));
  // 派生校正包（控制线折线 + 补给边）：低频（3s），用于本地派生的偏差度量与自愈
  socket.on('world:derive', (packet) => {
    debug.derive?.applyPacket(packet);
  });
  socket.on('match:end', (payload) => {
    showBanner('');
    showResult(payload);
  });
  socket.on('match:state', (state) => {
    if (state?.closed && state.result) showResult(state.result);
  });
  // P5：对手掉线 / 回来（广播给整个房间频道，所以要先排除"说的就是我"）
  socket.on('opponent:left', (payload) => {
    if (payload?.userId && debug.myUserId && payload.userId === debug.myUserId) return;
    debug.opponentLeft = true;
    const seconds = payload?.graceSeconds ?? Math.round((debug.reconnectGraceMs ?? 30000) / 1000);
    showBanner(`对手掉线：${seconds} 秒内可重连，超时判胜`, 'warn');
    // 横幅已经足够醒目；不要再覆盖 #battleStatus（那是"已进入对局…"这类稳定状态）
    flashOrderToast(t('pvp.toast.opponentLeft', { name: payload?.username ?? '—' }), 'warn');
  });
  socket.on('opponent:rejoin', (payload) => {
    if (payload?.userId && debug.myUserId && payload.userId === debug.myUserId) return;
    debug.opponentLeft = false;
    showBanner(t('pvp.banner.opponentRejoin'), 'ok');
    window.setTimeout(() => showBanner(''), 2500);
    flashOrderToast(t('pvp.banner.opponentRejoin'), 'ok');
  });
  socket.on('connect_error', (error) => {
    debug.socketConnected = false;
    setStatus(`连接失败：${error.message}`, true);
    showBanner(t('pvp.banner.connectError'), 'bad');
  });
  socket.on('disconnect', (reason) => {
    debug.socketConnected = false;
    setStatus(`连接断开：${reason}`, true);
    showBanner(t('pvp.banner.disconnected'), 'warn');
  });
  if (socket.connected) onConnect();
}

// ---------------- 启动 ----------------
// 先绑网络（socket 已经在模块顶层开始连接），再异步加载关卡/地图并起 Phaser。
bindSocket();

async function boot() {
  applyStaticI18n();   // 静态文案（准备提示 / 操作提示 / 返回大厅）走 i18n
  if (!roomCode) {
    setStatus(t('pvp.status.badRoom'), true);
    return;
  }
  if (hud.room) hud.room.textContent = `房间 ${roomCode} · 加载中…`;
  let levelData;
  try {
    levelData = await loadLevelData(levelId);
  } catch (error) {
    setStatus(error.message, true);
    return;
  }
  window.__battleData = levelData;
  // eslint-disable-next-line no-new
  new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'battleCanvas',
    backgroundColor: '#0b0a08',
    scale: {
      mode: Phaser.Scale.RESIZE,
      width: window.innerWidth,
      height: window.innerHeight,
    },
    scene: [BattleScene],
    audio: { noAudio: true },
  });
}

boot();
