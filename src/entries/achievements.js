// 成就页（achievements.html）入口：读取本地战绩 → 判定成就 → 渲染卡片。
// 判定逻辑在 src/achievements.js（纯函数、已单测），这里只做 DOM 与本地存储读取。
import {
  evaluateAchievements, summarizeAchievements,
  PROGRESS_KEY, LEVEL_STATS_KEY, CLIMB_CLEARED_KEY, CUSTOM_MAP_KEY,
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
      <h3>${achievement.name}</h3>
      <p class="ach-desc">${achievement.desc}</p>
      <p class="ach-note">${note}</p>
    </article>`;
}

async function main() {
  const [levels] = await Promise.all([loadLevels()]);
  const list = evaluateAchievements({
    progress: readJSON(PROGRESS_KEY, {}),
    stats: readJSON(LEVEL_STATS_KEY, {}),
    levels,
    climbCleared: localStorage.getItem(CLIMB_CLEARED_KEY) === '1',
    customMapSaved: Boolean(localStorage.getItem(CUSTOM_MAP_KEY)),
  });
  const summary = summarizeAchievements(list);

  document.getElementById('achSummary').textContent =
    `已解锁 ${summary.unlocked} / ${summary.count} · 星数 ${summary.earnedStars} / ${summary.totalStars}`;
  const percent = summary.totalStars > 0 ? (summary.earnedStars / summary.totalStars) * 100 : 0;
  const bar = document.getElementById('achProgress');
  bar.style.width = `${percent.toFixed(1)}%`;
  bar.parentElement.setAttribute('aria-valuenow', String(Math.round(percent)));

  // 已解锁的排在前面，未解锁的按星级从高到低（让"还没拿到的高星成就"更显眼）
  const sorted = [...list].sort((a, b) => (
    Number(b.unlocked) - Number(a.unlocked) || b.stars - a.stars || a.name.localeCompare(b.name, 'zh-Hans-CN')
  ));
  document.getElementById('achGrid').innerHTML = sorted.map(cardHtml).join('');
}

main();
