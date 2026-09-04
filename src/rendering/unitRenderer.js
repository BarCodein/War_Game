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
    const isSelected = selection.isSelected(unit.id);
    // 交战：去掉光圈特效，改为沿「自身→敌人」连线方向的小幅度高频抖动（仅渲染层，不影响模拟坐标）
    let dx = x;
    let dy = y;
    if (unit.state === 'combat') {
      const enemy = liveEnemy(unit);
      if (enemy) {
        const dirX = enemy.x - unit.x;
        const dirY = enemy.y - unit.y;
        const len = Math.hypot(dirX, dirY) || 1;
        const offset = Math.sin(scene.time.now * 0.08 + unit.id) * 0.9; // 减小幅度、提高频率
        dx += (dirX / len) * offset;
        dy += (dirY / len) * offset;
      }
    }
    if (unit.state === 'rout') { // 溃逃：白色闪烁圈
      graphics.lineStyle(3, 0xffffff, Math.sin(scene.time.now / 80) > 0 ? 0.9 : 0.25);
      graphics.strokeCircle(dx, dy, radius + 8);
    }
    // 选中特效：去掉黄色亮圈，改为单位变深色
    const fill = isSelected ? darken(colors.fill, 0.55) : colors.fill;
    graphics.fillStyle(fill, 1);
    graphics.lineStyle(2, colors.outline, 1);
    graphics.fillCircle(dx, dy, radius);
    graphics.strokeCircle(dx, dy, radius);
    drawCracks(unit, dx, dy); // 血量<50% 轻破碎、<20% 重破碎（对所有可见单位）
    drawBars(unit, dx, dy); // 仅己方显示血条/士气条（敌方隐藏）
  }

  // 当前交战目标（用于抖动方向的连线）；无目标时兜底取接触范围内最近敌军
  function liveEnemy(unit) {
    const target = unit.targetId !== null
      ? world.units.find(u => u.id === unit.targetId && u.state !== 'dead' && u.faction !== unit.faction)
      : null;
    if (target) return target;
    let nearest = null;
    let best = Infinity;
    for (const u of world.units) {
      if (u.state === 'dead' || u.faction === unit.faction) continue;
      const d = Math.hypot(u.x - unit.x, u.y - unit.y);
      if (d < best) {
        best = d;
        nearest = u;
      }
    }
    return nearest;
  }

  // 颜色加深（选中态）
  function darken(color, factor) {
    const r = Math.floor(((color >> 16) & 0xff) * factor);
    const g = Math.floor(((color >> 8) & 0xff) * factor);
    const b = Math.floor((color & 0xff) * factor);
    return ((r << 16) | (g << 8) | b) >>> 0;
  }

  function drawBars(unit, cx, cy) {
    if (unit.faction !== 'blue') return; // 隐藏敌方血条与士气条
    const { radius } = unit;
    const width = radius * 2; // 接近圆点直径（截图效果）
    const hpHeight = 5;
    const morHeight = 5;
    const gap = 2;
    const boxHeight = hpHeight + gap + morHeight;
    // 紧贴圆点上方
    const bottom = cy - radius - 2;
    const top = bottom - boxHeight;
    // 黑色框底（截图样式）
    graphics.fillStyle(0x0b0e10, 0.9);
    graphics.fillRect(cx - width / 2 - 1, top - 1, width + 2, boxHeight + 2);
    // 血条：≥50% 绿、<50% 黄、<20% 橘红（如图）
    const ratio = unit.hp / unit.maxHp;
    const hpColor = ratio >= 0.5 ? 0x53e77e : (ratio >= 0.2 ? 0xf2d42a : 0xff6a33);
    graphics.fillStyle(0x0c201b, 1);
    graphics.fillRect(cx - width / 2, top, width, hpHeight);
    graphics.fillStyle(hpColor, 1);
    graphics.fillRect(cx - width / 2, top, width * ratio, hpHeight);
    // 士气条：青蓝色（如图）
    graphics.fillStyle(0x0c201b, 1);
    graphics.fillRect(cx - width / 2, top + hpHeight + gap, width, morHeight);
    graphics.fillStyle(0x3fd6e6, 1);
    graphics.fillRect(cx - width / 2, top + hpHeight + gap, width * Math.min(1, unit.morale / 100), morHeight);
  }

  // 血量破碎（截图效果）：<50% 轻度破碎、<20% 重度破碎；
  // 以单位 id 作种子的确定性裂纹网，保证每帧稳定。
  function drawCracks(unit, cx, cy) {
    const ratio = unit.hp / unit.maxHp;
    if (ratio >= 0.5) return;
    const heavy = ratio < 0.2;
    const count = heavy ? 13 : 6;
    const rng = mulberry32(unit.id);
    const { radius } = unit;
    graphics.lineStyle(1, 0xd9d2b0, 0.92);
    for (let i = 0; i < count; i += 1) {
      const a = rng() * Math.PI * 2;
      const r0 = rng() * radius * 0.6;
      let px = cx + Math.cos(a) * r0;
      let py = cy + Math.sin(a) * r0;
      let dir = rng() * Math.PI * 2;
      graphics.beginPath();
      graphics.moveTo(px, py);
      const segs = heavy ? 4 : 3;
      for (let s = 0; s < segs; s += 1) {
        dir += (rng() - 0.5) * 1.2;
        const len = radius * (0.2 + rng() * 0.5);
        px += Math.cos(dir) * len;
        py += Math.sin(dir) * len;
        const dx = px - cx;
        const dy = py - cy;
        const d = Math.hypot(dx, dy);
        if (d > radius) {
          px = cx + (dx / d) * radius;
          py = cy + (dy / d) * radius;
        }
        graphics.lineTo(px, py);
      }
      graphics.strokePath();
    }
  }

  // 确定性伪随机（mulberry32），以单位 id 作种子
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function next() {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
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
