import { t } from '../i18n/index.js';

// 实际控制线（原型遗留视觉表现，gdd.md §9 暂定保留）：
// 按双方存活单位的纵深位置插值得到战线采样点，平滑连线。
const DEPTHS = 17;

export function createControlLineRenderer(scene, world) {
  const graphics = scene.add.graphics().setDepth(2);
  const label = scene.add.text(0, 0, t('hud.controlLine'), {
    fontFamily: '"PingFang SC", "Microsoft YaHei", sans-serif',
    fontSize: '11px',
    color: '#111111',
    fontStyle: '600',
  }).setDepth(3);

  function samples() {
    const livingBlue = world.units.filter(unit => unit.state !== 'dead' && unit.faction === 'blue');
    const livingRed = world.units.filter(unit => unit.state !== 'dead' && unit.faction === 'red');
    if (livingBlue.length === 0 || livingRed.length === 0) return null;
    const blueAverage = livingBlue.reduce((sum, unit) => sum + unit.x, 0) / livingBlue.length;
    const redAverage = livingRed.reduce((sum, unit) => sum + unit.x, 0) / livingRed.length;
    return Array.from({ length: DEPTHS }, (_, index) => {
      const y = index * world.size.height / (DEPTHS - 1);
      const blueAtDepth = livingBlue.filter(unit => Math.abs(unit.y - y) < 155);
      const redAtDepth = livingRed.filter(unit => Math.abs(unit.y - y) < 155);
      const blueX = blueAtDepth.length
        ? blueAtDepth.reduce((sum, unit) => sum + unit.x, 0) / blueAtDepth.length
        : blueAverage;
      const redX = redAtDepth.length
        ? redAtDepth.reduce((sum, unit) => sum + unit.x, 0) / redAtDepth.length
        : redAverage;
      return { x: (blueX + redX) / 2, y };
    });
  }

  function draw() {
    graphics.clear();
    const points = samples();
    if (!points) {
      label.setVisible(false);
      return;
    }
    graphics.lineStyle(4, 0x101414, 0.82);
    graphics.beginPath();
    graphics.moveTo(points[0].x, points[0].y);
    // Phaser Graphics 无贝塞尔路径 API，用二次贝塞尔采样 + lineTo 平滑
    for (let i = 1; i < points.length - 1; i += 1) {
      const previous = points[i - 1];
      const current = points[i];
      const next = points[i + 1];
      const midA = { x: (previous.x + current.x) / 2, y: (previous.y + current.y) / 2 };
      const midB = { x: (current.x + next.x) / 2, y: (current.y + next.y) / 2 };
      for (let step = 1; step <= 4; step += 1) {
        const t = step / 4;
        const mt = 1 - t;
        graphics.lineTo(
          mt * mt * midA.x + 2 * mt * t * current.x + t * t * midB.x,
          mt * mt * midA.y + 2 * mt * t * current.y + t * t * midB.y,
        );
      }
    }
    graphics.lineTo(points[points.length - 1].x, points[points.length - 1].y);
    graphics.strokePath();
    label.setVisible(true);
    label.setPosition(points[0].x + 12, 28);
  }

  return { draw };
}
