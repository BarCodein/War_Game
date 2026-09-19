(function(){
"use strict";
console.log("%c[教学系统] tutorial.js 已加载", "color:#4ec9a0;font-weight:bold");

/* ============================================================
 *  War of Dots · 教学关卡系统
 *  带勾选面板的步骤式引导：玩家每完成一个操作才能解锁下一个
 * ============================================================ */

const TUTORIAL_LEVEL_ID = "fracture-canyon-tutorial";


/* ============================================================
 *  剧情过场配置（接口）
 *  进入教学关卡后先播放剧情，玩家确认后才开始教学引导。
 *  后续可替换为视频、图片或更丰富的内容：
 *  - video: 视频URL（留空则不显示视频）
 *  - backgroundImage: 背景图URL（留空则用纯色）
 *  - onStart: 剧情开始时回调
 *  - onComplete: 剧情结束、教学开始时回调
 * ============================================================ */
let TUTORIAL_STORY = {
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

/* ---------- 教学结束剧情配置 ---------- */
let TUTORIAL_END_STORY = {
  enabled: true,
  assetPath: "/assets/tutorial/",
  scenes: [
    { talker: "通讯员", text: "报告司令员！训练场考核全部通过！部队已熟练掌握基础指挥要领！", bg: "images/bg-command.jpg", audio: "drum", alert: false, portrait: "images/port-hq.png" },
    { talker: "纵队司令员", text: "好！但这只是开始！训练场的胜利不算胜利，战场上的胜利才是真胜利！", bg: "images/bg-command.jpg", audio: "drum", alert: false, portrait: "images/port-hq.png" },
    { talker: "纵队司令员", text: "敌人还在步步紧逼！整编第七十四师的先头部队已经抵达我阵地前沿，真正的考验才刚刚开始！", bg: "images/bg-command.jpg", audio: "drum", alert: false, portrait: "images/port-hq.png" },
    { talker: "纵队司令员", text: "记住——骄兵必败！越是胜利，越要谨慎！各级指挥员务必戒骄戒躁，随时准备投入战斗！", bg: "images/bg-command.jpg", audio: "", alert: false, portrait: "images/port-hq.png" },
    { talker: "前线指挥员", text: "明白！我们绝不辜负党和人民的期望！随时待命，准备战斗！", bg: "images/bg-command.jpg", audio: "", alert: false, portrait: "images/port-commander.png" },
    { talker: "纵队司令员", text: "好！返回作战地图，准备迎接真正的战斗！", bg: "images/bg-command.jpg", audio: "", alert: false, portrait: "images/port-hq.png" }
  ],
  buttonText: "返回作战地图"
};

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
   第二关：地形与士气教学 配置
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
    targetRadius: 100,
  },
  {
    id: "roadmarch",
    title: "道路急行军",
    desc: "右键点击前方道路。道路是机动的命脉：移动速度×1.25（比平原快25%），且行军士气消耗减半。大部队转移务必走道路！",
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
    id: "terrainattack",
    title: "依托地形歼敌",
    desc: "现在你已体会了全部地形！选择有利地形（如城镇、山地）据守，右键点击红色敌军发动攻击。善用地形者，以少胜多。",
    hint: "右键点击红色敌军，利用地形优势歼敌",
    allowedButtons: [2],
    requireSelection: true,
  },
  {
    id: "moralefinal",
    title: "士气决胜总攻",
    desc: "框选所有部队，对残敌发动总攻！持续交战会消耗双方士气：士气<60进入削弱（伤害×0.75），<30动摇（伤害×0.5），归零且受攻击则溃逃（承受伤害×1.5）！趁敌士气崩溃，全歼残敌！",
    hint: "左键框选所有部队，右键总攻残敌",
    allowedButtons: [0, 2],
    requireSelection: false,
    expectMultiSelect: true,
  },
];

/* ---------- 第二关开场剧情 ---------- */
const STORY2_INTRO = {
  enabled: true,
  assetPath: "/assets/tutorial/",
  scenes: [
    { talker: "纵队司令部", text: "基础操作训练，考核通过！但这只是入门——战场上，决定生死的是地形和士气！", bg: "images/bg-command.jpg", audio: "drum", alert: false, portrait: "images/port-hq.png" },
    { talker: "纵队司令部", text: "据前线战报，塔山、宿北方向连日激战。不少新指挥员因不熟悉地形、不掌握士气，吃了大亏，甚至全军覆没！", bg: "images/bg-command.jpg", audio: "drum", alert: false, portrait: "images/port-hq.png" },
    { talker: "纵队司令员", text: "先讲地形！战场有六种地形，每一种都关乎生死。随我逐一看来——", bg: "images/bg-command.jpg", audio: "drum", alert: false, portrait: "images/port-hq.png" },
    { talker: "纵队司令员", text: "【平原】一马平川，最基础的战场。大兵团在此展开，正面交锋，拼的是兵力和火力，没有取巧的余地。", bg: "images/bg-plain.jpg", audio: "drum", alert: false, portrait: "images/port-hq.png" },
    { talker: "纵队司令员", text: "【道路】机动的命脉！部队转移、驰援友军，走道路最快，行军也最省力。兵贵神速——谁掌握了道路，谁就掌握了战场主动权！", bg: "images/bg-road.jpg", audio: "drum", alert: false, portrait: "images/port-hq.png" },
    { talker: "纵队司令员", text: "【森林】林木茂密，隐蔽性极佳！适合设伏、隐蔽集结，敌人难以发现。游击战、伏击战的天然掩护——藏得住，才能打得狠！", bg: "images/bg-forest.jpg", audio: "drum", alert: false, portrait: "images/port-hq.png" },
    { talker: "纵队司令员", text: "【山地】易守难攻！占领高地据守，敌人仰攻困难，我军以逸待劳。塔山阻击战的核心，就是守住每一处高地，让敌人寸步难进！", bg: "images/bg-mountain.jpg", audio: "drum", alert: false, portrait: "images/port-hq.png" },
    { talker: "纵队司令员", text: "【城镇】防御最强的地方！房屋街巷都是掩体，巷战歼敌，据守城镇，是以弱胜强的最佳依托。守住一座城，就能挡住一路敌！", bg: "images/bg-town.jpg", audio: "drum", alert: false, portrait: "images/port-hq.png" },
    { talker: "纵队司令员", text: "【水域】最危险的地形！涉水作战，行动迟缓、火力削弱，还会持续伤亡——等于自杀！非万不得已，绝不涉水！", bg: "images/bg-water.jpg", audio: "", alert: false, portrait: "images/port-hq.png" },
    { talker: "纵队司令员", text: "再说士气！部队打光了可以再建，士气垮了就一溃千里！士气低于六十，战斗力削弱；低于三十，军心动摇；归零且受攻击，当场溃逃！", bg: "images/bg-command.jpg", audio: "", alert: false, portrait: "images/port-hq.png" },
    { talker: "纵队司令员", text: "友军在身边、靠近己方城市、有补给，士气会回升；孤军深入、长时间交战、急行军，士气会暴跌！善用士气者，以弱胜强！", bg: "images/bg-command.jpg", audio: "", alert: false, portrait: "images/port-hq.png" },
    { talker: "纵队司令员", text: "现在，进入战术演训场！那里有道路、城镇、山地、森林、水域——每一种地形，每一种士气变化，都要亲手体会！", bg: "images/bg-command.jpg", audio: "", alert: false, portrait: "images/port-hq.png" },
    { talker: "前线指挥员", text: "明白！六种地形、士气要领，我已牢记在心！请司令员放心，我一定在演训场亲手体会每一种变化，随时准备投入真正的战斗！", bg: "images/bg-command.jpg", audio: "", alert: false, portrait: "images/port-commander.png" }
  ],
  buttonText: "进入战术演训场"
};

/* ---------- 第二关结束剧情 ---------- */
const STORY2_OUTRO = {
  enabled: true,
  assetPath: "/assets/tutorial/",
  scenes: [
    { talker: "通讯员", text: "报告！战术演训全部完成！指挥员已熟练掌握地形利用与士气决胜要领！", bg: "images/bg-command.jpg", audio: "drum", alert: false, portrait: "images/port-hq.png" },
    { talker: "纵队司令员", text: "好！记住——善用地形者，以少胜多；士气高昂者，以弱胜强！这是我军以弱胜强的法宝！", bg: "images/bg-command.jpg", audio: "drum", alert: false, portrait: "images/port-hq.png" },
    { talker: "纵队司令员", text: "塔山阻击战、宿北战役……前线的同志们正在用鲜血验证这些道理。你们，准备好接过钢枪了吗？", bg: "images/bg-command.jpg", audio: "", alert: false, portrait: "images/port-hq.png" },
    { talker: "前线指挥员", text: "时刻准备着！请党和人民放心，我们一定在战场上打出威风、打出胜利！", bg: "images/bg-command.jpg", audio: "", alert: false, portrait: "images/port-commander.png" },
    { talker: "纵队司令员", text: "好！返回作战地图，真正的战斗在等着你们！", bg: "images/bg-command.jpg", audio: "", alert: false, portrait: "images/port-hq.png" }
  ],
  buttonText: "返回作战地图"
};

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
function buildStoryOverlay(opts) {
  const cfg = Object.assign({}, TUTORIAL_STORY, opts || {});
  if (!cfg.enabled) { if (cfg.onComplete) cfg.onComplete(); else startTutorial(); return; }
  if (typeof cfg.onStart === "function") cfg.onStart();

  const AP = cfg.assetPath;
  const scenes = cfg.scenes;
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
      <button class="story-start-btn" id="storyStartBtn">${cfg.buttonText}</button>
    </div>
    <audio id="storySfxWarning"><source src="${AP}audio/sfx-warning.mp3" type="audio/mpeg"></audio>
    <audio id="storySfxDrum"><source src="${AP}audio/sfx-drum.mp3" type="audio/mpeg"></audio>
    <audio id="storySfxClick"><source src="${AP}audio/sfx-click.mp3" type="audio/mpeg"></audio>
    <audio id="storySfxTyping" loop><source src="${AP}audio/sfx-typing.mp3" type="audio/mpeg"></audio>
  `;
  document.body.appendChild(overlay);
  // 所有关卡：用 !important 强制设置样式，排除任何CSS覆盖
  overlay.style.setProperty("z-index", "2147483647", "important");
  overlay.style.setProperty("opacity", "1", "important");
  overlay.style.setProperty("display", "block", "important");
  overlay.style.setProperty("visibility", "visible", "important");
  overlay.style.setProperty("position", "fixed", "important");
  overlay.style.setProperty("inset", "0", "important");
  overlay.style.setProperty("background", "#111 center/cover no-repeat", "important");
  overlay.style.setProperty("pointer-events", "auto", "important");

  const textEl = document.getElementById("storyText");
  const tipEl = document.getElementById("storyTip");
  const btnEl = document.getElementById("storyStartBtn");
  const alertEl = document.getElementById("storyAlertFlash");
  const portraitEl = document.getElementById("storyPortrait");
  const panelEl = document.getElementById("storyPanel");
  typingAudio = document.getElementById("storySfxTyping");
  // 强制子元素可见（用 !important）
  if (textEl) {
    textEl.style.setProperty("opacity", "1", "important");
    textEl.style.setProperty("display", "block", "important");
    textEl.style.setProperty("visibility", "visible", "important");
    textEl.style.setProperty("color", "#fff", "important");
    textEl.style.setProperty("position", "relative", "important");
    textEl.style.setProperty("z-index", "10", "important");
  }
  if (portraitEl) {
    portraitEl.style.setProperty("opacity", "1", "important");
    portraitEl.style.setProperty("display", "block", "important");
    portraitEl.style.setProperty("visibility", "visible", "important");
    portraitEl.style.setProperty("position", "fixed", "important");
    portraitEl.style.setProperty("z-index", "5", "important");
    portraitEl.style.setProperty("left", "3%", "important");
    portraitEl.style.setProperty("top", "50%", "important");
    portraitEl.style.setProperty("transform", "translateY(-50%)", "important");
    portraitEl.style.setProperty("width", "45%", "important");
    portraitEl.style.setProperty("height", "80%", "important");
  }
  if (panelEl) {
    panelEl.style.setProperty("opacity", "1", "important");
    panelEl.style.setProperty("display", "block", "important");
    panelEl.style.setProperty("visibility", "visible", "important");
    panelEl.style.setProperty("position", "fixed", "important");
    panelEl.style.setProperty("z-index", "6", "important");
    panelEl.style.setProperty("bottom", "0", "important");
    panelEl.style.setProperty("left", "0", "important");
    panelEl.style.setProperty("right", "0", "important");
  }
  if (tipEl) {
    tipEl.style.setProperty("opacity", "1", "important");
    tipEl.style.setProperty("display", "block", "important");
  }
  console.log("[剧情] overlay已添加, textEl=" + !!textEl + ", portraitEl=" + !!portraitEl + ", panelEl=" + !!panelEl);

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
    if (!s) return;
    overlay.style.backgroundImage = "url('" + AP + s.bg + "')";
    overlay.style.backgroundSize = "cover";
    overlay.style.backgroundPosition = "center";
    if (alertEl) alertEl.classList.toggle("active", !!s.alert);
    if (portraitEl) {
      portraitEl.style.backgroundImage = "url('" + AP + s.portrait + "')";
      portraitEl.style.backgroundSize = "contain";
      portraitEl.style.backgroundPosition = "left center";
      portraitEl.style.backgroundRepeat = "no-repeat";
      portraitEl.style.display = "block";
      portraitEl.style.opacity = "1";
      portraitEl.style.visibility = "visible";
      portraitEl.style.zIndex = "5";
    }
    // 打字机效果显示文字
    if (textEl) {
      textEl.style.display = "block";
      textEl.style.opacity = "1";
      textEl.style.visibility = "visible";
      typeText(s.text || "", s.talker || "");
    }
    if (tipEl) tipEl.style.display = "block";
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
    // 移除剧情层的键盘事件监听器（必须加 true，与 addEventListener 匹配）
    document.removeEventListener("keydown", storyKeyHandler, true);
    overlay.classList.add("closing");
    setTimeout(() => {
      overlay.remove();
      style.remove();
      if (typeof cfg.onComplete === "function") cfg.onComplete();
      else startTutorial();
    }, 500);
  }

  // 交互：第一关用 click+底部面板（原样）；第二关用 pointerdown+全屏（修复被游戏拦截的问题）
  if (currentLevelId === "tactical-training-tutorial") {
    overlay.addEventListener("pointerdown", (e) => {

      if (e.target === btnEl) { closeStory(); return; }
      if (e.target.id === "storySkipBtn") { skipStory(); return; }
      goNext();
    }, true);
  } else {
    // 第一关：原样，只绑定底部面板的 click
    panelEl.addEventListener("click", (e) => { if (e.target !== btnEl) goNext(); });
    document.getElementById("storySkipBtn").addEventListener("click", (e) => { e.stopPropagation(); skipStory(); });
    btnEl.addEventListener("click", closeStory);
  }
  // 命名函数，方便 closeStory 时移除
  function storyKeyHandler(e) {
    if (e.code === "Space" || e.code === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      if (btnEl.style.display === "block") closeStory();
      else goNext();
    }
  }
  document.addEventListener("keydown", storyKeyHandler, true);

  renderScene();
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
  // 标记教学关卡完成
  try {
    const prog = JSON.parse(localStorage.getItem("war-of-dots.campaign-progress") || "{}");
    prog[currentLevelId] = Object.assign({}, prog[currentLevelId] || {}, { completed: true, wins: 1 });
    localStorage.setItem("war-of-dots.campaign-progress", JSON.stringify(prog));
  } catch (_) {}
  // 隐藏教学面板，播放结束剧情
  const panel = document.getElementById("tutorialChecklist");
  if (panel) panel.style.display = "none";
  const toast = document.getElementById("toast");
  if (toast) toast.style.display = "none";
  // 延迟一小段时间让玩家看到全部打勾，再进入结束剧情
  setTimeout(() => {
    buildStoryOverlay(Object.assign({}, TUTORIAL_END_STORY, {
      onComplete: () => { window.location.href = "/battlechoose.html"; }
    }));
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
  roadmarch: "道路地形 · 移动×1.25 士气消耗减半",
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
    // 最后总攻步骤：框选后右键攻击即完成
    if (step.id === "moralefinal" && activeSelectionCount() >= 2) {
      setTimeout(() => { completeCurrentStep(); }, 300);
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
  const selectIds = ["select", "recon"];
  const dragIds = ["dragselect", "moralefinal"];
  const observer = new MutationObserver(() => {
    if (state.finished) return;
    const step = steps[state.stepIndex];
    const count = activeSelectionCount();

    // 选中步骤辅助：如果通过其他方式选中了单位
    if (selectIds.includes(step.id) && count > 0) {
      completeCurrentStep();
    }

    // 框选步骤辅助：框选后检测
    if (dragIds.includes(step.id) && count >= 2 && state.dragMoved) {
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
    if (dragIds.includes(step.id) && count >= 2) completeCurrentStep();
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
  const oldOverlay = document.getElementById("tutorialStoryOverlay");
  if (oldOverlay) oldOverlay.remove();
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
  if (currentLevelId === "tactical-training-tutorial") {
    steps = STEPS_LEVEL2;
    TUTORIAL_STORY = STORY2_INTRO;
    TUTORIAL_END_STORY = STORY2_OUTRO;
    panelTitle = "地形与士气训练";
    panelTag = "TERRAIN & MORALE";
  }
  console.log("%c[教学系统] 激活教学: " + panelTitle + " (" + steps.length + "步)", "color:#4ec9a0;font-weight:bold");
  // 重置状态（steps 可能已切换）
  state.stepIndex = 0;
  state.completed = new Array(steps.length).fill(false);
  state.finished = false;

  // 保留游戏原有的任务进度面板

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
    if (battlefield()) {
      clearInterval(waitCanvas);
      setTimeout(showTargetMarker, 500);
    }
  }, 200);

  console.log("%c[教学系统] 新兵指挥训练已激活", "color:#4ec9a0;font-weight:bold");
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
