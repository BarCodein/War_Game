import { values } from '../config/index.js';

// 补给线寻路（gdd.md §7）：**地形网格上的加权最短路径**，供 supply 系统与补给线渲染共用。
// 只读 World 的地形 / 城市 / 控制线，不依赖 Phaser 与 DOM，可 headless 单测。
//
// 代价单位是**等效像素**：进入一格的代价 = 补给格边长 ÷ 该格的通行倍率，斜向再 ×√2。
// 于是「平地上沿直线走 900 px」的代价就是 900（横竖斜都一样），因子曲线的 100 / 900
// 两个断点可以直接按平地上的距离理解；森林 0.6 → 1.67 倍、水域 0.4 → 2.5 倍、
// 山地 0.65 → 1.54 倍、道路 1.25 → 0.8 倍、城镇/平原/桥 1.0 → 1 倍。
// 用 8 邻域（八向 + 对角 √2）而不是 4 邻域：后者其实是曼哈顿距离，斜向 45° 的补给线
// 会被算成 1.41 倍远，因子曲线会被方向扭曲；对角穿越前要求两个正交邻格都能走，
// 免得从两格障碍的夹角里斜穿过去。
//
// 寻路跑在**补给网格**上（values.supply.path.cellSize，默认 20 px，比 10 px 的地形格粗一档）：
// 补给线是战略级线条，不需要逐 10 px 的精度，粗一档让 500 单位场景的重算开销降到 1/4
// （实测见 tests/unit/supply-path.test.js）。粗格的地形按格内**可通行地形的平均倍率**取值，
// 只有整格都不可通行（或开了 waterIsBarrier 且格内含水域）才算阻断——
// 一格里有半条河就让这格变慢，而不是把整格封掉。
//
// **敌方的实际控制区默认不可通行**：判定读 world.controlLine 的带符号影响力，与画在屏幕上的
// 那条控制线是同一份数据（蓝 +、红 −，符号与己方相反即为敌方控制）。只认**真实影响力**：
// 控制线给无人区域铺的弱填充值（±partitionFillValue）不算"实际控制"，否则一个孤立敌军
// 会凭名义归属掐断几百像素外的补给线（见 supply.path.controlBlockMin）。
//   ⚠️ tick 顺序（world.js）：supply 跑在 controlLine 之前，所以这里读的是**上一 tick** 的控制线场
//   （10 Hz 重算，最多陈旧 16 ms）。这样不必改动系统顺序，也不会让两者互相依赖。
//
// 两条路径算法共用同一套代价与阻断规则，保证「分配用的代价」与「画出来的线」完全一致：
//   · buildSupplyField —— 从给定城市出发的多源 Dijkstra，一次算出全图每个格子的代价
//                         （500 个单位不管站哪里都直接查表，不需要各跑一次 A*）；
//   · findSupplyPath   —— 单点到单点的 A*，只给渲染层画选中单位的补给线用。

const SQRT2 = Math.SQRT2;
// 8 邻域：先四正、后四斜（顺序固定 → 结果确定）
const NEIGHBORS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

// 补给网格按地形缓存（同一张地图只算一次；地形本身在关卡内不变）
const gridCache = new WeakMap();

/** 补给网格：{ cellSize, cols, rows, steps }，steps 是该格的进入代价（等效像素）。 */
export function supplyGrid(world) {
  const terrain = world.terrain;
  const cellSize = values.supply.path.cellSize;
  const barrier = values.supply.waterIsBarrier;
  const cached = gridCache.get(terrain);
  if (cached && cached.cellSize === cellSize && cached.waterIsBarrier === barrier) return cached;

  const cols = Math.max(1, Math.ceil((terrain.cols * terrain.cellSize) / cellSize));
  const rows = Math.max(1, Math.ceil((terrain.rows * terrain.cellSize) / cellSize));
  const steps = new Float32Array(cols * rows);
  const nameByCode = {};
  for (const [name, code] of Object.entries(values.terrain.codes)) nameByCode[code] = name;
  const span = Math.max(1, Math.round(cellSize / terrain.cellSize)); // 一格覆盖几个地形格

  for (let gy = 0; gy < rows; gy += 1) {
    for (let gx = 0; gx < cols; gx += 1) {
      let sum = 0;
      let count = 0;
      let hasWater = false;
      for (let ty = gy * span; ty < Math.min(terrain.rows, (gy + 1) * span); ty += 1) {
        for (let tx = gx * span; tx < Math.min(terrain.cols, (gx + 1) * span); tx += 1) {
          const name = nameByCode[terrain.cells[ty * terrain.cols + tx]];
          const multiplier = values.terrain.moveMultiplier[name] ?? 1;
          if (name === 'water') hasWater = true;
          if (!values.terrain.passable[name] || multiplier <= 0) continue; // 不可通行地形不参与平均
          sum += multiplier;
          count += 1;
        }
      }
      const blocked = count === 0 || (barrier && hasWater);
      steps[gy * cols + gx] = blocked ? Infinity : cellSize / (sum / count);
    }
  }

  const grid = { cellSize, cols, rows, steps, waterIsBarrier: barrier };
  gridCache.set(terrain, grid);
  return grid;
}

/**
 * 该补给格是否处于**敌方**实际控制区（判定口径与屏幕上的控制线一致：带符号影响力压过己方）。
 */
export function inEnemyControl(world, faction, gx, gy) {
  const field = world.controlLine;
  if (!field || !values.supply.enemyControlBlocks) return false;
  const own = faction === 'blue' ? 1 : -1;
  const grid = supplyGrid(world);
  const x = (gx + 0.5) * grid.cellSize;
  const y = (gy + 0.5) * grid.cellSize;
  const col = Math.min(field.cols - 1, Math.max(0, Math.floor(x / field.cellSize)));
  const row = Math.min(field.rows - 1, Math.max(0, Math.floor(y / field.cellSize)));
  const value = field.values[row * field.cols + col];
  const threshold = Math.max(values.controlLine.neutralEpsilon, values.supply.path.controlBlockMin);
  return value * own < -threshold;
}

/**
 * 距离因子：把路径代价换算成「城市付出 1 点、单位实际到手多少」。
 * 见 values.supply.factor：cost ≤ 100 → 1.0；100→900 线性衰减；≥ 900 → 0.2。
 */
export function supplyFactor(cost) {
  if (!Number.isFinite(cost)) return 0;
  const { fullCost, zeroCost, min } = values.supply.factor;
  const ratio = 1 - (cost - fullCost) / (zeroCost - fullCost);
  return Math.max(min, Math.min(1, ratio));
}

/**
 * 预计算「敌方实际控制区」掩码（1 = 该格被敌方实际控制，补给线不可通行）。
 * 每个阵营每轮只算一次，之后所有 Dijkstra / A* 都直接查这张 Uint8Array——
 * 逐格调 inEnemyControl 要做浮点换算 + 数组取值，是这一整套里最容易变热的地方。
 */
export function buildBlockedMask(world, faction, out = null) {
  const grid = supplyGrid(world);
  const mask = out && out.length === grid.cols * grid.rows ? out : new Uint8Array(grid.cols * grid.rows);
  if (!world.controlLine || !values.supply.enemyControlBlocks) {
    mask.fill(0);
    return mask;
  }
  const field = world.controlLine;
  const own = faction === 'blue' ? 1 : -1;
  const threshold = Math.max(values.controlLine.neutralEpsilon, values.supply.path.controlBlockMin);
  const scale = grid.cellSize / field.cellSize;
  for (let gy = 0; gy < grid.rows; gy += 1) {
    // 控制线网格与补给网格都是正方形网格：整行共用一组列映射
    const row = Math.min(field.rows - 1, Math.max(0, Math.floor(((gy + 0.5) * grid.cellSize) / field.cellSize)));
    const base = row * field.cols;
    for (let gx = 0; gx < grid.cols; gx += 1) {
      const col = Math.min(field.cols - 1, Math.max(0, Math.floor((gx + 0.5) * scale)));
      mask[gy * grid.cols + gx] = field.values[base + col] * own < -threshold ? 1 : 0;
    }
  }
  return mask;
}

/** 每个阵营复用的代价场（Dijkstra 的工作数组 + 结果）。 */
export function createSupplyField(grid) {
  const total = grid.cols * grid.rows;
  return {
    grid,
    cols: grid.cols,
    rows: grid.rows,
    cost: new Float32Array(total),  // 到最近可用城市的代价（等效像素），无路可达 = Infinity
    owner: new Int32Array(total),   // 最近的是哪座城：world.cities 的下标（-1 = 够不着）
    pos: new Int32Array(total),     // 该格在堆里的位置（-1 = 不在堆里）→ 支持 decrease-key
    heap: new Int32Array(total),
    heapSize: 0,
    ignoreControl: false,
    ready: false,
    buildCount: 0,                  // 累计重算次数（性能测试用）
  };
}

/**
 * 多源 Dijkstra：从给定城市出发，算出每个格子到最近那座城的代价。
 * @param {object} world
 * @param {'blue'|'red'} faction
 * @param {object} field createSupplyField 的返回值（原地更新）
 * @param {{ignoreControl?: boolean, cities?: Array, mask?: Uint8Array}} [options]
 *   ignoreControl = 忽略敌方控制区（断补时画"本来该走的路"用）；
 *   cities = 只用这几座城当种子（默认己方全部城市）——某座城吞吐点数用光后把它剔出去
 *   重算一次，于是每个单位自动落到「下一座最近的城」上；
 *   mask = buildBlockedMask 的结果（省掉逐格判定）。
 */
export function buildSupplyField(world, faction, field, { ignoreControl = false, cities = null, mask = null } = {}) {
  const grid = field.grid;
  const { cols, rows, steps } = grid;
  const { cost, owner, pos } = field;
  const maxCost = values.supply.path.maxCost;

  cost.fill(Infinity);
  owner.fill(-1);
  pos.fill(-1);
  field.heapSize = 0;
  field.ignoreControl = ignoreControl;
  field.buildCount += 1;

  // 种子：己方城市。城市格永远是补给起点（被围时也算，否则城中守军会凭空断补）
  const seeds = cities ?? world.cities;
  for (let i = 0; i < world.cities.length; i += 1) {
    const city = world.cities[i];
    if (city.faction !== faction || !seeds.includes(city)) continue;
    const index = cellIndexAt(grid, city.x, city.y);
    if (cost[index] === 0) continue;
    cost[index] = 0;
    owner[index] = i;
    heapPush(field, index);
  }
  field.ready = true;
  if (field.heapSize === 0) return field; // 没有可用城市：全图都够不着

  const blocked = !ignoreControl && values.supply.enemyControlBlocks
    ? (mask ?? buildBlockedMask(world, faction))
    : null;
  const traversable = (index) => Number.isFinite(steps[index]) && (blocked === null || blocked[index] === 0);

  while (field.heapSize > 0) {
    const index = heapPop(field);
    const distance = cost[index];
    if (distance > maxCost) break; // 堆按代价有序：再往后都超过搜索上界
    const cx = index % cols;
    const cy = (index - cx) / cols;

    for (const [dx, dy] of NEIGHBORS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const neighbor = ny * cols + nx;
      if (!traversable(neighbor)) continue;
      const diagonal = dx !== 0 && dy !== 0;
      if (diagonal && (!traversable(cy * cols + nx) || !traversable(ny * cols + cx))) continue;
      const next = distance + steps[neighbor] * (diagonal ? SQRT2 : 1);
      if (next < cost[neighbor]) {
        cost[neighbor] = next;
        owner[neighbor] = owner[index];
        heapPush(field, neighbor); // 已在堆里就 decrease-key
      }
    }
  }
  return field;
}

/** 某个世界坐标处的路径代价（等效像素；够不着 = Infinity）。 */
export function supplyCostAt(world, field, x, y) {
  return field.cost[cellIndexAt(field.grid, x, y)];
}

/** 该世界坐标最近的是哪座城：world.cities 的下标（-1 = 够不着）。 */
export function supplyOwnerAt(world, field, x, y) {
  return field.owner[cellIndexAt(field.grid, x, y)];
}

/**
 * 单点到单点的 A*（渲染层画选中单位的补给线用）：代价与阻断规则同 buildSupplyField。
 * @param {{ignoreControl?: boolean, mask?: Uint8Array}} [options] mask 由调用方按轮次缓存传入
 * @returns {Array<{x:number,y:number}>|null} 起点格心 → 终点格心的折线；无路 = null
 */
export function findSupplyPath(world, faction, from, to, { ignoreControl = false, mask = null } = {}) {
  const grid = supplyGrid(world);
  const { cols, rows, steps, cellSize } = grid;
  const blocked = !ignoreControl && values.supply.enemyControlBlocks
    ? (mask ?? buildBlockedMask(world, faction))
    : null;
  const maxCost = values.supply.path.maxCost;

  const startCell = cellAt(grid, from.x, from.y);
  const endCell = resolveEndCell(grid, cellAt(grid, to.x, to.y));
  if (!endCell) return null;
  const startIndex = startCell.cy * cols + startCell.cx;
  const endIndex = endCell.cy * cols + endCell.cx;
  if (startIndex === endIndex) return [cellCenter(grid, startCell), cellCenter(grid, endCell)];

  const traversable = (index) => Number.isFinite(steps[index]) && (blocked === null || blocked[index] === 0);
  // 可采纳启发：八向距离（octile）× 每像素最小代价（最快的道路 1.25 → 0.8）
  const minCostPerPixel = 1 / Math.max(...Object.values(values.terrain.moveMultiplier));
  const heuristic = (cx, cy) => {
    const dx = Math.abs(cx - endCell.cx) * cellSize;
    const dy = Math.abs(cy - endCell.cy) * cellSize;
    return (Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy)) * minCostPerPixel;
  };

  const gScore = new Map([[startIndex, 0]]);
  const cameFrom = new Map();
  const open = [{ index: startIndex, f: heuristic(startCell.cx, startCell.cy) }];
  const visited = new Set();

  while (open.length > 0) {
    let best = 0;
    for (let i = 1; i < open.length; i += 1) if (open[i].f < open[best].f) best = i;
    const current = open.splice(best, 1)[0];
    if (visited.has(current.index)) continue;
    visited.add(current.index);
    if (current.index === endIndex) return reconstruct(grid, cameFrom, startIndex, endIndex);

    const distance = gScore.get(current.index);
    if (distance > maxCost) continue;
    const cx = current.index % cols;
    const cy = (current.index - cx) / cols;
    for (const [dx, dy] of NEIGHBORS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const neighbor = ny * cols + nx;
      if (visited.has(neighbor) || !traversable(neighbor)) continue;
      const diagonal = dx !== 0 && dy !== 0;
      if (diagonal && (!traversable(cy * cols + nx) || !traversable(ny * cols + cx))) continue;
      const tentative = distance + steps[neighbor] * (diagonal ? SQRT2 : 1);
      if (tentative < (gScore.get(neighbor) ?? Infinity)) {
        gScore.set(neighbor, tentative);
        cameFrom.set(neighbor, current.index);
        open.push({ index: neighbor, f: tentative + heuristic(nx, ny) });
      }
    }
  }
  return null;
}

// ── 网格辅助 ────────────────────────────────────────────────────────────────
function cellAt(grid, x, y) {
  return {
    cx: Math.min(grid.cols - 1, Math.max(0, Math.floor(x / grid.cellSize))),
    cy: Math.min(grid.rows - 1, Math.max(0, Math.floor(y / grid.cellSize))),
  };
}

function cellIndexAt(grid, x, y) {
  const { cx, cy } = cellAt(grid, x, y);
  return cy * grid.cols + cx;
}

function cellCenter(grid, cell) {
  return { x: cell.cx * grid.cellSize + grid.cellSize / 2, y: cell.cy * grid.cellSize + grid.cellSize / 2 };
}

// 终点不可通行（例如城市画在山地上）时就近取可通行格
function resolveEndCell(grid, cell) {
  const at = (cx, cy) => cx >= 0 && cy >= 0 && cx < grid.cols && cy < grid.rows && Number.isFinite(grid.steps[cy * grid.cols + cx]);
  if (at(cell.cx, cell.cy)) return cell;
  for (let ring = 1; ring <= 10; ring += 1) {
    for (let dy = -ring; dy <= ring; dy += 1) {
      for (let dx = -ring; dx <= ring; dx += 1) {
        if (Math.abs(dx) !== ring && Math.abs(dy) !== ring) continue;
        if (at(cell.cx + dx, cell.cy + dy)) return { cx: cell.cx + dx, cy: cell.cy + dy };
      }
    }
  }
  return null;
}

function reconstruct(grid, cameFrom, startIndex, endIndex) {
  const points = [];
  let current = endIndex;
  while (current !== startIndex) {
    points.push(cellCenter(grid, { cx: current % grid.cols, cy: Math.floor(current / grid.cols) }));
    current = cameFrom.get(current);
  }
  points.push(cellCenter(grid, { cx: startIndex % grid.cols, cy: Math.floor(startIndex / grid.cols) }));
  points.reverse();
  return simplify(points);
}

// 去掉网格 A* 产生的共线点：折线点数从"每格一个"降到"每拐一个"
function simplify(points) {
  if (points.length <= 2) return points;
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i += 1) {
    const a = out[out.length - 1];
    const b = points[i];
    const c = points[i + 1];
    const collinear = (a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y);
    if (!collinear) out.push(b);
  }
  out.push(points[points.length - 1]);
  return out;
}

// ── 二叉堆（带 decrease-key）────────────────────────────────────────────────
function heapPush(field, index) {
  const { pos } = field;
  if (pos[index] === -1) {
    pos[index] = field.heapSize;
    field.heap[field.heapSize] = index;
    field.heapSize += 1;
  }
  siftUp(field, pos[index]);
}

function heapPop(field) {
  const root = field.heap[0];
  field.heapSize -= 1;
  field.pos[root] = -1;
  if (field.heapSize > 0) {
    const last = field.heap[field.heapSize];
    field.heap[0] = last;
    field.pos[last] = 0;
    siftDown(field, 0);
  }
  return root;
}

function siftUp(field, start) {
  const { heap, cost, pos } = field;
  let child = start;
  while (child > 0) {
    const parent = (child - 1) >> 1;
    if (cost[heap[parent]] <= cost[heap[child]]) break;
    const tmp = heap[parent];
    heap[parent] = heap[child];
    heap[child] = tmp;
    pos[heap[parent]] = parent;
    pos[heap[child]] = child;
    child = parent;
  }
}

function siftDown(field, start) {
  const { heap, cost, pos } = field;
  let parent = start;
  for (;;) {
    const left = parent * 2 + 1;
    const right = left + 1;
    let smallest = parent;
    if (left < field.heapSize && cost[heap[left]] < cost[heap[smallest]]) smallest = left;
    if (right < field.heapSize && cost[heap[right]] < cost[heap[smallest]]) smallest = right;
    if (smallest === parent) return;
    const tmp = heap[parent];
    heap[parent] = heap[smallest];
    heap[smallest] = tmp;
    pos[heap[parent]] = parent;
    pos[heap[smallest]] = smallest;
    parent = smallest;
  }
}
