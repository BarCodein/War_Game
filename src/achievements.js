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
export const CLIMB_STATS_KEY = 'war-of-dots.climb-stats';
export const ACH_UNLOCKED_KEY = 'war-of-dots.ach-unlocked';
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
    totalPlays: entries.reduce((sum, entry) => sum + (Number(entry.plays) || 0), 0),
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
    id: 'first-defeat',
    name: '胜败乃兵家常事',
    stars: 1,
    desc: '第一次经历战败，知耻而后勇，来日方长。',
    hint: '在任意战役中失败一次',
    condition: ({ hasDefeat }) => hasDefeat === true,
  },
  {
    id: 'veteran',
    name: '百战不殆',
    stars: 2,
    desc: '累计征战十场，沙盘上的老兵。',
    hint: '累计游玩10场战役',
    condition: ({ statsSummary }) => statsSummary.totalPlays >= 10,
  },
  {
    id: 'general',
    name: '常胜将军',
    stars: 3,
    desc: '累计获胜五场，攻无不克，战无不胜。',
    hint: '累计胜利5场',
    condition: ({ totalWins }) => totalWins >= 5,
  },
  {
    id: 'blitz',
    name: '速战速决',
    stars: 2,
    desc: '两分钟内结束一场战役，兵贵神速。',
    hint: '任意战役用时≤2:00',
    condition: ({ statsSummary }) => statsSummary.bestTime !== null && statsSummary.bestTime <= 120,
  },
  {
    id: 'perfect',
    name: '毫发无损',
    stars: 3,
    desc: '一场战役下来，我方零伤亡，用兵如神。',
    hint: '任意战役通关且我方伤亡=0',
    condition: ({ statsSummary }) => statsSummary.bestCasualties === 0,
  },
  {
    id: 'tutorial-1',
    name: '教学毕业',
    stars: 1,
    desc: '完成基础教学关卡，掌握指挥的基本功。',
    hint: '通关基础教学关卡',
    condition: ({ progress }) => progress?.['fracture-canyon-tutorial']?.completed === true,
  },
  {
    id: 'tutorial-2',
    name: '战术精通',
    stars: 2,
    desc: '完成地形与士气教学关卡，深谙地形与士气之道。',
    hint: '通关地形与士气教学关卡',
    condition: ({ progress }) => progress?.['tactical-training-tutorial']?.completed === true,
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
  // ---------- 登山小游戏成就 ----------
  {
    id: 'climb-first-checkpoint',
    name: '初露锋芒',
    stars: 1,
    desc: '到达第一个检查点，登山之路迈出坚实的第一步。',
    hint: '到达第一个检查点',
    condition: ({ climbStats }) => climbStats?.reachedFirstCheckpoint === true,
  },
  {
    id: 'climb-veteran',
    name: '登山达人',
    stars: 2,
    desc: '累计登顶三次，睡衣登山界的常客。',
    hint: '累计登顶3次',
    condition: ({ climbStats }) => (climbStats?.totalWins || 0) >= 3,
  },
  {
    id: 'climb-speedster',
    name: '极速攀登',
    stars: 3,
    desc: '60秒内登顶，风一般的男子。',
    hint: '60秒内登顶',
    condition: ({ climbStats }) => climbStats?.bestTime != null && climbStats.bestTime <= 60,
  },
  {
    id: 'climb-barehand',
    name: '赤手空拳',
    stars: 2,
    desc: '不射击也不挥刀，仅凭拳脚登顶。',
    hint: '不射击也不使用大刀通关',
    condition: ({ climbStats }) => climbStats?.noWeapon === true,
  },
  {
    id: 'climb-lucky',
    name: '幸运儿',
    stars: 1,
    desc: '全程未受任何伤害就登顶，运气也是实力的一部分。',
    hint: '单局不被任何伤害通关',
    condition: ({ climbStats }) => climbStats?.noDamage === true,
  },
  {
    id: 'climb-comeback',
    name: '越挫越勇',
    stars: 2,
    desc: '单局死亡3次以上仍登顶，不屈不挠。',
    hint: '单局死亡3次以上仍登顶',
    condition: ({ climbStats }) => (climbStats?.maxDeathsInRun || 0) >= 3,
  },
  {
    id: 'climb-rock-kill',
    name: '大石碎胸口',
    stars: 1,
    desc: '引导敌人被天降巨石砸死，借刀杀人。',
    hint: '引导敌人被落石砸死',
    condition: ({ climbStats }) => climbStats?.enemyRockedKill === true,
  },
  {
    id: 'climb-peaceful',
    name: '和平解决',
    stars: 2,
    desc: '不杀一个敌人就登顶，以和为贵。',
    hint: '不击杀任何敌人通关',
    condition: ({ climbStats }) => climbStats?.peaceful === true,
  },
  {
    id: 'climb-sword-only',
    name: '大刀进行曲',
    stars: 2,
    desc: '仅用大刀通关，子弹一颗不发。',
    hint: '仅用大刀通关（不射击）',
    condition: ({ climbStats }) => climbStats?.onlyMelee === true,
  },
  {
    id: 'climb-sharpshooter',
    name: '神射手',
    stars: 2,
    desc: '每一发子弹都命中敌人，弹无虚发。',
    hint: '射击命中率100%通关',
    condition: ({ climbStats }) => climbStats?.sharpshooter === true,
  },
  {
    id: 'climb-collector',
    name: '收藏家',
    stars: 1,
    desc: '到达全部检查点，一个不落。',
    hint: '到达所有检查点',
    condition: ({ climbStats }) => climbStats?.collector === true,
  },
  {
    id: 'climb-expert-killer',
    name: '歼敌专家',
    stars: 2,
    desc: '单局击杀10个以上敌人，战功赫赫。',
    hint: '单局击杀10个以上',
    condition: ({ climbStats }) => (climbStats?.maxKillsInRun || 0) >= 10,
  },
  {
    id: 'climb-champion',
    name: '睡衣登山大赛冠军',
    stars: 3,
    desc: '在西安事变的登山小游戏里登顶成功，成为本届睡衣登山大赛冠军。',
    hint: '通关西安事变的登山小游戏',
    condition: ({ climbCleared, climbStats }) => climbCleared === true || climbStats?.bestTime != null,
  },
  {
    id: 'climb-speedrun',
    name: '神兵天降',
    stars: 2,
    desc: '90秒内快速登顶，兵贵神速。',
    hint: '90秒内登顶',
    condition: ({ climbStats }) => climbStats?.bestTime != null && climbStats.bestTime <= 90,
  },
  {
    id: 'climb-flawless',
    name: '毫发无伤',
    stars: 3,
    desc: '全程零死亡登顶，身法如仙。',
    hint: '零死亡登顶',
    condition: ({ climbStats }) => climbStats?.flawless === true,
  },
  {
    id: 'climb-slaughter',
    name: '斩尽杀绝',
    stars: 2,
    desc: '击杀沿途所有敌人，一个不留。',
    hint: '击杀所有敌人',
    condition: ({ climbStats }) => climbStats?.slaughter === true,
  },
  {
    id: 'climb-melee',
    name: '刀枪不入',
    stars: 1,
    desc: '不发射一颗子弹，只用大刀通关。',
    hint: '不射击通关',
    condition: ({ climbStats }) => climbStats?.melee === true,
  },
  {
    id: 'climb-persistent',
    name: '屡败屡战',
    stars: 1,
    desc: '失败后再次挑战，最终登顶成功。',
    hint: '失败后最终登顶',
    condition: ({ climbCleared, climbStats }) => (climbCleared === true || climbStats?.bestTime != null) && climbStats?.failedBefore === true,
  },
  {
    id: 'climb-rocked',
    name: '机械降神',
    stars: 1,
    desc: '被从天而降的巨石砸中，体验了一把神罚。',
    hint: '被落石砸死',
    condition: ({ climbStats }) => climbStats?.rocked === true,
  },
  {
    id: 'climb-shot',
    name: '枪林弹雨',
    stars: 1,
    desc: '在敌人的弹雨中倒下，虽败犹荣。',
    hint: '被敌人子弹打死',
    condition: ({ climbStats }) => climbStats?.shotDeath === true,
  },
  {
    id: 'climb-fell',
    name: '一失足成千古恨',
    stars: 1,
    desc: '脚下一空，坠入万丈深渊。',
    hint: '掉出地图摔死',
    condition: ({ climbStats }) => climbStats?.fell === true,
  },
  {
    id: 'climb-early',
    name: '出师未捷身先死',
    stars: 1,
    desc: '还没到第一个检查点就倒下了，长使英雄泪满襟。',
    hint: '第一个检查点前死亡',
    condition: ({ climbStats }) => climbStats?.earlyDeath === true,
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
  progress = {}, stats = {}, levels = [], climbCleared = false, climbStats = null, customMapSaved = false, hasDefeat = false,
} = {}) {
  const completedLevelIds = Object.keys(progress ?? {}).filter(id => progress[id]?.completed);
  const totalWins = Object.values(progress ?? {}).reduce((sum, p) => sum + (Number(p?.wins) || 0), 0);
  const context = {
    progress: progress ?? {},
    stats: stats ?? {},
    levels: Array.isArray(levels) ? levels : [],
    completedLevelIds,
    statsSummary: summarizeStats(stats),
    climbCleared,
    climbStats,
    customMapSaved,
    hasDefeat,
    totalWins,
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
