// 影响力场与实际控制线的纯计算（gdd.md §9）。
//
// 本模块不依赖 World / Phaser / DOM：输入是「影响力源」数组
// （由 systems/controlLine.js 的 collectSources 从 world 里取出），
// 输出是一张影响力网格与它的 0 等值线（= 实际控制线），可 headless 单测。
//
// 约定：蓝方影响力为正、红方为负，**每格的代数和**决定归属
// （sum > 0 蓝、sum < 0 红、sum === 0 中立，见 values.controlLine.neutralEpsilon）。
// 网格坐标：格 (col,row) 的中心是 ((col+0.5)·cellSize, (row+0.5)·cellSize)。
//
// 成本：累加只遍历每个源半径框内的格子（不扫全图），等值线只遍历格块。
// 实测（Node，1280×720，500 单位）：单次重算 0.77 ms，摊到每 6 tick 约 0.13 ms/tick；
// 同期整 tick 平均 2.13 ms（预算 8 ms，见 performance.test.js）。

/**
 * 单个影响力源在距离 distance 处的影响力（非负；正负由累加时按阵营决定）。
 *
 * 曲线形状来自原型 srcipt.js 的四段式（内圈满强度 → 断崖 → 两段线性衰减），
 * 参数见 values.controlLine.curve；距离按 radius / curve.maxDistance 等比缩放，
 * 因此改 influenceRadius 等于整体缩放这条曲线，不用改曲线本身。
 *
 * @param {number} distance 到影响力源的距离（px）
 * @param {number} radius   该源的影响力半径（px），超出即 0
 * @param {number} strength 内圈满强度
 * @param {{maxDistance:number, coreDistance:number, coreExitRatio:number,
 *          midDistance:number, midEndRatio:number, edgeEndRatio:number}} curve
 * @returns {number} 影响力（≥ 0）
 */
export function influenceAt(distance, radius, strength, curve) {
  const scale = radius / curve.maxDistance;
  const u = distance / scale;
  if (u > curve.maxDistance) return 0;
  if (u <= curve.coreDistance) return strength;
  if (u <= curve.midDistance) {
    const ratio = (u - curve.coreDistance) / (curve.midDistance - curve.coreDistance);
    return strength * (curve.coreExitRatio + (curve.midEndRatio - curve.coreExitRatio) * ratio);
  }
  const ratio = (u - curve.midDistance) / (curve.maxDistance - curve.midDistance);
  return strength * (curve.midEndRatio + (curve.edgeEndRatio - curve.midEndRatio) * ratio);
}

/**
 * 建立一张空的影响力网格。
 * values = 时间平滑后的影响力（对外可读），raw = 本次重算结果（内部用）。
 */
export function createField(width, height, cellSize) {
  const cols = Math.max(1, Math.ceil(width / cellSize));
  const rows = Math.max(1, Math.ceil(height / cellSize));
  return {
    width,
    height,
    cellSize,
    cols,
    rows,
    values: new Float32Array(cols * rows),
    raw: new Float32Array(cols * rows),
    scratch: null,
    ready: false, // 首次重算不做平滑（否则第一帧会被 alpha 稀释成 35%）
  };
}

/**
 * 重算网格：清零 → 累加所有影响力源 → 时间平滑 → 可选模糊。
 * @param {object} field createField 的返回值（原地更新）
 * @param {Array<{x:number,y:number,sign:1|-1,radius:number,strength:number}>} sources
 * @param {object} cfg values.controlLine
 */
export function rebuildField(field, sources, cfg) {
  field.raw.fill(0);
  for (const source of sources) accumulate(field, source, cfg.curve);

  const alpha = field.ready ? cfg.temporalSmoothing : 1;
  const { raw, values } = field;
  for (let i = 0; i < raw.length; i += 1) values[i] += (raw[i] - values[i]) * alpha;
  field.ready = true;

  for (let pass = 0; pass < cfg.fieldBlurPasses; pass += 1) blur3x3(field);
  return field;
}

/**
 * 取 0 等值线（marching squares），得到实际控制线的线段数组。
 *
 * 只有 2×2 格块里**同时存在正格与负格**时才输出线段：这样「只有蓝方影响力」
 * 的区域不会在自己影响范围的外沿画出一条假分界线（范围外全是 0，不算负方）。
 *
 * @param {object} field rebuildField 的结果
 * @param {number} epsilon 中立阈值（|值| ≤ epsilon 视为中立）
 * @param {Array<{x1:number,y1:number,x2:number,y2:number}>} out 复用的输出数组
 */
export function contour(field, epsilon = 0, out = []) {
  const { cols, rows, cellSize, values } = field;
  out.length = 0;
  for (let row = 0; row < rows - 1; row += 1) {
    for (let col = 0; col < cols - 1; col += 1) {
      const a = values[row * cols + col];               // 左上
      const b = values[row * cols + col + 1];           // 右上
      const c = values[(row + 1) * cols + col + 1];     // 右下
      const d = values[(row + 1) * cols + col];         // 左下
      if (!hasBothSigns(a, b, c, d, epsilon)) continue;
      const code = (a > epsilon ? 8 : 0) | (b > epsilon ? 4 : 0) | (c > epsilon ? 2 : 0) | (d > epsilon ? 1 : 0);
      if (code === 0 || code === 15) continue;

      // 格心坐标：列 0 的格心是 0.5·cellSize，故右边界是 (col+1.5)·cellSize
      const x0 = (col + 0.5) * cellSize;
      const x1 = (col + 1.5) * cellSize;
      const y0 = (row + 0.5) * cellSize;
      const y1 = (row + 1.5) * cellSize;
      const top = { x: x0 + (x1 - x0) * crossing(a, b), y: y0 };
      const right = { x: x1, y: y0 + (y1 - y0) * crossing(b, c) };
      const bottom = { x: x0 + (x1 - x0) * crossing(d, c), y: y1 };
      const left = { x: x0, y: y0 + (y1 - y0) * crossing(a, d) };
      // 鞍点（code 5 / 10）要靠格心值决定两个正角是否连通
      pushSegments(out, code, top, right, bottom, left, (a + b + c + d) / 4 > epsilon);
    }
  }
  return out;
}

function accumulate(field, source, curve) {
  const { cellSize, cols, rows, raw } = field;
  const { x, y, radius, strength, sign } = source;
  if (!(radius > 0) || !(strength > 0)) return;

  // 只遍历该源影响力半径覆盖到的格子（半径外的曲线值恒为 0）
  const minCol = Math.max(0, Math.floor((x - radius) / cellSize));
  const maxCol = Math.min(cols - 1, Math.floor((x + radius) / cellSize));
  const minRow = Math.max(0, Math.floor((y - radius) / cellSize));
  const maxRow = Math.min(rows - 1, Math.floor((y + radius) / cellSize));

  for (let row = minRow; row <= maxRow; row += 1) {
    const dy = (row + 0.5) * cellSize - y;
    for (let col = minCol; col <= maxCol; col += 1) {
      const dx = (col + 0.5) * cellSize - x;
      const value = influenceAt(Math.sqrt(dx * dx + dy * dy), radius, strength, curve);
      if (value !== 0) raw[row * cols + col] += sign * value;
    }
  }
}

// 3×3 均值模糊：抹掉单格孤立值，让等值线更平顺（次数见 values.controlLine.fieldBlurPasses）
function blur3x3(field) {
  const { cols, rows, values } = field;
  if (!field.scratch || field.scratch.length !== values.length) field.scratch = new Float32Array(values.length);
  const out = field.scratch;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      let sum = 0;
      let count = 0;
      for (let dr = -1; dr <= 1; dr += 1) {
        const r = row + dr;
        if (r < 0 || r >= rows) continue;
        for (let dc = -1; dc <= 1; dc += 1) {
          const c = col + dc;
          if (c < 0 || c >= cols) continue;
          sum += values[r * cols + c];
          count += 1;
        }
      }
      out[row * cols + col] = sum / count;
    }
  }
  values.set(out);
}

function hasBothSigns(a, b, c, d, epsilon) {
  const positive = a > epsilon || b > epsilon || c > epsilon || d > epsilon;
  if (!positive) return false;
  return a < -epsilon || b < -epsilon || c < -epsilon || d < -epsilon;
}

// 边 (v0 → v1) 上过零点的插值比例
function crossing(v0, v1) {
  const delta = v0 - v1;
  if (delta === 0) return 0.5;
  return Math.min(1, Math.max(0, v0 / delta));
}

// marching squares 的 16 种情形 → 线段（每个 2×2 块最多 2 段）
function pushSegments(out, code, top, right, bottom, left, centerPositive) {
  switch (code) {
    case 1:
    case 14:
      out.push(segment(left, bottom));
      break;
    case 2:
    case 13:
      out.push(segment(bottom, right));
      break;
    case 3:
    case 12:
      out.push(segment(left, right));
      break;
    case 4:
    case 11:
      out.push(segment(top, right));
      break;
    case 6:
    case 9:
      out.push(segment(top, bottom));
      break;
    case 7:
    case 8:
      out.push(segment(top, left));
      break;
    case 5: // 鞍点：上右 + 下左为正
      if (centerPositive) {
        out.push(segment(top, left));
        out.push(segment(right, bottom));
      } else {
        out.push(segment(top, right));
        out.push(segment(bottom, left));
      }
      break;
    case 10: // 鞍点：上左 + 下右为正
      if (centerPositive) {
        out.push(segment(top, right));
        out.push(segment(bottom, left));
      } else {
        out.push(segment(top, left));
        out.push(segment(right, bottom));
      }
      break;
    default:
      break;
  }
}

function segment(from, to) {
  return { x1: from.x, y1: from.y, x2: to.x, y2: to.y };
}
