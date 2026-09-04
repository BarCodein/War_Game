import Phaser from 'phaser';

// 启动场景（architecture.md §10）：按入口路由——#editor 进入地图编辑器，
// 否则加载教学地图进入游戏。
export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'Boot' });
  }

  async create() {
    if (window.location.hash === '#editor') {
      this.scene.start('Editor');
      return;
    }
    if (window.location.hash === '#bench') {
      this.scene.start('Bench');
      return;
    }
    const response = await fetch('/assets/maps/fracture-canyon.json');
    const mapData = await response.json();
    this.scene.start('Game', { mapData });
  }
}
