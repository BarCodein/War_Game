import Phaser from 'phaser';
import { World } from '../simulation/world.js';
import { deployForces } from '../simulation/level.js';
import { isSpotted, updateFog } from '../simulation/systems/fog.js';
import { createTerrainRenderer } from '../rendering/terrainRenderer.js';
import { createFogRenderer } from '../rendering/fogRenderer.js';
import { UNIT_TEXTURES, createUnitRenderer } from '../rendering/unitRenderer.js';
import { createMapCamera } from '../rendering/cameraView.js';
import { attackMoveCommand, moveCommand } from '../simulation/commands.js';
import { alphaFor, interpolatePosition } from './interpolate.js';

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

// ---------------- 选择框（PvP 版：按"我的阵营"选，不写死 blue） ----------------
function createBattleSelection(scene, world, getFaction) {
  const selected = new Set();
  const listeners = new Set();
  const notify = () => listeners.forEach((fn) => fn());
  let pressPoint = null;
  let dragPoint = null;
  let dragging = false;

  scene.input.on('pointerdown', (pointer) => {
    if (pointer.button !== 0) return;
    pressPoint = { x: pointer.worldX, y: pointer.worldY };
    dragPoint = pressPoint;
    dragging = false;
  });
  scene.input.on('pointermove', (pointer) => {
    if (!pressPoint) return;
    dragPoint = { x: pointer.worldX, y: pointer.worldY };
    if (Math.hypot(dragPoint.x - pressPoint.x, dragPoint.y - pressPoint.y) > 8) dragging = true;
  });
  scene.input.on('pointerup', (pointer) => {
    if (pointer.button !== 0 || !pressPoint) return;
    const end = { x: pointer.worldX, y: pointer.worldY };
    const faction = getFaction();
    if (!pointer.event?.shiftKey) selected.clear();

    const left = Math.min(pressPoint.x, end.x);
    const right = Math.max(pressPoint.x, end.x);
    const top = Math.min(pressPoint.y, end.y);
    const bottom = Math.max(pressPoint.y, end.y);
    for (const unit of world.units) {
      if (unit.state === 'dead' || unit.faction !== faction) continue;
      const hit = dragging
        ? unit.x > left && unit.x < right && unit.y > top && unit.y < bottom
        : Math.hypot(unit.x - end.x, unit.y - end.y) <= 26;
      if (hit) selected.add(unit.id);
    }
    pressPoint = null;
    dragPoint = null;
    dragging = false;
    notify();
  });

  return {
    isSelected: (id) => selected.has(id),
    ids: () => [...selected],
    size: () => selected.size,
    clear() { selected.clear(); notify(); },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    getDragRect() {
      if (!dragging || !pressPoint || !dragPoint) return null;
      return {
        left: Math.min(pressPoint.x, dragPoint.x),
        right: Math.max(pressPoint.x, dragPoint.x),
        top: Math.min(pressPoint.y, dragPoint.y),
        bottom: Math.max(pressPoint.y, dragPoint.y),
      };
    },
  };
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

    this.selection = createBattleSelection(this, world, () => debug.myFaction ?? 'blue');
    debug.selection = this.selection;

    createTerrainRenderer(this, world);
    // 渲染层按"我是哪一方"过滤敌军 / 画迷雾 / 显示己方血条。
    // 传函数而不是值：socket 握手完成后才知道自己是蓝方还是红方，而场景可能先建好。
    const viewerFaction = () => debug.myFaction ?? 'blue';
    this.fogRenderer = createFogRenderer(this, world, { faction: viewerFaction });
    this.unitRenderer = createUnitRenderer(this, world, this.selection, { faction: viewerFaction });
    this.mapCamera = createMapCamera(this, world);
    this.overlay = this.add.graphics().setDepth(30);

    this.input.mouse?.disableContextMenu();
    this.input.on('pointerdown', (pointer) => {
      if (pointer.button !== 2) return;
      this.issueOrder(pointer);
    });

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

  issueOrder(pointer) {
    const ids = this.selection.ids();
    if (!ids.length) { setStatus('先左键选择部队，再右键下令', true); return; }
    if (!socket || !socket.connected) { setStatus('WebSocket 未连接，命令未发送', true); return; }
    const target = { x: Math.round(pointer.worldX), y: Math.round(pointer.worldY) };
    const command = pointer.event?.shiftKey ? attackMoveCommand(target) : moveCommand([target]);
    const sentAt = performance.now();
    socket.emit('cmd', { unitIds: ids, command }, (response) => {
      debug.commandsSent += 1;
      if (response?.ok) {
        this.lastOrder = { ...target, at: performance.now(), units: response.units ?? ids.length, attack: Boolean(pointer.event?.shiftKey) };
        setStatus(`已下令 ${response.units ?? ids.length} 个单位（往返 ${Math.round(performance.now() - sentAt)} ms）`);
      } else {
        debug.commandErrors.push(response?.code ?? 'UNKNOWN');
        setStatus(`命令被拒绝：${response?.code ?? 'UNKNOWN'}`, true);
      }
    });
    this.orderFlash = { x: target.x, y: target.y, until: performance.now() + 700, attack: Boolean(pointer.event?.shiftKey) };
  }

  update(time, delta) {
    this.mapCamera.update(delta / 1000);
    this.interpolate(performance.now());
    this.unitRenderer.draw(delta / 1000);
    this.fogRenderer.sync();
    this.drawOverlay();
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
    this.overlay.clear();
    const rect = this.selection.getDragRect();
    if (rect) {
      this.overlay.fillStyle(0x000000, 0.08);
      this.overlay.fillRect(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top);
      this.overlay.lineStyle(2, 0xf1e9d2, 0.9);
      this.overlay.strokeRect(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top);
    }
    const flash = this.orderFlash;
    if (flash && flash.until > performance.now()) {
      this.overlay.lineStyle(3, flash.attack ? 0xff7043 : 0x9be15d, 0.9);
      this.overlay.strokeCircle(flash.x, flash.y, 18);
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
  }

  // 迷雾完全由客户端本地算：只用到己方单位/城市/占领点（与服务器同一套规则）
  debug.fogAuthority = snapshot.fogAuthority ?? 'client';
  updateFog(world);

  // 快照里消失的单位：
  //   · 己方 → 阵亡
  //   · 敌方 → 迷雾在客户端（快照是全量）时，缺席即阵亡；服务端过滤模式下，缺席可能只是脱离视野
  for (const unit of world.units) {
    if (seen.has(unit.id) || unit.state === 'dead') continue;
    if (unit.faction === myFaction) { unit.state = 'dead'; continue; }
    if (debug.fogAuthority !== 'server' || isSpotted(world, unit, myFaction)) unit.state = 'dead';
  }

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
  if (hud.room) hud.room.textContent = `房间 ${roomCode || '—'} · ${debug.myFaction === 'red' ? '红方' : '蓝方'}`;
  if (!snapshot) return;
  if (hud.timer) hud.timer.textContent = snapshot.phase === 'prep' ? '准备中' : fmtClock(snapshot.timeLeftMs);
  const cities = snapshot.cities ?? [];
  const blue = cities.filter((city) => city.faction === 'blue').length;
  const red = cities.filter((city) => city.faction === 'red').length;
  if (hud.cities) hud.cities.textContent = `城市 ${blue} : ${red}`;
  if (hud.enemies) hud.enemies.textContent = `可见敌军 ${debug.visibleEnemies ?? 0}`;
  if (hud.net) {
    hud.net.textContent = debug.rttMs === null ? 'RTT —' : `RTT ${debug.rttMs} ms`;
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
    ? '平局'
    : (result?.winner === debug.myFaction ? '胜利！' : '失败');
  if (hud.resultTitle) hud.resultTitle.textContent = title;
  const reasonText = {
    'captured-all-cities': '占领全部城市',
    'time-limit': '到达时限，按城市数/兵力判定',
    forfeit: '对手退出对局',
    'disconnect-timeout': '对手掉线超时（判定胜负）',
    aborted: '对局中断（服务器重启）',
  }[result?.reason] ?? (result?.reason ?? '');
  if (hud.resultDetail) {
    hud.resultDetail.textContent = `${reasonText} · 用时 ${fmtClock(result?.atMs ?? 0)}`
      + (result?.casualties ? ` · 伤亡 蓝 ${result.casualties.blue} / 红 ${result.casualties.red}` : '');
  }
  setStatus('对局结束');
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
  setStatus('已连接，进入房间…');
  showBanner('');
  socket.emit('match:join', { roomCode, reconnectToken: readToken() }, (response) => {
    if (!response?.ok) {
      const code = response?.code ?? 'UNKNOWN';
      if (code === 'RECONNECT_EXPIRED') {
        setStatus('掉线超时，本局已判负', true);
        showBanner('掉线超过宽限时间，对局已结束', 'bad');
      } else if (code === 'ROOM_NOT_FOUND' && readToken()) {
        setStatus('对局已中断（服务器可能重启过）', true);
        showBanner('对局已中断：房间不存在（服务器可能重启过）', 'bad');
      } else {
        setStatus(`进入对局失败：${code}`, true);
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
    setStatus(`已进入对局（${debug.myFaction === 'red' ? '红方' : '蓝方'}）${response.reconnected ? ' · 已重连续局' : ''}`);
    if (response.match?.result) showResult(response.match.result);
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
    setStatus('socket.io 客户端未加载（检查 /socket.io/socket.io.js）', true);
    return;
  }
  socket.on('connect', onConnect);
  socket.on('tick', (snapshot) => applySnapshot(snapshot));
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
    setStatus(`对手掉线（${payload?.username ?? '对手'}），等待重连…`);
  });
  socket.on('opponent:rejoin', (payload) => {
    if (payload?.userId && debug.myUserId && payload.userId === debug.myUserId) return;
    debug.opponentLeft = false;
    showBanner('对手已重连，对局继续', 'ok');
    window.setTimeout(() => showBanner(''), 2500);
    setStatus('对手已重连');
  });
  socket.on('connect_error', (error) => {
    debug.socketConnected = false;
    setStatus(`连接失败：${error.message}`, true);
    showBanner('连接失败，正在重试…', 'bad');
  });
  socket.on('disconnect', (reason) => {
    debug.socketConnected = false;
    setStatus(`连接断开：${reason}`, true);
    showBanner('与你服务器的连接断开，正在重连…', 'warn');
  });
  if (socket.connected) onConnect();
}

// ---------------- 启动 ----------------
// 先绑网络（socket 已经在模块顶层开始连接），再异步加载关卡/地图并起 Phaser。
bindSocket();

async function boot() {
  if (!roomCode) {
    setStatus('缺少房间参数（应形如 pvp-battle.html?room=ABC123&level=dujiang_pvp）', true);
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
