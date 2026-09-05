import Phaser from 'phaser';

// 游戏页启动场景（architecture.md §10）：编辑器试玩（?fromEditor=1）从 sessionStorage
// 取地图；#bench 进入性能基准；否则加载教学地图进入游戏。
export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'Boot' });
  }

  async create() {
    const params = new URLSearchParams(window.location.search);
    const fromEditor = params.get('fromEditor') === '1';
    let mapData = null;
    if (fromEditor) {
      const raw = sessionStorage.getItem('war-of-dots.playtest');
      if (raw) mapData = JSON.parse(raw);
    }
    if (!mapData) {
      if (window.location.hash === '#bench') {
        this.scene.start('Bench');
        return;
      }
      const response = await fetch('/assets/maps/fracture-canyon.json');
      mapData = await response.json();
    }
    this.scene.start('Game', { mapData, fromEditor });
  }
}
