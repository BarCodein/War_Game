// 成就系统（gdd.md §11）：成就定义 + 解锁判定。
//
// 纯函数、无 DOM：页面（src/entries/achievements.js）只负责把这里的结果画出来，
// 判定逻辑因此可以单测（tests/unit/achievements.test.js）。
//
// **星级**：每条成就自带 1~3 星（稀有度），解锁后计入总星数；页面上显示"已解锁 X/Y · 星数 A/B"。
// 全部数据来自本地存储（无后端）：
//   war-of-dots.campaign-progress  关卡通关记录（battlechoose-data.js 写入）
//   war-of-dots.level-stats        每关最佳战绩：是否通关 / 最快用时 / 最低伤亡（result.html 写入）
//   war-of-dots.climb-cleared      西安事变登山小游戏登顶标记（climb.js 写入）
//   war-of-dots.custom-map         地图编辑器保存过自定义地图（editorToolbar.js 写入）

export const PROGRESS_KEY = 'war-of-dots.campaign-progress';
export const LEVEL_STATS_KEY = 'war-of-dots.level-stats';
export const CLIMB_CLEARED_KEY = 'war-of-dots.climb-cleared';
export const CUSTOM_MAP_KEY = 'war-of-dots.custom-map';

// 判定用的"战绩汇总"，由 evaluateAchievements 从原始数据算好再交给各条件
function summarizeStats(stats) {
  const entries = Object.entries(stats ?? {}).map(([id, value]) => ({ id, ...value }));
  return {
    cleared: entries.filter(entry => entry.cleared),
    bestTime: entries.reduce(
      (best, entry) => (entry.cleared && Number.isFinite(entry.bestTime) && entry.bestTime > 0
        ? Math.min(best ?? Infinity, entry.bestTime) : best),
      null,
    ),
    bestCasualties: entries.reduce(
      (best, entry) => (entry.cleared && Number.isFinite(entry.bestCasualties)
        ? Math.min(best ?? Infinity, entry.bestCasualties) : best),
      null,
    ),
  };
}

/**
 * 成就定义。`hint` 是未解锁时显示的达成条件；`condition(ctx)` 返回是否解锁。
 * 数字阈值（比如 3 分钟、伤亡 100）暂定，方便后续按手感调整。
 */
export const ACHIEVEMENTS = [
  {
    id: 'first-victory',
    name: '首战告捷',
    stars: 1,
    desc: '完成任意一场战役，在沙盘上留下第一个胜字。',
    hint: '通关任意一关',
    condition: ({ completedLevelIds }) => completedLevelIds.length > 0,
  },
  {
    id: 'subei',
    name: '宿北战役',
    stars: 2,
    desc: '山东野战军与华中野战军联手，于宿迁北部歼灭国民党军整编第 69 师。',
    hint: '通关「宿北战役」',
    condition: ({ progress }) => progress?.subei_battle?.completed === true,
  },
  {
    id: 'tashan',
    name: '塔山战役',
    stars: 3,
    desc: '死守塔山阵地，把敌军的海陆协同进攻挡在阵地之外。',
    hint: '通关「塔山阻击战」',
    condition: ({ progress }) => progress?.tashan_battle?.completed === true,
  },
  {
    id: 'climb-champion',
    name: '睡衣登山大赛冠军',
    stars: 3,
    desc: '在西安事变的登山小游戏里登顶成功，成为本届睡衣登山大赛冠军。',
    hint: '通关西安事变的登山小游戏',
    condition: ({ climbCleared }) => climbCleared === true,
  },
  {
    id: 'all-campaigns',
    name: '战役全通',
    stars: 3,
    desc: '把战役选择页上的每一场战役都打完。',
    hint: '通关关卡索引中的全部战役',
    condition: ({ levels, progress }) => levels.length > 0
      && levels.every(level => progress?.[level.id]?.completed === true),
  },
  {
    id: 'swift',
    name: '一鼓作气',
    stars: 2,
    desc: '闪电般结束一场战役——兵贵神速。',
    hint: '任意战役用时 ≤ 3:00',
    condition: ({ statsSummary }) => statsSummary.bestTime !== null && statsSummary.bestTime <= 180,
  },
  {
    id: 'flawless',
    name: '兵不血刃',
    stars: 3,
    desc: '以极小的代价拿下胜利，伤亡控制在一百以内。',
    hint: '任意战役通关且我方伤亡 < 100',
    condition: ({ statsSummary }) => statsSummary.bestCasualties !== null && statsSummary.bestCasualties < 100,
  },
  {
    id: 'map-maker',
    name: '沙盘工程师',
    stars: 1,
    desc: '在地图编辑器里保存过一张自己画的地图。',
    hint: '在编辑器中保存自定义地图',
    condition: ({ customMapSaved }) => customMapSaved === true,
  },
];

/**
 * 判定所有成就。
 * @param {object} input
 * @param {object} input.progress    war-of-dots.campaign-progress（关卡 id → { completed, wins }）
 * @param {object} input.stats       war-of-dots.level-stats（关卡 id → { cleared, bestTime, bestCasualties }）
 * @param {Array}  input.levels      关卡索引（[{ id, name, ... }]）
 * @param {boolean} input.climbCleared / input.customMapSaved
 * @returns {Array} 每条成就 + `unlocked`
 */
export function evaluateAchievements({
  progress = {}, stats = {}, levels = [], climbCleared = false, customMapSaved = false,
} = {}) {
  const completedLevelIds = Object.keys(progress ?? {}).filter(id => progress[id]?.completed);
  const context = {
    progress: progress ?? {},
    stats: stats ?? {},
    levels: Array.isArray(levels) ? levels : [],
    completedLevelIds,
    statsSummary: summarizeStats(stats),
    climbCleared,
    customMapSaved,
  };
  return ACHIEVEMENTS.map(def => ({
    ...def,
    unlocked: Boolean(def.condition(context)),
  }));
}

/** 汇总：已解锁数量与星数（总星数 = 所有成就星级之和）。 */
export function summarizeAchievements(list) {
  const totalStars = list.reduce((sum, item) => sum + item.stars, 0);
  const earnedStars = list.reduce((sum, item) => sum + (item.unlocked ? item.stars : 0), 0);
  const unlocked = list.filter(item => item.unlocked).length;
  return { totalStars, earnedStars, unlocked, count: list.length };
}
