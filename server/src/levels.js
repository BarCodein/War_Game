import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLevel } from '../../src/simulation/level.js';

// PvP 关卡加载（服务端专用）。
// 关卡与地图都在仓库的 public/assets 下（**不是** LFS 大文件，服务器 clone 后即可读）：
//   · 关卡：public/assets/pvp/<id>.json（对称兵力模板，见 docs/pvp-plan.md §3.8）
//   · 地图：按关卡里的 map 路径解析到 public/assets/maps/<name>.json
const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');

export const PVP_LEVELS = ['dujiang_pvp', 'pingjin_pvp'];

export function loadPvpLevel(levelId) {
  if (!PVP_LEVELS.includes(levelId)) {
    throw new Error(`[levels] 未知的 PvP 关卡：${levelId}（可选：${PVP_LEVELS.join(' / ')}）`);
  }
  const levelPath = resolve(root, 'public/assets/pvp', `${levelId}.json`);
  const rawLevel = JSON.parse(readFileSync(levelPath, 'utf8'));
  const level = parseLevel(rawLevel);   // 复用战役关卡的校验与归一化

  const mapPath = resolve(root, 'public', level.map.replace(/^\//, ''));
  const map = JSON.parse(readFileSync(mapPath, 'utf8'));
  return { level, map, levelPath, mapPath };
}
