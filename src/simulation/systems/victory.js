// 胜负判定（gdd.md §10）：一方失去全部城市即告负，另一方获胜。
// 这也是 REQUIREMENTS.md §4.5「消灭全部敌军且敌方无可生产城市」的简化形式：
// 城市是唯一的兵力依托（部署之外没有别的补充来源），失去全部城市即无法继续作战，
// 因此不必再单独判定「敌军是否全灭」——失城判负已覆盖该分支。
export function updateVictory(world) {
  if (world.winner) return;
  for (const faction of ['blue', 'red']) {
    const ownsCity = world.cities.some(city => city.faction === faction);
    if (!ownsCity) {
      const winner = faction === 'blue' ? 'red' : 'blue';
      world.winner = winner;
      world.endTime = world.time;
      world.events.push({ type: 'victory', winner, at: world.time });
      return;
    }
  }
  const mess = world.mess;
  //defendVictory(world,mess);
  //attackVictory(world, mess);
}

// 防守胜利判定 faction 指防守方
function defendVictory(world,mess) {
  if (world.winner) return;
  const fac = mess.faction;
  if (world.time > mess.time){
    const winner = fac;
    world.winner = winner;
    world.endTime = world.time;
    world.events.push({ type: 'victory', winner, at:world.time});
    return;
  }

  for (const point of mess.points) {
    if (point.faction !== fac){
      const winner = point.faction;
      world.winner = winner;
      world.endTime = world.time;
      world.events.push({ type: 'victory', winner, at:world.time});
      return;
    }
  }
}


// 进攻胜利判定 faction 指的是进攻方
function attackVictory(world,mess) {
  if (world.winner) return;
  const fac = mess.faction;
  if (world.time > mess.time){
    const winner = mess.faction==='blue'? 'red':'blue';
    world.winner = winner;
    world.endTime = world.time;
    world.events.push({ type: 'victory', winner, at:world.time});
  }

  for (const point of mess.points) {
    if (point.faction !== fac)return;
  }
  const winner = mess.faction;
  world.winner = winner;
  world.endTime = world.time;
  world.events.push({ type: 'victory', winner, at:world.time});
  return;
}

