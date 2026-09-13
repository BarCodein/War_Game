import Phaser from 'phaser';
import { BootScene } from '../rendering/scenes/BootScene.js';
import { GameScene } from '../rendering/scenes/GameScene.js';
import { BenchScene } from '../rendering/scenes/BenchScene.js';

// 游戏页入口（game.html）：教学关，或编辑器试玩（?fromEditor=1，地图取自 sessionStorage）。
new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'battlefield',
  width: 1280,
  height: 800,
  backgroundColor: '#193d3d',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, GameScene, BenchScene],
});

// 全局禁用浏览器默认右键上下文菜单，防止干扰游戏内右键指令。
// 仅在 canvas 元素上阻止，不影响其他页面的正常右键行为。
document.addEventListener('contextmenu', (e) => {
  if (e.target.tagName === 'CANVAS') {
    e.preventDefault();
  }
});
