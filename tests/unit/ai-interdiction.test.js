import { describe, expect, it } from 'vitest';
import { advance, makePlainMap, makeWorld } from './helpers.js';
import { values } from '../../src/config/index.js';
import { ScriptedAI } from '../../src/simulation/ai.js';
import { resolveAiConfig } from '../../src/simulation/ai/presets.js';
import { perceive } from '../../src/simulation/ai/perception.js';
import { approachAxes, chooseApproach, chooseWeakSpot } from '../../src/simulation/ai/front.js';
import { withinSupply } from '../../src/simulation/ai/supply.js';
import {
  corridorCandidates, cutCountAt, enemyCorridors, interdictionPlan, interdictionScore,
} from '../../src/simulation/ai/interdiction.js';
import {
  bestRetreatCity, cityThreat, reliefPlan, supplyUserCounts, supplyUsers,
} from '../../src/simulation/ai/relief.js';

// AI 的补给战术（docs/ai-design.md §3.8）：
//   · 断敌粮道：敌补给线 = 敌单位 → 它最近的敌城（公开信息），把部队插到那条走廊上就真的能掐断
//     （supplyPath 的敌方控制区掩码按 unit.influenceRadius = 140 判定）；
//     软权重 ai.weights.interdiction 影响接近轴/薄弱点，闲置的预备队去守那个点；
//   · 护己粮道：己城被围且它在养兵 → 预备队解围；撤退选城避开被围的城。
//   · 公平：走廊只用**看得见**的敌单位（记忆里的旧坐标不算），绝不读 supplyFields[敌]。

const STEP = values.simulation.fixedStep;

// 蓝城西南、红城东北：中间的空地就是红方补给走廊的必经之处
function corridorMap() {
  return makePlainMap({
    width: 2400,
    height: 1000,
    cities: [
      { id: 'c1', x: 120, y: 500, faction: 'blue' },
      { id: 'c2', x: 2280, y: 500, faction: 'red' },
    ],
    spawns: [
      { faction: 'blue', x: 120, y: 500 },
      { faction: 'red', x: 2280, y: 500 },
    ],
  });
}

// 两座蓝城（c1 西、c3 东）：用来测"撤退避开被围的城"
function twoCityMap() {
  return makePlainMap({
    width: 2400,
    height: 1000,
    cities: [
      { id: 'c1', x: 120, y: 500, faction: 'blue' },
      { id: 'c3', x: 800, y: 500, faction: 'blue' },
      { id: 'c2', x: 2280, y: 500, faction: 'red' },
    ],
    spawns: [
      { faction: 'blue', x: 120, y: 500 },
      { faction: 'red', x: 2280, y: 500 },
    ],
  });
}

const cfg = () => resolveAiConfig('standard', null);

describe('断敌粮道：走廊识别', () => {
  it('走廊 = 看得见的敌单位 → 它最近的敌城；记忆条目 / 城边敌人 / 无城的敌人都不算', () => {
    const world = makeWorld(corridorMap());
    world.spawnUnit('red', 'light', 1500, 450);
    world.spawnUnit('red', 'light', 1500, 550);
    const atCity = world.spawnUnit('red', 'light', 2240, 500); // 就在城边：走廊 < minCorridor
    const knowns = perceive(world, 'blue', cfg(), false);

    const corridors = enemyCorridors(world, 'blue', knowns, cfg());
    expect(corridors).toHaveLength(2);
    expect(corridors.map(c => c.cityId)).toEqual(['c2', 'c2']);
    expect(corridors.every(c => c.by === 500 && c.bx === 2280)).toBe(true);
    expect(corridors.every(c => c.power > 0)).toBe(true);
    expect(corridors.some(c => c.unitId === atCity.id)).toBe(false);

    // 记忆里的旧坐标（ghost）不能当粮道：公平模式下 AI 只认看得见的
    const ghosts = [{ id: 999, faction: 'red', x: 1500, y: 500, confidence: 0.8, ghost: true }];
    expect(enemyCorridors(world, 'blue', ghosts, cfg())).toHaveLength(0);

    // 敌城全丢（没有敌城）→ 没有粮道可断
    world.cities = world.cities.filter(city => city.faction !== 'red');
    expect(enemyCorridors(world, 'blue', knowns, cfg())).toHaveLength(0);
  });

  it('cutCountAt：这一点压得住几条走廊（cutRadius 内即算）', () => {
    const world = makeWorld(corridorMap());
    world.spawnUnit('red', 'light', 1500, 250); // 单独一条，离其他两条足够远
    world.spawnUnit('red', 'light', 1500, 450);
    world.spawnUnit('red', 'light', 1500, 550);
    const corridors = enemyCorridors(world, 'blue', perceive(world, 'blue', cfg(), false), cfg());
    expect(corridors).toHaveLength(3);

    expect(cutCountAt({ x: 1500, y: 250 }, corridors)).toBe(1); // 只在自己那条上
    expect(cutCountAt({ x: 1500, y: 500 }, corridors)).toBe(2); // 两条并肩的走廊：一起掐断
    expect(cutCountAt({ x: 1200, y: 900 }, corridors)).toBe(0); // 哪儿都不挨
  });
});

describe('断敌粮道：方案', () => {
  it('两条并行走廊 → 出方案：点同时压住两条，且落在最近的那座敌城方向上', () => {
    const world = makeWorld(corridorMap());
    world.spawnUnit('red', 'light', 1500, 450);
    world.spawnUnit('red', 'light', 1500, 550);
    advance(world, 1); // 让补给场/空间网格就绪
    const knowns = perceive(world, 'blue', cfg(), false);

    const plan = interdictionPlan(world, 'blue', { cfg: cfg(), knowns, from: { x: 1200, y: 500 } });
    expect(plan).toBeTruthy();
    expect(plan.cuts).toBe(2);
    expect(plan.cityId).toBe('c2');
    // 采样点在"单位 → 城"这条线上（走廊中点附近），不在单位脚下也不在城下
    expect(plan.x).toBeGreaterThan(1500);
    expect(plan.x).toBeLessThan(2280);
    expect(cutCountAt(plan, plan.corridors)).toBe(plan.cuts);
    expect(plan.score).toBeGreaterThan(0);
  });

  it('走廊够不着 / 只有一条 → 不出方案（照旧打正面）；距离门槛是硬约束', () => {
    const world = makeWorld(corridorMap());
    world.spawnUnit('red', 'light', 1500, 450);
    world.spawnUnit('red', 'light', 1500, 550);
    advance(world, 1);
    const knowns = perceive(world, 'blue', cfg(), false);
    const options = { cfg: cfg(), knowns };

    // 太远（> maxDistance）：所有候选点都在 900px 之外 → 等走到了仗已经打完
    expect(interdictionPlan(world, 'blue', { ...options, from: { x: 400, y: 500 } })).toBeNull();
    // 贴着自己（< minDistance）的候选点会被跳过，但走廊另一端仍然可用：距离门槛是硬约束
    const near = interdictionPlan(world, 'blue', { ...options, from: { x: 2040, y: 500 } });
    expect(near).toBeTruthy();
    expect(Math.hypot(near.x - 2040, near.y - 500))
      .toBeGreaterThanOrEqual(values.ai.interdiction.minDistance);
    // 只有一条走廊：压住一条只是顺手的事，不值得为它改方向
    world.units = world.units.filter(unit => !(unit.faction === 'red' && unit.y === 550));
    const single = perceive(world, 'blue', cfg(), false);
    expect(single).toHaveLength(1);
    expect(interdictionPlan(world, 'blue', { cfg: cfg(), knowns: single, from: { x: 1200, y: 500 } })).toBeNull();
  });

  it('公平：只认看得见的情报，且不读敌方的补给代价场', () => {
    const world = makeWorld(corridorMap());
    world.spawnUnit('red', 'light', 1500, 450);
    world.spawnUnit('red', 'light', 1500, 550);
    advance(world, 1);
    const knowns = perceive(world, 'blue', cfg(), false);
    const before = interdictionPlan(world, 'blue', { cfg: cfg(), knowns, from: { x: 1200, y: 500 } });
    expect(before).toBeTruthy();

    // 把敌方的代价场彻底删掉：结果必须一模一样（AI 的断粮判断不依赖它）
    delete world.supplyFields.red;
    const after = interdictionPlan(world, 'blue', { cfg: cfg(), knowns, from: { x: 1200, y: 500 } });
    expect(after).toEqual(before);

    // 只看得到记忆（ghost）：不出方案
    const ghosts = knowns.map(item => ({ ...item, ghost: true }));
    expect(interdictionPlan(world, 'blue', { cfg: cfg(), knowns: ghosts, from: { x: 1200, y: 500 } })).toBeNull();
  });

  it('确定性：同样输入两次得到同一个方案', () => {
    const world = makeWorld(corridorMap());
    world.spawnUnit('red', 'light', 1500, 450);
    world.spawnUnit('red', 'light', 1500, 550);
    world.spawnUnit('red', 'light', 1600, 500);
    advance(world, 1);
    const knowns = perceive(world, 'blue', cfg(), false);
    const first = interdictionPlan(world, 'blue', { cfg: cfg(), knowns, from: { x: 1200, y: 500 } });
    const second = interdictionPlan(world, 'blue', { cfg: cfg(), knowns, from: { x: 1200, y: 500 } });
    expect(second).toEqual(first);
    // 候选点顺序也稳定（走廊按敌单位 id 排序）
    expect(corridorCandidates(enemyCorridors(world, 'blue', knowns, cfg()), cfg()).map(p => p.cityId))
      .toEqual(corridorCandidates(enemyCorridors(world, 'blue', knowns, cfg()), cfg()).map(p => p.cityId));
  });

  it('interdictionScore：压在走廊上的点得分最高，远离走廊 = 0，没有方案 = 0', () => {
    const world = makeWorld(corridorMap());
    world.spawnUnit('red', 'light', 1500, 450);
    world.spawnUnit('red', 'light', 1500, 550);
    advance(world, 1);
    const knowns = perceive(world, 'blue', cfg(), false);
    const plan = interdictionPlan(world, 'blue', { cfg: cfg(), knowns, from: { x: 1200, y: 500 } });

    expect(interdictionScore({ x: plan.x, y: plan.y }, plan)).toBe(1);
    expect(interdictionScore({ x: 1500, y: 500 }, plan)).toBeGreaterThan(0);
    expect(interdictionScore({ x: 1500, y: 500 }, plan)).toBeLessThan(1); // 两条走廊中间：压得住但不够贴
    expect(interdictionScore({ x: 1500, y: 900 }, plan)).toBe(0);
    expect(interdictionScore({ x: 1500, y: 500 }, null)).toBe(0);
  });
});

describe('断敌粮道：接入接近轴与薄弱点', () => {
  it('断粮项只加在"压得住走廊的那条轴"上：同一条轴有方案 > 没方案，无关的轴分数不变', () => {
    const world = makeWorld(corridorMap());
    advance(world, 1);
    const unit = world.spawnUnit('blue', 'light', 1000, 500);
    const objective = { x: 1400, y: 500 };
    const config = cfg();
    const axes = approachAxes(objective, { x: unit.x, y: unit.y }, config);
    const side = axes.find(axis => axis.index === 0);
    // 造三条横穿侧翼轴端点的敌走廊（index 0 命中，"对面"那条 index 2 在 208px 外，够不着）
    const corridors = [-40, 0, 40].map(offset => ({
      unitId: 1, ax: side.x - 60, ay: side.y + offset, bx: side.x + 60, by: side.y + offset, cityId: 'c2', power: 1,
    }));
    const plan = { x: side.x, y: side.y, cuts: 3, corridors };
    const only = (index, interdiction) => chooseApproach(world, {
      unit,
      objective,
      faction: 'blue',
      cfg: config,
      interdiction,
      taken: new Set(axes.filter(axis => axis.index !== index).map(axis => axis.index)),
    });

    expect(only(0, null).interdict).toBe(0);
    expect(only(0, plan).interdict).toBe(1);
    expect(only(0, plan).score).toBeGreaterThan(only(0, null).score);

    expect(only(2, plan).interdict).toBe(0);
    expect(only(2, plan).score).toBeCloseTo(only(2, null).score, 10);
  });

  it('断粮权重够大时，接近轴会真的偏向压得住走廊的那一侧', () => {
    const world = makeWorld(corridorMap());
    advance(world, 1);
    // 离目标足够远：三条轴的距离项都被夹成 0，剩下的差别只有断粮项与补给项
    const unit = world.spawnUnit('blue', 'light', 600, 500);
    const objective = { x: 1400, y: 500 };
    const config = cfg();
    const side = approachAxes(objective, { x: unit.x, y: unit.y }, config).find(axis => axis.index === 0);
    const corridors = [-40, 0, 40].map(offset => ({
      unitId: 1, ax: side.x - 60, ay: side.y + offset, bx: side.x + 60, by: side.y + offset, cityId: 'c2', power: 1,
    }));
    const plan = { x: side.x, y: side.y, cuts: 3, corridors };

    const unbiased = chooseApproach(world, { unit, objective, faction: 'blue', cfg: config });
    const biased = chooseApproach(world, { unit, objective, faction: 'blue', cfg: config, interdiction: plan });
    expect(biased.index).toBe(0);
    expect(biased.interdict).toBe(1);
    expect(biased.score).toBeGreaterThan(unbiased.score);
  });

  it('chooseWeakSpot 接受断粮方案：返回值带 interdict，分数不降', () => {
    const world = makeWorld(corridorMap());
    advance(world, 1);
    world.spawnUnit('blue', 'light', 700, 500);
    const objective = { x: 1400, y: 500 };
    const plan = { x: 900, y: 500, cuts: 1, corridors: [{ unitId: 1, ax: 900, ay: 480, bx: 900, by: 520, cityId: 'c2', power: 1 }] };
    const plain = chooseWeakSpot(world, { objective, faction: 'blue', cfg: cfg() });
    const biased = chooseWeakSpot(world, { objective, faction: 'blue', cfg: cfg(), interdiction: plan });
    if (plain) expect(biased.score).toBeGreaterThanOrEqual(plain.score);
    if (biased) expect(biased.interdict).toBeGreaterThanOrEqual(0);
  });
});

describe('护己方粮道：解围', () => {
  it('supplyUsers：按"欧氏最近己城"统计这座城养着几个兵', () => {
    const world = makeWorld(twoCityMap());
    const west = world.spawnUnit('blue', 'light', 200, 500);
    const west2 = world.spawnUnit('blue', 'light', 260, 500);
    const east = world.spawnUnit('blue', 'light', 760, 500);
    const counts = supplyUserCounts(world, 'blue');
    expect(counts.get('c1')).toBe(2);
    expect(counts.get('c3')).toBe(1);
    expect(supplyUsers(world, 'blue', world.cities.find(c => c.id === 'c1'))).toBe(2);
    expect([west, west2, east].every(unit => unit.state !== 'dead')).toBe(true);
  });

  it('cityThreat：看得见的敌军围城 或 正在被夺（captureProgress）都算被围', () => {
    const world = makeWorld(twoCityMap());
    const city = world.cities.find(c => c.id === 'c1');
    world.spawnUnit('red', 'light', 250, 500); // 距离 130 < threatRadius 200
    const knowns = perceive(world, 'blue', cfg(), false);
    const threat = cityThreat(world, 'blue', city, { cfg: cfg(), knowns });
    expect(threat.threatened).toBe(true);
    expect(threat.enemyCount).toBe(1);
    expect(threat.enemyPower).toBeGreaterThan(0);
    expect(threat.center).toEqual({ x: 250, y: 500 }); // 围城敌军的形心：解围就打这里

    // 看不到敌人（公平模式下的空情报）→ 但正在被夺，仍然算被围（公开信息），只是没有"人"可打
    city.captureProgress = 15;
    const blind = cityThreat(world, 'blue', city, { cfg: cfg(), knowns: [] });
    expect(blind.threatened).toBe(true);
    expect(blind.center).toBeNull();

    // 既看不到敌人也没被夺：安好
    const safe = world.cities.find(c => c.id === 'c3');
    expect(cityThreat(world, 'blue', safe, { cfg: cfg(), knowns: [] }).threatened).toBe(false);
  });

  it('reliefPlan：被围 + 养着兵 → 压向围城敌军；只看得到"正在被夺"时停在城外 standoff', () => {
    const world = makeWorld(corridorMap());
    const city = world.cities.find(c => c.id === 'c1');
    const besieger = world.spawnUnit('red', 'light', 250, 500);
    const pool = [400, 440, 480].map(x => world.spawnUnit('blue', 'light', x, 500));
    advance(world, 1);

    const plan = reliefPlan(world, 'blue', {
      cfg: cfg(), knowns: perceive(world, 'blue', cfg(), false), units: pool, from: { x: 460, y: 500 },
    });
    expect(plan).toBeTruthy();
    expect(plan.city.id).toBe('c1');
    expect(plan.users).toBe(3);
    expect(plan.x).toBeCloseTo(besieger.x, 6); // 看得见人 → 直接去打围城的那个
    expect(plan.y).toBeCloseTo(besieger.y, 6);
    expect(plan.enemyCount).toBe(1);
    expect(plan.score).toBeGreaterThan(0);

    // 看不到人、只有 captureProgress：停在城外 standoff（从分队来的方向），不撞进占领圈
    city.captureProgress = 20;
    const blind = reliefPlan(world, 'blue', {
      cfg: cfg(), knowns: [], units: pool, from: { x: 460, y: 500 },
    });
    expect(blind).toBeTruthy();
    expect(blind.x).toBeCloseTo(city.x + values.ai.relief.standoff, 6);
    expect(blind.y).toBeCloseTo(500, 6);
    expect(blind.enemyCount).toBe(0);
  });

  it('reliefPlan：不值得救的城 / 打不过 / 太远 → 不出方案（预备队原地待命）', () => {
    // 不值得救：城里只养着一个兵（users < minUsers）、也没有运力输出 → 丢了也断不了粮
    const lonelyWorld = makeWorld(corridorMap());
    lonelyWorld.spawnUnit('red', 'light', 250, 500);
    const lonely = [lonelyWorld.spawnUnit('blue', 'light', 400, 500)];
    advance(lonelyWorld, 1);
    expect(reliefPlan(lonelyWorld, 'blue', {
      cfg: cfg(), knowns: perceive(lonelyWorld, 'blue', cfg(), false), units: lonely, from: { x: 400, y: 500 },
    })).toBeNull();

    // 打不过 / 太远
    const world = makeWorld(corridorMap());
    const city = world.cities.find(c => c.id === 'c1');
    world.spawnUnit('red', 'light', 250, 500);
    const pool = [400, 440].map(x => world.spawnUnit('blue', 'light', x, 500));
    advance(world, 1);
    const knowns = perceive(world, 'blue', cfg(), false);
    const options = { cfg: cfg(), knowns, units: pool, from: { x: 460, y: 500 } };

    // 围城敌军太强（分队战力 < 敌军 × forceRatio）→ 不送人头，等主力
    for (let i = 0; i < 8; i += 1) world.spawnUnit('red', 'heavy', 220 + i * 8, 420);
    const strong = perceive(world, 'blue', cfg(), false);
    expect(reliefPlan(world, 'blue', { ...options, knowns: strong })).toBeNull();
    // 太远（> maxDistance）→ 等走到城已经丢了
    expect(reliefPlan(world, 'blue', { ...options, from: { x: city.x + values.ai.relief.maxDistance + 100, y: 500 } })).toBeNull();
    // 城里一个兵都没有：养兵数 0，但被围 → 仍不出方案
    world.units = world.units.filter(unit => unit.faction !== 'blue');
    expect(reliefPlan(world, 'blue', { ...options })).toBeNull();
  });

  it('bestRetreatCity：照旧选代价最低的城；它被围时改挑没被围的；全被围时挑罚分后最优', () => {
    const world = makeWorld(twoCityMap());
    advance(world, 1);
    const from = { x: 500, y: 500 };
    // 没有威胁：与旧行为一致（补给代价最低的城：c3 距离 300 < c1 的 380）
    expect(bestRetreatCity(world, 'blue', from.x, from.y, { cfg: cfg(), knowns: [] }).id).toBe('c3');

    // c3 被围（看得见的敌军）→ 改退没被围的 c1
    world.spawnUnit('red', 'light', 800, 400);
    const knowns = perceive(world, 'blue', cfg(), false);
    expect(bestRetreatCity(world, 'blue', from.x, from.y, { cfg: cfg(), knowns }).id).toBe('c1');

    // 两座城都被围：罚分相同，于是仍然挑代价更低的 c3（300+400 < 380+400）
    world.spawnUnit('red', 'light', 200, 500);
    const both = perceive(world, 'blue', cfg(), false);
    expect(bestRetreatCity(world, 'blue', from.x, from.y, { cfg: cfg(), knowns: both }).id).toBe('c3');
  });
});

describe('行为：预备队真的去护粮道 / 断粮道', () => {
  function engageScript(objective) {
    return {
      rules: [{ when: { time: 0 }, then: [{ type: 'engage', target: objective, units: { group: 'main' } }] }],
    };
  }

  function squad(world, xs, y = 500) {
    return xs.map((x, index) => {
      const unit = world.spawnUnit('blue', 'light', x, y + (index % 2) * 20);
      unit.group = 'main';
      return unit;
    });
  }

  it('己城被围 → 预备队领到解围任务（而不是在主力后方干等）', () => {
    const world = makeWorld(corridorMap());
    const units = squad(world, [300, 340, 380, 420, 460, 500]);
    world.spawnUnit('red', 'light', 250, 500); // 围着蓝城 c1
    // 目标方向有守军：这样"我方优势已经很大"不成立，预备队才会真的留着（否则会提前投入正面）
    world.spawnUnit('red', 'light', 2000, 480);
    world.spawnUnit('red', 'light', 2000, 520);
    advance(world, 1);

    const ai = new ScriptedAI(world, {
      faction: 'blue',
      script: { ...engageScript({ x: 2200, y: 500 }), preset: 'standard', tuning: { reserveRatio: 0.5 } },
    });
    ai.update(STEP);
    ai.update(values.ai.decisionIntervalSeconds);

    const labels = [...ai.lastOrders.values()];
    expect(labels.some(label => label.startsWith('relief:c1'))).toBe(true);
    expect(labels.some(label => label.startsWith('interdict:'))).toBe(false); // 解围优先
    // 解围 = 压向围城的那几个敌人（不是站在城外干看）
    for (const unit of units) {
      const label = ai.lastOrders.get(unit.id) ?? '';
      if (!label.startsWith('relief:')) continue;
      const end = unit.route.at(-1);
      expect(Math.hypot(end.x - 250, end.y - 500)).toBeLessThan(20);
    }
  });

  it('敌方走廊可断 → 预备队去压那个点，且目标必须还在己方补给可达区内', () => {
    const world = makeWorld(corridorMap());
    const units = squad(world, [1100, 1140, 1180, 1220, 1260, 1300]);
    world.spawnUnit('red', 'light', 1500, 450); // 两条可断的补给走廊
    world.spawnUnit('red', 'light', 1500, 550);
    world.spawnUnit('red', 'light', 2000, 480); // 目标方向守军：预备队不会被提前投入正面
    world.spawnUnit('red', 'light', 2000, 520);
    advance(world, 1);

    const ai = new ScriptedAI(world, {
      faction: 'blue',
      script: { ...engageScript({ x: 2200, y: 500 }), preset: 'standard', tuning: { reserveRatio: 0.5 } },
    });
    ai.update(STEP);
    ai.update(values.ai.decisionIntervalSeconds);

    const labels = [...ai.lastOrders.values()];
    expect(labels.some(label => label.startsWith('interdict:'))).toBe(true);
    for (const unit of units) {
      const label = ai.lastOrders.get(unit.id) ?? '';
      if (!label.startsWith('interdict:')) continue;
      const end = unit.route.at(-1);
      // 断人粮道不能先把自己断了：目标点仍在己方补给可达区内
      expect(withinSupply(world, 'blue', end.x, end.y, values.supply.path.maxCost)).toBe(true);
    }
  });

  it('没有解围/断粮任务时，预备队照旧在主力后方待命（旧行为不变）', () => {
    const world = makeWorld(corridorMap());
    const units = squad(world, [300, 340, 380, 420, 460, 500]);
    // 敌人缩在自家城边（走廊太短，断不了）+ 目标方向有守军（预备队留着）→ 没有任务可领
    world.spawnUnit('red', 'light', 2100, 500);
    advance(world, 1);

    const ai = new ScriptedAI(world, {
      faction: 'blue',
      script: { ...engageScript({ x: 2200, y: 500 }), preset: 'standard', tuning: { reserveRatio: 0.5 } },
    });
    ai.update(STEP);
    ai.update(values.ai.decisionIntervalSeconds);

    const reserveLabels = units
      .map(unit => ai.lastOrders.get(unit.id) ?? '')
      .filter(label => label === 'reserve-hold' || label.startsWith('reserve:'));
    expect(reserveLabels.length).toBeGreaterThan(0);
    for (const label of ai.lastOrders.values()) {
      expect(label.startsWith('relief:')).toBe(false);
      expect(label.startsWith('interdict:')).toBe(false);
    }
  });

  it('ai.tuning 把断粮权重调成 0 → 整套补给战术关闭（旧行为）', () => {
    const world = makeWorld(corridorMap());
    const units = squad(world, [1100, 1140, 1180, 1220, 1260, 1300]);
    world.spawnUnit('red', 'light', 1500, 450); // 本来是一条可断的走廊
    world.spawnUnit('red', 'light', 1500, 550);
    world.spawnUnit('red', 'light', 2000, 480);
    world.spawnUnit('red', 'light', 2000, 520);
    advance(world, 1);

    const ai = new ScriptedAI(world, {
      faction: 'blue',
      script: {
        ...engageScript({ x: 2200, y: 500 }),
        preset: 'standard',
        tuning: { reserveRatio: 0.5, weights: { interdiction: 0 } },
      },
    });
    ai.update(STEP);
    ai.update(values.ai.decisionIntervalSeconds);

    expect(ai.cfg.weights.interdiction).toBe(0);
    expect(values.ai.weights.interdiction).toBe(0.2); // values 本身没被改
    const labels = [...ai.lastOrders.values()];
    expect(labels.some(label => label.startsWith('interdict:'))).toBe(false);
    // 预备队退回"主力后方待命"的老行为
    expect(labels.some(label => label === 'reserve-hold' || label.startsWith('reserve:'))).toBe(true);
  });
});
