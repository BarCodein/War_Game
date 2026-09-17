import { describe, expect, it } from 'vitest';
import { values } from '../../src/config/index.js';
import { ScriptedAI } from '../../src/simulation/ai.js';
import { createLoop } from '../../src/simulation/loop.js';
import { makePlainMap, makeWorld, runSimulation } from './helpers.js';

// 战术层接入（docs/ai-design.md 阶段一）：engage 动作、队形推进、不添油、集中火力、脚本优先、固定节奏。
const STEP = values.simulation.fixedStep;

function setup() {
  const world = makeWorld(makePlainMap({ width: 1600, height: 480 }));
  const units = [0, 1, 2].map(i => world.spawnUnit('blue', 'light', 120 + i * 26, 240));
  for (const unit of units) unit.group = 'north';
  const objective = { x: 1500, y: 240 };
  return { world, units, objective };
}

function engageScript(objective, units = { group: 'north' }) {
  return {
    rules: [{ when: { time: 0 }, then: [{ type: 'engage', target: objective, units }] }],
  };
}

describe('engage：战术层接管执行', () => {
  it('按队形槽位推进：每个人拿到不同的落点，而不是全挤在目标点上', () => {
    const { world, units, objective } = setup();
    const ai = new ScriptedAI(world, { faction: 'blue', script: engageScript(objective) });
    ai.update(STEP); // 第一条规则立刻触发，设置意图
    ai.update(values.ai.decisionIntervalSeconds); // 到点 → 跑一次战术决策

    const ends = units.map(unit => unit.route.at(-1));
    expect(ends.every(Boolean)).toBe(true);
    const unique = new Set(ends.map(point => `${Math.round(point.x)},${Math.round(point.y)}`));
    expect(unique.size).toBe(units.length);              // 互不重叠
    expect(ends.every(point => point.x < objective.x)).toBe(true); // 朝目标推进、还没到
  });

  it('不添油：脱离队形又跑在前面的单位原地等主力', () => {
    const { world, units, objective } = setup();
    const ahead = world.spawnUnit('blue', 'light', 900, 240);
    ahead.group = 'north';
    const ai = new ScriptedAI(world, { faction: 'blue', script: engageScript(objective) });
    ai.update(STEP);
    ai.update(values.ai.decisionIntervalSeconds);

    expect(ahead.command?.type).toBe('hold');                       // 先锋等待
    expect(units.every(unit => unit.command?.type === 'attackMove')).toBe(true); // 主力按槽位推进
  });

  it('集中火力：同一个敌人最多 maxAttackersPerTarget 个人打，其余继续推进', () => {
    const { world, objective } = setup();
    const extra = world.spawnUnit('blue', 'light', 240, 260);
    extra.group = 'north';
    // 敌人放在交战半径（320px）内，所有蓝军都够得着
    const enemy = world.spawnUnit('red', 'light', 380, 240);
    world.spatial.rebuild(world.units);

    const ai = new ScriptedAI(world, { faction: 'blue', script: engageScript(objective) });
    ai.update(STEP);
    ai.update(values.ai.decisionIntervalSeconds);

    const attackers = world.units.filter(unit => unit.faction === 'blue'
      && unit.command?.type === 'attack' && unit.command.targetId === enemy.id);
    expect(attackers.length).toBe(values.ai.squad.maxAttackersPerTarget);
    // 其余单位没有被"过杀"绑在同一个目标上，而是继续按队形推进
    const others = world.units.filter(unit => unit.faction === 'blue' && unit.command?.type === 'attackMove');
    expect(others.length).toBe(3 - values.ai.squad.maxAttackersPerTarget + 1);
  });

  it('脚本优先：hold / retreat / attackMove 会清掉战术意图', () => {
    const { world, objective } = setup();
    const ai = new ScriptedAI(world, { faction: 'blue', script: engageScript(objective) });
    ai.update(STEP);
    expect(ai.intents.size).toBe(1);

    ai.doHold({ units: { group: 'north' } });
    expect(ai.intents.size).toBe(0);

    ai.doEngage({ target: objective, units: { group: 'north' } });
    expect(ai.intents.size).toBe(1);
    ai.doRetreat({ units: { group: 'north' } });
    expect(ai.intents.size).toBe(0);

    ai.doEngage({ target: objective });
    expect(ai.intents.size).toBe(1);
    ai.doAttackMove({ target: { x: 10, y: 10 } });
    expect(ai.intents.size).toBe(0);
  });

  it('决策节奏固定：与 update 的调用频率无关（2 秒内次数相同）', () => {
    const countDecisions = (dt, steps) => {
      const { world, objective } = setup();
      const ai = new ScriptedAI(world, { faction: 'blue', script: engageScript(objective) });
      let decisions = 0;
      const original = ai.runTactics.bind(ai);
      ai.runTactics = () => { decisions += 1; original(); };
      for (let i = 0; i < steps; i += 1) ai.update(dt);
      return decisions;
    };
    const at60fps = countDecisions(STEP, 120);            // 2 秒 @60fps
    const at240fps = countDecisions(STEP / 4, 480);       // 同样 2 秒，但每帧只走 1/4 步
    expect(at60fps).toBe(at240fps);
    expect(at60fps).toBeGreaterThanOrEqual(3);
    expect(at60fps).toBeLessThanOrEqual(4);
  });

  it('没有意图时不跑战术决策（纯脚本关卡零开销）', () => {
    const world = makeWorld(makePlainMap({ width: 800, height: 480 }));
    const unit = world.spawnUnit('blue', 'light', 100, 240);
    const ai = new ScriptedAI(world, {
      faction: 'blue',
      script: { triggers: [{ at: { time: 0 }, actions: [{ type: 'hold' }] }] },
    });
    let decisions = 0;
    const original = ai.runTactics.bind(ai);
    ai.runTactics = () => { decisions += 1; original(); };
    runSimulation(world, [ai], 5);
    expect(decisions).toBe(0);
    expect(unit.state).toBe('hold'); // 注意：hold 之后 command 会在路线清空时被置空，看 state 更可靠
  });
});

describe('固定步长接线：AI 由循环驱动', () => {
  it('createLoop(world, [ai]) 与逐 tick 驱动在同样 tick 数下结果完全一致', () => {
    const a = setup();
    const aiA = new ScriptedAI(a.world, { faction: 'blue', script: engageScript(a.objective) });
    const loop = createLoop(a.world, [aiA]);
    // 注意：累加器有浮点误差，所以按"实际发生的 tick 数"对齐，而不是按秒数
    let ticks = 0;
    for (let i = 0; i < 10800 && ticks < 180; i += 1) ticks += loop.advance(STEP, 1);

    const b = setup();
    const aiB = new ScriptedAI(b.world, { faction: 'blue', script: engageScript(b.objective) });
    for (let i = 0; i < ticks; i += 1) {
      b.world.tick(STEP);
      aiB.update(STEP); // 与 createLoop 内部完全相同的顺序与步长
    }

    const snapshot = ({ world }) => world.units.map(unit => [
      unit.id, Math.round(unit.x * 1000), Math.round(unit.y * 1000), unit.command?.type ?? null,
    ]);
    expect(ticks).toBe(180);
    expect(snapshot(b)).toEqual(snapshot(a));
    expect(b.world.time).toBe(a.world.time);
    expect(aiA.elapsed).toBeGreaterThan(2.9);
  });

  it('循环里不传控制器时行为不变（向后兼容）', () => {
    const world = makeWorld(makePlainMap({ width: 800, height: 480 }));
    const unit = world.spawnUnit('blue', 'light', 100, 240);
    const loop = createLoop(world);
    for (let i = 0; i < 60; i += 1) loop.advance(STEP, 1);
    expect(world.time).toBeCloseTo(1, 2);
    expect(unit.x).toBe(100); // 没有命令 → 不动
  });
});
