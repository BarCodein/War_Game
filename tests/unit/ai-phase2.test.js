import { describe, expect, it } from 'vitest';
import { values } from '../../src/config/index.js';
import { ScriptedAI } from '../../src/simulation/ai.js';
import { makePlainMap, makeWorld } from './helpers.js';

// 阶段二战术：薄弱点/接近轴、预备队、佯动分兵、急行军、回城休整（docs/ai-design.md §2）。
const STEP = values.simulation.fixedStep;
const DECISION = values.ai.decisionIntervalSeconds;

function setup({ units = 10, objective = { x: 1400, y: 300 }, cityX = 120, decide = true } = {}) {
  const world = makeWorld(makePlainMap({
    width: 1600, height: 600,
    cities: [{ id: 'c1', x: cityX, y: 300, faction: 'blue' }, { id: 'c2', x: 1500, y: 560, faction: 'red' }],
  }));
  const squad = [];
  for (let i = 0; i < units; i += 1) {
    const unit = world.spawnUnit('blue', 'light', 200 + (i % 5) * 22, 260 + Math.floor(i / 5) * 30);
    unit.group = 'north';
    squad.push(unit);
  }
  world.spatial.rebuild(world.units);
  const ai = new ScriptedAI(world, { faction: 'blue', script: {} });
  ai.doEngage({ target: objective, units: { group: 'north' } });
  ai.update(STEP);            // 登记意图
  if (decide) ai.update(DECISION); // 跑一次决策（用默认档位）
  return { world, ai, squad, objective };
}

// 需要先改档位再决策的用例：decide = false，避免状态被默认档位先算一遍
function withPreset(name, extra = {}) {
  const context = setup({ decide: false });
  context.ai.cfg = { ...values.ai, ...values.ai.presets[name], preset: name, ...extra };
  return context;
}

// 摆一个敌军在目标附近，避免"目标空虚 → 直接投入预备队"
function guardObjective(world, objective) {
  world.spawnUnit('red', 'light', objective.x - 200, objective.y);
  world.spawnUnit('red', 'light', objective.x - 180, objective.y + 20);
  world.spatial.rebuild(world.units);
  return world;
}

// 统计每个单位收到的最后一条命令（用命令对象本身判断）
const commandOf = (unit) => unit.command;

describe('薄弱点与接近轴', () => {
  it('敌方堵在正面时，主攻方向变成侧翼/薄弱段的停战线（不再直冲目标）', () => {
    const { world, ai, squad, objective } = setup();
    // 正面轴线上摆敌军
    world.spawnUnit('red', 'light', 1200, 300);
    world.spawnUnit('red', 'light', 1220, 320);
    world.spatial.rebuild(world.units);
    ai.update(DECISION);

    const state = ai.squadStates.get('north');
    expect(state.axis).not.toBeNull();
    const ends = squad.map(unit => unit.route.at(-1)).filter(Boolean);
    expect(ends.length).toBeGreaterThan(0);
    // 推进点在目标之前的停战线上，而不是目标点本身
    const minDistance = Math.min(...ends.map(point => Math.hypot(point.x - objective.x, point.y - objective.y)));
    expect(minDistance).toBeGreaterThan(1);
  });
});

describe('预备队（按档位比例）', () => {
  it('cautious 留 30% 在后方待命，sly 不留', () => {
    const cautious = withPreset('cautious', { feint: false, engageRadius: 180 });
    guardObjective(cautious.world, cautious.objective);
    cautious.ai.update(DECISION);
    const holding = cautious.squad.filter(unit => commandOf(unit)?.type === 'hold');
    expect(holding.length).toBe(Math.floor(cautious.squad.length * values.ai.presets.cautious.reserveRatio));

    const sly = withPreset('sly', { feint: false, engageRadius: 520 });
    guardObjective(sly.world, sly.objective);
    sly.ai.update(DECISION);
    expect(sly.squad.filter(unit => commandOf(unit)?.type === 'hold')).toHaveLength(0);
  });

  it('目标空虚（我方优势够大）时直接投入预备队，不留人', () => {
    const { ai, squad } = setup();
    ai.cfg = { ...values.ai, ...values.ai.presets.cautious, preset: 'cautious', feint: false, engageRadius: 180 };
    // 全场没有敌人 → 接近轴 ratio = 1 ≥ commitWeaknessRatio → 直接全军压上
    ai.update(DECISION);
    expect(ai.squadStates.get('north').committed).toBe(true);
    expect(squad.filter(unit => commandOf(unit)?.type === 'hold')).toHaveLength(0);
  });
});

describe('佯动分兵（sly）', () => {
  it('派一个单位走侧翼佯动轴，其余（含主力）走主攻轴', () => {
    const { world, ai, squad, objective } = withPreset('sly', { engageRadius: 520 });
    guardObjective(world, objective);
    ai.update(DECISION);

    const state = ai.squadStates.get('north');
    expect(state.feintPoint).not.toBeNull();
    const feinting = squad.filter((unit) => {
      const end = unit.route.at(-1);
      return end && Math.hypot(end.x - state.feintPoint.x, end.y - state.feintPoint.y) < 1;
    });
    expect(feinting).toHaveLength(1);
  });
});

describe('急行军（按档位开关）', () => {
  it('standard 距离远时走急行军，cautious 不走', () => {
    const standard = setup({ units: 2 });
    standard.ai.cfg = { ...values.ai, ...values.ai.presets.standard, preset: 'standard' };
    standard.ai.update(DECISION);
    expect(standard.squad.some(unit => unit.forcedMarch)).toBe(true);

    const cautious = setup({ units: 2 });
    cautious.ai.cfg = { ...values.ai, ...values.ai.presets.cautious, preset: 'cautious' };
    cautious.ai.update(DECISION);
    expect(cautious.squad.every(unit => !unit.forcedMarch)).toBe(true);
  });
});

describe('回城休整状态机', () => {
  it('打残 → 撤回己城；进入恢复半径 → 待命；恢复够 → 回归目标', () => {
    const { world, ai, squad } = setup({ units: 4 });
    const city = world.cities.find(item => item.faction === 'blue');
    for (const unit of squad) {
      unit.hp = values.units.light.hp * 0.2;   // 平均血量 20% < regroup.hpRatio
      unit.morale = 20;
    }
    ai.update(DECISION);
    const state = ai.squadStates.get('north');
    expect(state.mode).toBe('regroup');
    expect(squad.every(unit => commandOf(unit)?.type === 'move')).toBe(true);
    expect(squad.every(unit => {
      const end = unit.route.at(-1);
      return end && Math.hypot(end.x - city.x, end.y - city.y) < 1;
    })).toBe(true);

    // 把小队搬到城市恢复半径内 → 转为待命（hold）
    for (const unit of squad) {
      unit.x = city.x + 20;
      unit.y = city.y + 20;
    }
    world.spatial.rebuild(world.units);
    ai.update(DECISION);
    expect(state.mode).toBe('recover');
    expect(squad.every(unit => commandOf(unit)?.type === 'hold')).toBe(true);

    // 恢复到位 → 回到 engage，并进入冷却
    for (const unit of squad) {
      unit.hp = values.units.light.hp;
      unit.morale = 100;
    }
    ai.update(DECISION);
    expect(state.mode).toBe('engage');
    expect(state.cooldown).toBe(values.ai.regroup.cooldownSeconds);
  });

  it('没有己方城市时不撤退（无城可退就继续打）', () => {
    const { world, ai, squad } = setup({ units: 3 });
    for (const unit of squad) unit.hp = values.units.light.hp * 0.1;
    world.cities = world.cities.filter(city => city.faction !== 'blue');
    ai.update(DECISION);
    expect(ai.squadStates.get('north').mode).toBe('engage');
  });
});

describe('脚本意图仍然优先', () => {
  it('hold / retreat 清掉意图后，战术层不再接管（含阶段二状态）', () => {
    const { ai } = setup({ units: 4 });
    ai.doHold({ units: { group: 'north' } });
    expect(ai.intents.size).toBe(0);
    ai.update(DECISION);
    expect(ai.squadStates.size).toBeGreaterThan(0); // 状态留着，但没有意图就不再决策
    expect(ai.intents.size).toBe(0);
  });
});
