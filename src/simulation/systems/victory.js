// 胜负判定（gdd.md §10）：一方失去全部城市即告负，另一方获胜。
// REQUIREMENTS.md §4.5 的「消灭全部敌军且敌方无可生产城市」分支被本规则涵盖：
// 城市始终可生产，故「有城市」即「可继续生产」，失城即失败条件成立。
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
}
