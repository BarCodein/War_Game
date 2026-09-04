import { describe, expect, it } from 'vitest';
import { makePlainMap, makeWorld, runSimulation } from './helpers.js';
import { ScriptedAI } from '../../src/simulation/ai.js';

function aiWorld() {
  const world = makeWorld(makePlainMap({
    cities: [
      { id: 'c1', x: 100, y: 600, faction: 'blue' },
      { id: 'c2', x: 1100, y: 100, faction: 'red' },
    ],
    spawns: [
      { faction: 'blue', x: 100, y: 600 },
      { faction: 'red', x: 1100, y: 100 },
    ],
  }));
  // 红城驻军 2 + 3 名填位（满补给 → 生产暂停，隔离计数）
  world.spawnUnit('red', 'light', 1100, 100);
  world.spawnUnit('red', 'heavy', 1130, 100);
  for (let i = 0; i < 3; i += 1) world.spawnUnit('red', 'light', 1160 + i * 20, 100);
  world.spawnUnit('blue', 'light', 200, 600);
  return world;
}

function script() {
  return {
    reinforcement: { atTime: 60, count: 2, unitType: 'light', spawn: { x: 1230, y: 400 }, moveTo: { x: 1100, y: 100 } },
    trigger: { onEnemyCrossX: 640, retargetInterval: 5 },
  };
}

describe('scripted ai', () => {
  it('定时增援：60s 时在出生点补充 2 个单位并下达移动命令', () => {
    const world = aiWorld();
    const ai = new ScriptedAI(world, { faction: 'red', script: script() });
    expect(world.units.filter(u => u.faction === 'red').length).toBe(5);
    runSimulation(world, [ai], 60.5);
    const redUnits = world.units.filter(u => u.faction === 'red');
    expect(redUnits.length).toBe(7); // 5 驻军 + 2 增援（红城补给已满，无生产）
    expect(redUnits.filter(u => u.command?.type === 'attackMove').length).toBe(2);
  });

  it('触发进攻：敌军越过中线后，全军经统一命令接口攻击最近敌军', () => {
    const world = aiWorld();
    const ai = new ScriptedAI(world, { faction: 'red', script: script() });
    const blue = world.units.find(u => u.faction === 'blue');
    blue.x = 700; // 越过中线
    runSimulation(world, [ai], 0.1);
    const redUnits = world.units.filter(u => u.faction === 'red');
    expect(redUnits.every(u => u.command?.type === 'attackMove')).toBe(true);
  });

  it('未触发前保持驻守（无移动命令）', () => {
    const world = aiWorld();
    const ai = new ScriptedAI(world, { faction: 'red', script: script() });
    runSimulation(world, [ai], 10);
    const redUnits = world.units.filter(u => u.faction === 'red');
    expect(redUnits.every(u => u.command === null && u.state === 'hold')).toBe(true);
  });
});
