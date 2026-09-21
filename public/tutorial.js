(function(){
"use strict";
console.log("%c[教学系统] tutorial.js 已加载", "color:#4ec9a0;font-weight:bold");

/* ============================================================
 *  War of Dots · 教学关卡系统
 *  带勾选面板的步骤式引导：玩家每完成一个操作才能解锁下一个
 * ============================================================ */

const TUTORIAL_LEVEL_ID = "fracture-canyon-tutorial";


/* ============================================================
 *  剧情过场（对话式 + 打字机效果）**已整体移除**
 *  以前进入教学关会先播一段开场对话（第一关 9 段 / 第二关 13 段），
 *  打完再播一段结束对话（6 段 / 5 段），玩家确认后才开始教学引导。
 *  现在两关都直接进教学面板、打完直接回作战地图，不再有对话过场。
 *  对应的素材（assets/tutorial/ 下的背景图 / 立绘 / 过场音效）也一并删掉了；
 *  要恢复请翻 git 历史：剧情配置对象与过场构建函数都在那次删除之前的版本里。
 * ============================================================ */

/* ---------- 教学步骤定义 ---------- */
let steps = [
  {
    id: "select",
    title: "选择部队",
    desc: "用鼠标左键点击一支蓝色部队，将其选中。",
    hint: "左键单击蓝色单位",
    allowedButtons: [0],       // 只允许左键
    requireSelection: false,
  },
  {
    id: "move",
    title: "移动部队",
    desc: "选中部队后，用鼠标右键点击空地，部队将向该处移动。",
    hint: "右键点击空地执行移动",
    allowedButtons: [2],       // 只允许右键
    requireSelection: true,
  },
  {
    id: "attack",
    title: "攻击敌军",
    desc: "前方不远处有一支红色敌军。保持部队选中，用右键点击红色敌军单位，发动强制攻击。",
    hint: "右键点击前方的红色敌军",
    allowedButtons: [2],
    requireSelection: true,
  },
  {
    id: "deselect",
    title: "取消选择",
    desc: "按下键盘 Esc 键，取消当前所有选中的部队。",
    hint: "按 Esc 键取消选择",
    allowedButtons: [],        // 不允许鼠标操作
    requireSelection: false,
    keyTrigger: "Escape",
  },
  {
    id: "dragselect",
    title: "框选多支部队",
    desc: "在空地上按住左键并拖动，拉出一个选框，可同时选中范围内的多支部队。",
    hint: "左键拖动框选多支部队",
    allowedButtons: [0],
    requireSelection: false,
    expectMultiSelect: true,
  },
  {
    id: "shiftselect",
    title: "增减选择",
    desc: "按住 Shift 键的同时左键点击单位，可以追加或移除选中的部队。",
    hint: "Shift + 左键 增减选择",
    allowedButtons: [0],
    requireSelection: false,
    requireShift: true,
  },
  {
    id: "drawroute",
    title: "绘制行军轨迹",
    desc: "从已选中的部队身上按住左键拖动，可绘制多路径点的行军轨迹。",
    hint: "从已选单位左键拖动绘制路线",
    allowedButtons: [0],
    requireSelection: true,
    expectRouteDraw: true,
  },
];

/* ================================================================
   第二关：地形以及补给系统 配置
   ================================================================ */
const STEPS_LEVEL2 = [
  {
    id: "select",
    title: "选择部队",
    desc: "用左键点击一支部队将其选中。选中后部队上方会出现选择标记，这是下达一切命令的前提。",
    hint: "左键点击蓝色部队选中",
    allowedButtons: [0],
    requireSelection: false,
  },
  {
    id: "plainmarch",
    title: "平原行军",
    desc: "选中部队后，右键点击前方平原区域下达移动命令。平原是最基础的地形：移动速度×1.0，防御×1.0，无任何加成或惩罚。",
    hint: "右键点击前方平原，部队开始移动",
    allowedButtons: [2],
    requireSelection: true,
    targetPoint: { x: 130, y: 550 },
    targetRadius: 40,
  },
  {
    id: "roadmarch",
    title: "道路急行军",
    desc: "右键点击前方道路。道路是机动的命脉：移动速度×1.25（比平原快25%）。大部队转移务必走道路！",
    hint: "右键点击道路区域，体会更快的移动速度",
    allowedButtons: [2],
    requireSelection: true,
    targetPoint: { x: 350, y: 560 },
    targetRadius: 70,
  },
  {
    id: "forestmarch",
    title: "森林潜行",
    desc: "右键点击前方森林。森林中移动速度×0.6（明显变慢），但防御×0.85，且视野内敌军可见距离缩短——适合隐蔽设伏。",
    hint: "右键点击森林区域，体会移动减速",
    allowedButtons: [2],
    requireSelection: true,
    targetPoint: { x: 270, y: 440 },
    targetRadius: 80,
  },
  {
    id: "mountainmarch",
    title: "山地设伏",
    desc: "右键点击前方山地。山地移动速度×0.65，但防御×0.75（受到伤害降低25%）。高山（颜色更深）不可通行。山地是防御战的天然屏障。",
    hint: "右键点击山地区域，体会易守难攻",
    allowedButtons: [2],
    requireSelection: true,
    targetPoint: { x: 800, y: 220 },
    targetRadius: 80,
  },
  {
    id: "townmarch",
    title: "城镇据守",
    desc: "右键点击前方城镇。城镇是防御最强的地形：防御修正×0.6（受到伤害仅为60%）！占领城镇据守，能以少胜多。",
    hint: "右键点击城镇区域，进入最强防御地形",
    allowedButtons: [2],
    requireSelection: true,
    targetPoint: { x: 640, y: 360 },
    targetRadius: 50,
  },
  {
    id: "watermarch",
    title: "水域涉渡",
    desc: "右键点击前方水域。水域是绝地：移动速度×0.4（最慢），攻击力×0.5（站不稳），且每秒掉血1点！非必要绝不涉水，尽量在岸上攻击水中之敌。",
    hint: "右键点击水域区域，体会最恶劣的地形",
    allowedButtons: [2],
    requireSelection: true,
    targetPoint: { x: 450, y: 350 },
    targetRadius: 70,
  },
  {
    id: "supplyobserve",
    title: "观察补给线",
    desc: "选中一支部队，观察从己方城市延伸出来的蓝色细线——那就是补给线！血条下方的青蓝色条是补给存量。点击高亮标记的补给线位置，表示你找到了它。",
    hint: "左键选中部队，然后点击高亮的补给线位置",
    allowedButtons: [0],
    requireSelection: false,
    targetPoint: { x: 250, y: 580 },
    targetRadius: 50,
  },
  {
    id: "supplycut",
    title: "远离补给区",
    desc: "把部队移动到敌方区域，观察补给线断开！只要补给线被切断，部队就断了粮道——存量只减不增，打光了就只能撤退！",
    hint: "右键点击敌方区域（地图中标注的位置），等待补给线断开",
    allowedButtons: [2],
    requireSelection: true,
    targetPoint: { x: 780, y: 260 },
    targetRadius: 60,
  },
  {
    id: "terrainattack",
    title: "依托地形歼敌",
    desc: "现在你已体会了全部地形！选择有利地形（如城镇、山地）据守，右键点击红色敌军发动攻击。善用地形者，以少胜多。",
    hint: "右键点击红色敌军，利用地形优势歼敌",
    allowedButtons: [2],
    requireSelection: true,
  },
];

/* ---------- 状态 ---------- */
const state = {
  stepIndex: 0,
  completed: new Array(steps.length).fill(false),
  finished: false,
  dragging: false,
  dragStart: null,
  dragMoved: false,
  routeDrawing: false,
  lastSelectionSize: 0,
  shiftUsed: false,
  movedConfirmed: false,
  attackedConfirmed: false,
};

/* ---------- DOM 引用 ---------- */
const $ = (sel) => document.querySelector(sel);
const battlefield = () => document.querySelector("#battlefield canvas") || document.querySelector("canvas");

function isCanvasEvent(e) {
  const c = battlefield();
  return !!c && (e.target === c || c.contains(e.target));
}

function canvasPoint(e) {
  const c = battlefield();
  if (!c) return null;
  const r = c.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return null;
  return {
    x: (e.clientX - r.left) * (1280 / r.width),
    y: (e.clientY - r.top) * (800 / r.height),
  };
}

function checkSupplyCut() {
  try {
    const game = window.__rtsGame;
    if (!game || !game.scene) return false;
    for (const s of game.scene.scenes) {
      if (!s.scene || !s.scene.isActive || !s.scene.isActive()) continue;
      const world = s.world, selection = s.selection;
      if (!world || !selection) continue;
      for (const unit of world.units) {
        if (unit.state === "dead") continue;
        if (selection.isSelected(unit.id) && unit.supplied === false) return true;
      }
    }
  } catch (e) {}
  return false;
}

function activeSelectionCount() {
  return document.querySelectorAll("#unitList .unit-card.active").length;
}

/* ---------- 阻止事件 ---------- */
function blockEvent(e) {
  e.preventDefault();
  e.stopPropagation();
  if (e.stopImmediatePropagation) e.stopImmediatePropagation();
  return false;
}

/* ---------- 提示消息 ---------- */
let hintTimer = null;
function flashHint(text) {
  const el = $("#tutCurrentHint");
  if (!el) return;
  const old = el.textContent;
  el.textContent = text;
  el.classList.add("flash");
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => {
    el.classList.remove("flash");
    if (!state.finished) el.textContent = steps[state.stepIndex].hint;
  }, 1400);
}

/* ---------- 剧情过场构建（对话式 + 打字机效果） ---------- */
function setGamePaused(paused) {
  try {
    const game = window.__rtsGame;
    if (!game || !game.scene) return;
    for (const s of game.scene.scenes) {
      if (s.scene && s.scene.isActive && s.scene.isActive()) {
        if (s.controller) s.controller.paused = paused;
      }
    }
  } catch (e) {}
}


/* ---------- 地图目标区域标注 ---------- */
let targetMarker = null;
function showTargetMarker() {
  hideTargetMarker();
  const step = steps[state.stepIndex];
  if (!step || !step.targetPoint) return;
  try {
    const game = window.__rtsGame;
    if (!game || !game.scene) return;
    let scene = null;
    for (const s of game.scene.scenes) {
      if (s.scene && s.scene.isActive && s.scene.isActive()) { scene = s; break; }
    }
    if (!scene) return;
    const g = scene.add.graphics();
    const tp = step.targetPoint;
    const r = step.targetRadius || 80;
    g.fillStyle(0x4ec9a0, 0.18);
    g.fillCircle(tp.x, tp.y, r);
    g.lineStyle(3, 0x4ec9a0, 0.9);
    g.strokeCircle(tp.x, tp.y, r);
    g.lineStyle(2, 0xffffff, 0.7);
    g.lineBetween(tp.x - 8, tp.y, tp.x + 8, tp.y);
    g.lineBetween(tp.x, tp.y - 8, tp.x, tp.y + 8);
    // 补给线观察步骤：画蓝色脉冲圆圈，表示补给线位置
    if (steps[state.stepIndex].id === "supplyobserve") {
      g.fillStyle(0x4488ff, 0.25);
      g.fillCircle(tp.x, tp.y, 25);
      g.lineStyle(3, 0x66aaff, 0.9);
      g.strokeCircle(tp.x, tp.y, 25);
    }
    targetMarker = g;
  } catch (e) {}
}
function hideTargetMarker() {
  if (targetMarker) {
    try { targetMarker.destroy(); } catch (e) {}
    targetMarker = null;
  }
}

/* ---------- 面板构建 ---------- */
function buildPanel() {
  const style = document.createElement("style");
  style.id = "tutorialStyle";
  style.textContent = `
    #tutorialChecklist {
      position: fixed; right: 16px; top: 96px; z-index: 9999;
      width: 300px; max-height: calc(100vh - 140px); overflow-y: auto;
      background: linear-gradient(160deg, rgba(30,19,9,.96), rgba(16,10,4,.95));
      border: 1px solid #6b4a22;
      border-radius: 6px; box-shadow:
        inset 0 0 0 1px rgba(201,162,74,.22),
        0 8px 28px rgba(0,0,0,.55);
      color: #f4ecd0; font-family: "STKaiti","KaiTi","SimHei","Microsoft YaHei",sans-serif;
      pointer-events: auto;
    }
    #tutorialChecklist::-webkit-scrollbar { width: 5px; }
    #tutorialChecklist::-webkit-scrollbar-thumb { background: rgba(201,162,74,.4); border-radius: 3px; }
    .tut-header {
      padding: 14px 16px 10px; border-bottom: 1px solid rgba(201,162,74,.25);
    }
    .tut-header .tut-tag {
      font-size: 10px; letter-spacing: 3px; color: #c9a24a; font-weight: 700;
    }
    .tut-header h3 {
      margin: 4px 0 0; font-size: 17px; font-weight: 700; color: #f4ecd0;
    }
    .tut-progress-bar {
      height: 5px; margin-top: 10px; background: rgba(255,255,255,.08);
      border-radius: 3px; overflow: hidden;
    }
    .tut-progress-bar i {
      display: block; height: 100%; width: 0%;
      background: linear-gradient(90deg, #6f8f4a, #b9d08a);
      transition: width .35s ease;
    }
    .tut-step-list { padding: 6px 0; }
    .tut-step {
      display: flex; align-items: flex-start; gap: 10px;
      padding: 9px 16px; cursor: default; transition: background .2s;
      border-left: 3px solid transparent;
    }
    .tut-step:hover { background: rgba(255,255,255,.04); }
    .tut-step.active {
      background: rgba(111,143,74,.14); border-left-color: #6f8f4a;
    }
    .tut-step.done { opacity: .6; }
    .tut-check {
      flex-shrink: 0; width: 20px; height: 20px; margin-top: 1px;
      border: 2px solid rgba(201,162,74,.55); border-radius: 5px;
      display: flex; align-items: center; justify-content: center;
      font-size: 13px; font-weight: 700; color: transparent;
      transition: all .25s;
    }
    .tut-step.done .tut-check {
      background: #c9a24a; border-color: #c9a24a; color: #1c1207;
    }
    .tut-step.active .tut-check {
      border-color: #6f8f4a; box-shadow: 0 0 8px rgba(111,143,74,.55);
      animation: tutPulse 1.6s ease-in-out infinite;
    }
    @keyframes tutPulse {
      0%,100% { box-shadow: 0 0 4px rgba(111,143,74,.35); }
      50% { box-shadow: 0 0 12px rgba(111,143,74,.75); }
    }
    .tut-step-body { flex: 1; min-width: 0; }
    .tut-step-title {
      font-size: 13.5px; font-weight: 600; color: #e8d9b0;
      display: flex; align-items: center; gap: 6px;
    }
    .tut-step.active .tut-step-title { color: #fff7e6; }
    .tut-step-num {
      font-size: 10px; color: #b9a87a; font-weight: 700;
      background: rgba(201,162,74,.12); padding: 1px 5px; border-radius: 3px;
    }
    .tut-step-desc {
      font-size: 11.5px; color: #b9a87a; line-height: 1.5; margin-top: 3px;
      display: none;
    }
    .tut-step.active .tut-step-desc { display: block; }
    .tut-current-hint {
      margin: 0 16px 12px; padding: 8px 11px;
      background: rgba(111,143,74,.14); border-left: 3px solid #6f8f4a;
      border-radius: 0 5px 5px 0; font-size: 12px; color: #cfe0b0;
      line-height: 1.5;
    }
    .tut-current-hint.flash {
      background: rgba(244,190,79,.15); border-left-color: #f4be4f; color: #ffe2a8;
    }
    .tut-footer {
      padding: 10px 16px; border-top: 1px solid rgba(201,162,74,.25);
      font-size: 11px; color: #b9a87a; display: flex; justify-content: space-between;
    }
    .tut-footer button {
      background: none; border: 1px solid rgba(201,162,74,.4); color: #c9a24a;
      font-size: 11px; padding: 3px 10px; border-radius: 4px; cursor: pointer;
      font-family: inherit;
    }
    .tut-footer button:hover { background: rgba(201,162,74,.12); }
    #tutorialChecklist.all-done { border-color: rgba(201,162,74,.6); }
    #tutorialChecklist.all-done .tut-header h3 { color: #e8c879; }
  `;
  document.head.appendChild(style);

  const panel = document.createElement("div");
  panel.id = "tutorialChecklist";
  panel.innerHTML = `
    <div class="tut-header">
      <div class="tut-tag">${panelTag}</div>
      <h3>${panelTitle}</h3>
      <div class="tut-progress-bar"><i id="tutProgressFill"></i></div>
    </div>
    <div class="tut-step-list" id="tutStepList"></div>
    <div class="tut-current-hint" id="tutCurrentHint"></div>
    <div class="tut-footer">
      <span id="tutFooterText">按顺序完成操作</span>
      <button id="tutSkipBtn">跳过教学</button>
    </div>
  `;
  document.body.appendChild(panel);

  $("#tutSkipBtn").addEventListener("click", () => {
    if (confirm("确定要跳过教学吗？你可以随时在关卡选择中重新进入。")) {
      finishTutorial();
    }
  });

  renderSteps();
}

/* ---------- 渲染步骤列表 ---------- */
function renderSteps() {
  const list = $("#tutStepList");
  if (!list) return;
  list.innerHTML = steps.map((s, i) => `
    <div class="tut-step ${state.completed[i] ? "done" : ""} ${i === state.stepIndex && !state.finished ? "active" : ""}" data-index="${i}">
      <div class="tut-check">✓</div>
      <div class="tut-step-body">
        <div class="tut-step-title">
          <span class="tut-step-num">${String(i + 1).padStart(2, "0")}</span>
          ${s.title}
        </div>
        <div class="tut-step-desc">${s.desc}</div>
      </div>
    </div>
  `).join("");

  const hint = $("#tutCurrentHint");
  if (hint) {
    hint.textContent = state.finished ? "所有基础操作已掌握！" : steps[state.stepIndex].hint;
  }

  const doneCount = state.completed.filter(Boolean).length;
  const fill = $("#tutProgressFill");
  if (fill) fill.style.width = `${(doneCount / steps.length) * 100}%`;

  const footer = $("#tutFooterText");
  if (footer) {
    footer.textContent = state.finished
      ? "训练完成"
      : `进度 ${doneCount} / ${steps.length}`;
  }

  const panel = $("#tutorialChecklist");
  if (panel && state.finished) panel.classList.add("all-done");
}

/* ---------- 完成当前步骤 ---------- */
function completeCurrentStep() {
  if (state.finished) return;
  const idx = state.stepIndex;
  if (state.completed[idx]) return;

  state.completed[idx] = true;
  // 第一步（选中部队）完成后，才恢复游戏，让准备阶段倒计时重新开始
  if (idx === 0) setGamePaused(false);

  // 第一关：移动步骤完成显示迷雾消散
  if (currentLevelId === "fracture-canyon-tutorial" && idx === 1) {
    showFogToast();
  }
  // 第二关：地形步骤完成显示地形提示
  if (currentLevelId === "tactical-training-tutorial") {
    const sid = steps[idx].id;
    if (TERRAIN_TOASTS[sid]) {
      showTerrainToast(TERRAIN_TOASTS[sid]);
    }
  }

  // 播放完成音效（如果有）
  try { window.playSfx && window.playSfx("click"); } catch (_) {}

  if (idx >= steps.length - 1) {
    finishTutorial();
    return;
  }

  state.stepIndex = idx + 1;
  // 重置部分状态
  state.dragging = false;
  state.dragMoved = false;
  state.routeDrawing = false;
  state.shiftUsed = false;
  state.movedConfirmed = false;
  state.attackedConfirmed = false;
  state.lastSelectionSize = activeSelectionCount();

  renderSteps();
  showTargetMarker();
}

function finishTutorial() {
  state.finished = true;
  for (let i = 0; i < steps.length; i++) state.completed[i] = true;
  renderSteps();
  // 标记教学关卡完成（进度按账号隔离，见 public/user-storage.js）
  try {
    const store = window.UserStorage;
    const prog = store.readJSON("campaign-progress", {}) || {};
    prog[currentLevelId] = Object.assign({}, prog[currentLevelId] || {}, { completed: true, wins: 1 });
    store.writeJSON("campaign-progress", prog);
  } catch (_) {}
  // 隐藏教学面板，播放结束剧情
  const panel = document.getElementById("tutorialChecklist");
  if (panel) panel.style.display = "none";
  const toast = document.getElementById("toast");
  if (toast) toast.style.display = "none";
  // 延迟一小段时间让玩家看到全部打勾，再回作战地图（结束剧情已移除）
  setTimeout(() => {
    window.location.href = "/battlechoose.html";
  }, 1200);
}

// 显示迷雾消散的浮动提示（第一关，保持原样）
function showFogToast() {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = "迷雾已消散 · 部队视野扩大";
  toast.style.fontSize = "22px";
  toast.style.fontWeight = "700";
  toast.style.letterSpacing = "2px";
  toast.style.padding = "14px 28px";
  toast.classList.add("show");
  setTimeout(() => {
    toast.classList.remove("show");
    toast.style.fontSize = "";
    toast.style.fontWeight = "";
    toast.style.letterSpacing = "";
    toast.style.padding = "";
  }, 2200);
}

// 显示地形提示（第二关，字体更小）
function showTerrainToast(text) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = text;
  toast.style.fontSize = "16px";
  toast.style.fontWeight = "600";
  toast.style.letterSpacing = "1px";
  toast.style.padding = "10px 24px";
  toast.classList.add("show");
  setTimeout(() => {
    toast.classList.remove("show");
    toast.style.fontSize = "";
    toast.style.fontWeight = "";
    toast.style.letterSpacing = "";
    toast.style.padding = "";
  }, 2400);
}

// 地形提示映射（第二关）
const TERRAIN_TOASTS = {
  plainmarch: "平原地形 · 移动×1.0 防御×1.0",
  roadmarch: "道路地形 · 移动×1.25",
  forestmarch: "森林地形 · 移动×0.6 隐蔽性好",
  mountainmarch: "山地地形 · 移动×0.65 防御×0.75",
  townmarch: "城镇地形 · 防御×0.6 据守最佳",
  watermarch: "水域地形 · 移动×0.4 攻击×0.5 每秒掉血"
};

/* ---------- 事件处理：操作锁定 ---------- */
// 把 DOM 鼠标事件坐标转换为 Phaser 世界坐标
function getWorldPoint(e) {
  try {
    // 优先用游戏入口暴露的全局实例
    let g = window.__rtsGame;
    // 兜底：Phaser.GAMES 数组
    if (!g && typeof Phaser !== "undefined" && Phaser.GAMES) g = Phaser.GAMES[0];
    // 兜底：通过 canvas 元素查找
    if (!g) {
      const canvas = document.querySelector("canvas");
      if (canvas && canvas.parentElement) {
        for (const key in canvas.parentElement) {
          if (canvas.parentElement[key] && canvas.parentElement[key].input) {
            g = canvas.parentElement[key];
            break;
          }
        }
      }
    }
    if (g && g.input && g.input.activePointer) {
      const wp = { x: g.input.activePointer.worldX, y: g.input.activePointer.worldY };
      return wp;
    }
  } catch (err) {}
  return null;
}

function handlePointerDown(e) {
  if (state.finished) return;
  if (!isCanvasEvent(e)) return;

  const step = steps[state.stepIndex];
  const p = canvasPoint(e);

  // Esc 步骤不响应鼠标
  if (step.allowedButtons.length === 0) {
    blockEvent(e);
    flashHint("请按 Esc 键取消选择");
    return;
  }

  // 检查按键是否被允许
  if (!step.allowedButtons.includes(e.button)) {
    blockEvent(e);
    if (e.button === 0 && step.allowedButtons.includes(2)) {
      flashHint("当前步骤需要使用右键操作");
    } else if (e.button === 2 && step.allowedButtons.includes(0)) {
      flashHint("当前步骤需要使用左键操作");
    } else {
      flashHint(step.hint);
    }
    return;
  }

  // 检查是否需要先选中单位
  if (step.requireSelection && activeSelectionCount() === 0) {
    blockEvent(e);
    flashHint("请先选择一支部队（左键点击蓝色单位）");
    return;
  }

  // 观察补给线步骤特殊处理：已选中部队后，左键点击高亮位置时拦截事件并完成
  if (step.id === "supplyobserve" && e.button === 0 && activeSelectionCount() > 0) {
    const wp = getWorldPoint(e);
    if (wp && step.targetPoint) {
      const dx = wp.x - step.targetPoint.x;
      const dy = wp.y - step.targetPoint.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= (step.targetRadius || 50)) {
        blockEvent(e);
        setTimeout(() => completeCurrentStep(), 200);
        return;
      }
    }
  }

  // 检查目标区域（第二关地形步骤：只能点击指定地形区域）
  if (step.targetPoint && e.button === 2) {
    const wp = getWorldPoint(e);
    if (!wp) {
      // 获取不到世界坐标时也阻止，避免任意点击完成任务
      blockEvent(e);
      flashHint(step.hint);
      return;
    }
    const dx = wp.x - step.targetPoint.x;
    const dy = wp.y - step.targetPoint.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const radius = step.targetRadius || 120;
    if (dist > radius) {
      blockEvent(e);
      const terrainName = step.title.replace(/行军|急行军|潜行|设伏|据守|涉渡/g, "");
      flashHint("请点击" + terrainName + "区域（地图中标注的位置），其他区域暂不可点击");
      return;
    }
  }

  // Shift 步骤检查
  if (step.requireShift && !(e.shiftKey || e.event?.shiftKey)) {
    blockEvent(e);
    flashHint("需要按住 Shift 键再点击");
    return;
  }

  // 记录拖拽开始
  if (e.button === 0 && p) {
    state.dragging = true;
    state.dragStart = { x: e.clientX, y: e.clientY };
    state.dragMoved = false;

    // 绘制轨迹步骤：检查是否从已选单位开始
    if (step.expectRouteDraw) {
      const selCount = activeSelectionCount();
      if (selCount > 0) {
        state.routeDrawing = true;
      }
    }
  }

  // 右键移动/攻击（支持多关卡步骤ID）
  if (e.button === 2) {
    const moveIds = ["move", "plainmarch", "roadmarch", "forestmarch", "mountainmarch", "townmarch", "watermarch"];
    const attackIds = ["attack", "terrainattack"];
    const curIdx = state.stepIndex;
    if (moveIds.includes(step.id)) {
      state.movedConfirmed = true;
      setTimeout(() => {
        if (state.stepIndex === curIdx && state.movedConfirmed) completeCurrentStep();
      }, 300);
    }
    if (attackIds.includes(step.id)) {
      state.attackedConfirmed = true;
      setTimeout(() => {
        if (state.stepIndex === curIdx && state.attackedConfirmed) completeCurrentStep();
      }, 300);
    }
    // 观察补给线步骤：左键点击高亮位置且已选中部队
    if (step.id === "supplyobserve" && activeSelectionCount() > 0) {
      setTimeout(() => { completeCurrentStep(); }, 200);
    }
    // 切断补给线步骤：右键点击目标区域后，持续检测补给线是否真正断开
    if (step.id === "supplycut") {
      flashHint("部队正在移动…等待补给线断开");
      let checkCount = 0;
      const checkTimer = setInterval(() => {
        checkCount++;
        if (state.finished || steps[state.stepIndex].id !== "supplycut") { clearInterval(checkTimer); return; }
        if (checkSupplyCut()) {
          clearInterval(checkTimer);
          completeCurrentStep();
        }
        if (checkCount > 40) { clearInterval(checkTimer); } // 20秒超时
      }, 500);
    }
    // 最后总攻步骤：框选后右键攻击即完成
  }
}

function handlePointerMove(e) {
  if (state.finished || !state.dragging) return;
  if (!state.dragStart) return;
  const dx = e.clientX - state.dragStart.x;
  const dy = e.clientY - state.dragStart.y;
  if (Math.hypot(dx, dy) > 6) {
    state.dragMoved = true;
  }
}

function handlePointerUp(e) {
  if (state.finished) return;
  if (!isCanvasEvent(e)) return;

  const step = steps[state.stepIndex];

  if (e.button === 0 && state.dragging) {
    state.dragging = false;

    // 第1步：选择单位（单击，非拖拽）
    if (step.id === "select" && !state.dragMoved) {
      setTimeout(() => {
        if (state.stepIndex === 0 && activeSelectionCount() > 0) {
          completeCurrentStep();
        }
      }, 100);
    }

    // 第5步：框选多支部队
    if (step.id === "dragselect" && state.dragMoved) {
      setTimeout(() => {
        if (state.stepIndex === 4 && activeSelectionCount() >= 2) {
          completeCurrentStep();
        } else if (state.stepIndex === 4) {
          flashHint("请框选至少2支部队");
        }
      }, 120);
    }

    // 第6步：Shift增减选择
    if (step.id === "shiftselect" && !state.dragMoved) {
      if (e.shiftKey || e.event?.shiftKey) {
        state.shiftUsed = true;
        setTimeout(() => {
          if (state.stepIndex === 5 && state.shiftUsed) completeCurrentStep();
        }, 150);
      }
    }

    // 第7步：绘制行军轨迹
    if (step.id === "drawroute" && state.dragMoved && state.routeDrawing) {
      setTimeout(() => {
        if (state.stepIndex === 6) completeCurrentStep();
      }, 200);
    }

    state.dragStart = null;
    state.routeDrawing = false;
  }
}

function handleKeyDown(e) {
  if (state.finished) return;
  const step = steps[state.stepIndex];

  // Esc 步骤
  if (step.keyTrigger === "Escape" && e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    // 先让游戏处理Esc取消选择
    setTimeout(() => {
      if (state.stepIndex === 3) completeCurrentStep();
    }, 100);
    return;
  }

  // 非Esc步骤中，阻止Esc（避免跳过）
  // 实际上Esc在其他步骤也应该允许取消选择，但不触发完成
  // 这里不阻止，让游戏正常处理
}

function handleContextMenu(e) {
  if (state.finished) return;
  if (!isCanvasEvent(e)) return;
  const step = steps[state.stepIndex];
  // 只在允许右键的步骤允许contextmenu
  if (!step.allowedButtons.includes(2)) {
    e.preventDefault();
  }
}

/* ---------- DOM 观察：辅助检测 ---------- */
function watchDOM() {
  const selectIds = ["select", "recon"];
  const dragIds = ["dragselect"];
  const observer = new MutationObserver(() => {
    if (state.finished) return;
    const step = steps[state.stepIndex];
    const count = activeSelectionCount();

    // 选中步骤辅助：如果通过其他方式选中了单位
    if (selectIds.includes(step.id) && count > 0) {
      completeCurrentStep();
    }

    // 框选步骤辅助：框选后检测
    if (dragIds.includes(step.id) && count >= 4 && state.dragMoved) {
      completeCurrentStep();
    }

    state.lastSelectionSize = count;
  });

  observer.observe(document.body, { subtree: true, childList: true, attributes: true });

  // 定时检测兜底
  setInterval(() => {
    if (state.finished) return;
    const step = steps[state.stepIndex];
    const count = activeSelectionCount();

    if (selectIds.includes(step.id) && count > 0) completeCurrentStep();
    if (dragIds.includes(step.id) && count >= 4) completeCurrentStep();
  }, 400);
}

/* ---------- 关卡检测（与游戏 level-link.js 逻辑一致：query → hash → sessionStorage） ---------- */
const TUTORIAL_LEVEL_IDS = ["fracture-canyon-tutorial", "tactical-training-tutorial"];
function detectLevelId() {
  try {
    // 1. URL 查询参数 ?level=
    const fromQuery = new URLSearchParams(window.location.search).get("level");
    if (fromQuery) return fromQuery;
    // 2. URL hash #level=（服务器重写后 hash 永远保留）
    const hash = window.location.hash.replace(/^#/, "");
    const fromHash = new URLSearchParams(hash).get("level");
    if (fromHash) return fromHash;
    // 3. sessionStorage（同一标签页内的点击跳转）
    const fromStorage = window.sessionStorage.getItem("war-of-dots.campaign");
    if (fromStorage) return fromStorage;
  } catch (_) {}
  return null;
}
function isTutorialLevel(id) {
  return TUTORIAL_LEVEL_IDS.includes(id);
}

let currentLevelId = "fracture-canyon-tutorial";
let panelTitle = "新兵指挥训练";
let panelTag = "COMMAND TRAINING";

/* ---------- 初始化 ---------- */
let tutorialInitialized = false;
function init() {
  console.log("%c[教学系统] init() 被调用", "color:#4ec9a0");
  // 防重复初始化
  if (tutorialInitialized) { console.log("[教学系统] 已初始化，跳过"); return; }
  // 清理可能残留的旧元素
  const oldPanel = document.getElementById("tutorialChecklist");
  if (oldPanel) oldPanel.remove();
  const oldStyle = document.getElementById("tutorialStyle");
  if (oldStyle) oldStyle.remove();
  // 检测当前关卡，非教学关卡直接退出
  currentLevelId = detectLevelId();
  console.log("%c[教学系统] 检测到关卡ID: " + currentLevelId, "color:#4ec9a0");
  if (!currentLevelId || !isTutorialLevel(currentLevelId)) {
    console.log("%c[教学系统] 非教学关卡，退出", "color:#888");
    return;
  }
  tutorialInitialized = true;
  // 隐藏游戏自带的左侧任务面板（教学关卡用自己的任务面板）
  const hideStyle = document.createElement("style");
  hideStyle.id = "tutorialHideMission";
  hideStyle.textContent = ".vg-task-panel, #missionPanel, .feed-overlay { display: none !important; }";
  document.head.appendChild(hideStyle);
  if (currentLevelId === "tactical-training-tutorial") {
    steps = STEPS_LEVEL2;
    panelTitle = "地形以及补给系统";
    panelTag = "TERRAIN & SUPPLY";
  }
  console.log("%c[教学系统] 激活教学: " + panelTitle + " (" + steps.length + "步)", "color:#4ec9a0;font-weight:bold");
  // 重置状态（steps 可能已切换）
  state.stepIndex = 0;
  state.completed = new Array(steps.length).fill(false);
  state.finished = false;

  // 保留游戏原有的任务进度面板

  // 直接开始教学引导（开场剧情已移除）
  startTutorial();
}

/* ---------- 启动教学引导（init 里直接调用；以前是等开场剧情播完才调） ---------- */
function startTutorial() {
  buildPanel();

  // 事件监听（capture阶段，优先拦截）
  document.addEventListener("pointerdown", handlePointerDown, true);
  document.addEventListener("pointermove", handlePointerMove, true);
  document.addEventListener("pointerup", handlePointerUp, true);
  document.addEventListener("keydown", handleKeyDown, true);
  document.addEventListener("contextmenu", handleContextMenu, true);
  document.addEventListener("dragstart", (e) => e.preventDefault(), true);

  watchDOM();

  const waitCanvas = setInterval(() => {
    if (battlefield()) {
      clearInterval(waitCanvas);
      setTimeout(showTargetMarker, 500);
    }
  }, 200);

  console.log("%c[教学系统] 新兵指挥训练已激活", "color:#4ec9a0;font-weight:bold");
  // 游戏保持暂停，直到第一步（选中部队）完成后才恢复
}


// 直接调用 init（脚本在 body 末尾，DOM 已就绪）

try {
  init();
  
} catch (e) {
  console.error("[教学系统] init 出错:", e);
}

// 兜底：如果 init 因关卡ID未就绪而退出，轮询等待后重试
let tutorialRetries = 0;
const tutorialRetryTimer = setInterval(() => {
  tutorialRetries++;
  if (tutorialRetries > 30) { clearInterval(tutorialRetryTimer); return; }
  // 如果教学已经激活（面板存在），停止重试
  if (document.getElementById("tutorialChecklist")) { clearInterval(tutorialRetryTimer); return; }
  // 尝试从 sessionStorage 再次检测（游戏 BootScene 会写入）
  const retryId = detectLevelId();
  if (retryId && isTutorialLevel(retryId)) {
    clearInterval(tutorialRetryTimer);
    console.log("%c[教学系统] 重试成功，关卡ID: " + retryId, "color:#4ec9a0");
    init();
  }
}, 500);

})();
