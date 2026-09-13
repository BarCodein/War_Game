import { describe, expect, it } from 'vitest';
import {
  loadLevel, loadLevelIndex, loadMap, loadTutorialMap, makePlainMap, runSimulation,
} from './helpers.js';
import {
  LEVEL_VERSION, VICTORY_MODES, parseLevel, validateLevel, validateLevelReferences,
  deployForces, buildMission, resolvePoint, resolveAnchor, resolveTarget,
} from '../../src/simulation/level.js';
import { attackMoveCommand } from '../../src/simulation/commands.js';
import { World } from '../../src/simulation/world.js';
import { ScriptedAI } from '../../src/simulation/ai.js';

// 关卡标准格式（architecture.md §7.1）：URL 只携带关卡 id，其余全部来自关卡 JSON。
// 本文件锁定「格式契约」与「引擎按数据部署」这两件事。

describe('level：教学关已转为标准格式', () => {
  it('关卡 JSON 合法且关键字段齐全', () => {
    const level = parseLevel(loadLevel('fracture-canyon'));
    expect(level.version).toBe(LEVEL_VERSION);
    expect(level.id).toBe('fracture-canyon');
    expect(level.type).toBe('offensive');
    expect(level.map).toBe('/assets/maps/fracture-canyon.json');
    expect(level.forces).toHaveLength(2);
    expect(level.ai.faction).toBe('red');
    expect(level.ai.triggers.length).toBeGreaterThan(0);
  });

  it('关卡声明的兵力总数与 gdd 教学关配比一致（蓝 6 轻 2 重 / 红 2 轻 2 重）', () => {
    const level = parseLevel(loadLevel('fracture-canyon'));
    const count = (faction, type) => level.forces
      .filter(f => f.faction === faction)
      .flatMap(f => f.units)
      .filter(u => u.type === type)
      .reduce((sum, u) => sum + u.count, 0);
    expect(count('blue', 'light')).toBe(6);
    expect(count('blue', 'heavy')).toBe(2);
    expect(count('red', 'light')).toBe(2);
    expect(count('red', 'heavy')).toBe(2);
  });

  it('关卡索引里的每一关都有对应文件，且 id / 展示字段一致', () => {
    const levels = loadLevelIndex().levels;
    expect(levels.length).toBeGreaterThan(0);
    for (const entry of levels) {
      const level = parseLevel(loadLevel(entry.id));
      expect(level.id).toBe(entry.id);
      expect(entry.name).toBeTruthy();
      expect(entry.subtitle).toBeTruthy();
      expect(entry.description).toBeTruthy();
      expect(entry.difficulty).toBeTruthy();
    }
  });
});

describe('level：引擎按数据部署兵力', () => {
  it('deployForces 精确复现教学关落点（锚点 + offset + spacing × i）', () => {
    const level = parseLevel(loadLevel('fracture-canyon'));
    const world = new World(loadTutorialMap());
    const spawned = deployForces(world, level.forces);

    expect(spawned).toHaveLength(12); // 蓝 8（6 轻 2 重）+ 红 4（2 轻 2 重）
    const at = (faction) => spawned.filter(u => u.faction === faction)
      .map(u => `${u.type}@${u.x},${u.y}`);
    expect(at('blue')).toEqual([
      'light@200,560',
      'light@170,590',
      'light@150,590',
      'light@180,610',
      'light@200,610',
      'light@220,610',
      'heavy@240,520',
      'heavy@270,520',
    ]);
    expect(at('red')).toEqual([
      'light@1080,160',
      'light@1040,120',
      'heavy@1120,210',
      'heavy@1150,210',
    ]);
  });

  it('坐标引用解析：绝对坐标 / 命名锚点 / 出生点 id / 城市 id 全覆盖', () => {
    const level = parseLevel(loadLevel('fracture-canyon'));
    const world = new World(loadTutorialMap());
    const anchors = level.anchors;

    expect(resolvePoint({ x: 10, y: 20 }, world, anchors)).toEqual({ x: 10, y: 20 });
    // 命名锚点：eastGate 是绝对坐标，redBase 指向城市 c2
    expect(resolvePoint({ anchor: 'eastGate' }, world, anchors)).toEqual({ x: 1230, y: 400 });
    expect(resolvePoint({ anchor: 'redBase' }, world, anchors)).toEqual({ x: 1080, y: 160 });
    expect(resolvePoint({ anchor: 'nope' }, world, anchors)).toBeNull();
    // 出生点：spawnId 精确指定，spawn 取该阵营的第一个
    expect(resolvePoint({ spawnId: 's1' }, world, anchors)).toEqual({ x: 200, y: 560 });
    expect(resolvePoint({ spawnId: 's2' }, world, anchors)).toEqual({ x: 1080, y: 160 });
    expect(resolvePoint({ spawnId: 's9' }, world, anchors)).toBeNull();
    expect(resolveAnchor({ spawn: 'blue' }, world)).toEqual({ x: 200, y: 560 });
    expect(resolveAnchor({ spawn: 'green' }, world)).toBeNull();
    // 城市：cityId 精确指定，city 取该阵营当前拥有的第一座
    expect(resolveTarget({ cityId: 'c1' }, world)).toEqual({ x: 200, y: 560 });
    expect(resolveTarget({ cityId: 'c9' }, world)).toBeNull();
    expect(resolveTarget({ city: 'red' }, world)).toEqual({ x: 1080, y: 160 });
    expect(resolveTarget({ city: 'neutral' }, world)).toBeNull();
  });

  it('多出生点：{ spawnId } 可指定任意一个，{ spawn } 只取第一个', () => {
    const world = new World(makePlainMap({
      spawns: [
        { id: 's3', faction: 'blue', x: 100, y: 600 },
        { id: 's4', faction: 'blue', x: 400, y: 200 },
        { id: 's5', faction: 'red', x: 1100, y: 100 },
      ],
    }));
    expect(resolvePoint({ spawnId: 's4' }, world)).toEqual({ x: 400, y: 200 });
    expect(resolvePoint({ spawn: 'blue' }, world)).toEqual({ x: 100, y: 600 }); // 第一个

    // 两支部队可以分别从不同出生点出发
    const spawned = deployForces(world, [
      { faction: 'blue', at: { spawnId: 's3' }, units: [{ type: 'light', count: 1 }] },
      { faction: 'blue', at: { spawnId: 's4' }, units: [{ type: 'heavy', count: 1 }] },
    ]);
    expect(spawned.map(u => `${u.type}@${u.x},${u.y}`)).toEqual(['light@100,600', 'heavy@400,200']);
  });

  it('引用交叉校验：拼错的 spawnId / cityId 会被逐个指出', () => {
    const mapData = loadTutorialMap();
    const level = parseLevel(loadLevel('fracture-canyon'));
    expect(validateLevelReferences(level, mapData)).toEqual([]);

    const data = loadLevel('fracture-canyon');
    data.anchors.badSpawn = { spawnId: 's9' };
    data.anchors.badCity = { cityId: 'c9' };
    const errors = validateLevelReferences(parseLevel(data), mapData);
    expect(errors).toContainEqual(expect.stringContaining('不存在出生点 "s9"'));
    expect(errors).toContainEqual(expect.stringContaining('不存在城市 "c9"'));
  });
});

describe('level：AI 脚本由数据驱动', () => {
  it('教学关脚本：60s 在命名锚点触发增援，增援 attackMove 指向 redBase（城市 c2）', () => {
    const level = parseLevel(loadLevel('fracture-canyon'));
    const world = new World(loadTutorialMap());
    deployForces(world, level.forces, level.anchors);
    const ai = new ScriptedAI(world, {
      faction: level.ai.faction, script: level.ai, anchors: level.anchors,
    });

    // 增援出生点与目标都由锚点表解析
    const spawnAction = level.ai.triggers[0].actions[0];
    expect(resolvePoint(spawnAction.at, world, level.anchors)).toEqual({ x: 1230, y: 400 });
    expect(resolvePoint(spawnAction.order.target, world, level.anchors)).toEqual({ x: 1080, y: 160 });

    runSimulation(world, [ai], 59);
    expect(world.units.filter(u => u.faction === 'red' && u.command?.type === 'attackMove')).toHaveLength(0);

    runSimulation(world, [ai], 1.5);
    const ordered = world.units.filter(u => u.faction === 'red' && u.command?.type === 'attackMove');
    expect(ordered).toHaveLength(2);
    expect(ordered.map(u => u.type)).toEqual(['light', 'light']);
    // 增援从东侧锚点出生（红方原有单位在 x ≤ 1080），并已开始向西行军
    expect(ordered.every(u => u.x > 1150)).toBe(true);
    expect(ordered[0].command.target).toEqual({ x: 1080, y: 160 });
  });
});

describe('level：宿北战役（歼灭关卡 · 山地隘口）', () => {
  const level = parseLevel(loadLevel('subei_battle'));
  const mapData = loadMap('suqian');

  it('第二关引用全部有效，兵力落在可通行地形上', () => {
    expect(level.id).toBe('subei_battle');
    // 关卡类型随关卡 JSON 走：改 JSON 的 type 时同步改这一行
    expect(level.type).toBe('annihilative');
    expect(level.map).toBe('/assets/maps/suqian.json');
    expect(validateLevelReferences(level, mapData)).toEqual([]);

    const world = new World(mapData);
    const spawned = deployForces(world, level.forces, level.anchors);
    // 数量按关卡声明推算，这样调整兵力配比不需要改测试
    const declared = level.forces.reduce((sum, force) => sum
      + force.units.reduce((n, unit) => n + unit.count, 0), 0);
    expect(spawned).toHaveLength(declared);
    expect(spawned.filter(u => u.faction === 'blue').length).toBeGreaterThan(0);
    expect(spawned.filter(u => u.faction === 'red').length).toBeGreaterThan(0);
    // 落点必须都在可通行地形上（山顶/水面会让单位卡住）
    expect(spawned.every(u => world.terrain.passableAt(u.x, u.y))).toBe(true);

    // 隘口锚点压在山地上（防御修正 0.75），是这一关的战术要点
    const roadblock = resolvePoint({ anchor: 'roadblock' }, world, level.anchors);
    expect(world.terrain.defenseModifierAt(roadblock.x, roadblock.y)).toBe(0.75);

    // 「指定单位」：标了 objective 的编队部署出的单位带 unit.objective，
    // 未标记的编队（如 AI 增援）不带——歼灭胜负只看这些带标记的单位
    const marked = spawned.filter(u => u.objective === 'annihilate');
    const declaredMarked = level.forces
      .filter(force => force.objective === 'annihilate')
      .reduce((sum, force) => sum + force.units.reduce((n, unit) => n + unit.count, 0), 0);
    expect(declaredMarked).toBeGreaterThan(0);
    expect(marked).toHaveLength(declaredMarked);
    expect(marked.every(u => u.faction === 'red')).toBe(true);
  });

  it('这关能打完：朴素打法下蓝军 300s 内获胜（歼灭指定单位或夺取宿北城）', () => {
    const world = new World(mapData);
    deployForces(world, level.forces, level.anchors);
    // 走真实路径：胜利条件同样由关卡 JSON 的 victory 决定
    world.mess = buildMission(level, world);
    expect(world.mess).toMatchObject({ mode: 'annihilative', faction: 'blue' });
    const redAi = new ScriptedAI(world, {
      faction: 'red', script: level.ai, anchors: level.anchors,
    });
    // 「玩家」：每 5s 全军向红城攻击前进（只为验证关卡可解，不代表最优打法）
    const redBase = resolvePoint({ anchor: 'redBase' }, world, level.anchors);
    const blueCommander = {
      timer: 0,
      update(dt) {
        this.timer += dt;
        if (this.timer < 5) return;
        this.timer = 0;
        const ids = world.units.filter(u => u.faction === 'blue' && u.state !== 'dead').map(u => u.id);
        if (ids.length) world.issueCommands(ids, attackMoveCommand(redBase));
      },
    };

    runSimulation(world, [redAi, blueCommander], 300);

    expect(world.winner).toBe('blue');
  });
});

describe('level：胜负条件（victory → buildMission）', () => {
  const base = () => ({
    version: 1,
    id: 'x',
    type: 'offensive',
    map: '/assets/maps/x.json',
    forces: [{ faction: 'blue', at: { x: 1, y: 2 }, units: [{ type: 'light', count: 1 }] }],
  });

  it('captureAll / 未声明 victory → 不额外判定（返回 null，只走失城判负）', () => {
    const world = new World(makePlainMap());
    expect(VICTORY_MODES).toEqual(['captureAll', 'defend', 'attack', 'annihilative']);
    expect(buildMission({ victory: { type: 'captureAll' } }, world)).toBeNull();
    expect(buildMission({ victory: null }, world)).toBeNull();
    expect(buildMission({}, world)).toBeNull();
    expect(buildMission(null, world)).toBeNull();
  });

  it('defend / attack / annihilative：解析阵营、时限与据点对象（id → 世界对象）', () => {
    const world = new World(makePlainMap({
      capturePoints: [{ id: 'p1', x: 600, y: 300, faction: 'blue' }],
    }));
    const mission = buildMission({
      victory: { mode: 'defend', faction: 'red', time: 90, points: ['p1', 'c1'] },
    }, world);
    expect(mission).toEqual({
      mode: 'defend', faction: 'red', time: 90, points: [world.capturePoints[0], world.cities[0]],
    });

    // 缺省：faction = 玩家方 blue、time = null（不限时）、points = 地图上全部占领点
    expect(buildMission({ victory: { type: 'attack' } }, world)).toEqual({
      mode: 'attack', faction: 'blue', time: null, points: [world.capturePoints[0]],
    });

    // 宿北战役的写法：歼灭战 + 我方阵营 + 时限
    expect(buildMission({ victory: { type: 'annihilative', faction: 'blue', time: 10 } }, world))
      .toMatchObject({ mode: 'annihilative', faction: 'blue', time: 10 });
  });

  it('victory 字段非法时被校验拦截', () => {
    const bad = (victory, forces) => validateLevel({ ...base(), victory, ...(forces ? { forces } : {}) });
    expect(bad({ mode: 'nuke' }).some(e => e.includes('victory invalid mode'))).toBe(true);
    expect(bad({ mode: 'defend' }).some(e => e.includes('必须声明 faction'))).toBe(true);
    expect(bad({ mode: 'defend', faction: 'green' }).some(e => e.includes('victory invalid faction'))).toBe(true);
    expect(bad({ mode: 'defend', faction: 'blue', time: -1 }).some(e => e.includes('victory.time'))).toBe(true);
    expect(bad({ mode: 'defend', faction: 'blue', points: [1] }).some(e => e.includes('victory.points'))).toBe(true);
    expect(bad('nope')).toContain('victory must be an object');
    // 歼灭战必须至少有一个「指定单位」（forces 上标 objective）
    expect(bad({ mode: 'annihilative', faction: 'blue' }).some(e => e.includes('objective'))).toBe(true);
    // 编队 objective 只能是白名单里的值
    const badObjective = base();
    badObjective.forces[0].objective = 'melt';
    expect(validateLevel(badObjective).some(e => e.includes('invalid objective'))).toBe(true);
    // 合法写法
    expect(bad({ mode: 'defend', faction: 'blue', time: 60, points: ['p1'] })).toEqual([]);
    expect(bad({ type: 'captureAll' })).toEqual([]); // 当前教程关用的就是这种
    const marked = base();
    marked.forces[0].objective = 'annihilate';
    expect(bad({ mode: 'annihilative', faction: 'blue', time: 300 }, marked.forces)).toEqual([]);
  });

  it('victory.points 引用不存在的据点会被交叉校验指出', () => {
    const level = parseLevel({ ...base(), victory: { mode: 'defend', faction: 'blue', points: ['nope'] } });
    const errors = validateLevelReferences(level, loadTutorialMap());
    expect(errors).toContainEqual(expect.stringContaining('不存在据点 "nope"'));
  });
});

describe('level：非法关卡被拦截', () => {
  const base = () => ({
    version: 1,
    id: 'x',
    type: 'offensive',
    map: '/assets/maps/x.json',
    forces: [{ faction: 'blue', at: { spawn: 'blue' }, units: [{ type: 'light', count: 1 }] }],
  });

  it('缺失或非法的基础字段', () => {
    expect(validateLevel(null)).toContain('level must be an object');

    const noId = base(); delete noId.id;
    expect(validateLevel(noId)).toContain('missing id');

    const noMap = base(); delete noMap.map;
    expect(validateLevel(noMap)).toContain('missing map path');

    const badType = { ...base(), type: 'siege' };
    expect(validateLevel(badType).some(e => e.startsWith('invalid type'))).toBe(true);

    const future = { ...base(), version: LEVEL_VERSION + 1 };
    expect(validateLevel(future).some(e => e.includes('newer than supported'))).toBe(true);
  });

  it('非法兵力部署与非法 AI 动作', () => {
    const noForces = { ...base(), forces: [] };
    expect(validateLevel(noForces)).toContain('forces must be a non-empty array');

    const badAnchor = base();
    badAnchor.forces[0].at = { spawn: 'green' };
    expect(validateLevel(badAnchor).some(e => e.includes('invalid anchor'))).toBe(true);

    // 引用了未定义的命名锚点 → 结构合法但语义非法
    const unknownNamedAnchor = base();
    unknownNamedAnchor.forces[0].at = { anchor: 'nope' };
    expect(validateLevel(unknownNamedAnchor).some(e => e.includes('invalid anchor'))).toBe(true);

    // 命名锚点之间禁止链式引用
    const chained = base();
    chained.anchors = { a: { anchor: 'b' }, b: { x: 1, y: 2 } };
    chained.forces[0].at = { anchor: 'a' };
    expect(validateLevel(chained)).toContainEqual(expect.stringContaining('禁止链式引用'));

    // 合法的新写法：spawnId / cityId / 命名锚点
    const ok = base();
    ok.anchors = { start: { spawnId: 's1' } };
    ok.forces[0].at = { anchor: 'start' };
    ok.ai = {
      faction: 'red',
      fallback: { cityId: 'c1' },
      triggers: [{ at: { time: 1 }, actions: [{ type: 'spawn', unitType: 'light', count: 1, at: { spawnId: 's2' } }] }],
    };
    expect(validateLevel(ok)).toEqual([]);

    const badUnit = base();
    badUnit.forces[0].units = [{ type: 'mech', count: 1 }];
    expect(validateLevel(badUnit).some(e => e.includes('unknown type'))).toBe(true);

    const badCount = base();
    badCount.forces[0].units = [{ type: 'light', count: 0 }];
    expect(validateLevel(badCount).some(e => e.includes('count must be a positive integer'))).toBe(true);

    const badCondition = { ...base(), ai: { faction: 'red', triggers: [{ at: {}, actions: [{ type: 'hold' }] }] } };
    expect(validateLevel(badCondition).some(e => e.includes('invalid condition'))).toBe(true);

    const badAction = { ...base(), ai: { faction: 'red', triggers: [{ at: { time: 1 }, actions: [{ type: 'nuke' }] }] } };
    expect(validateLevel(badAction).some(e => e.includes('unknown action'))).toBe(true);
  });

  it('parseLevel 对非法数据抛错并聚合原因', () => {
    expect(() => parseLevel({ version: 1 })).toThrow(/invalid level/);
  });
});
