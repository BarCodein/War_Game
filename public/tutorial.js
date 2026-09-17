(function(){
"use strict";

/* ============================================================
 *  War of Dots · 教学关卡系统
 *  带勾选面板的步骤式引导：玩家每完成一个操作才能解锁下一个
 * ============================================================ */

const TUTORIAL_LEVEL_ID = "fracture-canyon-tutorial";

const params = new URLSearchParams(location.search);
const hashParams = new URLSearchParams(location.hash.replace(/^#/, ""));
const levelId = params.get("level") || hashParams.get("level");

// 仅在教学关卡激活
if (levelId !== TUTORIAL_LEVEL_ID) return;

/* ============================================================
 *  剧情过场配置（接口）
 *  进入教学关卡后先播放剧情，玩家确认后才开始教学引导。
 *  后续可替换为视频、图片或更丰富的内容：
 *  - video: 视频URL（留空则不显示视频）
 *  - backgroundImage: 背景图URL（留空则用纯色）
 *  - onStart: 剧情开始时回调
 *  - onComplete: 剧情结束、教学开始时回调
 * ============================================================ */
const TUTORIAL_STORY = {
  enabled: true,
  assetPath: "/assets/tutorial/",
  scenes: [
    { talker: "纵队司令部", text: "警报！全体注意！敌人大举进犯，立即进入战斗位置！", bg: "images/bg-warning.jpg", audio: "warning", alert: true, portrait: "images/port-hq.png" },
    { talker: "纵队司令部", text: "前线指挥所！听到请回答！我是纵队司令部作战科！", bg: "images/bg-warning.jpg", audio: "", alert: true, portrait: "images/port-hq.png" },
    { talker: "前线指挥员", text: "司令部！我是前线指挥员，已到岗！请指示！", bg: "images/bg-character.jpg", audio: "", alert: false, portrait: "images/port-commander.png" },
    { talker: "纵队司令部", text: "据侦察营急报：敌整编第七十四师正沿公路向我阵地推进，先头部队距我前沿不足十里，炮火随时可能覆盖！", bg: "images/bg-command.jpg", audio: "drum", alert: false, portrait: "images/port-hq.png" },
    { talker: "纵队司令部", text: "形势严峻！但我部多为新兵，各级指挥员尚缺乏实战经验。司令员亲自指示：必须在战斗打响前，完成基础指挥训练！", bg: "images/bg-command.jpg", audio: "drum", alert: false, portrait: "images/port-hq.png" },
    { talker: "纵队司令部", text: "现在我命令你：立即在训练场完成指挥训练——单位选择、部队机动、火力打击、多单位协同、行军路线规划！一项都不能少！", bg: "images/bg-command.jpg", audio: "drum", alert: false, portrait: "images/port-hq.png" },
    { talker: "纵队司令部", text: "时间紧迫！敌人的炮弹不长眼睛，每多练一分，战场上就多一分胜算！", bg: "images/bg-command.jpg", audio: "", alert: false, portrait: "images/port-hq.png" },
    { talker: "前线指挥员", text: "明白！请司令员放心！我保证在最短时间内完成训练，随时率部投入战斗！", bg: "images/bg-command.jpg", audio: "", alert: false, portrait: "images/port-commander.png" },
    { talker: "纵队司令部", text: "好！党和人民考验我们的时候到了！训练——开始！", bg: "images/bg-command.jpg", audio: "", alert: false, portrait: "images/port-hq.png" }
  ],
  buttonText: "开始教学关卡",
  onStart: null,
  onComplete: null
};

/* ---------- 教学步骤定义 ---------- */
const steps = [
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
function buildStoryOverlay() {
  if (!TUTORIAL_STORY.enabled) { startTutorial(); return; }
  if (typeof TUTORIAL_STORY.onStart === "function") TUTORIAL_STORY.onStart();

  const AP = TUTORIAL_STORY.assetPath;
  const scenes = TUTORIAL_STORY.scenes;
  let curIdx = 0;
  let audioUnlocked = false;
  let typingTimer = null;
  let isTyping = false;
  let typingAudio = null;
  const TYPE_SPEED = 45; // 每字毫秒

  // 样式
  const style = document.createElement("style");
  style.id = "tutorialStoryStyle";
  style.textContent = `
    #tutorialStoryOverlay {
      position: fixed; inset: 0; z-index: 10000;
      background: #111 center/cover no-repeat;
      font-family: SimHei, "Microsoft YaHei", sans-serif;
      overflow: hidden; animation: storyFadeIn .6s ease;
    }
    #tutorialStoryOverlay::before {
      content: ""; position: fixed; inset: 0;
      background: rgba(0,0,0,.55); z-index: 0;
    }
    @keyframes storyFadeIn { from { opacity: 0; } to { opacity: 1; } }
    #tutorialStoryOverlay.closing { animation: storyFadeOut .5s ease forwards; }
    @keyframes storyFadeOut { to { opacity: 0; visibility: hidden; } }
    .story-alert-flash {
      position: fixed; inset: 0; z-index: 1;
      background: radial-gradient(ellipse at center, transparent 40%, rgba(255,0,0,.45));
      animation: alertPulse .8s infinite; display: none;
    }
    .story-alert-flash.active { display: block; }
    @keyframes alertPulse { 0%,100%{opacity:.3} 50%{opacity:1} }
    .story-portrait {
      position: fixed; left: 3%; top: 50%; transform: translateY(-50%);
      width: 45%; height: 80%; z-index: 2; pointer-events: none;
      background: left center / contain no-repeat;
      filter: drop-shadow(0 10px 30px rgba(0,0,0,.6));
      transition: opacity .3s;
    }
    .story-skip-btn {
      position: fixed; top: 20px; right: 20px; z-index: 10;
      padding: 8px 18px; font-size: 14px;
      background: rgba(0,0,0,.5); color: #aaa;
      border: 1px solid rgba(150,150,150,.4);
      border-radius: 4px; cursor: pointer; font-family: inherit;
    }
    .story-skip-btn:hover { color: #fff; border-color: rgba(200,200,200,.6); }
    .story-panel {
      position: fixed; left: 0; right: 0; bottom: 0; z-index: 5;
      padding: 30px 36px 40px;
      background: linear-gradient(to top, rgba(0,0,0,.88), rgba(0,0,0,.35));
      border-top: 1px solid rgba(100,180,255,.35);
      cursor: pointer;
    }
    .story-text {
      max-width: 900px; margin: 0 auto;
      font-size: 21px; color: #fff; line-height: 1.9;
      text-shadow: 0 2px 10px rgba(0,0,0,.8);
      min-height: 80px;
    }
    .story-talker {
      color: #ffb347; font-weight: bold; display: block;
      margin-bottom: 10px; font-size: 23px;
    }
    .story-cursor {
      display: inline-block; width: 2px; height: 20px;
      background: #ffb347; margin-left: 2px; vertical-align: middle;
      animation: cursorBlink .6s step-end infinite;
    }
    @keyframes cursorBlink { 0%,100%{opacity:1} 50%{opacity:0} }
    .story-tip {
      max-width: 900px; margin: 16px auto 0;
      font-size: 14px; color: #bbb;
    }
    .story-start-btn {
      display: none; margin: 24px auto 0; padding: 12px 40px;
      font-size: 19px; background: linear-gradient(90deg, #113366, #2255aa);
      color: #fff; border: 1px solid #4488dd; border-radius: 6px;
      cursor: pointer; letter-spacing: 4px; font-family: inherit;
    }
    .story-start-btn:hover { background: linear-gradient(90deg, #1a4488, #3366cc); }
  `;
  document.head.appendChild(style);

  // DOM
  const overlay = document.createElement("div");
  overlay.id = "tutorialStoryOverlay";
  overlay.innerHTML = `
    <div class="story-alert-flash" id="storyAlertFlash"></div>
    <div class="story-portrait" id="storyPortrait"></div>
    <button class="story-skip-btn" id="storySkipBtn">跳过剧情 ⏭</button>
    <div class="story-panel" id="storyPanel">
      <div class="story-text" id="storyText"></div>
      <div class="story-tip" id="storyTip">点击任意位置 或 按空格键 继续...</div>
      <button class="story-start-btn" id="storyStartBtn">${TUTORIAL_STORY.buttonText}</button>
    </div>
    <audio id="storySfxWarning"><source src="${AP}audio/sfx-warning.mp3" type="audio/mpeg"></audio>
    <audio id="storySfxDrum"><source src="${AP}audio/sfx-drum.mp3" type="audio/mpeg"></audio>
    <audio id="storySfxClick"><source src="${AP}audio/sfx-click.mp3" type="audio/mpeg"></audio>
    <audio id="storySfxTyping" loop><source src="${AP}audio/sfx-typing.mp3" type="audio/mpeg"></audio>
  `;
  document.body.appendChild(overlay);

  const textEl = document.getElementById("storyText");
  const tipEl = document.getElementById("storyTip");
  const btnEl = document.getElementById("storyStartBtn");
  const alertEl = document.getElementById("storyAlertFlash");
  const portraitEl = document.getElementById("storyPortrait");
  const panelEl = document.getElementById("storyPanel");
  typingAudio = document.getElementById("storySfxTyping");

  function playSfx(id) {
    if (!id) return;
    const el = document.getElementById("storySfx" + id.charAt(0).toUpperCase() + id.slice(1));
    if (el) { el.currentTime = 0; el.play().catch(() => {}); }
  }

  function stopTyping() {
    if (typingTimer) { clearInterval(typingTimer); typingTimer = null; }
    isTyping = false;
    if (typingAudio) { typingAudio.pause(); typingAudio.currentTime = 0; }
  }

  function typeText(fullText, talker) {
    stopTyping();
    isTyping = true;
    let charIdx = 0;
    textEl.innerHTML = '<span class="story-talker">' + talker + '</span><span id="storyTypedContent"></span><span class="story-cursor"></span>';
    const contentEl = document.getElementById("storyTypedContent");
    // 播放打字音效
    if (audioUnlocked && typingAudio) {
      typingAudio.currentTime = 0;
      typingAudio.play().catch(() => {});
    }
    typingTimer = setInterval(() => {
      if (charIdx < fullText.length) {
        contentEl.textContent = fullText.substring(0, charIdx + 1);
        charIdx++;
      } else {
        stopTyping();
        // 移除光标
        const cursor = textEl.querySelector(".story-cursor");
        if (cursor) cursor.remove();
      }
    }, TYPE_SPEED);
  }

  function showFullText(fullText, talker) {
    stopTyping();
    textEl.innerHTML = '<span class="story-talker">' + talker + '</span>' + fullText;
  }

  function renderScene() {
    const s = scenes[curIdx];
    overlay.style.backgroundImage = "url('" + AP + s.bg + "')";
    alertEl.classList.toggle("active", !!s.alert);
    portraitEl.style.backgroundImage = "url('" + AP + s.portrait + "')";
    typeText(s.text, s.talker);
    if (s.audio && audioUnlocked) playSfx(s.audio);
  }

  function goNext() {
    if (!audioUnlocked) {
      audioUnlocked = true;
      const s = scenes[curIdx];
      if (s.audio) playSfx(s.audio);
      // 首次交互也启动打字音效
      if (isTyping && typingAudio) { typingAudio.play().catch(() => {}); }
    }
    // 正在打字：点击快速显示完整文字
    if (isTyping) {
      const s = scenes[curIdx];
      showFullText(s.text, s.talker);
      playSfx("click");
      return;
    }
    playSfx("click");
    curIdx++;
    if (curIdx >= scenes.length) {
      tipEl.style.display = "none";
      btnEl.style.display = "block";
      alertEl.classList.remove("active");
      portraitEl.style.backgroundImage = "none";
    } else {
      renderScene();
    }
  }

  function skipStory() {
    stopTyping();
    audioUnlocked = true;
    tipEl.style.display = "none";
    btnEl.style.display = "block";
    alertEl.classList.remove("active");
    portraitEl.style.backgroundImage = "none";
    const last = scenes[scenes.length - 1];
    overlay.style.backgroundImage = "url('" + AP + last.bg + "')";
    showFullText(last.text, last.talker);
  }

  function closeStory() {
    stopTyping();
    playSfx("click");
    overlay.classList.add("closing");
    setTimeout(() => {
      overlay.remove();
      style.remove();
      if (typeof TUTORIAL_STORY.onComplete === "function") TUTORIAL_STORY.onComplete();
      startTutorial();
    }, 500);
  }

  // 交互
  panelEl.addEventListener("click", (e) => { if (e.target !== btnEl) goNext(); });
  document.addEventListener("keydown", function storyKey(e) {
    if (e.code === "Space" || e.code === "Enter") {
      e.preventDefault();
      if (btnEl.style.display === "block") closeStory();
      else goNext();
    }
  });
  document.getElementById("storySkipBtn").addEventListener("click", (e) => { e.stopPropagation(); skipStory(); });
  btnEl.addEventListener("click", closeStory);

  renderScene();
}

/* ---------- 面板构建 ---------- */
function buildPanel() {
  const style = document.createElement("style");
  style.id = "tutorialStyle";
  style.textContent = `
    #tutorialChecklist {
      position: fixed; right: 16px; top: 96px; z-index: 9999;
      width: 300px; max-height: calc(100vh - 140px); overflow-y: auto;
      background: linear-gradient(160deg, rgba(10,22,30,.96), rgba(14,30,38,.94));
      border: 1px solid rgba(120,200,180,.35);
      border-radius: 10px; box-shadow: 0 8px 32px rgba(0,0,0,.5);
      color: #d8ece6; font-family: "PingFang SC","Microsoft YaHei",Arial,sans-serif;
      pointer-events: auto; backdrop-filter: blur(6px);
    }
    #tutorialChecklist::-webkit-scrollbar { width: 5px; }
    #tutorialChecklist::-webkit-scrollbar-thumb { background: rgba(120,200,180,.3); border-radius: 3px; }
    .tut-header {
      padding: 14px 16px 10px; border-bottom: 1px solid rgba(120,200,180,.2);
    }
    .tut-header .tut-tag {
      font-size: 10px; letter-spacing: 3px; color: #6ec9b0; font-weight: 700;
    }
    .tut-header h3 {
      margin: 4px 0 0; font-size: 17px; font-weight: 700; color: #e8f7f2;
    }
    .tut-progress-bar {
      height: 5px; margin-top: 10px; background: rgba(255,255,255,.08);
      border-radius: 3px; overflow: hidden;
    }
    .tut-progress-bar i {
      display: block; height: 100%; width: 0%;
      background: linear-gradient(90deg, #4ec9a0, #7ee0c0);
      transition: width .35s ease;
    }
    .tut-step-list { padding: 6px 0; }
    .tut-step {
      display: flex; align-items: flex-start; gap: 10px;
      padding: 9px 16px; cursor: default; transition: background .2s;
      border-left: 3px solid transparent;
    }
    .tut-step:hover { background: rgba(255,255,255,.03); }
    .tut-step.active {
      background: rgba(78,201,160,.1); border-left-color: #4ec9a0;
    }
    .tut-step.done { opacity: .55; }
    .tut-check {
      flex-shrink: 0; width: 20px; height: 20px; margin-top: 1px;
      border: 2px solid rgba(120,200,180,.4); border-radius: 5px;
      display: flex; align-items: center; justify-content: center;
      font-size: 13px; font-weight: 700; color: transparent;
      transition: all .25s;
    }
    .tut-step.done .tut-check {
      background: #4ec9a0; border-color: #4ec9a0; color: #0a1e18;
    }
    .tut-step.active .tut-check {
      border-color: #4ec9a0; box-shadow: 0 0 8px rgba(78,201,160,.5);
      animation: tutPulse 1.6s ease-in-out infinite;
    }
    @keyframes tutPulse {
      0%,100% { box-shadow: 0 0 4px rgba(78,201,160,.3); }
      50% { box-shadow: 0 0 12px rgba(78,201,160,.7); }
    }
    .tut-step-body { flex: 1; min-width: 0; }
    .tut-step-title {
      font-size: 13.5px; font-weight: 600; color: #c8e6dd;
      display: flex; align-items: center; gap: 6px;
    }
    .tut-step.active .tut-step-title { color: #eafff8; }
    .tut-step-num {
      font-size: 10px; color: #5a9a88; font-weight: 700;
      background: rgba(120,200,180,.1); padding: 1px 5px; border-radius: 3px;
    }
    .tut-step-desc {
      font-size: 11.5px; color: #7aa89a; line-height: 1.5; margin-top: 3px;
      display: none;
    }
    .tut-step.active .tut-step-desc { display: block; }
    .tut-current-hint {
      margin: 0 16px 12px; padding: 8px 11px;
      background: rgba(78,201,160,.1); border-left: 3px solid #4ec9a0;
      border-radius: 0 5px 5px 0; font-size: 12px; color: #a8e0cc;
      line-height: 1.5;
    }
    .tut-current-hint.flash {
      background: rgba(255,180,80,.15); border-left-color: #ffb450; color: #ffd89a;
    }
    .tut-footer {
      padding: 10px 16px; border-top: 1px solid rgba(120,200,180,.2);
      font-size: 11px; color: #5a8a7c; display: flex; justify-content: space-between;
    }
    .tut-footer button {
      background: none; border: 1px solid rgba(120,200,180,.3); color: #8ac4b0;
      font-size: 11px; padding: 3px 10px; border-radius: 4px; cursor: pointer;
      font-family: inherit;
    }
    .tut-footer button:hover { background: rgba(120,200,180,.1); }
    #tutorialChecklist.all-done { border-color: rgba(78,201,160,.6); }
    #tutorialChecklist.all-done .tut-header h3 { color: #7ee0c0; }
  `;
  document.head.appendChild(style);

  const panel = document.createElement("div");
  panel.id = "tutorialChecklist";
  panel.innerHTML = `
    <div class="tut-header">
      <div class="tut-tag">COMMAND TRAINING</div>
      <h3>新兵指挥训练</h3>
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

  // 移动步骤完成：显示迷雾消散提示
  if (idx === 1) {
    showFogToast();
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
}

function finishTutorial() {
  state.finished = true;
  for (let i = 0; i < steps.length; i++) state.completed[i] = true;
  renderSteps();
  // 标记教学关卡完成
  try {
    const prog = JSON.parse(localStorage.getItem("war-of-dots.campaign-progress") || "{}");
    prog["fracture-canyon-tutorial"] = Object.assign({}, prog["fracture-canyon-tutorial"] || {}, { completed: true, wins: 1 });
    localStorage.setItem("war-of-dots.campaign-progress", JSON.stringify(prog));
  } catch (_) {}
  // 2.8秒后自动返回关卡选择界面
  setTimeout(() => {
    window.location.href = "/battlechoose.html";
  }, 2800);
}

// 显示迷雾消散的浮动提示
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

/* ---------- 事件处理：操作锁定 ---------- */
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

  // 右键移动/攻击
  if (e.button === 2) {
    if (step.id === "move") {
      // 延迟确认移动（等游戏处理命令）
      state.movedConfirmed = true;
      setTimeout(() => {
        if (state.stepIndex === 1 && state.movedConfirmed) completeCurrentStep();
      }, 300);
    }
    if (step.id === "attack") {
      state.attackedConfirmed = true;
      setTimeout(() => {
        if (state.stepIndex === 2 && state.attackedConfirmed) completeCurrentStep();
      }, 300);
    }
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
  const observer = new MutationObserver(() => {
    if (state.finished) return;
    const step = steps[state.stepIndex];
    const count = activeSelectionCount();

    // 第1步辅助：如果通过其他方式选中了单位
    if (step.id === "select" && count > 0) {
      completeCurrentStep();
    }

    // 第5步辅助：框选后检测
    if (step.id === "dragselect" && count >= 2 && state.dragMoved) {
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

    if (step.id === "select" && count > 0) completeCurrentStep();
    if (step.id === "dragselect" && count >= 2) completeCurrentStep();
  }, 400);
}

/* ---------- 初始化 ---------- */
function init() {
  // 彻底隐藏游戏原有的任务进度面板
  const hideMission = () => {
    const mp = document.getElementById("missionPanel");
    if (mp) { mp.style.display = "none"; mp.style.visibility = "hidden"; }
  };
  hideMission();
  const missionObserver = new MutationObserver(hideMission);
  missionObserver.observe(document.body, { subtree: true, childList: true });
  const missionCss = document.createElement("style");
  missionCss.textContent = "#missionPanel{display:none!important;visibility:hidden!important;}";
  document.head.appendChild(missionCss);

  // 先播放剧情过场，剧情结束后才开始教学引导
  buildStoryOverlay();
}

/* ---------- 剧情结束后启动教学 ---------- */
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
    if (battlefield()) clearInterval(waitCanvas);
  }, 200);

  console.log("%c[教学系统] 新兵指挥训练已激活", "color:#4ec9a0;font-weight:bold");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

})();
