import Phaser from 'phaser';
import { t } from '../../i18n/index.js';

// 游戏主场景占位：阶段 2 起接入模拟层，阶段 3 接入输入与 HUD。
export class GameScene extends Phaser.Scene {
  constructor() {
    super({ key: 'Game' });
  }

  create() {
    const { width, height } = this.scale;
    const style = { fontFamily: '"PingFang SC", "Microsoft YaHei", sans-serif', color: '#d6e7df' };
    this.add.text(width / 2, height / 2 - 24, t('game.title'), { ...style, fontSize: '48px' }).setOrigin(0.5);
    this.add.text(width / 2, height / 2 + 28, t('game.placeholder'), { ...style, fontSize: '20px' }).setOrigin(0.5);
    this.add.text(width / 2, height / 2 + 58, t('game.subtitle'), { ...style, fontSize: '14px' }).setOrigin(0.5);

    // 供 Playwright 冒烟测试断言 Phaser 已启动
    window.__gameReady = true;
  }
}
