import Phaser from 'phaser';
import { UNIT_TEXTURES } from '../unitRenderer.js';
import { parseLevel, validateLevelReferences, LEVELS_INDEX_PATH, levelPath } from '../../simulation/level.js';

// 游戏页启动场景（architecture.md §10）：把 URL 解析为「关卡」再启动游戏。
//   1. ?level=<id>   → 加载 /assets/levels/<id>.json（标准关卡格式，含地图/兵力/增援/AI）
//   2. #bench        → 性能基准测试
//   3. ?fromEditor=1 → 编辑器试玩：地图来自 sessionStorage，无关卡脚本（纯沙盒）
//   4. 无参数        → 关卡索引里的第一关（默认教学关）
//
// 关卡索引 /assets/levels/index.json 同时用于战役选择页与「下一关」导航。

const DEFAULT_LEVEL_ID = 'fracture-canyon';
const DEFAULT_MAP = '/assets/maps/fracture-canyon.json';

async function loadJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path} → HTTP ${response.status}`);
  return response.json();
}

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'Boot' });
  }

  // 单位贴图（美术资源，见 assets/texture/）：按阵营 × 档次（普通/精英）各一张。
  // 加载失败不阻塞启动，unitRenderer 检测不到贴图时会回退到圆形绘制。
  preload() {
    for (const faction of Object.values(UNIT_TEXTURES)) {
      for (const { key, url } of Object.values(faction)) this.load.image(key, url);
    }
  }

  async create() {
    const params = new URLSearchParams(window.location.search);

    // 性能基准测试
    if (window.location.hash === '#bench') {
      this.scene.start('Bench');
      return;
    }

    // 关卡索引（供默认关卡与「下一关」导航使用；缺失不致命）
    let levelIndex = [];
    try {
      levelIndex = (await loadJson(LEVELS_INDEX_PATH)).levels ?? [];
    } catch (err) {
      console.error('[BootScene] level index unavailable:', err);
    }

    // 编辑器试玩：地图来自 sessionStorage，无关卡脚本（沙盒模式）
    if (params.get('fromEditor') === '1') {
      const raw = sessionStorage.getItem('war-of-dots.playtest');
      if (raw) {
        this.scene.start('Game', {
          level: null, mapData: JSON.parse(raw), fromEditor: true, levelIndex,
        });
        return;
      }
      console.error('[BootScene] fromEditor=1 但 sessionStorage 中没有试玩地图，回退到默认关卡');
    }

    // 关卡：?level=<id> 优先，否则索引中的第一关
    const levelId = params.get('level') || levelIndex[0]?.id || DEFAULT_LEVEL_ID;
    let level = null;
    let levelError = null;
    try {
      level = parseLevel(await loadJson(levelPath(levelId)));
    } catch (err) {
      levelError = err.message;
      console.error(`[BootScene] 关卡 "${levelId}" 加载失败：`, err);
    }

    // 地图：关卡指定的路径优先，否则退回默认教学地图
    let mapData = null;
    if (level) {
      try {
        mapData = await loadJson(level.map);
      } catch (err) {
        levelError = err.message;
        console.error(`[BootScene] 关卡地图 "${level.map}" 加载失败：`, err);
      }
    }
    if (!mapData) {
      mapData = await loadJson(DEFAULT_MAP);
      level = null; // 关卡不可用时降级为纯沙盒（按出生点部署）
      levelError = levelError ?? `无法载入关卡地图，已退回默认地图 ${DEFAULT_MAP}`;
    }

    // 关卡引用交叉校验：spawnId / cityId / anchor 写错时告警（不致命，解析不到的点位会被跳过）
    if (level) {
      const refErrors = validateLevelReferences(level, mapData);
      if (refErrors.length > 0) {
        console.warn(`[BootScene] 关卡 "${level.id}" 存在无效引用：\n- ${refErrors.join('\n- ')}`);
        levelError = `关卡存在无效引用：\n- ${refErrors.join('\n- ')}`;
      }
    }

    // levelError 交给 GameScene 显示在画面上：静默退回沙盒会让「关卡写错了」看起来像「游戏坏了」
    this.scene.start('Game', {
      level, mapData, fromEditor: false, levelIndex, levelId, levelError,
    });
  }
}
