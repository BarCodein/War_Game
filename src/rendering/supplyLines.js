import { values } from '../config/index.js';
import { t } from '../i18n/index.js';
import { buildBlockedMask, findSupplyPath, inEnemyControl, supplyGrid } from '../simulation/supplyPath.js';
import { backtrackPx, offsetPx, trimToUnit as trimToNearest } from './supplyPathTrim.js';

// 补给线渲染（gdd.md §7）：**选中单位时**把它这一轮的补给线画出来。
//
// 只画选中单位，所以不存在"用画面泄露敌情"的问题（选中集合本来就是玩家自己的部队）。
// 每条线对应一条实际的补给边（城市 → 单位）：
//   · 线宽与不透明度随「实收 ÷ 需求」变化 —— 一眼看出谁是主供城、谁只象征性给一点；
//   · 缺补给时再画出「本来该走的那条路」（忽略敌方控制区算出来的 A*）：
//     如果这条路穿过敌方实际控制区，就用红色虚线画出来并在切断处打叉；
//     如果路是通的（纯粹是城里运力不够），只提示"补给不足"，不画假线。
//
// 路径按 world.supplyToken 缓存（代价场每 fieldRefreshSeconds 重算一次才失效），
// 于是逐帧渲染的开销只有画线本身；单位那一端用实时坐标，线始终连在单位身上。
const DEPTH = 7;        // 层级：地形 0 < 迷雾 1 < 控制线 2 < 城市 3 < 单位 4/5 < 城市标签 6 < 补给线 7
// 单位偏离缓存折线起点超过这个距离就重跑 A*（实测 0.48 ms/次；走 40 px/s 时约 1.7 次/秒/单位）
const REPATH_PX = 8;
const LABEL_DEPTH = 8;
const MAX_UNITS = 12;   // 同时选中很多单位时只画前 12 个，避免画面糊成一片

export function createSupplyLines(scene, world, selection) {
  const style = values.supply.style;
  const demand = values.supply.demandPerUnit;
  const lines = scene.add.graphics().setDepth(DEPTH);
  const marks = scene.add.graphics().setDepth(DEPTH);
  const label = scene.add.text(0, 0, '', {
    fontFamily: '"PingFang SC", "Microsoft YaHei", sans-serif',
    fontSize: '11px',
    color: '#7a1f1f',
    fontStyle: '600',
    backgroundColor: 'rgba(240,233,214,0.85)',
    padding: { x: 6, y: 3 },
  }).setDepth(LABEL_DEPTH).setVisible(false);

  let cache = new Map();   // `${unitId}|${cityId}` → 折线（按 supplyToken 失效）
  let masks = {};          // 敌方控制区掩码（同一轮里所有 A* 共用，避免逐个 A* 重建）
  let cacheToken = -1;
  // 上一帧的画线结果，供 e2e / 调试读取（渲染层不做判断，只是把"画了什么"记下来）
  const state = {
    selected: 0, lines: 0, cuts: 0, note: null,
    repath: 0,                 // 累计重跑 A* 的次数
    startOffsetPx: 0,          // 本帧"画线起点 vs 单位位置"的最大距离
    maxStartOffsetPx: 0,       // 上述值的累计最大
    backtrackPx: 0,            // 本帧裁剪后仍"折回"的像素（应接近 0）
    backtrackRawPx: 0,         // 本帧未裁剪时的"折回"像素（缓存路径起点相对单位的反向投影）
    maxBacktrackDrawnPx: 0,    // 裁剪后折回的累计最大（修复效果）
    maxBacktrackRawPx: 0,      // 未裁剪折回的累计最大（原来的 bug 幅度）
  };

  function draw() {
    lines.clear();
    marks.clear();
    const selected = [];
    for (const unit of world.units) {
      if (unit.state === 'dead' || !selection.isSelected(unit.id)) continue;
      selected.push(unit);
      if (selected.length >= MAX_UNITS) break;
    }
    if (selected.length === 0) {
      label.setVisible(false);
      state.selected = 0;
      state.lines = 0;
      state.cuts = 0;
      state.note = null;
      return;
    }
    if (cacheToken !== world.supplyToken) {
      cache = new Map();
      masks = {};
      cacheToken = world.supplyToken;
    }

    let note = null; // { x, y, text }：只显示一条提示，避免多个单位时字叠在一起
    state.startOffsetPx = 0;   // 每帧重置（只统计本帧画出来的线）
    let lineCount = 0;
    let cutCount = 0;
    for (const unit of selected) {
      const cities = world.cities.filter(city => city.faction === unit.faction);
      if (cities.length === 0) continue;

      // ① 每条补给边画一条线：线宽/浓度 = 实收占比。
      // 满额部队没有缺口 → 那条边是 0 流量的"待机"边（最细最淡），玩家仍能看出路线走向。
      for (const edge of unit.supplyEdges ?? []) {
        const city = cities.find(item => item.id === edge.cityId);
        if (!city) continue;
        const path = pathFor(unit, city, false);
        if (!path) continue;
        const share = clamp01(edge.received / demand);
        const width = style.width.min + (style.width.max - style.width.min) * share;
        stroke([{ x: unit.x, y: unit.y }, ...path, { x: city.x, y: city.y }],
          width, style.color, style.alpha * (0.3 + 0.7 * share));
        lineCount += 1;
      }

      // ② 只有**补给线断了**（supplied=false：被敌方控制区切断 / 够不着 / 没有城市）才提示。
      // 注意用 supplied 而不是 supplyRatio：满额部队 ratio=1，但路断了照样要画出那条红色虚线。
      if (unit.supplied) continue;

      // ② 缺补给：找出"本来该走的那条路"，判断是被敌方控制区切断，还是城里运力不够
      const nearest = nearestCity(unit, cities);
      const relief = nearest ? pathFor(unit, nearest, true) : null;
      if (!nearest || !relief) {
        note ??= { x: unit.x, y: unit.y, text: t('hud.supply.noPath') };
        continue;
      }
      const cut = firstCut(unit.faction, relief);
      if (cut) {
        strokeDashed([{ x: unit.x, y: unit.y }, ...relief, { x: nearest.x, y: nearest.y }]);
        markCut(cut);
        cutCount += 1;
        note ??= { x: cut.x, y: cut.y, text: t('hud.supply.cut') };
      } else {
        note ??= { x: unit.x, y: unit.y, text: t('hud.supply.short') };
      }
    }

    state.lines = lineCount;
    state.cuts = cutCount;
    state.note = note ? note.text : null;
    state.selected = selected.length;

    if (note) {
      label.setText(note.text);
      label.setPosition(note.x + 10, note.y - 26);
      label.setVisible(true);
    } else {
      label.setVisible(false);
    }
  }

  // 路径缓存：同一轮补给（同一个 supplyToken）内不重复跑 A*。
  //
  // ⚠️ 缓存里存的是"从**当时**的单位位置算出来的折线"。单位一直在动，如果直接复用，
  // 画出来的线会是 `[单位当前位置, 折线起点（旧位置）, …]` —— 视觉上就是"先折回上一个位置"。
  // 所以命中缓存时先把折线**头部裁到离单位最近的点**（不再折回），并且单位偏离缓存起点
  // 超过 REPATH_PX 就重算（A* 实测 0.48 ms/次，不能每帧跑）。
  function pathFor(unit, city, relief) {
    const key = `${unit.id}|${city.id}|${relief ? 'r' : 'b'}`;
    const hit = cache.get(key);
    if (hit && Math.hypot(hit.x - unit.x, hit.y - unit.y) <= REPATH_PX) {
      return trimToUnit(hit.path, unit);
    }
    if (!relief && !masks[unit.faction]) masks[unit.faction] = buildBlockedMask(world, unit.faction);
    const path = findSupplyPath(world, unit.faction,
      { x: unit.x, y: unit.y }, { x: city.x, y: city.y },
      { ignoreControl: relief, mask: relief ? null : masks[unit.faction] });
    if (path) {
      cache.set(key, { path, x: unit.x, y: unit.y });
      state.repath += 1;
    }
    return path;
  }

  /** 丢掉折线头部"在单位身后"的点，并把诊断量记到 state（几何逻辑在 supplyPathTrim.js，有单测） */
  function trimToUnit(path, unit) {
    if (!path || path.length < 2) return path;
    // 诊断①：未裁剪时"折回"有多长（= 缓存路径起点相对单位当前位置的反方向投影）
    const rawBacktrack = backtrackPx(path, unit);
    if (rawBacktrack > state.maxBacktrackRawPx) state.maxBacktrackRawPx = rawBacktrack;
    state.backtrackRawPx = rawBacktrack;

    // 诊断②：画线起点（最近点）与单位当前位置的距离
    const offset = offsetPx(path, unit);
    state.startOffsetPx = Math.max(state.startOffsetPx, offset);
    if (offset > state.maxStartOffsetPx) state.maxStartOffsetPx = offset;

    const trimmed = trimToNearest(path, unit);
    // 诊断③：裁剪之后还剩多少折回（应接近 0）
    const drawnBacktrack = backtrackPx(trimmed, unit);
    state.backtrackPx = drawnBacktrack;
    if (drawnBacktrack > state.maxBacktrackDrawnPx) state.maxBacktrackDrawnPx = drawnBacktrack;
    return trimmed;
  }

  // 折线上第一个落在敌方实际控制区里的点（= 补给被切断的地方）
  function firstCut(faction, points) {
    const grid = supplyGrid(world);
    for (const point of points) {
      const cx = Math.min(grid.cols - 1, Math.max(0, Math.floor(point.x / grid.cellSize)));
      const cy = Math.min(grid.rows - 1, Math.max(0, Math.floor(point.y / grid.cellSize)));
      if (inEnemyControl(world, faction, cx, cy)) return point;
    }
    return null;
  }

  function stroke(points, width, color, alpha) {
    lines.lineStyle(width, color, alpha);
    lines.beginPath();
    lines.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i += 1) lines.lineTo(points[i].x, points[i].y);
    lines.strokePath();
  }

  // Phaser 的 Graphics 没有虚线：按实/虚长度自己切段
  function strokeDashed(points) {
    const width = style.width.max;
    lines.lineStyle(width, style.cutColor, style.alpha);
    for (const [from, to] of dashSegments(points)) {
      lines.beginPath();
      lines.moveTo(from.x, from.y);
      lines.lineTo(to.x, to.y);
      lines.strokePath();
    }
  }

  function markCut(point) {
    const size = style.cutMarkSize;
    marks.lineStyle(3, style.cutColor, 1);
    marks.beginPath();
    marks.moveTo(point.x - size, point.y - size);
    marks.lineTo(point.x + size, point.y + size);
    marks.moveTo(point.x + size, point.y - size);
    marks.lineTo(point.x - size, point.y + size);
    marks.strokePath();
  }

  return { draw, state };
}

function dashSegments(points) {
  const { length, gap } = values.supply.style.dash;
  const out = [];
  let drawing = true;
  let left = length;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const total = Math.hypot(b.x - a.x, b.y - a.y);
    if (total === 0) continue;
    let pos = 0;
    while (pos < total) {
      const step = Math.min(left, total - pos);
      if (drawing) {
        out.push([
          { x: a.x + (b.x - a.x) * (pos / total), y: a.y + (b.y - a.y) * (pos / total) },
          { x: a.x + (b.x - a.x) * ((pos + step) / total), y: a.y + (b.y - a.y) * ((pos + step) / total) },
        ]);
      }
      pos += step;
      left -= step;
      if (left <= 1e-6) {
        drawing = !drawing;
        left = drawing ? length : gap;
      }
    }
  }
  return out;
}

function nearestCity(unit, cities) {
  let nearest = null;
  let best = Infinity;
  for (const city of cities) {
    const distance = Math.hypot(city.x - unit.x, city.y - unit.y);
    if (distance < best) {
      best = distance;
      nearest = city;
    }
  }
  return nearest;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}
