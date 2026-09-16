import { values } from '../config/index.js';
import { t } from '../i18n/index.js';

// 实际控制线渲染（gdd.md §9）：把 simulation 算好的分界线线段描出来。
//
// 影响力统计与归属判定不在这里——见 src/simulation/influence.js（纯函数：衰减曲线、
// 网格累加、时间平滑、0 等值线）与 src/simulation/systems/controlLine.js（10 Hz 重算、
// 收集影响力源）。渲染层只读 world.controlLineSegments，不做任何判断。
export function createControlLineRenderer(scene, world) {
  const style = values.controlLine.style;
  const graphics = scene.add.graphics().setDepth(2);
  const label = scene.add.text(0, 0, t('hud.controlLine'), {
    fontFamily: '"PingFang SC", "Microsoft YaHei", sans-serif',
    fontSize: '11px',
    color: '#111111',
    fontStyle: '600',
  }).setDepth(3);

  function draw() {
    graphics.clear();
    const segments = world.controlLineSegments;
    if (!segments || segments.length === 0) {
      label.setVisible(false);
      return;
    }

    // 分界线可能有多段（包围、多个战场）：每段独立 moveTo/lineTo，
    // Phaser 的 MOVE_TO 会开一条新子路径，不会把两段错误地连起来。
    graphics.lineStyle(style.lineWidth, style.color, style.alpha);
    graphics.beginPath();
    let topX = null;
    let topY = Infinity;
    for (const segment of segments) {
      graphics.moveTo(segment.x1, segment.y1);
      graphics.lineTo(segment.x2, segment.y2);
      const y = Math.min(segment.y1, segment.y2);
      if (y < topY) {
        topY = y;
        topX = (segment.x1 + segment.x2) / 2;
      }
    }
    graphics.strokePath();

    // 标签贴在最靠上的那一段旁边（多条战线时避免飘到画面外，也避免固定在标题区、
    // 离实际战线很远）
    label.setVisible(true);
    label.setPosition((topX ?? 0) + 12, Math.max(12, topY + 10));
  }

  return { draw };
}
