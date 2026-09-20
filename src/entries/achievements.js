// 成就页（achievements.html）入口：读取本地战绩 → 判定成就 → 渲染卡片。
// 判定逻辑在 src/achievements.js（纯函数、已单测），这里只做 DOM 与本地存储读取。
import {
  evaluateAchievements, summarizeAchievements,
  PROGRESS_KEY, LEVEL_STATS_KEY, CLIMB_CLEARED_KEY, CLIMB_STATS_KEY, CUSTOM_MAP_KEY,
} from '../achievements.js';
import { LEVELS_INDEX_PATH } from '../simulation/level.js';

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback; // 存储损坏时按"没有数据"处理，不让整页崩掉
  }
}

async function loadLevels() {
  try {
    const response = await fetch(LEVELS_INDEX_PATH);
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data.levels) ? data.levels : [];
  } catch {
    return [];
  }
}

function starsHtml(stars, unlocked) {
  return Array.from({ length: 3 }, (_, index) => {
    const filled = index < stars;
    const cls = filled ? (unlocked ? 'ach-star on' : 'ach-star dim') : 'ach-star off';
    return `<span class="${cls}">★</span>`;
  }).join('');
}

function cardHtml(achievement) {
  const state = achievement.unlocked ? 'unlocked' : 'locked';
  const badge = achievement.unlocked ? '已解锁' : '未解锁';
  const isClimb = achievement.id.startsWith('climb-');
  const categoryLabel = isClimb ? '小游戏' : '主游戏';
  const categoryClass = isClimb ? 'ach-cat-climb' : 'ach-cat-main';
  // 锁定显示"达成条件"，解锁显示同一条件但标明已达成——不再重复一遍描述文字
  const note = achievement.unlocked
    ? `已达成 · 达成条件：${achievement.hint}`
    : `达成条件：${achievement.hint}`;
  return `
    <article class="ach-card ${state}">
      <div class="ach-head">
        <span class="ach-stars" aria-label="${achievement.stars} 星成就">${starsHtml(achievement.stars, achievement.unlocked)}</span>
        <span class="ach-badge ${state}">${badge}</span>
      </div>
      <span class="ach-category ${categoryClass}">${categoryLabel}</span>
      <h3>${achievement.name}</h3>
      <p class="ach-desc">${achievement.desc}</p>
      <p class="ach-note">${note}</p>
    </article>`;
}

async function main() {
  // 判断是否从登山小游戏进入
  const urlParams = new URLSearchParams(window.location.search)
  const fromClimb = urlParams.get('from') === 'climb' ||
    document.referrer.includes('climb')

  // 根据来源设置返回按钮
  const backLink = document.getElementById('achBackLink')
  if (backLink) {
    if (fromClimb) {
      backLink.href = '/climb/climb.html'
      backLink.textContent = '← 返回小游戏'
    } else {
      backLink.href = '/index.html'
      backLink.textContent = '← 返回首页'
    }
  }

  const [levels] = await Promise.all([loadLevels()]);
  const list = evaluateAchievements({
    progress: readJSON(PROGRESS_KEY, {}),
    stats: readJSON(LEVEL_STATS_KEY, {}),
    levels,
    climbCleared: localStorage.getItem(CLIMB_CLEARED_KEY) === '1',
    climbStats: readJSON(CLIMB_STATS_KEY, null),
    customMapSaved: Boolean(localStorage.getItem(CUSTOM_MAP_KEY)),
    hasDefeat: localStorage.getItem('war-of-dots.has-defeat') === '1',
  });

  const summary = summarizeAchievements(list);

  document.getElementById('achSummary').textContent =
    `已解锁 ${summary.unlocked} / ${summary.count} · 星数 ${summary.earnedStars} / ${summary.totalStars}`;
  const percent = summary.totalStars > 0 ? (summary.earnedStars / summary.totalStars) * 100 : 0;
  const bar = document.getElementById('achProgress');
  bar.style.width = `${percent.toFixed(1)}%`;
  bar.parentElement.setAttribute('aria-valuenow', String(Math.round(percent)));

  // 排序：主游戏在前，小游戏在后；同分类按星级从低到高，同星级已解锁的排在前面
  const sorted = [...list].sort((a, b) => {
    const aClimb = a.id.startsWith('climb-') ? 1 : 0;
    const bClimb = b.id.startsWith('climb-') ? 1 : 0;
    return aClimb - bClimb || a.stars - b.stars || Number(b.unlocked) - Number(a.unlocked) || a.name.localeCompare(b.name, 'zh-Hans-CN');
  });
  document.getElementById('achGrid').innerHTML = sorted.map(cardHtml).join('');
}

main();
