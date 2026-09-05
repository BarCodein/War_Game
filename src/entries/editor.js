import Phaser from 'phaser';
import { EditorScene } from '../rendering/scenes/EditorScene.js';

// 地图编辑器页入口（editor.html）。
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
  scene: [EditorScene],
});
