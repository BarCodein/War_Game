import { isSpotted } from '../simulation/systems/fog.js';
import { t } from '../i18n/index.js';

// 单位贴图（美术资源，置于项目根 assets/texture/，由 Vite 以 /assets/** 提供）。
// 按「阵营 × 档次」各一张：普通（轻型/步兵师）与精英（重型/装甲师）使用不同贴图；
// 等比缩放保持美术原图长宽比；找不到贴图时回退到圆形绘制。
// 替换正式美术只需改这里的路径/文件名。
export const UNIT_TEXTURES = {
  blue: {
    normal: { key: 'unit-blue', url: '/assets/texture/blueunit.png' },
    elite: { key: 'unit-blue-merit', url: '/assets/texture/blueunitmerit.png' },
  },
  red: {
    normal: { key: 'unit-red', url: '/assets/texture/redunit.png' },
    elite: { key: 'unit-red-merit', url: '/assets/texture/redunitmerit.png' },
  },
};

// 精英判定：重型（装甲师）用精英贴图，轻型（步兵师）用普通贴图。
export const ELITE_UNIT_TYPE = 'heavy';

export function unitTexture(unit) {
  return UNIT_TEXTURES[unit.faction][unit.type === ELITE_UNIT_TYPE ? 'elite' : 'normal'];
}

// 回退配色：贴图不可用时仍按圆形绘制（保留旧行为）。
const SIDE_COLORS = {
  blue: { fill: 0x2f6bff, outline: 0x090b78 },
  red: { fill: 0xf01818, outline: 0x76100e },
};

// 贴图旋转基准：立绘「正上方」朝向目标方向（+90°）。
const SPRITE_FACING_OFFSET = Math.PI / 2;

// 贴图对角线相对碰撞半径的倍数：2 = 对角线正好等于碰撞直径（贴图内切于碰撞圆）。
// 当前取 3 让方块更醒目；调整大小只需改这一个数。
const SPRITE_DIAGONAL_FACTOR = 3;

// 贴图单位选中时的着色（加深）。
const SELECTED_TINT = 0x5a5a5a;

// 单位与城市渲染（每帧重绘，只读世界状态）：
// 层级：terrain 0 < fog 1 < 控制线 2 < 城市/基地 3 < 单位贴图 4 < 覆盖层(裂纹/血条/虚影) 5 < 城市标签 6。
// 单位改为贴图精灵（等比缩放至对角线 = 碰撞直径、随行进/交战方向旋转、选中着色加深），
// 贴图缺失时回退圆形；城市、裂纹、血条/士气条、交战抖动、溃逃闪圈、敌军虚影仍用 Graphics 绘制。
export function createUnitRenderer(scene, world, selection) {
  // 城市/基地单独一层，深度低于单位精灵，避免基地图案遮挡单位（bugfix）
  const cityGraphics = scene.add.graphics().setDepth(3);
  const graphics = scene.add.graphics().setDepth(5);
  const sprites = new Map(); // unitId → Phaser.GameObjects.Image
  const stats = { ghostCount: 0 };
  // 贴图是否已加载：按纹理键记录（未加载则对应阵营/档次回退圆形）
  const textured = new Map();
  for (const faction of Object.values(UNIT_TEXTURES)) {
    for (const { key } of Object.values(faction)) textured.set(key, scene.textures.exists(key));
  }
  // 贴图原始对角线（像素），按纹理键缓存。等比缩放时用它把对角线对齐到目标尺寸，
  // 这样显示长宽比始终等于美术原图比例，换贴图无需改代码。
  const nativeDiagonals = new Map();
  function diagonalOf(key) {
    let diagonal = nativeDiagonals.get(key);
    if (diagonal === undefined) {
      const source = scene.textures.get(key).getSourceImage();
      diagonal = Math.hypot(source.width, source.height) || 1;
      nativeDiagonals.set(key, diagonal);
    }
    return diagonal;
  }
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
    cityGraphics.clear();
    stats.ghostCount = 0;
    for (const city of world.cities) drawCity(city);
    for (const unit of world.units) {
      if (unit.state === 'dead') {
        hideSprite(unit.id);
        continue;
      }
      if (unit.faction === 'red' && !isSpotted(world, unit, 'blue')) {
        hideSprite(unit.id); // 未被目视：隐藏贴图，改画最后已知位置虚影
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

  // 按需创建贴图精灵（单位可能在开局后才生产/增援出现），层级低于 overlay graphics 以便裂纹/血条盖在上面
  function spriteFor(unit, textureKey) {
    let sprite = sprites.get(unit.id);
    if (!sprite) {
      sprite = scene.add.image(unit.x, unit.y, textureKey).setDepth(4);
      sprites.set(unit.id, sprite);
    } else if (sprite.texture.key !== textureKey) {
      sprite.setTexture(textureKey); // 阵营/档次变化时换图（当前单位类型不变，属防御性处理）
    }
    return sprite;
  }

  function hideSprite(id) {
    const sprite = sprites.get(id);
    if (sprite) sprite.setVisible(false);
  }

  function drawUnit(unit) {
    const { x, y, radius } = unit;
    const isSelected = selection.isSelected(unit.id);
    // 交战：沿「自身→敌人」连线方向的低频率小幅度抖动（仅渲染层，不影响模拟坐标）
    let dx = x;
    let dy = y;
    if (unit.state === 'combat') {
      const enemy = liveEnemy(unit);
      if (enemy) {
        const dirX = enemy.x - unit.x;
        const dirY = enemy.y - unit.y;
        const len = Math.hypot(dirX, dirY) || 1;
        const offset = Math.sin(scene.time.now * 0.06 + unit.id) * 1; // 降低频率、保持小幅度
        dx += (dirX / len) * offset;
        dy += (dirY / len) * offset;
      }
    }
    if (unit.state === 'rout') { // 溃逃：白色闪烁圈
      graphics.lineStyle(3, 0xffffff, Math.sin(scene.time.now / 80) > 0 ? 0.9 : 0.25);
      graphics.strokeCircle(dx, dy, radius + 8);
    }
    const texture = unitTexture(unit);
    if (textured.get(texture.key)) drawTexturedUnit(unit, texture.key, dx, dy, isSelected);
    else drawCircleUnit(unit, dx, dy, isSelected);
    drawCracks(unit, dx, dy); // 血量<50% 轻破碎、<20% 重破碎（跟随单位震动）
    drawBars(unit, x, y); // 仅己方显示血条/士气条；固定于单位真实位置，不跟随震动
  }

  // 贴图单位：等比缩放到「对角线 = 半径 × SPRITE_DIAGONAL_FACTOR」，保持贴图原始长宽比；
  // 随目标方向旋转、选中着色加深。普通/精英各用其贴图。
  function drawTexturedUnit(unit, textureKey, dx, dy, isSelected) {
    const sprite = spriteFor(unit, textureKey);
    sprite.setVisible(true);
    // 等比缩放（scaleX === scaleY）→ 长宽比不变
    sprite.setScale((unit.radius * SPRITE_DIAGONAL_FACTOR) / diagonalOf(textureKey));
    sprite.setPosition(dx, dy);
    const facing = facingAngle(unit);
    if (facing !== null) sprite.setRotation(facing + SPRITE_FACING_OFFSET);
    if (isSelected) sprite.setTint(SELECTED_TINT);
    else sprite.clearTint();
  }

  // 回退：贴图不可用时仍画圆形（与旧版一致）
  function drawCircleUnit(unit, dx, dy, isSelected) {
    const colors = SIDE_COLORS[unit.faction];
    // 选中特效：单位变深色（加深 + 去饱和）
    const fill = isSelected ? dim(colors.fill) : colors.fill;
    graphics.fillStyle(fill, 1);
    graphics.lineStyle(2, colors.outline, 1);
    graphics.fillCircle(dx, dy, unit.radius);
    graphics.strokeCircle(dx, dy, unit.radius);
  }

  // 贴图朝向：交战时朝当前目标；否则朝下一个路径点；两者都没有则返回 null（保持上次朝向）
  function facingAngle(unit) {
    if (unit.state === 'combat') {
      const enemy = liveEnemy(unit);
      if (enemy) return Math.atan2(enemy.y - unit.y, enemy.x - unit.x);
    }
    if (unit.route.length > 0 && unit.routeIndex < unit.route.length) {
      const waypoint = unit.route[unit.routeIndex];
      return Math.atan2(waypoint.y - unit.y, waypoint.x - unit.x);
    }
    return null;
  }

  // 当前交战目标（用于抖动方向与朝向）；无目标时兜底取最近敌军
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

  // 选中态加深：提黑 + 向灰色靠拢（去饱和），使选中与未选中对比明显（仅回退圆形使用）
  function dim(color) {
    const r = (color >> 16) & 0xff;
    const g = (color >> 8) & 0xff;
    const b = color & 0xff;
    const gray = (r + g + b) / 3;
    const mix = 0.45; // 向灰靠拢程度
    const factor = 0.32; // 提黑
    const dr = Math.floor(((r * (1 - mix) + gray * mix) * factor));
    const dg = Math.floor(((g * (1 - mix) + gray * mix) * factor));
    const db = Math.floor(((b * (1 - mix) + gray * mix) * factor));
    return ((dr << 16) | (dg << 8) | db) >>> 0;
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

  // 城市/基地画在独立的低层级 Graphics 上（depth 3），单位始终绘制在其上方
  function drawCity(city) {
    const { x, y } = city;
    cityGraphics.fillStyle(0x4b4b53, 1);
    cityGraphics.lineStyle(2, 0x252c2e, 1);
    cityGraphics.fillCircle(x, y, 16);
    cityGraphics.strokeCircle(x, y, 16);
    // 阵营旗
    cityGraphics.lineStyle(2, 0x252c2e, 1);
    cityGraphics.lineBetween(x, y - 16, x, y - 42);
    cityGraphics.fillStyle(city.faction === 'red' ? 0xe93227 : 0x1911ce, 1);
    cityGraphics.fillTriangle(x, y - 42, x + 18, y - 36, x, y - 30);
    // 占领进度环
    if (city.captureProgress > 0) {
      cityGraphics.lineStyle(5, 0xf4d71a, 0.95);
      cityGraphics.beginPath();
      cityGraphics.arc(x, y, 22, -Math.PI / 2, -Math.PI / 2 + city.captureProgress / 100 * Math.PI * 2);
      cityGraphics.strokePath();
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
