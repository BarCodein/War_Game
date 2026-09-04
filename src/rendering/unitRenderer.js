import { isSpotted } from '../simulation/systems/fog.js';
import { t } from '../i18n/index.js';

const SIDE_COLORS = {
  blue: { fill: 0x1911df, outline: 0x090b78 },
  red: { fill: 0xf01818, outline: 0x76100e },
};

// 单位与城市渲染（每帧重绘，只读世界状态）：
// 己方单位完整渲染；敌军仅在目视时渲染实时状态，否则画最后已知位置虚影（gdd.md §9）。
export function createUnitRenderer(scene, world, selection) {
  const graphics = scene.add.graphics().setDepth(5);
  const stats = { ghostCount: 0 };
  // 城市标签（Phaser Graphics 无文字绘制，需 Text 对象）
  const cityLabels = new Map();
  for (const city of world.cities) {
    cityLabels.set(city.id, scene.add.text(city.x, city.y + 30, '', {
      fontFamily: '"PingFang SC", "Microsoft YaHei", sans-serif',
      fontSize: '12px',
      color: '#102124',
    }).setOrigin(0.5).setDepth(6));
  }

  function draw() {
    graphics.clear();
    stats.ghostCount = 0;
    for (const city of world.cities) drawCity(city);
    for (const unit of world.units) {
      if (unit.state === 'dead') continue;
      if (unit.faction === 'red' && !isSpotted(world, unit, 'blue')) {
        const last = unit.lastSeen.blue;
        if (last) {
          stats.ghostCount += 1;
          drawGhost(last.x, last.y, unit.radius);
        }
        continue;
      }
      drawUnit(unit);
    }
  }

  function drawUnit(unit) {
    const colors = SIDE_COLORS[unit.faction];
    const { x, y, radius } = unit;
    if (unit.state === 'combat') { // 交战圈
      graphics.lineStyle(3, 0x111111, 0.9);
      graphics.strokeCircle(x, y, radius + 5 + Math.sin(scene.time.now / 100) * 2);
    }
    if (unit.state === 'rout') { // 溃逃：白色闪烁圈
      graphics.lineStyle(3, 0xffffff, Math.sin(scene.time.now / 80) > 0 ? 0.9 : 0.25);
      graphics.strokeCircle(x, y, radius + 8);
    }
    if (selection.isSelected(unit.id)) { // 选中圈
      graphics.lineStyle(3, 0xf9ed35, 1);
      graphics.strokeCircle(x, y, radius + 8);
    }
    graphics.fillStyle(colors.fill, 1);
    graphics.lineStyle(2, colors.outline, 1);
    graphics.fillCircle(x, y, radius);
    graphics.strokeCircle(x, y, radius);
    drawBars(unit);
  }

  function drawBars(unit) {
    const { x, y } = unit;
    const width = 36;
    graphics.fillStyle(0x0c201b, 1);
    graphics.fillRect(x - width / 2, y - unit.radius - 13, width, 4);
    graphics.fillStyle(0x53e77e, 1);
    graphics.fillRect(x - width / 2, y - unit.radius - 13, width * unit.hp / unit.maxHp, 4);
    graphics.fillStyle(0x0c201b, 1);
    graphics.fillRect(x - width / 2, y - unit.radius - 7, width, 3);
    graphics.fillStyle(0xf2d42a, 1);
    graphics.fillRect(x - width / 2, y - unit.radius - 7, width * unit.morale / 100, 3);
  }

  function drawCity(city) {
    const { x, y } = city;
    graphics.fillStyle(0x4b4b53, 1);
    graphics.lineStyle(2, 0x252c2e, 1);
    graphics.fillCircle(x, y, 16);
    graphics.strokeCircle(x, y, 16);
    // 阵营旗
    graphics.lineStyle(2, 0x252c2e, 1);
    graphics.lineBetween(x, y - 16, x, y - 42);
    graphics.fillStyle(city.faction === 'red' ? 0xe93227 : 0x1911ce, 1);
    graphics.fillTriangle(x, y - 42, x + 18, y - 36, x, y - 30);
    // 占领进度环
    if (city.captureProgress > 0) {
      graphics.lineStyle(5, 0xf4d71a, 0.95);
      graphics.beginPath();
      graphics.arc(x, y, 22, -Math.PI / 2, -Math.PI / 2 + city.captureProgress / 100 * Math.PI * 2);
      graphics.strokePath();
    }
    const label = cityLabels.get(city.id);
    if (label) label.setText(t('city.label', { faction: t(`faction.${city.faction}`) }));
  }

  function drawGhost(x, y, radius) {
    graphics.lineStyle(2, 0x9aa7a7, 0.6);
    graphics.strokeCircle(x, y, radius);
    graphics.lineStyle(1, 0x9aa7a7, 0.5);
    graphics.lineBetween(x - radius, y - radius, x + radius, y + radius);
    graphics.lineBetween(x - radius, y + radius, x + radius, y - radius);
  }

  return { draw, stats };
}
