import { OBJECTIVE_ANNIHILATE } from '../level.js';

// 胜负判定（gdd.md §10）：
// 1. **基础规则（始终生效）**：一方失去全部城市即告负，另一方获胜。
//    这也是 REQUIREMENTS.md §4.5「消灭全部敌军且敌方无可生产城市」的简化形式：城市是唯一的
//    兵力依托（部署之外没有别的补充来源），失去全部城市即无法继续作战，故无需再单独判定全灭。
// 2. **关卡任务规则（可选）**：关卡 JSON 的 `victory` 声明了 `mode: 'defend' | 'attack' | 'annihilative'` 时，
//    `world.mess` 会带着 { mode, faction, time, points } 传进来（见 level.js 的 buildMission），
//    由下面的 defendVictory / attackVictory / annihilationVictory 追加判定。
//
// ⚠️ world.mess 为 null 时必须安全退出——绝大多数关卡没有任务规则，
//    这里若直接读 mess.faction 会抛 TypeError 并让整个 tick（也就是游戏）崩掉。
export function updateVictory(world) {
  if (world.winner) return;
  for (const faction of ['blue', 'red']) {
    const ownsCity = world.cities.some(city => city.faction === faction);
    if (!ownsCity) {
      endGame(world, faction === 'blue' ? 'red' : 'blue');
      return;
    }
  }

  // 关卡任务规则：未声明（world.mess 为空）时到此为止，只保留上面的失城判负
  const mess = world.mess;
  if (!mess) return;
  if (mess.mode === 'attack') attackVictory(world, mess);
  else if (mess.mode === 'annihilative') annihilationVictory(world, mess);
  else defendVictory(world, mess);
}

function endGame(world, winner) {
  if (world.winner) return;
  world.winner = winner;
  world.endTime = world.time;
  world.events.push({ type: 'victory', winner, at: world.time });
}

// 防守胜利判定：mess.faction 指防守方
// - 坚守到时限（mess.time，秒；未声明则不限时）→ 防守方胜
// - 任一据点（mess.points）不再属于防守方 → 该据点当前归属方胜（丢点即败）
function defendVictory(world, mess) {
  if (world.winner || !mess) return;
  const fac = mess.faction;
  if (Number.isFinite(mess.time) && world.time > mess.time) {
    endGame(world, fac);
    return;
  }
  for (const point of mess.points ?? []) {
    if (point.faction !== fac) {
      endGame(world, point.faction);
      return;
    }
  }
}

// 进攻胜利判定：mess.faction 指进攻方
// - 时限内拿下全部据点（mess.points 全部归属进攻方）→ 进攻方胜
// - 超过时限仍未拿下 → 另一方（防守方）胜
function attackVictory(world, mess) {
  if (world.winner || !mess) return;
  const fac = mess.faction;
  if (Number.isFinite(mess.time) && world.time > mess.time) {
    endGame(world, fac === 'blue' ? 'red' : 'blue');
    return;
  }
  const points = mess.points ?? [];
  if (points.length === 0) return; // 没有可争夺的据点 → 不做任务判定
  if (points.every(point => point.faction === fac)) endGame(world, fac);
}

// 歼灭判定：mess.faction 指我方；胜利条件是**消灭全部指定单位**（而不是消灭全部敌军）。
// 「指定单位」= 关卡 forces 上标了 "objective": "annihilate" 的编队部署出的单位（unit.objective）。
// - 指定单位全部阵亡 → 我方胜
// - 没有指定单位 → 不判定（避免关卡忘标标记时开局秒胜）
// - 声明了时限且超时仍未歼灭 → 敌方胜（任务未达成）
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
