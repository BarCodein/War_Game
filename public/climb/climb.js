// ============================================================
// 睡衣登山大赛 - 横板爬山跑酷 (像素风)
// 主角: 穿睡衣的士兵 | 武器: 步枪 + 大刀
// 目标: 在规定时间内爬上山顶
// ============================================================
console.log('[climb.js] 脚本开始执行')

const canvas = document.querySelector('canvas')
const ctx = canvas.getContext('2d')

canvas.width = 1024
canvas.height = 576

const WORLD_W = 11000
const WORLD_H = 3600
const GRAV = 0.7
const JUMP_V = -15.5
const SPEED = 5.5
const PLAYER_W = 30
const PLAYER_H = 48
const START_Y = 3480
const SUMMIT_Y = 380
const WIN_X = 10700
const FLAG_X = 10750
const TIME_LIMIT = 150

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
const lerp = (a, b, t) => a + (b - a) * t
const rand = (a, b) => a + Math.random() * (b - a)

// ---------- audio (WebAudio, no files) ----------
let actx = null
let soundOn = true

function initAudio() {
  try {
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext
      actx = AC ? new AC() : null
    }
    if (actx && actx.state === 'suspended') actx.resume()
  } catch (e) {
    actx = null
  }
}

function beep(o) {
  if (!soundOn || !actx) return
  const t0 = actx.currentTime + (o.delay || 0)
  const dur = o.dur || 0.12
  const osc = actx.createOscillator()
  const gain = actx.createGain()
  osc.type = o.type || 'square'
  osc.frequency.setValueAtTime(Math.max(1, o.f0 || 440), t0)
  if (o.f1 && o.f1 !== o.f0) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t0 + dur)
  }
  const vol = o.vol || 0.14
  gain.gain.setValueAtTime(0.0001, t0)
  gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  osc.connect(gain).connect(actx.destination)
  osc.start(t0)
  osc.stop(t0 + dur + 0.03)
}

function noiseBurst(dur, vol, delay) {
  if (!soundOn || !actx) return
  const t0 = actx.currentTime + (delay || 0)
  const n = Math.max(1, Math.floor(actx.sampleRate * dur))
  const buf = actx.createBuffer(1, n, actx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n)
  const src = actx.createBufferSource()
  src.buffer = buf
  const gain = actx.createGain()
  gain.gain.value = vol || 0.1
  src.connect(gain).connect(actx.destination)
  src.start(t0)
}

function sfx(name) {
  if (!soundOn) return
  initAudio()
  if (!actx) return
  switch (name) {
    case 'jump':
      beep({ type: 'square', f0: 320, f1: 660, dur: 0.14, vol: 0.12 })
      break
    case 'shoot':
      beep({ type: 'square', f0: 900, f1: 180, dur: 0.09, vol: 0.09 })
      noiseBurst(0.05, 0.05)
      break
    case 'slash':
      beep({ type: 'triangle', f0: 1500, f1: 420, dur: 0.12, vol: 0.08 })
      beep({ type: 'square', f0: 2400, f1: 1000, dur: 0.07, vol: 0.045 })
      noiseBurst(0.09, 0.09)
      break
    case 'hurt':
      beep({ type: 'square', f0: 260, f1: 70, dur: 0.25, vol: 0.15 })
      break
    case 'ehit':
      beep({ type: 'square', f0: 520, f1: 380, dur: 0.05, vol: 0.07 })
      break
    case 'edie':
      noiseBurst(0.18, 0.13)
      beep({ type: 'triangle', f0: 300, f1: 80, dur: 0.2, vol: 0.11 })
      break
    case 'checkpoint':
      beep({ type: 'triangle', f0: 660, dur: 0.1, vol: 0.11 })
      beep({ type: 'triangle', f0: 990, dur: 0.14, vol: 0.11, delay: 0.1 })
      break
    case 'rockfall':
      beep({ type: 'sawtooth', f0: 160, f1: 60, dur: 0.3, vol: 0.08 })
      noiseBurst(0.2, 0.06)
      break
    case 'impact':
      noiseBurst(0.12, 0.14)
      beep({ type: 'square', f0: 180, f1: 60, dur: 0.12, vol: 0.1 })
      break
    case 'win':
      ;[523, 659, 784, 1047].forEach((f, i) =>
        beep({ type: 'square', f0: f, dur: 0.18, vol: 0.12, delay: i * 0.13 })
      )
      break
    case 'lose':
      ;[392, 330, 262, 196].forEach((f, i) =>
        beep({ type: 'sawtooth', f0: f, dur: 0.22, vol: 0.11, delay: i * 0.16 })
      )
      break
  }
}

const P = {
  h: '#6d5b3a', s: '#e6b98a', S: '#c98f62',
  g: '#5a7040', G: '#3f5230', d: '#2c3a20',
  b: '#4a3826', w: '#2f2f2f', W: '#1f1f1f',
  e: '#8a5a2a', c: '#5f6460', u: '#6a6f74',
  U: '#494d51', k: '#202020', r: '#c0392b',
  f: '#f4f4f4', y: '#e8c84a',
  q: '#8fb7e0', Q: '#5d84b0', n: '#3a4a5f'
}

function px(rows) {
  const h = rows.length
  const w = Math.max(...rows.map((r) => r.length))
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const cx = cv.getContext('2d')
  for (let y = 0; y < h; y++) {
    const row = rows[y]
    for (let x = 0; x < row.length; x++) {
      const ch = row[x]
      if (ch === '.' || ch === ' ') continue
      cx.fillStyle = P[ch] || '#f0f'
      cx.fillRect(x, y, 1, 1)
    }
  }
  return cv
}

const SOLDIER_IDLE = px([
  '................',
  '......hhhhhh....',
  '.....hhhhhhhh...',
  '....hhhhhhhhhh..',
  '...hhhhhhhhhhhh.',
  '...hhhhhhhhhhhh.',
  '....ssssssss....',
  '....sSssssSs....',
  '.....ssssss.....',
  '......ssss......',
  '.....gggggg.....',
  '....gggggggg....',
  '...gggggggggg...',
  '...gggggggggg...',
  '...gggggggggg...',
  '..Ggggggggggg...',
  '..gggggggggg....',
  '...gggg.gggg....',
  '...gggg.gggg....',
  '...bbbb.bbbb....',
  '...bbbb.bbbb....',
  '................'
])

const SOLDIER_RUN1 = px([
  '................',
  '......hhhhhh....',
  '.....hhhhhhhh...',
  '....hhhhhhhhhh..',
  '...hhhhhhhhhhhh.',
  '...hhhhhhhhhhhh.',
  '....ssssssss....',
  '....sSssssSs....',
  '.....ssssss.....',
  '......ssss......',
  '.....gggggg.....',
  '....gggggggg....',
  '...gggggggggg...',
  '...gggggggggg...',
  '...gggggggggg...',
  '..Ggggggggggg...',
  '..gggggggggg....',
  '...gggg..ggg....',
  '..gggg....gggg..',
  '..bbbb....bbbb..',
  '..bbbb...bbbb...',
  '................'
])

const SOLDIER_RUN2 = px([
  '................',
  '......hhhhhh....',
  '.....hhhhhhhh...',
  '....hhhhhhhhhh..',
  '...hhhhhhhhhhhh.',
  '...hhhhhhhhhhhh.',
  '....ssssssss....',
  '....sSssssSs....',
  '.....ssssss.....',
  '......ssss......',
  '.....gggggg.....',
  '....gggggggg....',
  '...gggggggggg...',
  '...gggggggggg...',
  '...gggggggggg...',
  '..Ggggggggggg...',
  '..gggggggggg....',
  '...gggg.gggg....',
  '..gggg...gggg...',
  '..bbbb...bbbb...',
  '..bbbb...bbbb...',
  '................'
])

const SOLDIER_JUMP = px([
  '................',
  '......hhhhhh....',
  '.....hhhhhhhh...',
  '....hhhhhhhhhh..',
  '...hhhhhhhhhhhh.',
  '...hhhhhhhhhhhh.',
  '....ssssssss....',
  '....sSssssSs....',
  '.....ssssss.....',
  '......ssss......',
  '.....gggggg.....',
  '....gggggggg....',
  '...gggggggggg...',
  '...gggggggggg...',
  '...gggggggggg...',
  '..Ggggggggggg...',
  '..gggggggggg....',
  '...gggg.gggg....',
  '..ggg....ggg....',
  '..bbb....bbb....',
  '..bbb....bbb....',
  '................'
])

const SOLDIER_SHOOT = px([
  '................',
  '......hhhhhh....',
  '.....hhhhhhhh...',
  '....hhhhhhhhhh..',
  '...hhhhhhhhhhhh.',
  '...hhhhhhhhhhhh.',
  '....ssssssss....',
  '....sSssssSs....',
  '.....ssssss.....',
  '......ssss......',
  '.....gggggg.....',
  '...gggggggggg...',
  '..gggggggggggg..',
  '..gggggggggggg..',
  '..gggggggggggg..',
  '..Ggggggggggg...',
  '..gggggggggg....',
  '...gggg.gggg....',
  '...gggg.gggg....',
  '...bbbb.bbbb....',
  '...bbbb.bbbb....',
  '................'
])

const ENEMY_IDLE = px([
  '................',
  '......cccccc....',
  '.....cccccccc...',
  '....cccccccccc..',
  '...cccccccccccc.',
  '...cccccccccccc.',
  '....ssssssss....',
  '....sSssssSs....',
  '.....ssssss.....',
  '......ssss......',
  '.....uuuuuu.....',
  '....uuuuuuuu....',
  '...uuuuuuuuuu...',
  '...uuuuuuuuuu...',
  '...uuuuuuuuuu...',
  '..Uuuuuuuuuuu...',
  '..uuuuuuuuuu....',
  '...uuuu.uuuu....',
  '...uuuu.uuuu....',
  '...kkkk.kkkk....',
  '...kkkk.kkkk....',
  '................'
])

const ENEMY_RUN1 = px([
  '................',
  '......cccccc....',
  '.....cccccccc...',
  '....cccccccccc..',
  '...cccccccccccc.',
  '...cccccccccccc.',
  '....ssssssss....',
  '....sSssssSs....',
  '.....ssssss.....',
  '......ssss......',
  '.....uuuuuu.....',
  '....uuuuuuuu....',
  '...uuuuuuuuuu...',
  '...uuuuuuuuuu...',
  '...uuuuuuuuuu...',
  '..Uuuuuuuuuuu...',
  '..uuuuuuuuuu....',
  '...uuuu..uuu....',
  '..uuuu....uuuu..',
  '..kkkk....kkkk..',
  '..kkkk...kkkk...',
  '................'
])

const ENEMY_RUN2 = px([
  '................',
  '......cccccc....',
  '.....cccccccc...',
  '....cccccccccc..',
  '...cccccccccccc.',
  '...cccccccccccc.',
  '....ssssssss....',
  '....sSssssSs....',
  '.....ssssss.....',
  '......ssss......',
  '.....uuuuuu.....',
  '....uuuuuuuu....',
  '...uuuuuuuuuu...',
  '...uuuuuuuuuu...',
  '...uuuuuuuuuu...',
  '..Uuuuuuuuuuu...',
  '..uuuuuuuuuu....',
  '...uuuu.uuuu....',
  '..uuuu...uuuu...',
  '..kkkk...kkkk...',
  '..kkkk...kkkk...',
  '................'
])

const HEART = px([
  '.rr.rr.',
  'rrrrrrr',
  'rrrrrrr',
  '.rrrrr.',
  '..rrr..',
  '...r...'
])

// Chiang Kai-shek in pajamas (bald, mustache, striped sleepwear)
const PAJAMA_MAN = px([
  '..................',
  '.....ssssssss.....',
  '....ssssssssss....',
  '...ssssssssssss...',
  '...ssssssssssss...',
  '...ssSssssssSss...',
  '...ssssssssssss...',
  '...sskkkkkkkkss...',
  '....ssssssssss....',
  '.....ssssssss.....',
  '......ssssss......',
  '....qqqqqqqqqq....',
  '...qqQqqqqqqQqq...',
  '..qqqqqqqqqqqqqq..',
  '..qqQqqqqqqqqQqq..',
  '..qqqqqqqqqqqqqq..',
  '..qqqqqqqqqqqqqq..',
  '..qqqqqqqqqqqqqq..',
  '...qqqqqqqqqqqq...',
  '...qqqq....qqqq...',
  '...qqqq....qqqq...',
  '...nnnn....nnnn...',
  '..................',
  '..................'
])

// ---------- terrain (mountain face) ----------
const GAPS = [
  { x0: 380, x1: 540, y: 3480 },
  { x0: 2050, x1: 2230, y: 2900 },
  { x0: 3700, x1: 3920, y: 2400 },
  { x0: 5450, x1: 5670, y: 1900 },
  { x0: 7150, x1: 7370, y: 1400 },
  { x0: 8900, x1: 9120, y: 900 },
  { x0: 10400, x1: 10620, y: 380 }
]

const CHECKPOINTS = [700, 2400, 4100, 5850, 7550, 9300]

const SEGS = [
  { x0: 0, x1: 900, y0: 3480, y1: 3480 },
  { x0: 900, x1: 1800, y0: 3480, y1: 2900 },
  { x0: 1800, x1: 2600, y0: 2900, y1: 2900 },
  { x0: 2600, x1: 3500, y0: 2900, y1: 2400 },
  { x0: 3500, x1: 4300, y0: 2400, y1: 2400 },
  { x0: 4300, x1: 5200, y0: 2400, y1: 1900 },
  { x0: 5200, x1: 6000, y0: 1900, y1: 1900 },
  { x0: 6000, x1: 6900, y0: 1900, y1: 1400 },
  { x0: 6900, x1: 7700, y0: 1400, y1: 1400 },
  { x0: 7700, x1: 8600, y0: 1400, y1: 900 },
  { x0: 8600, x1: 9400, y0: 900, y1: 900 },
  { x0: 9400, x1: 10100, y0: 900, y1: 380 },
  { x0: 10100, x1: 11000, y0: 380, y1: 380 }
]

function groundY(x) {
  x = clamp(x, 0, WORLD_W - 1)
  for (const g of GAPS) {
    if (x >= g.x0 && x <= g.x1) return null
  }
  for (const s of SEGS) {
    if (x >= s.x0 && x <= s.x1) {
      const t = (x - s.x0) / (s.x1 - s.x0)
      return s.y0 + (s.y1 - s.y0) * t
    }
  }
  return WORLD_H - 120
}

// ---------- level objects ----------
const platforms = [
  { x: 1380, y: 3200, w: 200 },
  { x: 2900, y: 2750, w: 160 },
  { x: 4600, y: 2200, w: 160 },
  { x: 6400, y: 1750, w: 170 },
  { x: 8000, y: 1250, w: 180 },
  { x: 9600, y: 720, w: 170 },
  { x: 2060, y: 2860, w: 70, minX: 2055, maxX: 2155, vx: 1.4 },
  { x: 3705, y: 2360, w: 70, minX: 3705, maxX: 3845, vx: 1.5 },
  { x: 5455, y: 1860, w: 70, minX: 5455, maxX: 5595, vx: 1.6 },
  { x: 7155, y: 1360, w: 70, minX: 7155, maxX: 7295, vx: 1.7 },
  { x: 8905, y: 860, w: 70, minX: 8905, maxX: 9045, vx: 1.8 },
  { x: 10405, y: 340, w: 70, minX: 10405, maxX: 10545, vx: 2.0 }
]

const rocks = [
  { x: 1050, w: 40, h: 44 },
  { x: 1300, w: 40, h: 44 },
  { x: 1580, w: 40, h: 44 },
  { x: 2950, w: 40, h: 44 },
  { x: 3250, w: 40, h: 44 },
  { x: 4600, w: 40, h: 44 },
  { x: 4950, w: 40, h: 44 },
  { x: 6250, w: 40, h: 44 },
  { x: 6600, w: 40, h: 44 },
  { x: 7950, w: 40, h: 44 },
  { x: 8300, w: 40, h: 44 },
  { x: 9650, w: 40, h: 44 },
  { x: 9900, w: 40, h: 44 }
]
for (const r of rocks) r.y = groundY(r.x) - r.h

// decorative summit boulders flanking the finish line
const SUMMIT_ROCKS = [
  { x: 10620, w: 50, h: 58 },
  { x: 10760, w: 50, h: 58 }
]
for (const r of SUMMIT_ROCKS) r.y = groundY(r.x) - r.h
const SUMMIT_MAN_X = 10715

// ---------- enemies ----------
function makeEnemy(x, minX, maxX) {
  return {
    x,
    y: groundY(x) - PLAYER_H,
    minX,
    maxX,
    w: 30,
    h: 48,
    dir: 1,
    speed: 1.1,
    hp: 2,
    shootTimer: rand(40, 160),
    flash: 0,
    frame: 0
  }
}

const ENEMY_SPAWNS = [
  [780, 560, 880],
  [1920, 1820, 2030],
  [2500, 2300, 2580],
  [3600, 3520, 3680],
  [4200, 4000, 4280],
  [5320, 5220, 5430],
  [5900, 5750, 5980],
  [7040, 6920, 7130],
  [7650, 7450, 7680],
  [8780, 8620, 8880],
  [9280, 9180, 9380],
  [10250, 10120, 10380]
]
let enemies = ENEMY_SPAWNS.map((s) => makeEnemy(s[0], s[1], s[2]))

// ---------- player ----------
const player = {
  x: 60,
  y: START_Y - PLAYER_H,
  vx: 0,
  vy: 0,
  w: PLAYER_W,
  h: PLAYER_H,
  facing: 1,
  onGround: false,
  hp: 3,
  maxHp: 3,
  shootCd: 0,
  muzzle: 0,
  slashTimer: 0,
  slashCd: 0,
  hurtTimer: 0,
  frame: 0,
  coyote: 0,
  jumpBuf: 0
}

// ---------- state ----------
let state = 'start' // start | play | win | lose
let bullets = []
let particles = []
let endTime = 0
let timeLeft = TIME_LIMIT
let cam = { x: 0, y: 0 }
const keys = {}
let shake = 0
let cpIndex = 0
let cp = { x: 60, y: START_Y - PLAYER_H }
let fallRocks = []
let rockTimer = rand(150, 300)
let renderFrames = 0 // animate() 被调用的次数（端到端测试用它断言"逻辑步数与刷新率无关"）
let logicSteps = 0   // 真正的逻辑步数（固定步长累加器里的循环次数）

// ---------- 成就系统 ----------
// 进度类数据按账号隔离：统一走 window.UserStorage（public/user-storage.js，climb.html 里先加载）
const CLIMB_STATS_KEY = 'climb-stats'
const ACH_UNLOCKED_NAME = 'ach-unlocked'
const CLIMB_CLEARED_NAME = 'climb-cleared'
const CLIMB_ACHIEVEMENTS = [
  { id: 'climb-veteran', name: '捉蒋大师', stars: 2, desc: '累计登顶三次，捉蒋行动的老手。', hint: '累计登顶3次' },
  { id: 'climb-speedster', name: '极速攀登', stars: 3, desc: '60秒内登顶，风一般的男子。', hint: '60秒内登顶' },
  { id: 'climb-rock-kill', name: '大石碎胸口', stars: 1, desc: '引导敌人被天降巨石砸死，借刀杀人。', hint: '引导敌人被落石砸死' },
  { id: 'climb-peaceful', name: '和平解决', stars: 2, desc: '不杀一个敌人就登顶，以和为贵。', hint: '不击杀任何敌人通关' },
  { id: 'climb-sword-only', name: '大刀进行曲', stars: 2, desc: '仅用大刀通关，子弹一颗不发。', hint: '仅用大刀通关（不射击）' },
  { id: 'climb-champion', name: '睡衣登山大赛冠军', stars: 3, desc: '在西安事变的登山小游戏里登顶成功。', hint: '登顶成功' },
  { id: 'climb-speedrun', name: '神兵天降', stars: 2, desc: '90秒内快速登顶，兵贵神速。', hint: '90秒内登顶' },
  { id: 'climb-flawless', name: '毫发无伤', stars: 3, desc: '全程零死亡登顶，身法如仙。', hint: '零死亡登顶' },
  { id: 'climb-slaughter', name: '斩尽杀绝', stars: 2, desc: '击杀沿途所有敌人，一个不留。', hint: '击杀所有敌人' },
  { id: 'climb-early', name: '出师未捷身先死', stars: 1, desc: '还没到第一个检查点就倒下了，长使英雄泪满襟。', hint: '第一个检查点前死亡' },
]
let climbStats = {
  deaths: 0, kills: 0, shots: 0,
  rocked: false, shotDeath: false, fell: false, earlyDeath: false,
  failedBefore: false, bestTime: null, reachedFirstCheckpoint: false,
  totalWins: 0, noWeapon: false, noDamage: false, maxDeathsInRun: 0,
  enemyRockedKill: false, peaceful: false, onlyMelee: false,
  sharpshooter: false, collector: false, maxKillsInRun: 0,
}
let deathCause = null // 'rock' | 'shot' | 'fell' | null
let usedWeapon = false // 本局是否使用过武器（射击或大刀）
let usedSlash = false // 本局是否使用过大刀
let tookDamage = false // 本局是否受过任何伤害
let enemyKilledByRock = 0 // 本局敌人被落石砸死数
let shotsHit = 0 // 本局子弹命中数
const unlockedThisRun = new Set()

function loadClimbStats() {
  try {
    const saved = window.UserStorage.readJSON(CLIMB_STATS_KEY, null)
    if (saved) climbStats = { ...climbStats, ...saved }
  } catch (e) {}
}
function saveClimbStats() {
  try { window.UserStorage.writeJSON(CLIMB_STATS_KEY, climbStats) } catch (e) {}
}
function isAchievementUnlocked(id) {
  try {
    const obj = window.UserStorage.readJSON(ACH_UNLOCKED_NAME, null)
    if (obj) return obj[id] === true
  } catch (e) {}
  return false
}
function markAchievementUnlocked(id) {
  try {
    const obj = window.UserStorage.readJSON(ACH_UNLOCKED_NAME, {}) || {}
    obj[id] = true
    window.UserStorage.writeJSON(ACH_UNLOCKED_NAME, obj)
  } catch (e) {}
}
// 成就弹窗 + 音效接口（音频稍后替换）
function playAchievementSfx() {
  // 接口占位：后续替换为实际音效文件
  try { sfx('win') } catch (e) {}
}
function showAchievementPopup(ach) {
  let el = document.getElementById('achPopup')
  if (!el) {
    el = document.createElement('div')
    el.id = 'achPopup'
    el.style.cssText = 'position:fixed;top:24px;right:24px;z-index:99999;background:linear-gradient(135deg,#2a1810,#4a2818);border:2px solid #d4a843;border-radius:10px;padding:14px 20px;min-width:260px;box-shadow:0 8px 32px rgba(0,0,0,.6);font-family:"PingFang SC","Microsoft YaHei",sans-serif;transform:translateX(120%);transition:transform .4s ease;pointer-events:none;'
    el.innerHTML = `
      <div style="font-size:11px;color:#d4a843;letter-spacing:2px;margin-bottom:4px;">成就解锁</div>
      <div style="display:flex;align-items:center;gap:8px;">
        <span id="achPopupStars" style="color:#ffd700;font-size:16px;"></span>
        <span id="achPopupName" style="color:#fff;font-size:16px;font-weight:bold;"></span>
      </div>
      <div id="achPopupDesc" style="color:#c8b89a;font-size:12px;margin-top:4px;line-height:1.5;"></div>`
    document.body.appendChild(el)
  }
  document.getElementById('achPopupStars').textContent = '★'.repeat(ach.stars) + '☆'.repeat(3 - ach.stars)
  document.getElementById('achPopupName').textContent = ach.name
  document.getElementById('achPopupDesc').textContent = ach.desc
  el.style.transform = 'translateX(0)'
  playAchievementSfx()
  clearTimeout(el._timer)
  el._timer = setTimeout(() => { el.style.transform = 'translateX(120%)' }, 3500)
}
function unlockAchievement(id) {
  console.log('[成就] unlockAchievement 调用:', id, '已在本局解锁:', unlockedThisRun.has(id), '已永久解锁:', isAchievementUnlocked(id))
  if (unlockedThisRun.has(id)) return
  if (isAchievementUnlocked(id)) return
  const ach = CLIMB_ACHIEVEMENTS.find(a => a.id === id)
  if (!ach) { console.log('[成就] 未找到成就定义:', id); return }
  unlockedThisRun.add(id)
  markAchievementUnlocked(id)
  showAchievementPopup(ach)
  console.log('[成就] 弹窗已显示:', ach.name)
}
loadClimbStats()

// ---------- input ----------
const KEYMAP = {
  ArrowLeft: 'left', a: 'left',
  ArrowRight: 'right', d: 'right',
  ArrowUp: 'jump', w: 'jump', ' ': 'jump',
  j: 'shoot', z: 'shoot',
  k: 'slash', x: 'slash',
  r: 'restart'
}

window.addEventListener('keydown', (e) => {
  if (state === 'start') {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault()
      initAudio()
      resetGame()
      startGame()
    }
    return
  }
  if (state === 'win' || state === 'lose') {
    if (e.key === 'r' || e.key === 'R') resetGame()
    return
  }
  const k = KEYMAP[e.key]
  if (!k) return
  e.preventDefault()
  if (k === 'jump' || k === 'shoot' || k === 'slash') {
    if (!e.repeat) press(k)
  } else if (k === 'left' || k === 'right') {
    keys[k] = true
  }
})

window.addEventListener('keyup', (e) => {
  const k = KEYMAP[e.key]
  if (k === 'left' || k === 'right') keys[k] = false
})

function press(k) {
  if (k === 'jump') player.jumpBuf = 6
  else if (k === 'shoot') tryShoot()
  else if (k === 'slash') trySlash()
}

// ---------- HTML UI wiring ----------
const menuEl = document.getElementById('menu')
const endEl = document.getElementById('endScreen')
const endTitleEl = document.getElementById('endTitle')
const endSubEl = document.getElementById('endSub')
const touchEl = document.getElementById('touch')
const btnSound = document.getElementById('btnSound')

function syncUI() {
  const over = state === 'win' || state === 'lose'
  if (menuEl) menuEl.classList.toggle('show', state === 'start')
  if (touchEl) touchEl.classList.toggle('show', state === 'play')
  if (endEl) {
    endEl.classList.toggle('show', over)
    if (over) {
      if (endTitleEl) {
        endTitleEl.textContent = state === 'win' ? '介于两石之间十分中正' : '挑战失败'
      }
      if (endSubEl) {
        endSubEl.textContent =
          state === 'win' ? '登顶成功！你站在山顶巨石之间。' : '时间到 或 生命耗尽，再试一次吧。'
      }
    }
  }
}

const btnStart = document.getElementById('btnStart')
const btnAgain = document.getElementById('btnAgain')
if (btnStart) {
  btnStart.addEventListener('click', () => {
    initAudio()
    resetGame()
    startGame()
  })
}
if (btnAgain) {
  btnAgain.addEventListener('click', () => {
    initAudio()
    resetGame()
    startGame()
  })
}
const btnMenu = document.getElementById('btnMenu')
console.log('[菜单] btnMenu 元素:', btnMenu)
if (btnMenu) {
  btnMenu.addEventListener('click', () => {
    console.log('[菜单] 返回菜单按钮点击, 当前 state=', state)
    resetGame()
    // 隐藏成就弹窗
    const achPopup = document.getElementById('achPopup')
    if (achPopup) achPopup.style.transform = 'translateX(120%)'
    syncUI()
    console.log('[菜单] 返回菜单完成, state=', state, 'menu显示=', document.getElementById('menu').classList.contains('show'))
  })
} else {
  console.log('[菜单] 警告: btnMenu 元素未找到!')
}
if (btnSound) {
  btnSound.addEventListener('click', () => {
    soundOn = !soundOn
    if (soundOn) initAudio()
    btnSound.textContent = '音效：' + (soundOn ? '开' : '关')
  })
}

for (const btn of document.querySelectorAll('[data-key]')) {
  const k = btn.dataset.key
  const down = (e) => {
    e.preventDefault()
    if (state !== 'play') return
    if (k === 'left' || k === 'right') keys[k] = true
    else press(k)
  }
  const up = (e) => {
    e.preventDefault()
    if (k === 'left' || k === 'right') keys[k] = false
  }
  btn.addEventListener('pointerdown', down)
  btn.addEventListener('pointerup', up)
  btn.addEventListener('pointerleave', up)
  btn.addEventListener('pointercancel', up)
}

// ---------- actions ----------
function tryShoot() {
  if (player.shootCd > 0) return
  player.shootCd = 15
  player.muzzle = 5
  sfx('shoot')
  climbStats.shots++
  usedWeapon = true
  const dir = player.facing
  bullets.push({
    x: dir === 1 ? player.x + player.w : player.x - 14,
    y: player.y + 22,
    vx: dir * 14,
    vy: 0,
    w: 12,
    h: 3,
    owner: 'player',
    life: 40
  })
}

function trySlash() {
  if (player.slashCd > 0 || player.slashTimer > 0) return
  player.slashTimer = 16
  player.slashCd = 22
  sfx('slash')
  usedWeapon = true
  usedSlash = true
}

function damagePlayer(dmg) {
  if (player.hurtTimer > 0 || state !== 'play') return
  tookDamage = true
  player.hp -= dmg
  player.hurtTimer = 45
  shake = 6
  sfx('hurt')
  spawnBurst(player.x + player.w / 2, player.y + player.h / 2, '#c0392b', 8)
  if (player.hp <= 0) {
    player.hp = 0
    climbStats.deaths++
    state = 'lose'
    sfx('lose')
    onPlayerLose()
  }
}

// ---------- 成就判定 ----------
function onPlayerLose() {
  console.log('[成就] onPlayerLose 触发, deathCause=', deathCause, 'cpIndex=', cpIndex)
  climbStats.failedBefore = true
  // 失败成就（不标注为失败成就）
  if (deathCause === 'rock') { climbStats.rocked = true; unlockAchievement('climb-rocked') }
  if (deathCause === 'shot') { climbStats.shotDeath = true; unlockAchievement('climb-shot') }
  if (deathCause === 'fell') { climbStats.fell = true; unlockAchievement('climb-fell') }
  if (cpIndex === 0) { climbStats.earlyDeath = true; unlockAchievement('climb-early') }
  saveClimbStats()
}
function onPlayerWin() {
  const usedTime = TIME_LIMIT - timeLeft
  if (climbStats.bestTime === null || usedTime < climbStats.bestTime) {
    climbStats.bestTime = usedTime
  }
  // 累计登顶次数
  climbStats.totalWins = (climbStats.totalWins || 0) + 1
  // 永久标记
  if (climbStats.deaths === 0) climbStats.flawless = true
  if (climbStats.kills >= ENEMY_SPAWNS.length) climbStats.slaughter = true
  if (climbStats.shots === 0) climbStats.melee = true
  if (!usedWeapon) climbStats.noWeapon = true
  if (!tookDamage) climbStats.noDamage = true
  if (climbStats.deaths >= 3 && climbStats.deaths > (climbStats.maxDeathsInRun || 0)) {
    climbStats.maxDeathsInRun = climbStats.deaths
  }
  if (enemyKilledByRock > 0) climbStats.enemyRockedKill = true
  if (climbStats.kills === 0) climbStats.peaceful = true
  if (climbStats.shots === 0 && usedSlash) climbStats.onlyMelee = true
  if (climbStats.shots > 0 && shotsHit === climbStats.shots) climbStats.sharpshooter = true
  if (climbStats.kills >= 10 && climbStats.kills > (climbStats.maxKillsInRun || 0)) {
    climbStats.maxKillsInRun = climbStats.kills
  }
  // 正面成就
  unlockAchievement('climb-champion')
  if (usedTime <= 90) unlockAchievement('climb-speedrun')
  if (usedTime <= 60) unlockAchievement('climb-speedster')
  if (climbStats.flawless) unlockAchievement('climb-flawless')
  if (climbStats.slaughter) unlockAchievement('climb-slaughter')
  if (climbStats.melee) unlockAchievement('climb-melee')
  if (climbStats.noWeapon) unlockAchievement('climb-barehand')
  if (climbStats.noDamage) unlockAchievement('climb-lucky')
  if (climbStats.failedBefore) unlockAchievement('climb-persistent')
  if ((climbStats.maxDeathsInRun || 0) >= 3) unlockAchievement('climb-comeback')
  if ((climbStats.totalWins || 0) >= 3) unlockAchievement('climb-veteran')
  if (climbStats.enemyRockedKill) unlockAchievement('climb-rock-kill')
  if (climbStats.peaceful) unlockAchievement('climb-peaceful')
  if (climbStats.onlyMelee) unlockAchievement('climb-sword-only')
  if (climbStats.sharpshooter) unlockAchievement('climb-sharpshooter')
  if (climbStats.collector) unlockAchievement('climb-collector')
  if ((climbStats.maxKillsInRun || 0) >= 10) unlockAchievement('climb-expert-killer')
  // 兼容旧成就系统的 climb-cleared 标记（按账号存）
  try { window.UserStorage.writeFlag(CLIMB_CLEARED_NAME) } catch (e) {}
  saveClimbStats()
}

function die() {
  console.log('[成就] die() 调用, state=', state, 'hp=', player.hp)
  if (state !== 'play') return
  tookDamage = true
  deathCause = 'fell'
  climbStats.deaths++
  player.hp -= 1
  shake = 8
  sfx('hurt')
  spawnBurst(player.x + player.w / 2, player.y + player.h / 2, '#c0392b', 14)
  if (player.hp <= 0) {
    console.log('[成就] die() 导致 hp<=0, 触发 onPlayerLose')
    player.hp = 0
    state = 'lose'
    sfx('lose')
    onPlayerLose()
    return
  }
  console.log('[成就] die() 扣血后 hp=', player.hp, ', 传送回检查点')
  player.x = cp.x
  player.y = cp.y
  player.vx = 0
  player.vy = 0
  player.hurtTimer = 40
}

// ---------- particles ----------
function spawnBurst(x, y, color, n, speed = 3) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2)
    const s = rand(1, speed)
    particles.push({
      x, y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      life: rand(12, 28),
      max: 28,
      color,
      size: rand(2, 4)
    })
  }
}

// ---------- collision ----------
function overlap(a, b) {
  return (
    a.x < b.x + b.w && a.x + a.w > b.x &&
    a.y < b.y + b.h && a.y + a.h > b.y
  )
}

function physics(p) {
  p.standPlat = null
  p.x += p.vx
  p.x = clamp(p.x, 0, WORLD_W - p.w)
  for (const r of rocks) {
    if (overlap(p, r)) {
      if (p.vx > 0) p.x = r.x - p.w
      else if (p.vx < 0) p.x = r.x + r.w
    }
  }

  const prevBottom = p.y + p.h
  p.vy += GRAV
  if (p.vy > 14) p.vy = 14
  p.y += p.vy
  p.onGround = false

  for (const r of rocks) {
    if (overlap(p, r)) {
      if (p.vy >= 0 && prevBottom <= r.y + 3) {
        p.y = r.y - p.h
        p.vy = 0
        p.onGround = true
      } else if (p.vy < 0) {
        p.y = r.y + r.h
        p.vy = 0
      }
    }
  }

  const gy = groundY(p.x + p.w / 2)
  if (gy !== null && p.y + p.h >= gy && p.vy >= 0) {
    p.y = gy - p.h
    p.vy = 0
    p.onGround = true
  }

  for (const pf of platforms) {
    if (
      p.vy >= 0 &&
      prevBottom <= pf.y + 3 &&
      p.y + p.h >= pf.y &&
      p.x + p.w > pf.x &&
      p.x < pf.x + pf.w
    ) {
      p.y = pf.y - p.h
      p.vy = 0
      p.onGround = true
      p.standPlat = pf
    }
  }
}

// ---------- game flow ----------
function startGame() {
  state = 'play'
  endTime = performance.now() + TIME_LIMIT * 1000
  timeLeft = TIME_LIMIT
}

function resetGame() {
  player.x = 60
  player.y = START_Y - PLAYER_H
  player.vx = 0
  player.vy = 0
  player.facing = 1
  player.hp = 3
  player.shootCd = 0
  player.muzzle = 0
  player.slashTimer = 0
  player.slashCd = 0
  player.hurtTimer = 0
  bullets = []
  particles = []
  fallRocks = []
  rockTimer = rand(150, 300)
  enemies = ENEMY_SPAWNS.map((s) => makeEnemy(s[0], s[1], s[2]))
  cpIndex = 0
  cp = { x: 60, y: START_Y - PLAYER_H }
  for (const pf of platforms) {
    if (pf.vx) {
      pf.x = pf.minX
      pf.vx = Math.abs(pf.vx)
      pf.dx = 0
    }
  }
  state = 'start'
  // 重置本局统计（跨局统计如 failedBefore/bestTime 保留）
  climbStats.deaths = 0
  climbStats.kills = 0
  climbStats.shots = 0
  deathCause = null
  usedWeapon = false
  usedSlash = false
  tookDamage = false
  enemyKilledByRock = 0
  shotsHit = 0
  unlockedThisRun.clear()
}

// ---------- drawing helpers ----------
function drawPx(img, x, y, scale, flip) {
  ctx.save()
  ctx.imageSmoothingEnabled = false
  if (flip) {
    ctx.translate(x + img.width * scale, y)
    ctx.scale(-1, 1)
    ctx.drawImage(img, 0, 0, img.width * scale, img.height * scale)
  } else {
    ctx.drawImage(img, x, y, img.width * scale, img.height * scale)
  }
  ctx.restore()
}

function drawRifle(cx, cy, dir) {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.scale(dir, 1)
  ctx.fillStyle = P.e
  ctx.fillRect(-12, -3, 10, 5)
  ctx.fillStyle = P.w
  ctx.fillRect(-2, -2, 20, 3)
  ctx.fillStyle = P.W
  ctx.fillRect(18, -3, 5, 4)
  ctx.restore()
}

function drawSword(cx, cy, dir, prog) {
  const ang = lerp(-0.9, 1.4, prog)
  ctx.save()
  ctx.translate(cx, cy)
  ctx.scale(dir, 1)
  ctx.rotate(ang)
  ctx.fillStyle = P.b
  ctx.fillRect(-10, -3, 10, 6)
  ctx.fillStyle = P.y
  ctx.fillRect(-1, -6, 3, 12)
  ctx.fillStyle = '#d8d8d8'
  ctx.beginPath()
  ctx.moveTo(2, -2)
  ctx.quadraticCurveTo(14, -4, 28, -7)
  ctx.lineTo(28, -1)
  ctx.quadraticCurveTo(14, 1, 2, 2)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(4, -2, 22, 2)
  ctx.restore()
}

function drawSlashArc(cx, cy, dir, prog) {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.scale(dir, 1)
  const a0 = -0.6
  const ang = lerp(a0, 1.2, prog)
  ctx.strokeStyle = 'rgba(255,255,255,0.85)'
  ctx.lineWidth = 7
  ctx.beginPath()
  ctx.arc(0, 0, 30, a0, ang)
  ctx.stroke()
  ctx.lineWidth = 3
  ctx.strokeStyle = 'rgba(255,255,200,0.95)'
  ctx.beginPath()
  ctx.arc(0, 0, 26, a0, ang)
  ctx.stroke()
  ctx.restore()
}

function drawMuzzle(x, y) {
  ctx.fillStyle = P.y
  ctx.fillRect(x - 4, y - 4, 8, 8)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(x - 2, y - 2, 4, 4)
}

// ---------- world rendering ----------
function drawSky() {
  const g = ctx.createLinearGradient(0, 0, 0, canvas.height)
  g.addColorStop(0, '#7ec8f0')
  g.addColorStop(0.6, '#bfe3f5')
  g.addColorStop(1, '#e8f4fb')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  ctx.fillStyle = '#fff3c4'
  ctx.beginPath()
  ctx.arc(canvas.width - 160 - cam.x * 0.02, 90 - cam.y * 0.02, 42, 0, Math.PI * 2)
  ctx.fill()
}

function drawClouds() {
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  for (let i = 0; i < 8; i++) {
    const cx = ((i * 420 - cam.x * 0.25 + i * 137) % (canvas.width + 240)) - 120
    const cy = 60 + ((i * 97) % 160) - cam.y * 0.05
    const s = 0.6 + (i % 3) * 0.25
    ctx.fillRect(cx, cy, 44 * s, 12 * s)
    ctx.fillRect(cx + 10 * s, cy - 8 * s, 24 * s, 10 * s)
    ctx.fillRect(cx + 22 * s, cy - 4 * s, 20 * s, 8 * s)
  }
}

function drawFarMountain(par, color, baseY) {
  const step = 24
  const yOff = cam.y * 0.12
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(0, canvas.height)
  for (let sx = 0; sx <= canvas.width + step; sx += step) {
    const wx = sx + cam.x * par
    const n = Math.sin(wx * 0.0018) * 0.5 + Math.sin(wx * 0.0006 + 2) * 0.5
    const y = baseY - n * 220 - cam.y * 0.12
    ctx.lineTo(sx, y)
  }
  ctx.lineTo(canvas.width, canvas.height)
  ctx.closePath()
  ctx.fill()
}

function drawTerrain() {
  const step = 8
  for (let sx = 0; sx <= canvas.width; sx += step) {
    const wx = sx + cam.x
    const gy = groundY(wx)
    if (gy === null) continue
    const y = gy - cam.y
    ctx.fillStyle = '#5d7a33'
    ctx.fillRect(sx, y, step, 10)
    ctx.fillStyle = '#7a5230'
    ctx.fillRect(sx, y + 10, step, canvas.height - y - 10)
  }

  for (const g of GAPS) {
    const x0 = g.x0 - cam.x
    const x1 = g.x1 - cam.x
    if (x1 < 0 || x0 > canvas.width) continue
    const y = g.y - cam.y
    ctx.fillStyle = '#160e0c'
    ctx.fillRect(x0, y, x1 - x0, canvas.height - y)
    ctx.fillStyle = '#3a2a1c'
    ctx.fillRect(x0, y, 6, canvas.height - y)
    ctx.fillRect(x1 - 6, y, 6, canvas.height - y)
    const grd = ctx.createLinearGradient(0, y, 0, canvas.height)
    grd.addColorStop(0, 'rgba(0,0,0,0)')
    grd.addColorStop(1, 'rgba(0,0,0,0.5)')
    ctx.fillStyle = grd
    ctx.fillRect(x0, y, x1 - x0, canvas.height - y)
  }

  ctx.fillStyle = 'rgba(0,0,0,0.08)'
  for (let sx = 0; sx <= canvas.width; sx += 64) {
    const wx = sx + cam.x
    const gy = groundY(wx)
    if (gy === null) continue
    ctx.fillRect(sx, gy - cam.y + 22, 4, 4)
  }
}

function drawPlatform(pf) {
  const x = pf.x - cam.x
  const y = pf.y - cam.y
  ctx.fillStyle = '#7a5230'
  ctx.fillRect(x, y, pf.w, 14)
  ctx.fillStyle = pf.vx ? '#8fb84a' : '#5d7a33'
  ctx.fillRect(x - 3, y, pf.w + 6, 5)
  ctx.fillStyle = 'rgba(0,0,0,0.15)'
  ctx.fillRect(x, y + 12, pf.w, 2)
}

function drawCheckpoints() {
  for (let i = 0; i < CHECKPOINTS.length; i++) {
    const cx = CHECKPOINTS[i]
    const gy = groundY(cx)
    if (gy === null) continue
    const x = cx - cam.x
    const y = gy - cam.y
    const active = i < cpIndex
    ctx.fillStyle = active ? '#3a3a3a' : '#7a7a7a'
    ctx.fillRect(x, y - 64, 4, 64)
    ctx.fillStyle = active ? '#7dd84a' : '#c8c8c8'
    ctx.beginPath()
    ctx.moveTo(x + 4, y - 64)
    ctx.lineTo(x + 28, y - 56)
    ctx.lineTo(x + 4, y - 48)
    ctx.closePath()
    ctx.fill()
  }
}

function drawRock(r) {
  const x = r.x - cam.x
  const y = r.y - cam.y
  ctx.fillStyle = '#8a8f94'
  ctx.fillRect(x, y, r.w, r.h)
  ctx.fillStyle = '#a9aeb3'
  ctx.fillRect(x, y, r.w, 8)
  ctx.fillStyle = '#5f6468'
  ctx.fillRect(x + 6, y + 14, 8, 8)
  ctx.fillRect(x + 22, y + 24, 8, 8)
}

function drawFallRock(r) {
  const gy = groundY(r.x + r.w / 2)
  if (gy !== null) {
    const sx = r.x + r.w / 2 - cam.x
    const sy = gy - cam.y
    ctx.fillStyle = 'rgba(0,0,0,0.28)'
    ctx.beginPath()
    ctx.ellipse(sx, sy, r.w * 0.7, 6, 0, 0, Math.PI * 2)
    ctx.fill()
  }
  const x = r.x - cam.x
  const y = r.y - cam.y
  ctx.save()
  ctx.translate(x + r.w / 2, y + r.h / 2)
  ctx.rotate(r.rot)
  ctx.fillStyle = '#8a8f94'
  ctx.fillRect(-r.w / 2, -r.h / 2, r.w, r.h)
  ctx.fillStyle = '#a9aeb3'
  ctx.fillRect(-r.w / 2, -r.h / 2, r.w, 7)
  ctx.fillStyle = '#5f6468'
  ctx.fillRect(-r.w / 2 + 5, -r.h / 2 + 12, 7, 7)
  ctx.fillRect(r.w / 2 - 12, r.h / 2 - 14, 7, 7)
  ctx.restore()
}

function drawFlag() {
  const x = FLAG_X - cam.x
  const y = groundY(FLAG_X) - cam.y
  ctx.fillStyle = '#6b6b6b'
  ctx.fillRect(x, y - 120, 6, 120)
  const wave = Math.sin(performance.now() / 200) * 4
  ctx.fillStyle = '#d82424'
  ctx.beginPath()
  ctx.moveTo(x + 6, y - 120)
  ctx.lineTo(x + 52 + wave, y - 108)
  ctx.lineTo(x + 6, y - 96)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#f4f4f4'
  ctx.fillRect(x + 10, y - 116, 10, 8)
}

function drawSummitMan() {
  const s = 2.5
  const gy = groundY(SUMMIT_MAN_X)
  const w = PAJAMA_MAN.width * s
  const h = PAJAMA_MAN.height * s
  const bob = Math.sin(performance.now() / 600) * 2
  drawPx(PAJAMA_MAN, SUMMIT_MAN_X - w / 2 - cam.x, gy - h + bob - cam.y, s, false)
}

// ---------- entity rendering ----------
function drawPlayer() {
  const p = player
  if (p.hurtTimer > 0 && Math.floor(p.hurtTimer / 4) % 2 === 0) return

  let spr
  if (p.slashTimer > 0) spr = SOLDIER_IDLE
  else if (p.muzzle > 0) spr = SOLDIER_SHOOT
  else if (!p.onGround) spr = SOLDIER_JUMP
  else if (Math.abs(p.vx) > 0.5) spr = Math.floor(p.frame / 6) % 2 === 0 ? SOLDIER_RUN1 : SOLDIER_RUN2
  else spr = SOLDIER_IDLE

  const sx = p.x - 5 - cam.x
  const sy = p.y - 7 - cam.y
  drawPx(spr, sx, sy, 2.5, p.facing < 0)

  const hx = p.x + p.w / 2 - cam.x
  const hy = p.y + 20 - cam.y
  if (p.slashTimer > 0) {
    const prog = 1 - p.slashTimer / 16
    drawSword(hx, hy, p.facing, prog)
    if (p.slashTimer >= 3 && p.slashTimer <= 13) drawSlashArc(hx, hy, p.facing, prog)
  } else {
    drawRifle(hx, hy, p.facing)
  }

  if (p.muzzle > 0) {
    const mx = (p.facing === 1 ? p.x + p.w + 4 : p.x - 8) - cam.x
    drawMuzzle(mx, hy)
  }
}

function drawEnemy(e) {
  const sx = e.x - 5 - cam.x
  const sy = e.y - 7 - cam.y
  const moving = Math.abs(e.vx) > 0.1
  let spr = ENEMY_IDLE
  if (moving) spr = Math.floor(e.frame / 8) % 2 === 0 ? ENEMY_RUN1 : ENEMY_RUN2
  if (e.flash > 0) spr = ENEMY_IDLE
  drawPx(spr, sx, sy, 2.5, e.facing < 0)
  if (e.flash > 0) {
    const hx = e.x + e.w / 2 - cam.x
    const hy = e.y + 20 - cam.y
    drawRifle(hx, hy, e.facing)
    drawMuzzle(e.facing === 1 ? e.x + e.w - cam.x : e.x - 10 - cam.x, hy)
  }
}

function drawBullet(b) {
  const x = b.x - cam.x
  const y = b.y - cam.y
  ctx.fillStyle = b.owner === 'player' ? '#ffe066' : '#ff6b4a'
  ctx.fillRect(x, y, b.w, b.h)
}

// ---------- HUD ----------
function drawHUD() {
  ctx.fillStyle = 'rgba(0,0,0,0.45)'
  ctx.fillRect(0, 0, canvas.width, 46)

  for (let i = 0; i < player.maxHp; i++) {
    const full = i < player.hp
    if (full) drawPx(HEART, 12 + i * 30, 12, 3, false)
    else {
      ctx.fillStyle = 'rgba(120,120,120,0.5)'
      ctx.fillRect(12 + i * 30, 12, 21, 18)
    }
  }

  ctx.textAlign = 'center'
  ctx.font = "20px 'Press Start 2P', monospace"
  ctx.fillStyle = '#ffffff'
  ctx.fillText('TIME ' + timeLeft, canvas.width / 2, 30)

  const prog = clamp((START_Y - player.y) / (START_Y - SUMMIT_Y), 0, 1)
  const bx = canvas.width - 220
  const by = 14
  ctx.fillStyle = 'rgba(255,255,255,0.25)'
  ctx.fillRect(bx, by, 200, 16)
  ctx.fillStyle = '#7dd84a'
  ctx.fillRect(bx, by, 200 * prog, 16)
  ctx.strokeStyle = '#000'
  ctx.lineWidth = 2
  ctx.strokeRect(bx, by, 200, 16)
  ctx.font = "9px 'Press Start 2P', monospace"
  ctx.fillStyle = '#ffffff'
  ctx.fillText('SUMMIT', bx + 100, by + 30)
}

// ---------- update ----------
function updatePlayer() {
  const p = player
  if (p.hurtTimer > 0) p.hurtTimer--
  if (p.shootCd > 0) p.shootCd--
  if (p.muzzle > 0) p.muzzle--
  if (p.slashCd > 0) p.slashCd--
  if (p.jumpBuf > 0) p.jumpBuf--

  let dir = 0
  if (keys.left) dir -= 1
  if (keys.right) dir += 1
  p.vx = dir * SPEED
  if (dir !== 0) p.facing = dir
  if (p.vx !== 0) p.frame++

  if (p.onGround) p.coyote = 6
  else if (p.coyote > 0) p.coyote--

  if (p.jumpBuf > 0 && p.coyote > 0) {
    p.vy = JUMP_V
    p.onGround = false
    p.coyote = 0
    p.jumpBuf = 0
    sfx('jump')
  }

  if (p.slashTimer > 0) p.slashTimer--

  physics(p)

  if (p.standPlat) p.x += p.standPlat.dx || 0

  if (p.y + p.h > WORLD_H) die()

  if (cpIndex < CHECKPOINTS.length && p.x >= CHECKPOINTS[cpIndex]) {
    cp = { x: CHECKPOINTS[cpIndex], y: groundY(CHECKPOINTS[cpIndex]) - PLAYER_H }
    spawnBurst(cp.x, cp.y + PLAYER_H / 2, '#7dd84a', 12)
    sfx('checkpoint')
    cpIndex++
    // 到达第一个检查点成就
    if (cpIndex === 1 && !climbStats.reachedFirstCheckpoint) {
      climbStats.reachedFirstCheckpoint = true
      saveClimbStats()
      unlockAchievement('climb-first-checkpoint')
    }
    // 到达所有检查点成就
    if (cpIndex >= CHECKPOINTS.length && !climbStats.collector) {
      climbStats.collector = true
      saveClimbStats()
      unlockAchievement('climb-collector')
    }
  }
}

function updatePlatforms() {
  for (const pf of platforms) {
    if (!pf.vx) {
      pf.dx = 0
      continue
    }
    const prev = pf.x
    pf.x += pf.vx
    if (pf.x < pf.minX) {
      pf.x = pf.minX
      pf.vx *= -1
    } else if (pf.x + pf.w > pf.maxX) {
      pf.x = pf.maxX - pf.w
      pf.vx *= -1
    }
    pf.dx = pf.x - prev
  }
}

function updateEnemies() {
  for (const e of enemies) {
    if (e.flash > 0) e.flash--
    e.frame++
    e.x += e.dir * e.speed
    if (e.x < e.minX) { e.x = e.minX; e.dir = 1 }
    if (e.x > e.maxX) { e.x = e.maxX; e.dir = -1 }
    e.vx = e.dir * e.speed
    e.y = groundY(e.x) - e.h

    const dx = player.x - e.x
    const dy = player.y - e.y
    e.facing = dx >= 0 ? 1 : -1
    e.shootTimer--
    if (e.shootTimer <= 0 && Math.abs(dx) < 520 && Math.abs(dy) < 220 && state === 'play') {
      e.shootTimer = rand(70, 150)
      e.flash = 10
      bullets.push({
        x: e.facing === 1 ? e.x + e.w : e.x - 14,
        y: e.y + 20,
        vx: e.facing * 3.4,
        vy: 0,
        w: 10,
        h: 4,
        owner: 'enemy',
        life: 220
      })
    }
  }
}

function updateBullets() {
  for (const b of bullets) {
    b.x += b.vx
    b.y += b.vy
    b.life--
    if (b.life <= 0 || b.x < cam.x - 40 || b.x > cam.x + canvas.width + 40) b.life = 0
  }
  bullets = bullets.filter((b) => b.life > 0)
}

function spawnFallRock() {
  const off = rand(-170, 220)
  const w = rand(26, 40)
  const h = rand(26, 40)
  const x = clamp(player.x + off, 20, WORLD_W - w - 20)
  fallRocks.push({
    x,
    y: cam.y - rand(60, 160),
    w,
    h,
    vx: clamp((player.x + player.w / 2 - (x + w / 2)) * 0.004, -1.2, 1.2),
    vy: rand(1, 3),
    rot: 0,
    rotV: rand(-0.08, 0.08),
    dead: false
  })
  sfx('rockfall')
}

function updateHazards() {
  rockTimer--
  if (rockTimer <= 0) {
    spawnFallRock()
    rockTimer = rand(150, 300)
  }
  for (const r of fallRocks) {
    r.vy += 0.45
    r.x += r.vx
    r.y += r.vy
    r.rot += r.rotV
    const gy = groundY(r.x + r.w / 2)
    if ((gy !== null && r.y + r.h >= gy) || r.y > WORLD_H) {
      r.dead = true
      spawnBurst(r.x + r.w / 2, r.y + r.h, '#8a8f94', 10, 4)
      shake = Math.max(shake, 4)
      sfx('impact')
    }
  }
  fallRocks = fallRocks.filter((r) => !r.dead)
}

function checkCollisions() {
  // falling rocks vs player / enemies
  for (const r of fallRocks) {
    if (overlap(r, player)) {
      r.dead = true
      spawnBurst(r.x + r.w / 2, r.y + r.h / 2, '#8a8f94', 8, 4)
      sfx('impact')
      deathCause = 'rock'
      damagePlayer(1)
    }
    for (const e of enemies) {
      if (e.hp <= 0) continue
      if (overlap(r, e)) {
        r.dead = true
        e.hp = 0
        spawnBurst(e.x + e.w / 2, e.y + e.h / 2, '#6a6f74', 14)
        sfx('edie')
        climbStats.kills++
        enemyKilledByRock++
        break
      }
    }
  }

  // player bullets vs enemies
  for (const b of bullets) {
    if (b.owner !== 'player') continue
    for (const e of enemies) {
      if (e.hp <= 0) continue
      if (overlap(b, e)) {
        b.life = 0
        shotsHit++
        e.hp -= 1
        e.flash = 8
        sfx('ehit')
        spawnBurst(b.x, b.y, '#ffffff', 4)
        if (e.hp <= 0) {
          spawnBurst(e.x + e.w / 2, e.y + e.h / 2, '#6a6f74', 14)
          sfx('edie')
          climbStats.kills++
        }
        break
      }
    }
  }

  // enemy bullets vs player
  for (const b of bullets) {
    if (b.owner !== 'enemy') continue
    if (overlap(b, player)) {
      b.life = 0
      deathCause = 'shot'
      damagePlayer(1)
    }
  }

  // sword vs enemies
  if (player.slashTimer >= 3 && player.slashTimer <= 13) {
    const sw = 60
    const hb = {
      x: player.facing === 1 ? player.x + player.w - 5 : player.x - sw + 5,
      y: player.y + 4,
      w: sw,
      h: 40
    }
    for (const e of enemies) {
      if (e.hp <= 0) continue
      if (overlap(hb, e)) {
        e.hp -= 2
        e.flash = 8
        sfx('ehit')
        spawnBurst(e.x + e.w / 2, e.y + e.h / 2, '#ffffff', 8)
        if (e.hp <= 0) {
          spawnBurst(e.x + e.w / 2, e.y + e.h / 2, '#6a6f74', 16)
          sfx('edie')
          climbStats.kills++
        }
      }
    }
  }

  enemies = enemies.filter((e) => e.hp > 0)
}

// ---------- camera ----------
function updateCamera() {
  cam.x = player.x - canvas.width / 2
  cam.y = player.y - canvas.height * 0.6
  cam.x = clamp(cam.x, 0, WORLD_W - canvas.width)
  cam.y = clamp(cam.y, 0, WORLD_H - canvas.height)
}

// ---------- main loop ----------
// 固定步长逻辑：这套小游戏的所有数值（SPEED / GRAV / JUMP_V / 各种冷却与 flash / shake…）
// 都是按「一帧一步 @60Hz」调出来的，而 requestAnimationFrame 的频率跟着显示器刷新率走
// —— 在 120Hz / 144Hz 的机器上，逐帧更新会直接跑成 2~2.4 倍速（本机 60Hz 正常、别人机器变快）。
// 所以逻辑固定在 60Hz 步进，按真实经过时间补步；补不上的部分丢掉，最多补 5 步（不瞬移）。
const STEP_MS = 1000 / 60
const MAX_STEPS_PER_FRAME = 5
const MAX_FRAME_MS = 250 // 切标签页 / 系统卡顿回来时，单帧最多按 250ms 计
let lastFrameAt = 0
let stepAccumulator = 0

function animate(now) {
  requestAnimationFrame(animate)
  renderFrames++

  if (typeof now !== 'number') now = performance.now()
  if (!lastFrameAt) lastFrameAt = now
  let elapsed = now - lastFrameAt
  if (elapsed < 0) elapsed = 0 // 时钟回退（页面挂起恢复 / 测试注入时钟）
  lastFrameAt = now
  if (elapsed > MAX_FRAME_MS) elapsed = MAX_FRAME_MS
  stepAccumulator += elapsed

  let steps = 0
  while (stepAccumulator >= STEP_MS && steps < MAX_STEPS_PER_FRAME) {
    stepAccumulator -= STEP_MS
    steps++
    logicSteps++

    if (state === 'play') {
      updatePlatforms()
      updatePlayer()
      updateEnemies()
      updateBullets()
      updateHazards()
      checkCollisions()
      updateCamera()
    }

    if (shake > 0) shake--

    // 粒子同样按 60Hz 步进（以前跟着刷新率走，高刷屏上会飞得更快、消失得更快）
    for (const pt of particles) {
      pt.x += pt.vx
      pt.y += pt.vy
      pt.vy += 0.15
      pt.life--
    }
    particles = particles.filter((p) => p.life > 0)
  }
  if (steps >= MAX_STEPS_PER_FRAME) stepAccumulator = 0 // 追不上就丢掉积压，别滚雪球

  if (state === 'play') {
    // 倒计时与胜负判定都基于真实时钟（不受刷新率影响）
    timeLeft = Math.max(0, Math.ceil((endTime - performance.now()) / 1000))
    if (timeLeft <= 0) {
      state = 'lose'
      sfx('lose')
      onPlayerLose()
    } else if (player.x >= WIN_X) {
      state = 'win'
      sfx('win')
      onPlayerWin()
    }
  }

  ctx.save()
  if (shake > 0) {
    ctx.translate(rand(-shake, shake), rand(-shake, shake))
  }

  drawSky()
  drawClouds()
  drawFarMountain(0.3, '#b8cfd8', 420)
  drawFarMountain(0.55, '#93b0b8', 380)
  drawTerrain()
  for (const pf of platforms) drawPlatform(pf)
  for (const r of rocks) drawRock(r)
  drawCheckpoints()
  drawFlag()
  for (const r of SUMMIT_ROCKS) drawRock(r)
  for (const r of fallRocks) drawFallRock(r)

  for (const b of bullets) drawBullet(b)
  for (const e of enemies) drawEnemy(e)
  drawPlayer()
  drawSummitMan()

  for (const pt of particles) {
    ctx.fillStyle = pt.color
    ctx.globalAlpha = clamp(pt.life / pt.max, 0, 1)
    ctx.fillRect(pt.x - cam.x, pt.y - cam.y, pt.size, pt.size)
    ctx.globalAlpha = 1
  }

  drawHUD()
  ctx.restore()

  syncUI()
}

// 只读调试口：端到端测试用它断言"同一段真实时间里，60Hz 与 120Hz 的推进量一致"
// （全是 getter，不写状态，也不参与游戏逻辑）。
window.__climb = {
  get state() { return state },
  get x() { return player.x },
  get y() { return player.y },
  get renderFrames() { return renderFrames },
  get logicSteps() { return logicSteps },
  get timeLeft() { return timeLeft },
}

animate()


