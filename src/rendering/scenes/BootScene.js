import Phaser from 'phaser';

// 启动场景（architecture.md §10）：加载资源 → 获取地图 JSON → 进入 GameScene。
export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'Boot' });
  }

  async create() {
    const response = await fetch('/assets/maps/fracture-canyon.json');
    const mapData = await response.json();
    this.scene.start('Game', { mapData });
  }
}
