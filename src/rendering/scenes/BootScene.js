import Phaser from 'phaser';

// 游戏页启动场景（architecture.md §10）：
// 1. ?fromEditor=1 → 从 sessionStorage 取地图（编辑器试玩）
// 2. ?map=<path>  → 加载指定地图文件（战役选择页传入）
// 3. #bench       → 进入性能基准测试
// 4. 其他         → 加载默认教学地图（fracture-canyon.json）
export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'Boot' });
  }

  async create() {
    const params = new URLSearchParams(window.location.search);
    const campaignId = params.get('campaign') || 'fracture-canyon';

    // 编辑器试玩模式：从 sessionStorage 取地图数据
    const fromEditor = params.get('fromEditor') === '1';
    let mapData = null;
    if (fromEditor) {
      const raw = sessionStorage.getItem('war-of-dots.playtest');
      if (raw) mapData = JSON.parse(raw);
    }

    // 战役选择页模式：从 URL 参数加载指定地图
    const mapPath = params.get('map');
    if (mapPath && !mapData) {
      try {
        const response = await fetch(mapPath);
        mapData = await response.json();
      } catch (err) {
        console.error(`[BootScene] Failed to load map from ${mapPath}:`, err);
        // 加载失败时降级到默认地图
      }
    }

    // 性能基准测试模式
    if (!mapData && window.location.hash === '#bench') {
      this.scene.start('Bench');
      return;
    }

    // 默认：加载教学地图
    if (!mapData) {
      const response = await fetch('/assets/maps/fracture-canyon.json');
      mapData = await response.json();
    }

    this.scene.start('Game', { mapData, fromEditor, campaignId });
  }
}
