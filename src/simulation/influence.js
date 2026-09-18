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
 * 曲线参数见 values.controlLine.curve，形状照搬原型 srcipt.js 的四段式：
 * - **核心圈** `source.coreRadius`（绝对值，不随 influenceRadius 缩放）：该距离内满强度。
 *   每个源各有自己的数值：单位 = 它的碰撞半径（`units.*.radius`），
 *   城市 = `values.controlLine.city.coreRadius`，占领点 = `values.controlLine.capturePoint.coreRadius`
 *   （两者的核心圈都与各自的占领半径脱钩），这样核心圈只覆盖源「脚下的身体」，
 *   而不是在它周围造一圈很大的绝对领域。
 * - 出核心圈直接掉到 `coreExitRatio`（保留原型 100 → 20 的断崖手感）。
 * - 中圈/外圈断点按 `influenceRadius / curve.maxDistance` 等比缩放后两段线性衰减，
 *   到 `influenceRadius` 截断为 0。改半径只平移这两个断点，不用改曲线本身。
 *
 * @param {number} distance 到影响力源的距离（px）
 * @param {{radius:number, strength:number, coreRadius?:number}} source 影响力源
 * @param {object} curve values.controlLine.curve
 * @returns {number} 影响力（≥ 0）
 */
export function influenceAt(distance, source, curve) {
  const { radius, strength, coreRadius = 0 } = source;
  if (!(radius > 0) || !(strength > 0)) return 0;

  const edge = radius;
  const core = Math.max(0, Math.min(coreRadius, edge)); // 核心圈不会大于影响力半径
  const scale = edge / curve.maxDistance;
  const mid = Math.min(edge, Math.max(core, curve.midDistance * scale));

  if (distance > edge) return 0;
  if (distance <= core) return strength;
  if (distance <= mid) {
    const ratio = (distance - core) / (mid - core);
    return strength * (curve.coreExitRatio + (curve.midEndRatio - curve.coreExitRatio) * ratio);
  }
  const ratio = (distance - mid) / (edge - mid);
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
 * 重算网格：清零 → 累加所有影响力源 → 时间平滑 → 可选模糊 → 可选"铺满全图"划分。
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
  // 放在模糊之后：填充值只用来定"没人管的地方算谁的"，不该被模糊抹平
  if (cfg.partitionMap) partitionField(field, cfg.neutralEpsilon, cfg.partitionFillValue);
  return field;
}

/**
 * 把「双方影响力都够不到」的格子按**最近的阵营**归属，让实际控制线铺满整张地图——
 * 包括迷雾与从未探索的区域（否则这些格子是中立、那里就没有线，看起来像"被迷雾吃掉了"）。
 *
 * 做法是多源 BFS（曼哈顿 Voronoi）：所有已有影响力的格子当种子，向外一圈圈扩散，
 * 每个空格取最先到达它的那个阵营；两方波前相遇处就是延续出去的控制线。
 *
 * 赋的是极小的弱值 ±fillValue，远小于真实影响力的下限（strength × edgeEndRatio = 2.5），
 * 所以它只决定归属、不会挪动真实战线。
 *
 * @param {object} field rebuildField 的结果（原地更新）
 * @param {number} epsilon 中立阈值
 * @param {number} fillValue 填充用的弱影响力
 */
export function partitionField(field, epsilon, fillValue) {
  const { cols, rows, values } = field;
  const total = cols * rows;
  if (!field.queue || field.queue.length !== total) {
    field.queue = new Int32Array(total);
    field.visited = new Uint8Array(total);
  }
  const queue = field.queue;
  const visited = field.visited;
  visited.fill(0);

  let head = 0;
  let tail = 0;
  for (let i = 0; i < total; i += 1) {
    if (values[i] > epsilon || values[i] < -epsilon) {
      visited[i] = 1;
      queue[tail] = i;
      tail += 1;
    }
  }
  if (tail === 0) return field; // 场上没有任何影响力源：无从划分

  const spread = (index, sign) => {
    if (visited[index]) return;
    visited[index] = 1;
    values[index] = sign * fillValue;
    queue[tail] = index;
    tail += 1;
  };

  while (head < tail) {
    const index = queue[head];
    head += 1;
    const sign = values[index] > 0 ? 1 : -1;
    const col = index % cols;
    const row = (index - col) / cols;
    if (col > 0) spread(index - 1, sign);
    if (col < cols - 1) spread(index + 1, sign);
    if (row > 0) spread(index - cols, sign);
    if (row < rows - 1) spread(index + cols, sign);
  }
  return field;
}

/**
 * **单位所在格的硬保证**：把每个存活单位脚下那一格强制归它自己的阵营。
 *
 * 为什么需要：影响力是"加总后看符号"，单靠核心圈并不能保证这一点——
 *   · 城市（核心圈 20px / 强度 80）与占领点（核心圈 14px / 强度 60）会压过单位身体的 100；
 *   · 格边长 20px、单位核心圈 = 碰撞半径 14px，格心可能落在核心圈外（只剩 20% 影响力）；
 *   · 多个敌军贴身时，它们的影响力会叠过你。
 * 这三条都会让"单位一定在自己阵营控制区内"失效，所以这里做最小幅度的兜底。
 *
 * 做法（**最小扰动**）：只有在这一格的符号不对时才翻转它，且保留原来的量级
 * （`|value|`，最低 minMagnitude）——这样等值线只是贴着这一格的边界绕一圈，
 * 表现为"这个兵站住了自己那一格"，而不会把整片战线拉过来。
 *
 * @param {object} field rebuildField 的结果（原地更新）
 * @param {Array<{x:number,y:number,sign:1|-1}>} marks 存活单位的位置与阵营
 * @param {number} minMagnitude 兜底的最小幅度（用于原本就是 0 的格）
 */
export function guaranteeUnitCells(field, marks, minMagnitude = 0) {
  const { cols, rows, cellSize, values } = field;
  for (const mark of marks) {
    const col = Math.min(cols - 1, Math.max(0, Math.floor(mark.x / cellSize)));
    const row = Math.min(rows - 1, Math.max(0, Math.floor(mark.y / cellSize)));
    const index = row * cols + col;
    const value = values[index];
    if (value * mark.sign > 0) continue; // 已经是己方的格：不动
    values[index] = mark.sign * Math.max(Math.abs(value), minMagnitude);
  }
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
      const value = influenceAt(Math.sqrt(dx * dx + dy * dy), source, curve);
      if (value !== 0) raw[row * cols + col] += sign * value;
    }
  }
}

// 3×3 均值模糊：让等值线更平顺，但**会破坏「单位所在格归自己阵营」**——
// 它把邻近格的敌方影响力混进单位脚下；实测（435,766 次采样）开关从 0 改到 1，
// 该不变量的失败率从 0.000% 涨到 5.3%。所以配置里 fieldBlurPasses 默认且应当保持 0。
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

/**
 * 把等值线线段首尾相接成折线（一条战线 / 一个包围圈就是一条折线）。
 *
 * 线段由逐格 marching squares 产出，顺序是"按格块扫描"而不是"沿战线"，
 * 所以这里按端点把相邻线段串起来：先从一个端点出发一路向前串，再回头向前串，
 * 闭合的包围圈会串成首尾同点的一条。
 *
 * 端点量化到 0.01 px 再比较：相邻格块共享的那条边上，过零点是用同一对格值
 * 按同一公式算出来的，浮点结果完全相同，量化只是为了防止极端情况下的末位误差。
 *
 * @param {Array<{x1:number,y1:number,x2:number,y2:number}>} segments
 * @param {Array<Array<{x:number,y:number}>>} out 复用的输出数组（每条折线一个点数组）
 */
export function chainSegments(segments, out = []) {
  out.length = 0;
  if (segments.length === 0) return out;

  const pointKey = (x, y) => `${Math.round(x * 100)},${Math.round(y * 100)}`;
  const byPoint = new Map();
  segments.forEach((line, index) => {
    for (const key of [pointKey(line.x1, line.y1), pointKey(line.x2, line.y2)]) {
      const bucket = byPoint.get(key);
      if (bucket) bucket.push(index);
      else byPoint.set(key, [index]);
    }
  });

  const used = new Uint8Array(segments.length);
  const nextUnused = (key) => {
    for (const index of byPoint.get(key) ?? []) {
      if (used[index] === 0) return index;
    }
    return -1;
  };
  const step = (line, key) => (
    pointKey(line.x1, line.y1) === key
      ? { x: line.x2, y: line.y2 }
      : { x: line.x1, y: line.y1 }
  );

  for (let start = 0; start < segments.length; start += 1) {
    if (used[start] === 1) continue;
    used[start] = 1;
    const line = segments[start];
    const forward = [{ x: line.x1, y: line.y1 }, { x: line.x2, y: line.y2 }];
    const backward = [];

    for (let tail = forward[forward.length - 1]; ;) {
      const index = nextUnused(pointKey(tail.x, tail.y));
      if (index < 0) break;
      used[index] = 1;
      tail = step(segments[index], pointKey(tail.x, tail.y));
      forward.push(tail);
    }
    for (let head = forward[0]; ;) {
      const index = nextUnused(pointKey(head.x, head.y));
      if (index < 0) break;
      used[index] = 1;
      head = step(segments[index], pointKey(head.x, head.y));
      backward.push(head);
    }
    backward.reverse();
    out.push(backward.concat(forward));
  }
  return out;
}

/**
 * Chaikin 切角平滑：每轮把每条折线变成"保留首尾 + 每段取 1/4、3/4 两点"，
 * 阶梯状的等值线会被磨成平滑曲线。首尾点保留，所以开口战线不会缩头。
 *
 * @param {Array<{x:number,y:number}>} points
 * @param {number} iterations 迭代次数（0 = 不平滑）
 */
export function smoothPath(points, iterations = 1) {
  let current = points;
  for (let pass = 0; pass < iterations; pass += 1) {
    if (current.length < 3) return current; // 两点无法切角
    const next = [current[0]];
    for (let i = 0; i < current.length - 1; i += 1) {
      const a = current[i];
      const b = current[i + 1];
      next.push({ x: a.x + (b.x - a.x) * 0.25, y: a.y + (b.y - a.y) * 0.25 });
      next.push({ x: a.x + (b.x - a.x) * 0.75, y: a.y + (b.y - a.y) * 0.75 });
    }
    next.push(current[current.length - 1]);
    current = next;
  }
  return current;
}

/**
 * 等值线 → 可渲染的平滑折线：串联 + Chaikin 切角（次数见 values.controlLine.pathSmoothing）。
 * 平滑只作用在几何上，**不动影响力场**——这样既让线好看，
 * 又不会像空间模糊那样破坏「单位所在格归自己阵营」。
 */
export function buildPaths(segments, iterations, out = []) {
  out.length = 0;
  const polylines = chainSegments(segments, []);
  for (const line of polylines) out.push(smoothPath(line, iterations));
  return out;
}
