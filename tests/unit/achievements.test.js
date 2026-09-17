import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENTS, evaluateAchievements, summarizeAchievements,
  PROGRESS_KEY, LEVEL_STATS_KEY, CLIMB_CLEARED_KEY, CUSTOM_MAP_KEY,
} from '../../src/achievements.js';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const LEVELS = [{ id: 'fracture-canyon' }, { id: 'subei_battle' }, { id: 'tashan_battle' }];
const byId = (list, id) => list.find(item => item.id === id);

describe('成就定义', () => {
  it('每条成就都有 id / 名称 / 星级 1~3 / 说明 / 达成条件', () => {
    expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(6);
    for (const item of ACHIEVEMENTS) {
      expect(item.id, JSON.stringify(item)).toBeTruthy();
      expect(item.name).toBeTruthy();
      expect([1, 2, 3]).toContain(item.stars);
      expect(item.desc).toBeTruthy();
      expect(item.hint).toBeTruthy();
      expect(typeof item.condition).toBe('function');
    }
    // id 不能重复（页面用它做排序/定位）
    expect(new Set(ACHIEVEMENTS.map(item => item.id)).size).toBe(ACHIEVEMENTS.length);
  });

  it('点名的三条成就都在：宿北战役 / 塔山战役 / 睡衣登山大赛冠军', () => {
    const names = ACHIEVEMENTS.map(item => item.name);
    expect(names).toContain('宿北战役');
    expect(names).toContain('塔山战役');
    expect(names).toContain('睡衣登山大赛冠军');
  });

  it('存储键与写入方（result.html / climb.js / editorToolbar.js）一致', () => {
    // 结算页与登山小游戏是 classic script，键名只能各写一份——这里守住不漂移
    expect(read('result.html')).toContain(`'${LEVEL_STATS_KEY}'`);
    expect(read('public/climb/climb.js')).toContain(`'${CLIMB_CLEARED_KEY}'`);
    expect(read('src/rendering/editorToolbar.js')).toContain(`'${CUSTOM_MAP_KEY}'`);
    expect(PROGRESS_KEY).toBe('war-of-dots.campaign-progress'); // battlechoose-data.js 也在用
    expect(read('src/entries/battlechoose-data.js')).toContain(`'${PROGRESS_KEY}'`);
  });
});

describe('成就判定', () => {
  it('什么都没做时全部未解锁，总星数等于各成就星级之和', () => {
    const list = evaluateAchievements({ levels: LEVELS });
    expect(list.every(item => item.unlocked === false)).toBe(true);
    const summary = summarizeAchievements(list);
    expect(summary.unlocked).toBe(0);
    expect(summary.earnedStars).toBe(0);
    expect(summary.totalStars).toBe(ACHIEVEMENTS.reduce((sum, item) => sum + item.stars, 0));
  });

  it('通关宿北 → 首战告捷 + 宿北战役解锁，塔山仍未解锁', () => {
    const list = evaluateAchievements({
      progress: { subei_battle: { completed: true, wins: 1 } },
      levels: LEVELS,
    });
    expect(byId(list, 'first-victory').unlocked).toBe(true);
    expect(byId(list, 'subei').unlocked).toBe(true);
    expect(byId(list, 'tashan').unlocked).toBe(false);
    expect(byId(list, 'all-campaigns').unlocked).toBe(false);
    expect(summarizeAchievements(list).earnedStars).toBe(1 + 2);
  });

  it('全部关卡通关 → 战役全通解锁（关卡索引为空时不误判为"全通"）', () => {
    const progress = Object.fromEntries(LEVELS.map(level => [level.id, { completed: true }]));
    expect(byId(evaluateAchievements({ progress, levels: LEVELS }), 'all-campaigns').unlocked).toBe(true);
    expect(byId(evaluateAchievements({ progress, levels: [] }), 'all-campaigns').unlocked).toBe(false);
  });

  it('登山登顶 / 编辑器存图 各自解锁对应成就', () => {
    const climb = evaluateAchievements({ levels: LEVELS, climbCleared: true });
    expect(byId(climb, 'climb-champion').unlocked).toBe(true);
    expect(byId(climb, 'map-maker').unlocked).toBe(false);

    const editor = evaluateAchievements({ levels: LEVELS, customMapSaved: true });
    expect(byId(editor, 'map-maker').unlocked).toBe(true);
    expect(byId(editor, 'climb-champion').unlocked).toBe(false);
  });

  it('用时与伤亡只在"通关过"的记录里算：3 分钟内 / 伤亡 < 100', () => {
    const stats = {
      subei_battle: { cleared: true, bestTime: 179, bestCasualties: 99, plays: 2 },
      tashan_battle: { cleared: false, bestTime: 12, bestCasualties: 0, plays: 1 }, // 没通关 → 不计
    };
    const list = evaluateAchievements({ levels: LEVELS, stats });
    expect(byId(list, 'swift').unlocked).toBe(true);
    expect(byId(list, 'flawless').unlocked).toBe(true);

    const slow = evaluateAchievements({
      levels: LEVELS,
      stats: { subei_battle: { cleared: true, bestTime: 181, bestCasualties: 100, plays: 1 } },
    });
    expect(byId(slow, 'swift').unlocked).toBe(false);
    expect(byId(slow, 'flawless').unlocked).toBe(false);
  });

  it('存储损坏 / 缺字段时不抛错（页面照常渲染）', () => {
    expect(() => evaluateAchievements()).not.toThrow();
    expect(() => evaluateAchievements({ progress: null, stats: null, levels: null })).not.toThrow();
    const list = evaluateAchievements({ stats: { x: {} }, levels: LEVELS });
    expect(list).toHaveLength(ACHIEVEMENTS.length);
  });
});
