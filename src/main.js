import Phaser from 'phaser';
import { BootScene } from './rendering/scenes/BootScene.js';
import { GameScene } from './rendering/scenes/GameScene.js';

// 游戏实例配置：固定逻辑分辨率 1280×720，缩放适配（REQUIREMENTS.md §3）。
// 固定时间步长模拟循环在阶段 2 接入（docs/architecture.md §4）。
new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: 1280,
  height: 720,
  backgroundColor: '#193d3d',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, GameScene],
});
