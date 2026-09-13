import { describe, expect, it } from 'vitest';
import { loadTutorialMap, runSimulation } from './helpers.js';
import { World } from '../../src/simulation/world.js';
import { ScriptedAI } from '../../src/simulation/ai.js';
import { attackMoveCommand } from '../../src/simulation/commands.js';

// 阶段 2 出口条件：模拟层在无渲染环境下跑完整一局（headless）。
describe('world integration', () => {
  it('教学地图上蓝军与脚本红军完整对局并分出胜负', () => {
    const world = new World(loadTutorialMap());
    // 蓝军初始兵力：6 轻型 + 2 重型（对局测试用；教学关兵力配比见 gdd.md §10）
    for (let i = 0; i < 6; i += 1) world.spawnUnit('blue', 'light', 200 + i * 15, 560);
    world.spawnUnit('blue', 'heavy', 260, 500);
    world.spawnUnit('blue', 'heavy', 290, 620);
    // 红军初始兵力
    world.spawnUnit('red', 'light', 1080, 160);
    world.spawnUnit('red', 'heavy', 1110, 160);

    const redAi = new ScriptedAI(world, {
      faction: 'red',
      script: {
        triggers: [
          {
            id: 'reinforcement',
            at: { time: 60 },
            actions: [{
              type: 'spawn',
              unitType: 'light',
              count: 2,
              at: { x: 1230, y: 400 },
              spacing: { x: 18, y: 0 },
              order: { type: 'attackMove', target: { x: 1080, y: 160 } },
            }],
          },
          {
            id: 'counterattack',
            at: { enemyCrossX: 640 },
            repeatEvery: 5,
            actions: [{ type: 'attackNearest' }],
          },
        ],
      },
    });

    // 蓝军脚本控制器：每 5s 全军向红城 attackMove（走统一命令接口）
    const blueCommander = {
      timer: 0,
      update(dt) {
        this.timer += dt;
        if (this.timer < 5) return;
        this.timer = 0;
        const ids = world.units.filter(u => u.state !== 'dead' && u.faction === 'blue').map(u => u.id);
        world.issueCommands(ids, attackMoveCommand({ x: 1080, y: 160 }));
      },
    };

    // 300s 预算：当前平衡（低伤害/高攻速、士气行军与交战消耗、水域可通行）下
    // 蓝军约在 250s 攻陷红城；局部提前结束（world.winner 置位即停），加余量不增加耗时。
    runSimulation(world, [redAi, blueCommander], 300);

    expect(world.winner).toBe('blue');
    expect(world.history.some(e => e.type === 'cityCaptured' && e.cityId === 'c2' && e.faction === 'blue')).toBe(true);
    expect(world.history.some(e => e.type === 'victory' && e.winner === 'blue')).toBe(true);
    // 城市生产在整局中持续工作（红城兵力低于补给容量，对局中应有产出）
    expect(world.units.filter(u => u.faction === 'red').length).toBeGreaterThan(2);
    // 迷雾网格按阵营维护
    expect(world.fog.blue.some(v => v === 2)).toBe(true);
  });
});
