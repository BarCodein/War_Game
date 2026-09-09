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

// 全局禁用浏览器默认右键上下文菜单，防止干扰编辑器内右键操作。
// 仅在 canvas 元素上阻止，不影响其他页面的正常右键行为。
document.addEventListener('contextmenu', (e) => {
  if (e.target.tagName === 'CANVAS') {
    e.preventDefault();
  }
});
