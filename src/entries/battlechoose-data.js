import { LEVELS_INDEX_PATH, levelPath } from '../simulation/level.js';
import { levelHref, rememberLevelId } from '../level-link.js';
import { readJSON, writeJSON } from '../user-storage.js';

// 关卡索引与战役进度（本地存储）。
// 关卡本身（地图、兵力、增援、AI 脚本）由 public/assets/levels/*.json 提供，
// 本模块只负责：读取索引、读写通关进度、跳转到指定关卡。
// 通关进度**按账号隔离**（war-of-dots.u.<账号>.campaign-progress），换账号不会共用进度。

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
  const stored = readJSON('campaign-progress', {});
  return stored && typeof stored === 'object' ? stored : {};
}

/**
 * 保存进度到本地存储（当前账号的命名空间）。
 * @param {string} levelId
 * @param {object} data  写入字段，例如 { completed: true, wins: 1 }
 */
export function saveProgress(levelId, data) {
  const all = loadProgress();
  all[levelId] = { ...(all[levelId] ?? {}), ...data };
  writeJSON('campaign-progress', all);
}

/**
 * 进入关卡：只把关卡 id 交给 URL，其余（地图/兵力/增援/AI）由引擎读关卡 JSON 得到。
 * 同时写入 sessionStorage 并带上 #level= —— 静态服务器的 cleanUrls 会重写掉查询参数，
 * 只带 ?level= 的话会被重写成 /game 从而丢掉关卡 id（详见 src/level-link.js）。
 * @param {string} levelId
 */
export function startLevel(levelId) {
  if (!levelId) return;
  rememberLevelId(levelId);
  window.location.href = levelHref('/game.html', levelId);
}
