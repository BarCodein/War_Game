import Phaser from 'phaser';
import { BootScene } from './rendering/scenes/BootScene.js';
import { GameScene } from './rendering/scenes/GameScene.js';
import { EditorScene } from './rendering/scenes/EditorScene.js';

// 游戏实例配置：固定逻辑分辨率 1280×720，缩放适配（REQUIREMENTS.md §3）。
// 模拟由固定步长 loop 推进（docs/architecture.md §4），渲染挂在 Phaser 帧循环。
new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'battlefield',
  width: 1280,
  height: 720,
  backgroundColor: '#193d3d',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, GameScene, EditorScene],
});

// 游戏与编辑器之间通过 hash 导航（#editor 进入编辑器），hash 变化时重载页面由 BootScene 路由
window.addEventListener('hashchange', () => window.location.reload());
