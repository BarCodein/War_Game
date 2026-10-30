// 开战前的居中读秒（单机战役 / PvP 共用同一段，保证两边观感一致）。
//
// 用法：
//   const view = createPrepCountdown(scene);
//   view.update({ prepping: true, remainingMs: 3200 });   // 每帧调用即可（内部只在变化时改文本）
//   view.destroy();

import { t } from '../i18n/index.js';

export function createPrepCountdown(scene, options = {}) {
  const font = { fontFamily: '"PingFang SC", "Microsoft YaHei", sans-serif', fontStyle: '600' };
  const centerX = options.x ?? scene.scale.width / 2;
  const centerY = options.y ?? scene.scale.height / 2;

  const number = scene.add.text(centerX, centerY - 40, '', {
    ...font,
    fontSize: '84px',
    color: '#8c1d1d',
    shadow: { offsetX: 0, offsetY: 2, color: '#f1e9d2', blur: 0, fill: true },
  }).setOrigin(0.5);

  const hint = scene.add.text(centerX, centerY + 34, t(options.hintKey ?? 'prep.hint'), {
    ...font,
    fontSize: '15px',
    color: '#2c2c2c',
    align: 'center',
    backgroundColor: 'rgba(241,233,210,0.82)',
    padding: { x: 10, y: 5 },
  }).setOrigin(0.5);

  const overlay = scene.add.container(0, 0, [number, hint]).setDepth(40);
  overlay.setVisible(false);

  return {
    overlay,
    /** @param {{prepping: boolean, remainingMs: number}} state */
    update({ prepping, remainingMs }) {
      if (overlay.visible !== prepping) overlay.setVisible(prepping);
      if (!prepping) return;
      const seconds = String(Math.max(1, Math.ceil(remainingMs / 1000)));
      if (number.text !== seconds) number.setText(seconds);
    },
    destroy() {
      overlay.destroy(true);
    },
  };
}
