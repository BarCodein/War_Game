import Phaser from 'phaser';

// 启动场景：后续负责加载资源 → 解析地图 JSON → 构造 world → 进入 GameScene
// （docs/architecture.md §10）。阶段 1 暂无外部资源，直接切换。
export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'Boot' });
  }

  create() {
    this.scene.start('Game');
  }
}
