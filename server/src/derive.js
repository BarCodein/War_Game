// 派生数据包（socket 事件 `world:derive`）——方案 B：控制线/补给线由客户端本地算，
// 服务器只按低频（默认 3 s）发一份"可用来校正的最小数据"。
//
// 为什么只发这些：
//   · 控制线折线是纯几何（客户端自己也算得出），这里只用于**偏差校正**；
//   · 补给边只发「单位 → 哪座城」的对应关系，几何由客户端自己的代价场算；
//   · 断补单位只发 id 列表，用于度量与降级判断，**不参与**任何数值显示。
// 不含任何结算输入（supplyIntake / supplyStock / 伤害 / 胜负）。见 docs/pvp-derive-draft.md。
export function buildDerive(match, { lod = 2 } = {}) {
  const world = match.world;
  const step = Math.max(1, Math.round(lod));

  const paths = [];
  for (const path of world.controlLinePaths ?? []) {
    if (!path || path.length < 2) continue;
    const points = [];
    for (let i = 0; i < path.length; i += step) {
      points.push([Math.round(path[i].x), Math.round(path[i].y)]);
    }
    const last = path[path.length - 1];
    const tail = [Math.round(last.x), Math.round(last.y)];
    const prev = points[points.length - 1];
    if (!prev || prev[0] !== tail[0] || prev[1] !== tail[1]) points.push(tail);
    paths.push(points);
  }

  const cityIds = world.cities.map((city) => city.id);
  const cityIndex = new Map(cityIds.map((id, index) => [id, index]));
  const edges = [];
  const off = [];
  for (const unit of world.units) {
    if (unit.state === 'dead') continue;
    if (unit.supplied === false) {
      off.push(unit.id);
      continue;
    }
    for (const edge of unit.supplyEdges ?? []) {
      const cityIdx = cityIndex.get(edge.cityId);
      if (cityIdx !== undefined) edges.push([unit.id, cityIdx]);
    }
  }

  return {
    seq: 0,                       // 由 driver 填（每局单调递增）
    atTick: match.ticks,
    controlLine: { lod: step, paths },
    supply: { cityIds, edges, off },
  };
}

/** 便宜的稳定哈希：折线点 + 补给边 + 断补列表，用于"内容没变就不发" */
export function deriveHash(payload) {
  let hash = 2166136261;
  const feed = (value) => {
    const text = String(value);
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
  };
  for (const path of payload.controlLine.paths) {
    for (const point of path) {
      feed(point[0]); feed(','); feed(point[1]); feed(';');
    }
  }
  for (const [unitId, cityIdx] of payload.supply.edges) {
    feed(unitId); feed('/'); feed(cityIdx); feed('|');
  }
  for (const unitId of payload.supply.off) feed(unitId), feed('!');
  return hash >>> 0;
}

/** JSON 字节数（压测/验收用） */
export function deriveBytes(payload) {
  return Buffer.byteLength(JSON.stringify(payload));
}
