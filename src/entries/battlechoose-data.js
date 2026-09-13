import { LEVELS_INDEX_PATH, levelPath } from '../simulation/level.js';

// 关卡索引与战役进度（本地存储）。
// 关卡本身（地图、兵力、增援、AI 脚本）由 public/assets/levels/*.json 提供，
// 本模块只负责：读取索引、读写通关进度、跳转到指定关卡。

export { LEVELS_INDEX_PATH, levelPath };

/**
 * 读取关卡索引（战役选择页使用）。
 * @returns {Promise<Array<{ id, name, subtitle, type, difficulty, order, description }>>}
 */
export async function loadLevels() {
  const response = await fetch(LEVELS_INDEX_PATH);
  if (!response.ok) throw new Error(`levels index → HTTP ${response.status}`);
  const data = await response.json();
  return Array.isArray(data.levels) ? data.levels : [];
}

/**
 * 读取本地存档，返回 { [levelId]: { completed?: boolean, wins?: number } }
 * 当前仅记录通关状态，后续可扩展完成次数、用时等。
 */
export function loadProgress() {
  try {
    const raw = localStorage.getItem('war-of-dots.campaign-progress');
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * 保存进度到 localStorage。
 * @param {string} levelId
 * @param {object} data  写入字段，例如 { completed: true, wins: 1 }
 */
export function saveProgress(levelId, data) {
  const all = loadProgress();
  all[levelId] = { ...(all[levelId] ?? {}), ...data };
  localStorage.setItem('war-of-dots.campaign-progress', JSON.stringify(all));
}

/**
 * 进入关卡：只把关卡 id 交给 URL，其余（地图/兵力/增援/AI）由引擎读关卡 JSON 得到。
 * @param {string} levelId
 */
export function startLevel(levelId) {
  if (!levelId) return;
  window.location.href = `/game.html?level=${encodeURIComponent(levelId)}`;
}
