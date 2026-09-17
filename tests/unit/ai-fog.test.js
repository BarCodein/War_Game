import { describe, expect, it } from 'vitest';
import { values } from '../../src/config/index.js';
import { ScriptedAI } from '../../src/simulation/ai.js';
import { updateFog, FOG_UNEXPLORED } from '../../src/simulation/systems/fog.js';
import { makePlainMap, makeWorld, runSimulation } from './helpers.js';

// 公平模式的接入（docs/ai-design.md 阶段三）：隐藏的敌人不打、记忆只当坐标、
// 侦察兵去探路、没情报就按脚本目标推进。
const STEP = values.simulation.fixedStep;
const DECISION = values.ai.decisionIntervalSeconds;
const OBJECTIVE = { x: 1400, y: 300 };

function scene({ fog = true, units = 6, squadX = 200, hiddenAt = { x: 1300, y: 300 }, triggers = [] } = {}) {
  const world = makeWorld(makePlainMap({
    width: 1600, height: 600,
    cities: [{ id: 'c1', x: 80, y: 560, faction: 'blue' }, { id: 'c2', x: 1520, y: 560, faction: 'red' }],
  }));
  const squad = [];
  for (let i = 0; i < units; i += 1) {
    const unit = world.spawnUnit('blue', 'light', squadX + i * 20, 280);
    unit.group = 'north';
    unit.vision = 140;
    squad.push(unit);
  }
  const hidden = world.spawnUnit('red', 'light', hiddenAt.x, hiddenAt.y);
  hidden.vision = 140;
  updateFog(world);
  const ai = new ScriptedAI(world, { faction: 'blue', script: { fog, triggers } });
  ai.doEngage({ target: OBJECTIVE, units: { group: 'north' } });
  ai.update(STEP);
  return { world, ai, squad, hidden };
}

// 推进 n 轮决策（每轮 1 tick + 1 次决策）
const decide = (context, times = 1) => {
  for (let i = 0; i < times; i += 1) {
    context.world.tick(STEP);
    context.ai.update(STEP);
    context.ai.update(DECISION);
  }
};

describe('公平模式：只打看得见的敌人', () => {
  it('迷雾深处的敌人不会被选为目标；同一场景全知模式会', () => {
    const fair = scene({ fog: true });
    decide(fair, 2);
    expect(fair.ai.attackCandidates(fair.squad[0])).toHaveLength(0);
    expect(fair.squad.every(unit => unit.command?.type !== 'attack')).toBe(true);

    const god = scene({ fog: false });
    decide(god, 2);
    // 全知模式：1000px 外的敌人也算候选（engageRadius 320 内只有它一个）
    god.squad[0].x = 1050;
    god.world.spatial.rebuild(god.world.units);
    expect(god.ai.attackCandidates(god.squad[0]).map(enemy => enemy.id)).toEqual([god.hidden.id]);
  });

  it('看得见的敌人会被当作目标（含集中火力上限）', () => {
    const near = scene({ fog: true, hiddenAt: { x: 330, y: 300 } });
    decide(near, 1);
    expect(near.ai.attackCandidates(near.squad[0]).map(enemy => enemy.id)).toEqual([near.hidden.id]);
    expect(near.squad.some(unit => unit.command?.type === 'attack')).toBe(true);
  });

  it('记忆里的敌人只是坐标：据此推进，但绝不作为攻击目标', () => {
    const context = scene({ fog: true });
    context.world.time = 30;
    context.hidden.lastSeen.blue = { x: context.hidden.x, y: context.hidden.y, time: 29 };
    decide(context, 2);
    expect(context.squad.some(unit => unit.command?.type === 'attack'
      && unit.command.targetId === context.hidden.id)).toBe(false);
    expect(context.ai.attackCandidates(context.squad[0])).toHaveLength(0);
    // 但已知敌情确实参与了接近轴/薄弱点判断
    expect(context.ai.squadStates.get('north').axis).not.toBeNull();
  });
});

describe('公平模式：侦察兵', () => {
  it('编队够大时抽 1 个侦察兵去未探索格，其余按队形推进', () => {
    const context = scene({ fog: true, units: 6 });
    decide(context, 2);
    const state = context.ai.squadStates.get('north');
    expect(state.scoutTargets?.size).toBe(values.ai.scout.perGroup);

    const [scoutId, target] = [...state.scoutTargets.entries()][0];
    const cell = context.world.terrain.cellAt(target.x, target.y);
    expect(context.world.fog.blue[context.world.terrain.cellIndex(cell.cx, cell.cy)]).toBe(FOG_UNEXPLORED);
    const scout = context.squad.find(unit => unit.id === scoutId);
    expect(scout.command?.type).toBe('attackMove');
    expect(scout.route.at(-1)).toMatchObject({ x: target.x, y: target.y });
  });

  it('编队太小（< minSquadSize）不抽侦察兵', () => {
    const context = scene({ fog: true, units: values.ai.scout.minSquadSize - 1 });
    decide(context, 2);
    expect(context.ai.squadStates.get('north').scoutTargets?.size ?? 0).toBe(0);
  });

  it('全知模式不派侦察兵（默认行为不变）', () => {
    const context = scene({ fog: false, units: 6 });
    decide(context, 2);
    expect(context.ai.squadStates.get('north').scoutTargets?.size ?? 0).toBe(0);
  });
});

describe('公平模式：没有情报时按脚本目标推进', () => {
  it('敌人全在迷雾里时全军仍朝目标前进（胜负条件可达）', () => {
    const context = scene({ fog: true, hiddenAt: { x: 1500, y: 560 } });
    const before = context.squad.map(unit => unit.x);
    runSimulation(context.world, [context.ai], 4);
    // 侦察兵会往未探索方向走（可能向后），所以只要求"绝大多数单位在推进"
    const progressed = context.squad.filter((unit, index) => unit.x > before[index] + 5);
    expect(progressed.length).toBeGreaterThanOrEqual(context.squad.length - 2);
    expect(context.squad.every(unit => unit.x >= 0 && unit.x <= 1600)).toBe(true);
  });

  it('enemyCrossX 条件在公平模式下只认看得见的敌人', () => {
    // 看不见：敌人远在迷雾里 → 条件不成立
    const unseen = scene({
      fog: true,
      hiddenAt: { x: 1300, y: 300 },
      triggers: [{ at: { enemyCrossX: 900 }, actions: [{ type: 'hold' }] }],
    });
    unseen.ai.update(STEP);
    expect(unseen.ai.triggers[0].active).toBe(false);

    // 看得见：己方部队已经推到敌人身边 → 条件成立
    const seen = scene({
      fog: true,
      squadX: 950,
      hiddenAt: { x: 1080, y: 300 },
      triggers: [{ at: { enemyCrossX: 1000 }, actions: [{ type: 'hold' }] }],
    });
    seen.ai.update(STEP);
    expect(seen.ai.triggers[0].active).toBe(true);
  });
});
