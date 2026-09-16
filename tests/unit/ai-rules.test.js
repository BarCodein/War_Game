import { describe, expect, it } from 'vitest';
import { ScriptedAI } from '../../src/simulation/ai.js';
import { deployForces } from '../../src/simulation/level.js';
import { moveCommand } from '../../src/simulation/commands.js';
import { makePlainMap, makeWorld } from './helpers.js';

// 条件规则（gdd.md §10）：敌军脚本可以"看局势"下命令——
// 条件成立走 then、不成立走 otherwise，且**只在条件翻转时**下发一次（不每帧刷命令）。
function makeWorldWithPoint() {
  const world = makeWorld(makePlainMap({
    width: 1000,
    height: 600,
    cities: [
      { id: 'c1', x: 100, y: 300, faction: 'red' },
      { id: 'c2', x: 900, y: 300, faction: 'blue' },
    ],
    capturePoints: [{ id: 'p1', x: 500, y: 300, faction: 'red' }],
  }));
  const red = world.spawnUnit('red', 'light', 480, 300);
  world.spawnUnit('blue', 'light', 900, 300);
  return { world, red };
}

// 记录下发次数，用来验证"只在条件变化时下发"
function spyOnCommands(world) {
  const issued = [];
  const original = world.issueCommands.bind(world);
  world.issueCommands = (ids, command) => {
    issued.push({ ids: [...ids], command });
    return original(ids, command);
  };
  return issued;
}

const holdOrRetreat = {
  id: 'hold-or-retreat',
  when: { capturePoint: 'p1', owner: 'self' },
  then: [{ type: 'hold' }],
  otherwise: [{ type: 'retreat', to: { cityId: 'c1' } }],
};

describe('AI 条件规则', () => {
  it('首次求值就下发当前分支：占领点在手 → 坚守', () => {
    const { world, red } = makeWorldWithPoint();
    const ai = new ScriptedAI(world, { faction: 'red', script: { rules: [holdOrRetreat] } });
    const issued = spyOnCommands(world);

    ai.update(1 / 60);
    expect(issued).toHaveLength(1);
    expect(issued[0].command.type).toBe('hold');
    expect(issued[0].ids).toEqual([red.id]);
    expect(red.command.type).toBe('hold');
  });

  it('占领点丢失 → 撤退到指定城市；重新夺回 → 再坚守', () => {
    const { world, red } = makeWorldWithPoint();
    const ai = new ScriptedAI(world, { faction: 'red', script: { rules: [holdOrRetreat] } });
    world.capturePoints[0].faction = 'blue'; // 丢了
    const issued = spyOnCommands(world);

    ai.update(1 / 60);
    expect(issued).toHaveLength(1);
    expect(issued[0].command.type).toBe('move');
    expect(red.command.type).toBe('move');
    expect(red.route.at(-1)).toEqual({ x: 100, y: 300 }); // 撤向 c1

    // 再夺回来 → 条件翻转 → 下发 hold
    issued.length = 0;
    world.capturePoints[0].faction = 'red';
    ai.update(1 / 60);
    expect(issued).toHaveLength(1);
    expect(issued[0].command.type).toBe('hold');
  });

  it('条件没变化时不重复下发（避免每帧重置行军路线）', () => {
    const { world } = makeWorldWithPoint();
    const ai = new ScriptedAI(world, { faction: 'red', script: { rules: [holdOrRetreat] } });
    const issued = spyOnCommands(world);

    for (let i = 0; i < 120; i += 1) ai.update(1 / 60); // 2 秒
    expect(issued).toHaveLength(1); // 只有首次那一次
  });

  it('owner 支持 self / enemy / neutral / 绝对阵营', () => {
    const { world } = makeWorldWithPoint();
    const ai = new ScriptedAI(world, { faction: 'red', script: { rules: [] } });
    expect(ai.conditionMet({ capturePoint: 'p1', owner: 'self' }, { persistent: true })).toBe(true);
    expect(ai.conditionMet({ capturePoint: 'p1', owner: 'enemy' }, { persistent: true })).toBe(false);
    expect(ai.conditionMet({ capturePoint: 'p1', owner: 'neutral' }, { persistent: true })).toBe(false);
    expect(ai.conditionMet({ capturePoint: 'p1', owner: 'red' }, { persistent: true })).toBe(true);

    world.capturePoints[0].faction = 'neutral';
    expect(ai.conditionMet({ capturePoint: 'p1', owner: 'neutral' }, { persistent: true })).toBe(true);
    expect(ai.conditionMet({ capturePoint: 'p1', owner: 'self' }, { persistent: true })).toBe(false);
    // 城市同样支持
    expect(ai.conditionMet({ city: 'c1', owner: 'self' }, { persistent: true })).toBe(true);
    expect(ai.conditionMet({ city: 'c9', owner: 'self' }, { persistent: true })).toBe(false);
  });

  it('兵力对比条件：ownUnitsBelow / enemyUnitsBelow', () => {
    const { world } = makeWorldWithPoint();
    const ai = new ScriptedAI(world, { faction: 'red', script: { rules: [] } });
    expect(ai.conditionMet({ ownUnitsBelow: 2 }, { persistent: true })).toBe(true);  // 红光杆 1 个
    expect(ai.conditionMet({ ownUnitsBelow: 1 }, { persistent: true })).toBe(false);
    expect(ai.conditionMet({ enemyUnitsBelow: 2 }, { persistent: true })).toBe(true); // 蓝也 1 个
  });

  it('retreat 省略 to 时撤向最近的己方城市；无城可退则原地驻守', () => {
    const { world } = makeWorldWithPoint();
    const ai = new ScriptedAI(world, { faction: 'red', script: {} });
    const issued = spyOnCommands(world);
    ai.doRetreat();
    expect(issued[0].command.type).toBe('move');
    expect(issued[0].command.path.at(-1)).toEqual({ x: 100, y: 300 });

    issued.length = 0;
    world.cities = world.cities.filter(city => city.faction !== 'red');
    ai.doRetreat();
    expect(issued[0].command.type).toBe('hold');
  });

  it('规则支持单条动作对象；没有 otherwise 时条件不成立就什么都不做', () => {
    const { world } = makeWorldWithPoint();
    const ai = new ScriptedAI(world, {
      faction: 'red',
      script: { rules: [{ when: { capturePoint: 'p1', owner: 'self' }, then: { type: 'hold' } }] },
    });
    const issued = spyOnCommands(world);
    ai.update(1 / 60);
    expect(issued).toHaveLength(1);
    expect(issued[0].command.type).toBe('hold');

    issued.length = 0;
    world.capturePoints[0].faction = 'blue';
    ai.update(1 / 60);
    expect(issued).toHaveLength(0);
  });

  it('生效时间窗 after / until：窗口外不下发，进窗那一刻才判定', () => {
    const { world, red } = makeWorldWithPoint();
    world.capturePoints[0].faction = 'blue'; // 还没拿下
    const ai = new ScriptedAI(world, {
      faction: 'red',
      script: {
        rules: [{
          after: 10,
          until: 20,
          when: { capturePoint: 'p1', owner: 'self' },
          then: [{ type: 'hold' }],
          otherwise: [{ type: 'retreat', to: { cityId: 'c1' } }],
        }],
      },
    });
    const issued = spyOnCommands(world);

    ai.update(9);                     // 窗口前：完全不动
    expect(issued).toHaveLength(0);
    expect(red.command).toBeNull();

    ai.update(1.5);                   // 进窗 → 判定"没拿下" → 撤退
    expect(issued).toHaveLength(1);
    expect(issued[0].command.type).toBe('move');

    issued.length = 0;
    world.capturePoints[0].faction = 'red'; // 窗口内夺回 → 翻转 → 坚守
    ai.update(1);
    expect(issued.at(-1).command.type).toBe('hold');

    // 窗口内再反转一次仍会下发；跑过 until 之后彻底静默
    world.capturePoints[0].faction = 'blue';
    ai.update(1);
    expect(issued).toHaveLength(2);
    issued.length = 0;
    ai.update(20);                    // t ≈ 32.5 > until(20)
    expect(issued).toHaveLength(0);
    world.capturePoints[0].faction = 'red';
    ai.update(5);
    expect(issued).toHaveLength(0);
  });

  it('repeatEvery：条件成立期间周期重发 then（持续施压），条件不成立时不重发', () => {
    const { world } = makeWorldWithPoint();
    world.capturePoints[0].faction = 'blue';
    const ai = new ScriptedAI(world, {
      faction: 'red',
      script: {
        rules: [{
          repeatEvery: 5,
          when: { capturePoint: 'p1', owner: 'enemy' },
          then: [{ type: 'hold' }], // 用 hold：不依赖空间网格（attackNearest 需要 spatial.rebuild）
        }],
      },
    });
    const issued = spyOnCommands(world);
    ai.update(1);                     // 首次求值 → 立刻一次
    expect(issued).toHaveLength(1);
    ai.update(4.5);
    expect(issued).toHaveLength(1);   // 还没到 5 秒
    ai.update(1);
    expect(issued).toHaveLength(2);   // 满 5 秒重发
    ai.update(10);
    expect(issued).toHaveLength(3);   // 一次 update 最多补发一次（不做追帧补发）

    issued.length = 0;
    world.capturePoints[0].faction = 'red'; // 条件不成立 → 不再重发
    ai.update(1);
    expect(issued).toHaveLength(0);
    ai.update(20);
    expect(issued).toHaveLength(0);
  });

  it('据点条件支持 id 数组：任意一个归属符合即成立', () => {
    const { world } = makeWorldWithPoint();
    const ai = new ScriptedAI(world, { faction: 'red', script: { rules: [] } });
    world.capturePoints[0].faction = 'blue';
    expect(ai.conditionMet({ capturePoint: ['p1', 'p3'], owner: 'self' }, { persistent: true })).toBe(false);
    world.capturePoints[0].faction = 'red';
    expect(ai.conditionMet({ capturePoint: ['p1', 'p3'], owner: 'self' }, { persistent: true })).toBe(true);
    // 不存在的 id 不会误判为成立
    expect(ai.conditionMet({ capturePoint: ['p9'], owner: 'self' }, { persistent: true })).toBe(false);
  });

  it('attackMove 动作支持 forced（急行军），与触发器共用同一套动作', () => {
    const { world, red } = makeWorldWithPoint();
    const ai = new ScriptedAI(world, {
      faction: 'red',
      script: { triggers: [{ at: { time: 0 }, actions: [{ type: 'attackMove', target: { x: 800, y: 300 }, forced: true }] }] },
    });
    ai.update(1 / 60);
    expect(red.command.type).toBe('attackMove');
    expect(red.command.forced).toBe(true);
    expect(red.forcedMarch).toBe(true);
  });

  it('触发器仍然照旧工作（回归：time / enemyCrossX 走原有语义）', () => {
    const { world } = makeWorldWithPoint();
    const ai = new ScriptedAI(world, {
      faction: 'red',
      script: {
        triggers: [
          { id: 't1', at: { time: 5 }, actions: [{ type: 'hold' }] },
          { id: 't2', at: { enemyCrossX: 600 }, actions: [{ type: 'attackNearest' }] },
        ],
        fallback: { x: 900, y: 300 },
      },
    });
    const issued = spyOnCommands(world);
    ai.update(4);
    // enemyCrossX 触发器一开场就满足（蓝军在 x=900 ≥ 600）→ 立刻 attackNearest 一次；
    // time 触发器还没到 5 秒，所以只应该有这一条
    expect(issued).toHaveLength(1);
    expect(issued[0].command.type).toBe('attackMove');
    expect(ai.triggers[0].active).toBe(false);
    ai.update(1.1);
    expect(issued.at(-1).command.type).toBe('hold');
    // 触发器条件不参与"持久条件"（capturePoint 等只在规则里生效）
    expect(ai.conditionMet({ capturePoint: 'p1', owner: 'self' })).toBe(false);
  });
});

describe('AI 只指挥一部分单位（units: { group }）', () => {
  // 两个红方编队：north / south（关卡里由 forces[].group 打标签，这里直接写 unit.group）
  function makeTwoGroups() {
    const { world, red } = makeWorldWithPoint();
    const south = world.spawnUnit('red', 'light', 520, 340);
    red.group = 'north';
    south.group = 'south';
    return { world, north: red, south };
  }

  it('带 group 的动作只作用于该编队：同阵营的另一支编队保持原命令', () => {
    const { world, north, south } = makeTwoGroups();
    world.issueCommands([north.id, south.id], moveCommand([{ x: 900, y: 300 }])); // 旧命令
    const ai = new ScriptedAI(world, {
      faction: 'red',
      script: {
        triggers: [{
          at: { time: 0 },
          actions: [{ type: 'hold', units: { group: 'north' } }],
        }],
      },
    });
    ai.update(1 / 60);
    expect(north.command.type).toBe('hold');
    expect(north.route).toEqual([]);
    expect(south.command.type).toBe('move'); // 南线不受影响
    expect(south.route.length).toBeGreaterThan(0);
  });

  it('省略 units = 全军（向后兼容，回归）', () => {
    const { world, north, south } = makeTwoGroups();
    const ai = new ScriptedAI(world, {
      faction: 'red',
      script: { triggers: [{ at: { time: 0 }, actions: [{ type: 'hold' }] }] },
    });
    ai.update(1 / 60);
    expect(north.command.type).toBe('hold');
    expect(south.command.type).toBe('hold');
  });

  it('选不到任何单位时什么都不做（不算错误）', () => {
    const { world, north, south } = makeTwoGroups();
    world.issueCommands([north.id, south.id], moveCommand([{ x: 900, y: 300 }]));
    const ai = new ScriptedAI(world, {
      faction: 'red',
      script: { triggers: [{ at: { time: 0 }, actions: [{ type: 'hold', units: { group: 'ghost' } }] }] },
    });
    const issued = spyOnCommands(world);
    ai.update(1 / 60);
    expect(issued).toHaveLength(0);
    expect(north.command.type).toBe('move');
    expect(south.command.type).toBe('move');
  });

  it('retreat / attackMove 同样支持 units 选择器', () => {
    const { world, north, south } = makeTwoGroups();
    const ai = new ScriptedAI(world, {
      faction: 'red',
      script: {
        triggers: [{
          at: { time: 0 },
          actions: [
            { type: 'retreat', to: { cityId: 'c1' }, units: { group: 'north' } },
            { type: 'attackMove', target: { x: 800, y: 300 }, units: { group: 'south' } },
          ],
        }],
      },
    });
    ai.update(1 / 60);
    expect(north.command.type).toBe('move');
    expect(north.route.at(-1)).toEqual({ x: 100, y: 300 }); // 撤向 c1
    expect(south.command.type).toBe('attackMove');
    expect(south.route.at(-1)).toEqual({ x: 800, y: 300 });
  });

  it('spawn 可以给增援打标签，之后的动作就能只指挥这批', () => {
    const { world } = makeTwoGroups();
    const ai = new ScriptedAI(world, {
      faction: 'red',
      script: {
        triggers: [
          { id: 'wave', at: { time: 0 }, actions: [{ type: 'spawn', unitType: 'light', count: 2, at: { x: 200, y: 400 }, group: 'wave' }] },
          { id: 'waveHold', at: { time: 1 }, actions: [{ type: 'hold', units: { group: 'wave' } }] },
        ],
      },
    });
    ai.update(1 / 60);
    const wave = world.units.filter(unit => unit.group === 'wave');
    expect(wave).toHaveLength(2);
    expect(wave.every(unit => unit.faction === 'red')).toBe(true);

    world.issueCommands(wave.map(unit => unit.id), moveCommand([{ x: 900, y: 400 }]));
    ai.update(1.1);
    expect(wave.every(unit => unit.command.type === 'hold')).toBe(true);
  });

  it('deployForces 把 forces[].group 写到 unit.group（没写的编队保持 null）', () => {
    const world = makeWorld(makePlainMap({ width: 800, height: 600 }));
    const spawned = deployForces(world, [
      { faction: 'red', at: { x: 100, y: 100 }, group: 'north', units: [{ type: 'light', count: 2 }] },
      { faction: 'red', at: { x: 200, y: 100 }, units: [{ type: 'heavy', count: 1 }] },
    ], {});
    expect(spawned.filter(unit => unit.group === 'north')).toHaveLength(2);
    expect(spawned.filter(unit => unit.group === null || unit.group === undefined)).toHaveLength(1);
  });
});
