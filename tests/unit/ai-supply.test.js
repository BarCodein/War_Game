import { describe, expect, it } from 'vitest';
import { advance, makePlainMap, makeWorld } from './helpers.js';
import { values } from '../../src/config/index.js';
import { ScriptedAI } from '../../src/simulation/ai.js';
import { resolveAiConfig } from '../../src/simulation/ai/presets.js';
import { scoreAttack } from '../../src/simulation/ai/tactics.js';
import { chooseApproach } from '../../src/simulation/ai/front.js';
import {
  bestSupplyCity, clampToSupply, isLowSupply, squadLowSupply, supplyCaution, supplyCostOf, supplyPolicy,
  supplyScore, withinSupply,
} from '../../src/simulation/ai/supply.js';

// AI 的补给视野（docs/ai-design.md §3.5）：
//   · 硬约束：断补（supplied=false）或存量比例 < lowRatio → 不急行军、不主动接战、回撤进补给区；
//   · 行动边界：目标点不得越出 supply.path.maxCost（真"够不着"的地方）；
//   · 软权重：效用打分与接近轴打分里加"存量 / 是否在补给可达区内"；
//   · 撤退目标：补给代价最低的城（而不是欧氏最近）；
//   · 档位差异：supplyCaution 插值出活动范围 / 打分倍率 / 急行军门槛 / 回城阈值。

const STEP = values.simulation.fixedStep;

// 大图：蓝城在西南，红城在东北；两者之间足够远，方便造"够不着"与"够得着"两种位置
function bigMap(width = 2400, height = 1000) {
  return makePlainMap({
    width,
    height,
    cities: [
      { id: 'c1', x: 120, y: 500, faction: 'blue' },
      { id: 'c2', x: width - 120, y: 500, faction: 'red' },
    ],
    spawns: [
      { faction: 'blue', x: 120, y: 500 },
      { faction: 'red', x: width - 120, y: 500 },
    ],
  });
}

function tickSupply(world, seconds = 1) {
  advance(world, seconds); // 让补给代价场与控制线就绪
}

describe('AI 补给策略：档位插值', () => {
  it('supplyCaution 缺失时取中间值，越界会被夹回 0~1', () => {
    expect(supplyCaution({})).toBe(0.5);
    expect(supplyCaution({ supplyCaution: -3 })).toBe(0);
    expect(supplyCaution({ supplyCaution: 9 })).toBe(1);
  });

  it('越保守：活动范围越小、打分越重补给、急行军门槛越高、回城越早', () => {
    const bold = supplyPolicy(resolveAiConfig('sly', null));
    const standard = supplyPolicy(resolveAiConfig('standard', null));
    const careful = supplyPolicy(resolveAiConfig('cautious', null));

    expect(careful.caution).toBeGreaterThan(standard.caution);
    expect(standard.caution).toBeGreaterThan(bold.caution);

    expect(careful.reachRatio).toBeLessThan(standard.reachRatio);
    expect(standard.reachRatio).toBeLessThan(bold.reachRatio);

    expect(careful.weightScale).toBeGreaterThan(standard.weightScale);
    expect(careful.forcedMarchStock).toBeGreaterThan(standard.forcedMarchStock);
    expect(careful.regroupRatio).toBeGreaterThan(standard.regroupRatio);
    expect(bold.regroupRatio).toBeLessThan(standard.regroupRatio);
  });

  it('行动边界用的是 supply.path.maxCost（与档位无关），软范围才随档位变', () => {
    for (const preset of ['cautious', 'standard', 'sly']) {
      const policy = supplyPolicy(resolveAiConfig(preset, null));
      expect(policy.hardReachCost).toBe(values.supply.path.maxCost);
      expect(policy.reachCost).toBeLessThanOrEqual(policy.hardReachCost);
    }
  });

  it('关卡 ai.tuning 可以单独覆盖 supplyCaution', () => {
    const cfg = resolveAiConfig('standard', { supplyCaution: 0.05 });
    expect(supplyPolicy(cfg).caution).toBeCloseTo(0.05, 6);
  });
});

describe('AI 补给视野：代价与目标', () => {
  it('supplyCostOf 读的是本方代价场；够不着 = Infinity', () => {
    const world = makeWorld(bigMap());
    tickSupply(world, 1);
    const near = supplyCostOf(world, 'blue', 220, 500);
    const far = supplyCostOf(world, 'blue', 2300, 500); // 远超 maxCost
    expect(near).toBeGreaterThan(0);
    expect(near).toBeLessThan(values.supply.path.maxCost);
    expect(far).toBe(Infinity);
    // 没有代价场时（没 tick / 该阵营没城）视为"未知"：不限制
    expect(supplyCostOf(makeWorld(bigMap()), 'blue', 220, 500)).toBe(Infinity);
    expect(withinSupply(makeWorld(bigMap()), 'blue', 220, 500, 100)).toBe(true);
  });

  it('bestSupplyCity 选补给代价最低的城；断补时退回欧氏最近', () => {
    const world = makeWorld(bigMap());
    tickSupply(world, 1);
    const east = bestSupplyCity(world, 'blue', 900, 500);
    expect(east.city.id).toBe('c1');           // 只有一座蓝城，但代价是有限的
    expect(Number.isFinite(east.cost)).toBe(true);

    // 敌人把蓝城围起来之前/之后：够不着时也要给一个"往哪走"的方向
    const blind = bestSupplyCity(world, 'blue', 2300, 500);
    expect(blind.city.id).toBe('c1');
    expect(blind.cost).toBe(Infinity);
  });

  it('clampToSupply：区内的目标原样返回，区外的目标沿直线回退到边界内', () => {
    const world = makeWorld(bigMap());
    tickSupply(world, 1);
    const reach = values.supply.path.maxCost;

    const inside = clampToSupply(world, 'blue', { x: 120, y: 500 }, { x: 400, y: 500 }, reach);
    expect(inside.clamped).toBe(false);
    expect(inside.x).toBe(400);

    const outside = clampToSupply(world, 'blue', { x: 120, y: 500 }, { x: 2300, y: 500 }, reach);
    expect(outside.clamped).toBe(true);
    expect(outside.x).toBeLessThan(2300);
    expect(outside.x).toBeGreaterThan(120);
    expect(withinSupply(world, 'blue', outside.x, outside.y, reach)).toBe(true);
    // 回退到的点必须在边界内、且尽量靠外（不是一路缩回起点）
    expect(supplyCostOf(world, 'blue', outside.x, outside.y)).toBeLessThanOrEqual(reach);
    expect(outside.x).toBeGreaterThan(1000);
  });
});

describe('AI 补给视野：硬约束判定', () => {
  it('断补 或 存量低于警戒线 → lowSupply', () => {
    const world = makeWorld(bigMap());
    const policy = supplyPolicy(resolveAiConfig('standard', null));
    const unit = world.spawnUnit('blue', 'light', 300, 500);
    expect(isLowSupply(unit, policy)).toBe(false);         // 出击：满存量 + 默认通线

    unit.supplied = false;
    expect(isLowSupply(unit, policy)).toBe(true);          // 路断了
    unit.supplied = true;
    unit.supplyStock = unit.maxSupplyStock * (policy.lowRatio - 0.01);
    expect(isLowSupply(unit, policy)).toBe(true);          // 存量跌破警戒线
  });

  it('小队判定：断补人数占比过半 或 平均存量过低 → 整队转入低补给姿态', () => {
    const world = makeWorld(bigMap());
    const policy = supplyPolicy(resolveAiConfig('standard', null));
    const units = [0, 1, 2, 3].map(i => world.spawnUnit('blue', 'light', 300 + i * 20, 500));
    expect(squadLowSupply(units, policy)).toBe(false);

    units[0].supplied = false;
    expect(squadLowSupply(units, policy)).toBe(false); // 1/4 断补还不够
    units[1].supplied = false;
    expect(squadLowSupply(units, policy)).toBe(true);  // 2/4 = 50% → 触发

    units[0].supplied = true;
    units[1].supplied = true;
    for (const unit of units) unit.supplyStock = unit.maxSupplyStock * 0.1;
    expect(squadLowSupply(units, policy)).toBe(true);  // 平均存量 10% < 30%
  });

  it('补给打分：存量足 + 战场在可达区内 得分更高', () => {
    const world = makeWorld(bigMap());
    tickSupply(world, 1);
    const policy = supplyPolicy(resolveAiConfig('standard', null));
    const unit = world.spawnUnit('blue', 'light', 300, 500);
    const nearEnemy = { id: 9001, x: 500, y: 500, faction: 'red', type: 'light', hp: 60, maxHp: 60, state: 'hold' };
    const farEnemy = { id: 9002, x: 2200, y: 500, faction: 'red', type: 'light', hp: 60, maxHp: 60, state: 'hold' };

    expect(supplyScore(world, unit, nearEnemy, policy)).toBeGreaterThan(
      supplyScore(world, unit, farEnemy, policy),
    );
    unit.supplyStock = 0;
    expect(supplyScore(world, unit, nearEnemy, policy)).toBeLessThan(
      supplyScore({ ...world, units: [unit] }, { ...unit, supplyStock: unit.maxSupplyStock }, nearEnemy, policy),
    );
  });
});

describe('AI 行为：补给约束真的生效', () => {
  // 一个只推进的脚本：没有触发器，只有 fallback 目标（走战术层）
  function engageScript(objective) {
    return {
      rules: [{ when: { time: 0 }, then: [{ type: 'engage', target: objective, units: { group: 'main' } }] }],
    };
  }

  function setup() {
    const world = makeWorld(bigMap());
    const units = [0, 1, 2].map(i => world.spawnUnit('blue', 'light', 300 + i * 24, 500));
    for (const unit of units) unit.group = 'main';
    const objective = { x: 2200, y: 500 }; // 远超补给可达区 → 应被夹回边界内
    return { world, units, objective };
  }

  it('目标点越出补给可达区时，AI 把它夹回边界内（不再往"够不着"的地方推）', () => {
    const { world, units, objective } = setup();
    tickSupply(world, 1);
    const ai = new ScriptedAI(world, { faction: 'blue', script: engageScript(objective) });
    ai.update(STEP);                                    // 规则触发 → 设意图
    ai.update(values.ai.decisionIntervalSeconds);        // 跑一次战术决策

    const ends = units.map(unit => unit.route.at(-1)).filter(Boolean);
    expect(ends.length).toBeGreaterThan(0);
    for (const end of ends) {
      expect(withinSupply(world, 'blue', end.x, end.y, values.supply.path.maxCost)).toBe(true);
      expect(Math.hypot(end.x - objective.x, end.y - objective.y)).toBeGreaterThan(0);
    }
  });

  it('断补 + 存量见底的部队不去打，而是撤回补给代价最低的城', () => {
    const { world, units, objective } = setup();
    tickSupply(world, 1);
    // 让整队断补且存量见底：整队应转入"回城补给"（regroup），不下攻击命令
    for (const unit of units) {
      unit.supplied = false;
      unit.supplyStock = 0;
    }
    const ai = new ScriptedAI(world, { faction: 'blue', script: engageScript(objective) });
    ai.update(STEP);
    ai.update(values.ai.decisionIntervalSeconds);

    const state = ai.squadStates.get('main');
    expect(state.mode).toBe('regroup');
    for (const unit of units) {
      expect(unit.command?.type).toBe('move');
      const end = unit.route.at(-1);
      const city = world.cities.find(c => c.id === 'c1');
      expect(Math.hypot(end.x - city.x, end.y - city.y)).toBeLessThan(1); // 目标就是补给城
    }
  });

  it('存量不足时不开急行军（急行军要烧存量，断补时等于自杀）', () => {
    const { world, units, objective } = setup();
    tickSupply(world, 1);
    const ai = new ScriptedAI(world, { faction: 'blue', script: engageScript(objective) });
    const cfg = ai.cfg;
    expect(cfg.useForcedMarch).toBe(true); // standard 档允许急行军

    // 满存量 + 路通 + 距离够远（≥ march.minDistance）+ 目的地可达 → 允许
    expect(cfg.march.minDistance).toBe(650);
    expect(ai.shouldForceMarch(units, { x: 1100, y: 500 }, cfg)).toBe(true);

    // 存量掉到门槛以下 → 不允许
    for (const unit of units) unit.supplyStock = unit.maxSupplyStock * (ai.policy.forcedMarchStock - 0.05);
    expect(ai.shouldForceMarch(units, { x: 1100, y: 500 }, cfg)).toBe(false);

    // 恢复存量但断补 → 依然不允许
    for (const unit of units) unit.supplyStock = unit.maxSupplyStock;
    units[0].supplied = false;
    expect(ai.shouldForceMarch(units, { x: 1100, y: 500 }, cfg)).toBe(false);

    // 目的地"够不着" → 不允许
    units[0].supplied = true;
    expect(ai.shouldForceMarch(units, { x: 2300, y: 500 }, cfg)).toBe(false);
  });

  it('低补给的部队在第一轮决策里就被拦下（不会继续往前顶）', () => {
    const { world, units, objective } = setup();
    tickSupply(world, 1);
    // 只让一个单位断补、其余健康：整队不算低补给，但这个单位要自己回撤
    const straggler = units[0];
    straggler.x = 1500;
    straggler.y = 500;
    straggler.supplied = false;
    straggler.supplyStock = straggler.maxSupplyStock * 0.1;
    world.spatial.rebuild(world.units);

    const ai = new ScriptedAI(world, { faction: 'blue', script: engageScript(objective) });
    ai.update(STEP);
    ai.update(values.ai.decisionIntervalSeconds);

    expect(straggler.command?.type).toBe('move');
    const end = straggler.route.at(-1);
    const city = world.cities.find(c => c.id === 'c1');
    expect(Math.hypot(end.x - city.x, end.y - city.y)).toBeLessThan(1);
    // 其余两个单位照常推进
    for (const unit of units.slice(1)) {
      expect(unit.command?.type).toBe('attackMove');
    }
  });
});

describe('AI 选路：接近轴与目标打分带补给代价', () => {
  it('两条等价轴线里，补给代价低的那条得分更高', () => {
    const world = makeWorld(bigMap());
    tickSupply(world, 1);
    const cfg = resolveAiConfig('standard', null);
    const unit = world.spawnUnit('blue', 'light', 120, 500);
    const objective = { x: 1400, y: 500 };
    const best = chooseApproach(world, { unit, objective, faction: 'blue', cfg });
    expect(best).toBeTruthy();
    expect(best.supply).toBeGreaterThan(0);
    expect(Number.isFinite(best.supply)).toBe(true);
    // 选出来的轴线端点必须还在补给可达区内（另一端会明显更贵）
    expect(withinSupply(world, 'blue', best.x, best.y, values.supply.path.maxCost)).toBe(true);
  });

  it('交战打分：同一个敌人在补给区内 vs 区外，得分不同', () => {
    const world = makeWorld(bigMap());
    tickSupply(world, 1);
    const cfg = resolveAiConfig('standard', null);
    const unit = world.spawnUnit('blue', 'light', 300, 500);
    const enemy = (x) => ({
      id: Math.round(x), x, y: 500, faction: 'red', type: 'light',
      hp: 30, maxHp: 60, state: 'hold', objective: false,
    });
    const inside = scoreAttack(world, unit, enemy(500), { cfg });
    const outside = scoreAttack(world, unit, enemy(2300), { cfg });
    expect(inside.score).toBeGreaterThan(outside.score);
  });
});
