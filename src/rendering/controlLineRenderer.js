import { values } from '../config/index.js';
import { t } from '../i18n/index.js';

// 实际控制线渲染（gdd.md §9）：把 simulation 算好的分界线折线描出来。
//
// 影响力统计与归属判定不在这里——见 src/simulation/influence.js（纯函数：衰减曲线、
// 网格累加、时间平滑、0 等值线、串联与 Chaikin 平滑）与 src/simulation/systems/controlLine.js
// （10 Hz 重算、收集影响力源）。渲染层只读 world.controlLinePaths，不做任何判断。
//
// **永远可见、不受视野限制**，三件事一起保证：
// 1) 影响力不读迷雾（双方全部存活单位都参与统计）；
// 2) 图形 depth = 2 > 迷雾罩层 depth = 1（见 fogRenderer），画在迷雾之上；
// 3) 深色主色之下再垫一层更宽的**浅色描边**——只画深色线时，叠在迷雾/森林这类深色底上
//    对比度会归零（实机截图上看起来就是"被迷雾盖住了"，其实线在上面、只是看不见）。
const DEPTH = 2;        // 层级：地形 0 < 迷雾 1 < 控制线 2 < 城市 3 < 单位 4/5 < 城市标签 6
const LABEL_DEPTH = 3;

export function createControlLineRenderer(scene, world) {
  const style = values.controlLine.style;
  // 同一 depth 下按加入顺序绘制：底衬先加 → 主色后加，于是深色线压在浅色描边上。
  const halo = scene.add.graphics().setDepth(DEPTH);
  const graphics = scene.add.graphics().setDepth(DEPTH);
  const label = scene.add.text(0, 0, t('hud.controlLine'), {
    fontFamily: '"PingFang SC", "Microsoft YaHei", sans-serif',
    fontSize: '11px',
    color: '#111111',
    fontStyle: '600',
    // 浅纸底：标签经常落在迷雾/森林上，纯文字在深色底上读不出来
    backgroundColor: 'rgba(240,233,214,0.82)',
    padding: { x: 6, y: 3 },
  }).setDepth(LABEL_DEPTH);

  // 每条折线（一条战线 / 一个包围圈）独立 moveTo 起头：Phaser 的 MOVE_TO 会开新子路径，
  // 不会把两条战线错误地连起来。
  function stroke(target, width, color, alpha, paths) {
    target.clear();
    target.lineStyle(width, color, alpha);
    target.beginPath();
    for (const points of paths) {
      target.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i += 1) target.lineTo(points[i].x, points[i].y);
    }
    target.strokePath();
  }

  function draw() {
    const paths = world.controlLinePaths;
    if (!paths || paths.length === 0) {
      halo.clear();
      graphics.clear();
      label.setVisible(false);
      return;
    }

    stroke(halo, style.haloWidth, style.haloColor, style.haloAlpha, paths);
    stroke(graphics, style.lineWidth, style.color, style.alpha, paths);

    // 标签贴在最靠上的那条战线旁边（多条战线时避免飘到画面外，也避免固定在标题区、
    // 离实际战线很远）
    let topX = null;
    let topY = Infinity;
    for (const points of paths) {
      for (const point of points) {
        if (point.y < topY) {
          topY = point.y;
          topX = point.x;
        }
      }
    }
    label.setVisible(true);
    label.setPosition((topX ?? 0) + 12, Math.max(12, topY + 10));
  }

  return { draw };
}
