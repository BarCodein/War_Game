// 战场外壳（单机战役 / PvP 对局页共用同一套 DOM 与样式）。
//
// 为什么要有这个模块：战役的 `game.html` 与联机对局页 `pvp-battle.html` 需要**完全一样的观感**
// （styles.css 的 class 只有一份），但又不能把同一坨 HTML 抄两遍。所以把"骨架"收敛到这里，
// 两个页面只留一个挂载点，调用 `mountBattleChrome({ mode })` 生成 DOM。
//
//   · mode = 'campaign'：顶栏 = brand / 任务名 / 主菜单 / 缩放 / 倍速 / 暂停；结算按钮 = 重新开始
//   · mode = 'pvp'     ：顶栏 = brand / 房间·阵营 / **认输** / 缩放 / 对手状态 + RTT；结算按钮 = 返回大厅
//                        （任务、暂停、倍速按需求去掉；左栏单位/城市、任务面板、战场通讯都不生成）
//
// 返回 `els`：所有 hud.js 会用到的元素引用（缺失的为 null，hud.js 已做判空）。

const BRAND = `
  <div class="brand">
    <span class="brand-mark">+</span>
    <div><strong>沙盘战争</strong><small>FRONTLINE COMMAND</small></div>
  </div>`;

function zoomControls() {
  return `
    <div class="zoom-controls">
      <span class="zoom-readout" id="zoomLabel">100%</span>
      <button class="icon-button" id="zoomReset" title="缩放复位到 100%（滚轮缩放）">⟲</button>
    </div>`;
}

function topBarFor(mode) {
  if (mode === 'pvp') {
    return `
      <header class="topbar">
        ${BRAND}
        <div class="mission-name">
          <span class="eyebrow" id="roomEyebrow">PvP MATCH</span>
          <span id="roomLabel">房间 —</span>
        </div>
        <div class="top-actions">
          ${zoomControls()}
          <div class="pvp-opponent" id="opponentChip" hidden>
            <span class="pvp-opponent-name" id="opponentName">对手</span>
            <em class="pvp-opponent-state" id="opponentState">在线</em>
          </div>
          <span class="status" id="pvpNet">RTT —</span>
          <span class="status" id="battleStatus">—</span>
          <button class="icon-button" id="resignButton" title="认输并返回大厅">认输</button>
        </div>
      </header>`;
  }
  return `
    <header class="topbar">
      ${BRAND}
      <div class="mission-name">
        <span class="eyebrow" id="missionEyebrow">OPERATION 07</span>
        <span id="missionLevelName">—</span>
      </div>
      <div class="top-actions">
        <button class="icon-button" id="exitPlaytest" title="返回编辑器" hidden>返回编辑器</button>
        <a class="icon-button editor-link" href="/index.html" title="主菜单">主菜单</a>
        ${zoomControls()}
        <div class="speed-controls">
          <button class="icon-button" data-speed="0.5" title="0.5×">½×</button>
          <button class="icon-button active" data-speed="1" title="1×">1×</button>
          <button class="icon-button" data-speed="2" title="2×">2×</button>
        </div>
        <button class="icon-button" id="pauseButton" title="暂停游戏">Ⅱ</button>
      </div>
    </header>`;
}

function canvasTipFor(mode) {
  if (mode === 'pvp') {
    return `
      <div class="canvas-tip" id="canvasTip">
        左键点选 / 空地拖拽框选 · 从己方单位拖出路径 = 移动 · 按住 E = 急行军 ·
        Shift+拖拽 = 追加路线 · 右键 = 攻击前进 · 右键目视敌军 = 锁定 · Shift+右键 = 排队 · S = 停止 · Esc = 取消选择
      </div>`;
  }
  return `
    <div class="canvas-tip">
      左键选择 · Shift 增减选 · 从已选单位拖动绘制轨迹 · 右键移动 / 攻击 ·
      按住 E + 右键 / E + 拖轨迹 = 急行军 · 滚轮缩放
    </div>`;
}

function victoryFor(mode) {
  const label = mode === 'pvp' ? '返回大厅' : '重新开始';
  return `
    <div class="victory-overlay" id="victoryOverlay">
      <div class="victory-card">
        <h2 id="victoryTitle">胜利</h2>
        <p id="victoryDetail"></p>
        <button id="restartButton" data-mode="${mode}">${label}</button>
      </div>
    </div>`;
}

// 战役专有的挂件：左栏（编队/城市卡，全屏时由 CSS 隐藏但 hud.js 仍会写）、任务浮层、
// 战场通讯（默认隐藏，只有新事件时淡入 4 秒）、标题行与底栏（全屏时隐藏）。
function campaignExtras() {
  return `
    <div class="game-layout-campaign">
      <aside class="left-panel panel">
        <div class="panel-heading"><span>我的编队</span><em id="unitCount">00 UNITS</em></div>
        <div id="unitList" class="unit-list"></div>
        <div class="panel-heading tech-title"><span>城市状态</span><em>CITY</em></div>
        <div class="status-card" id="cityCard"></div>
      </aside>
      <aside class="vg-task-panel" aria-label="任务">
        <div class="vg-task-title"><span class="vg-task-title-text">任务</span></div>
        <ul class="vg-task-list"></ul>
      </aside>
    </div>
    <div class="battlefield-head">
      <div><span class="eyebrow" id="tacticalEyebrow">TACTICAL VIEW / —</span><h1>前线态势</h1></div>
      <div class="battlefield-tools">
        <span class="selection-readout" id="selectionReadout">未选择单位</span>
        <span class="timer-readout" id="timer">00:00</span>
      </div>
    </div>`;
}

function campaignOverlays() {
  return `
    <div class="battle-overlay mission-overlay" id="missionPanel">
      <div class="overlay-heading"><span>任务进度</span><em id="missionPercent">0%</em></div>
      <div class="overlay-sub">夺取北方信标 · 控制并守住高地信标</div>
      <div class="progress"><i id="missionProgress" style="width:0%"></i></div>
      <div id="missionList"></div>
    </div>
    <div class="battle-overlay feed-overlay" id="feedOverlay">
      <div class="overlay-heading"><span>战场通讯</span></div>
      <div id="eventLog" class="event-log"><p><time>09:41</time><span class="event-tag blue">SYS</span>通讯已接通，等待战报。</p></div>
    </div>
    <div class="battlefield-foot">
      <span><i class="legend-dot friendly"></i>己方</span>
      <span><i class="legend-dot hostile"></i>敌方</span>
      <span><i class="legend-dot city-dot"></i>城市</span>
      <span class="coords" id="coords">GRID 00 : 00</span>
    </div>`;
}

/** 战场通讯"有新事件才出现、4 秒后淡出"（原 game.html 内联脚本的逻辑，挪到这里与骨架同源） */
function bindFeedFade(host) {
  const feed = host.querySelector('#feedOverlay');
  const log = host.querySelector('#eventLog');
  if (!feed || !log) return;
  let hideTimer = null;
  const showAndFade = () => {
    feed.classList.add('vg-feed-active');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => feed.classList.remove('vg-feed-active'), 4000);
  };
  setTimeout(showAndFade, 1500);
  new MutationObserver((mutations) => {
    if (mutations.some((mutation) => mutation.addedNodes.length > 0)) showAndFade();
  }).observe(log, { childList: true });
}

/**
 * 把战场外壳挂到 `#battle-root`（没有再退回到 body）。
 * @param {{mode?: 'campaign'|'pvp', root?: Element}} options
 */
export function mountBattleChrome({ mode = 'campaign', root = null } = {}) {
  const host = root ?? document.querySelector('#battle-root') ?? document.body;
  host.innerHTML = `
    <div class="vg-clock-panel" id="vgClockPanel">
      <span id="vgClockText">00:00</span>
    </div>
    ${topBarFor(mode)}
    ${mode === 'campaign' ? campaignExtras() : ''}
    <div class="game-layout">
      <section class="battlefield-wrap">
        <div class="canvas-frame">
          <div id="battlefield"></div>
          ${canvasTipFor(mode)}
          <div class="toast" id="toast"></div>
          ${mode === 'campaign' ? campaignOverlays() : ''}
        </div>
      </section>
    </div>
    ${victoryFor(mode)}
  `;
  if (mode === 'campaign') bindFeedFade(host);

  const query = (selector) => host.querySelector(selector);
  const els = {
    mode,
    host,
    battlefield: query('#battlefield'),
    vgClockText: query('#vgClockText'),
    zoomLabel: query('#zoomLabel'),
    zoomReset: query('#zoomReset'),
    toast: query('#toast'),
    overlay: query('#victoryOverlay'),
    overlayTitle: query('#victoryTitle'),
    overlayDetail: query('#victoryDetail'),
    restartButton: query('#restartButton'),
    // 战役专有（PvP 下为 null，hud.js 会跳过）
    pauseButton: query('#pauseButton'),
    speedButtons: host.querySelectorAll('[data-speed]'),
    exitPlaytest: query('#exitPlaytest'),
    unitList: query('#unitList'),
    unitCount: query('#unitCount'),
    cityCard: query('#cityCard'),
    selectionReadout: query('#selectionReadout'),
    missionPanel: query('#missionPanel'),
    missionList: query('#missionList'),
    missionPercent: query('#missionPercent'),
    missionProgress: query('#missionProgress'),
    eventLog: query('#eventLog'),
    timer: query('#timer'),
    coords: query('#coords'),
    missionEyebrow: query('#missionEyebrow'),
    missionLevelName: query('#missionLevelName'),
    tacticalEyebrow: query('#tacticalEyebrow'),
    vgTaskPanel: query('.vg-task-panel'),
    vgTaskList: query('.vg-task-list'),
    // PvP 专有
    roomLabel: query('#roomLabel'),
    roomEyebrow: query('#roomEyebrow'),
    opponentChip: query('#opponentChip'),
    opponentName: query('#opponentName'),
    opponentState: query('#opponentState'),
    pvpNet: query('#pvpNet'),
    battleStatus: query('#battleStatus'),
    resignButton: query('#resignButton'),
  };

  // PvP 专用样式（styles.css 里 body.pvp-mode 段）：时钟贴左上角、顶栏收紧、认输红描边
  document.body.classList.toggle('pvp-mode', mode === 'pvp');
  // 认输按钮的"样式"沿用 icon-button；危险动作给个红色描边（少量 PvP 专用样式，见 styles.css）
  els.resignButton?.classList.add('danger-button');
  return els;
}
