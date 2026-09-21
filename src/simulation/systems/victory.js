import { OBJECTIVE_ANNIHILATE } from '../level.js';

// 胜负判定（gdd.md §10）：
// **没有"通用基础规则"，每个关卡完全由自己的 victory 任务规则结束**：
//   · normal        —— 占领全部城市（某一阵营拿下地图上每一座城市）即获胜
//   · attack        —— 拿下全部据点胜；超时仍未拿完则负
//   · defend        —— 守到时限胜；据点全丢立即负；到点仍有据点不在手里则负
//   · annihilative  —— 消灭全部「指定单位」胜；超时未歼灭则负
//
// 历史：以前这里有一条**无条件**的基础规则"一方失去全部城市即告负"。
// 它的副作用是：歼灭战里只要把敌方城市全占了就能提前获胜（不必歼灭完），
// 与"歼灭战要达成歼灭目标"冲突。现在这条规则只属于 normal 模式
// （normal 与旧的 `captureAll` 写法同义，见 level.js 的 VICTORY_MODES）。
//
// ⚠️ world.mess 为 null 时按 normal 处理（编辑器试玩 / 没声明 victory 的关卡）——
//    否则一局永远结束不了；同时任何分支都必须能安全处理 mess 为空。
export function updateVictory(world) {
  if (world.winner) return;
  const mess = world.mess ?? null;
  const mode = mess?.mode ?? 'normal';
  if (mode === 'attack') attackVictory(world, mess);
  else if (mode === 'annihilative') annihilationVictory(world, mess);
  else if (mode === 'defend') defendVictory(world, mess);
  else normalVictory(world);
}

function endGame(world, winner) {
  if (world.winner) return;
  world.winner = winner;
  world.endTime = world.time;
  world.events.push({ type: 'victory', winner, at: world.time });
}

// normal：占领全部城市即获胜——**对称判定**，谁把地图上每一座城市都拿到手谁赢
// （所以"敌人占光你的城市"也是你输，而这条只在 normal 模式生效）。
// - 占领点不参与（占领点在规则上只提供视野）
// - 地图上一座城市都没有时不判定（避免开局秒胜；正常地图都至少各有 1 座）
function normalVictory(world) {
  if (world.cities.length === 0) return;
  for (const faction of ['blue', 'red']) {
    if (!world.cities.some(city => city.faction !== faction)) {
      endGame(world, faction);
      return;
    }
  }
}

// 防守胜利判定：mess.faction 指防守方，mess.points 是要守的据点（缺省 = 地图上全部占领点）
// - 时限内：**据点全丢立即判负**；只要还有任何一个据点在手里就继续守
// - 到达时限：还有据点不在防守方手里 → 防守失败（由占住该据点的阵营获胜）；全部守住 → 防守方胜
// - 没有可守的据点（points 为空）→ 据点规则不参与判定，只看时限
function defendVictory(world, mess) {
  if (world.winner || !mess) return;
  const fac = mess.faction;
  const points = mess.points ?? [];

  if (Number.isFinite(mess.time) && world.time > mess.time) {
    const lost = points.find(point => point.faction !== fac);
    endGame(world, lost ? lost.faction : fac);
    return;
  }

  if (points.length === 0) return; // 没有据点可守 → 不做据点判定
  if (points.some(point => point.faction === fac)) return; // 还有据点在手里 → 继续守
  endGame(world, fac === 'blue' ? 'red' : 'blue'); // 全丢立败
}

// 进攻胜利判定：mess.faction 指进攻方
// - 拿下全部据点（mess.points 全部归属进攻方）→ 进攻方胜
// - 超过时限仍未拿下 → 另一方（防守方）胜
// ⚠️ 顺序要紧：**先判据点、再判超时**。反过来的话，"刚好在时限那一 tick 拿下最后一个据点"
//    会被超时分支判成失败——玩家明明赢了却看到失败结算（渡江战役实测踩到）。
// ⚠️ 城市不算任务目标：占光敌方城市不在这里判胜（那是 normal 模式的规则）。
function attackVictory(world, mess) {
  if (world.winner || !mess) return;
  const fac = mess.faction;
  const points = mess.points ?? [];
  if (points.length > 0 && points.every(point => point.faction === fac)) {
    endGame(world, fac);
    return;
  }
  if (Number.isFinite(mess.time) && world.time > mess.time) {
    endGame(world, fac === 'blue' ? 'red' : 'blue');
  }
}

// 歼灭判定：mess.faction 指我方；胜利条件是**消灭全部指定单位**（而不是消灭全部敌军）。
// 「指定单位」= 关卡 forces 上标了 "objective": "annihilate" 的编队部署出的单位（unit.objective）。
// - 指定单位全部阵亡 → 我方胜
// - 没有指定单位 → 不判定（避免关卡忘标标记时开局秒胜）
// - 声明了时限且超时仍未歼灭 → 敌方胜（任务未达成）
// ⚠️ 占光敌方城市**不算**歼灭完成：这里只看单位，不看城市。
function annihilationVictory(world, mess) {
  if (world.winner || !mess) return;
  const fac = mess.faction;
  const enemy = fac === 'blue' ? 'red' : 'blue';
  const targets = world.units.filter(unit =>
    unit.faction === enemy && unit.objective === OBJECTIVE_ANNIHILATE);
  if (targets.length === 0) return;
  if (targets.every(unit => unit.state === 'dead')) {
    endGame(world, fac);
    return;
  }
  if (Number.isFinite(mess.time) && world.time > mess.time) endGame(world, enemy);
}
