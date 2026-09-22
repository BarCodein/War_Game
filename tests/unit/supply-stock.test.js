import { describe, expect, it } from 'vitest';
import { advance, makePlainMap, makeWorld } from './helpers.js';
import { values } from '../../src/config/index.js';
import { updateSupplyStock, effectsFor, stockRatio } from '../../src/simulation/systems/supplyStock.js';

// 补给存量系统（gdd.md §6）：数值 = 单位剩余补给存量（上限按兵种，values.units.*.supplyStock）。
//   · 进货：补给系统算出的实收点数（unit.supplyIntake），断补 = 0；
//   · 消耗：交战 −8/s（参战未瞄准 −3/s）、行军 −5/s、急行军 −10/s，有路线时 ×1.3；
//     **交战项再乘战斗力系数**（血量低于 combat.hp_dps_ratio 后线性下降，与伤害公式同一函数），
//     口粮 / 行军 / 急行军 / 进货 / 就地搜集都不乘；
//   · 阈值：存量比例 < 60% → 缺补（削弱）、< 30% → 将尽（动摇）、= 0 → 溃逃 / 失序；
//   · 归零后才掉血（supply.attritionHpPerSecond）；补给线被切断本身不掉血，只是不进货。

const STEP = values.simulation.fixedStep;

function cityMap() {
  return makePlainMap({
    cities: [
      { id: 'c1', x: 100, y: 600, faction: 'blue' },
      { id: 'c2', x: 1100, y: 100, faction: 'red' },
    ],
    spawns: [
      { faction: 'blue', x: 100, y: 600 },
      { faction: 'red', x: 1100, y: 100 },
    ],
  });
}

// 直接驱动存量系统：把进货速率手动清零（模拟"补给线被切断"），只观察消耗
function cutOff(unit) {
  unit.supplyIntake = 0;
  unit.supplied = false;
  return unit;
}

// 消耗速率 = 基础口粮 + 该状态的消耗项（战斗/行军）
const IDLE = Math.abs(values.supplyStock.perSecond.idle);

describe('补给存量：基础口径', () => {
  it('上限按兵种分开，出击时带满', () => {
    const world = makeWorld(cityMap());
    const light = world.spawnUnit('blue', 'light', 300, 300);
    const heavy = world.spawnUnit('blue', 'heavy', 340, 300);
    expect(light.maxSupplyStock).toBe(values.units.light.supplyStock);
    expect(heavy.maxSupplyStock).toBe(values.units.heavy.supplyStock);
    expect(stockRatio(light)).toBe(1);
    expect(stockRatio(heavy)).toBe(1);
  });

  it('阈值按存量比例（不是绝对值）：不同兵种用同一套比例', () => {
    const t = values.supplyStock.thresholds;
    expect(effectsFor(1)).toEqual({ damageMultiplier: 1, speedMultiplier: 1 });
    expect(effectsFor(t.weakenedBelow - 0.01)).toEqual(values.supplyStock.effects.weakened);
    expect(effectsFor(t.shakenBelow - 0.01)).toEqual(values.supplyStock.effects.shaken);
    // 轻 80 上限的 50% 与 重 120 上限的 50% 是同一档
    const world = makeWorld(cityMap());
    const light = world.spawnUnit('blue', 'light', 300, 300);
    const heavy = world.spawnUnit('blue', 'heavy', 340, 300);
    light.supplyStock = light.maxSupplyStock * 0.5;
    heavy.supplyStock = heavy.maxSupplyStock * 0.5;
    expect(stockRatio(light)).toBeCloseTo(stockRatio(heavy), 6);
    expect(effectsFor(stockRatio(light))).toEqual(effectsFor(stockRatio(heavy)));
  });

  it('存量已满 → 几乎不申领运力（只剩一点基础口粮的缺口）', () => {
    const world = makeWorld(cityMap());
    const unit = world.spawnUnit('blue', 'light', 150, 600);
    advance(world, 2);
    const fullRate = values.supply.stockPerPoint * values.supply.demandPerUnit / values.supply.refreshSeconds;
    // 满额部队没有"要补的量"：基础口粮每秒吃掉 1 存量，所以它只会申领刚好抵掉口粮的那一点点
    // （≈1/s，而不是"收 20/s 再被 clamp 丢掉"）
    expect(unit.supplyIntake).toBeLessThan(fullRate * 0.1);
    expect(unit.supplyStock).toBeGreaterThan(unit.maxSupplyStock - 1); // 稳态就停在满额下方一点
    expect(unit.supplyRatio).toBe(1);   // 缺口被满足
    expect(unit.supplied).toBe(true);   // 补给线可达
    expect(world.citySupplyLoad.get('c1')).toBeLessThan(0.5); // 城市几乎没为它花点数

    // 一旦打出大缺口，立刻按满额速率进货：满额速率 = stockPerPoint × 需求 ÷ 结算间隔 = 20/s
    unit.supplyStock -= 30;
    world.supplyTimer = 999;
    advance(world, values.supply.refreshSeconds);
    expect(unit.supplyIntake).toBeCloseTo(fullRate, 6);
    expect(world.citySupplyLoad.get('c1')).toBeCloseTo(values.supply.demandPerUnit, 2); // 满额申领 1 点
  });

  it('进货只来自补给系统：补给线够不着 → 断补 → 只出不进', () => {
    // 大图上把单位放到超出行进上界（supply.path.maxCost）的位置：补给线拉不到 → 断补
    const world = makeWorld(makePlainMap({
      width: 2200,
      height: 900,
      cities: [
        { id: 'c1', x: 100, y: 600, faction: 'blue' },
        { id: 'c2', x: 2100, y: 100, faction: 'red' },
      ],
      spawns: [
        { faction: 'blue', x: 100, y: 600 },
        { faction: 'red', x: 2100, y: 100 },
      ],
    }));
    const unit = world.spawnUnit('blue', 'light', 1900, 600);
    world.issueCommands([unit.id], { type: 'move', path: [{ x: 1990, y: 600 }] }); // 让它一边走一边耗
    advance(world, 1);
    expect(unit.supplied).toBe(false);
    expect(unit.supplyIntake).toBe(0);                 // 没有任何进货
    expect(unit.supplyStock).toBeLessThan(unit.maxSupplyStock); // 只出不进
    expect(unit.hp).toBe(unit.maxHp);                  // 存量还没耗尽 → 不掉血
  });
});

describe('补给存量：消耗', () => {
  it('交战消耗 -8/s（叠基础口粮 -1/s；无路径时为防守，不乘进攻因子）', () => {
    const world = makeWorld(cityMap());
    const unit = cutOff(world.spawnUnit('blue', 'light', 300, 300));
    unit.state = 'combat';
    unit.underFire = true;
    const before = unit.supplyStock;
    updateSupplyStock(world, 1);
    expect(before - unit.supplyStock).toBeCloseTo(
      Math.abs(values.supplyStock.perSecond.inCombat) + IDLE, 6,
    );
  });

  it('参战但没被瞄准消耗更少（inCombatSupport）', () => {
    const world = makeWorld(cityMap());
    const front = cutOff(world.spawnUnit('blue', 'light', 300, 300));
    const support = cutOff(world.spawnUnit('blue', 'light', 380, 300));
    for (const unit of [front, support]) {
      unit.state = 'combat';
      unit.underFire = false;
    }
    front.underFire = true;
    updateSupplyStock(world, 1);
    const frontDrop = front.maxSupplyStock - front.supplyStock;
    const supportDrop = support.maxSupplyStock - support.supplyStock;
    expect(frontDrop).toBeCloseTo(Math.abs(values.supplyStock.perSecond.inCombat) + IDLE, 6);
    expect(supportDrop).toBeCloseTo(Math.abs(values.supplyStock.perSecond.inCombatSupport) + IDLE, 6);
    expect(supportDrop).toBeLessThan(frontDrop);
  });

  it('行军消耗 -5/s；沿道路行军消耗减半', () => {
    // 一列地形：y=120 铺成道路（10 px 网格 → 行 12、列 10~70）
    const cells = {};
    for (let col = 10; col <= 70; col += 1) cells[`${col},12`] = values.terrain.codes.road;
    const world = makeWorld(makePlainMap({ width: 800, height: 480, terrainCells: cells }));
    const plain = cutOff(world.spawnUnit('blue', 'light', 300, 300));
    const road = cutOff(world.spawnUnit('blue', 'light', 300, 125));
    for (const unit of [plain, road]) {
      unit.state = 'moving';
      unit.route = [{ x: 700, y: unit.y }]; // 有路线 → 进攻因子，两边一样，差值就是地形系数
    }
    const before = { plain: plain.supplyStock, road: road.supplyStock };
    updateSupplyStock(world, 1);
    // 基础口粮两边都吃，扣掉它之后才是"纯行军消耗"的比值
    const plainMarch = (before.plain - plain.supplyStock) - IDLE;
    const roadMarch = (before.road - road.supplyStock) - IDLE;
    expect(roadMarch / plainMarch).toBeCloseTo(values.terrain.marchSupplyMultiplier.road, 6);
  });

  it('急行军用 -10/s 取代行军的 -5/s', () => {
    const world = makeWorld(cityMap());
    const normal = cutOff(world.spawnUnit('blue', 'light', 300, 300));
    const forced = cutOff(world.spawnUnit('blue', 'light', 300, 360));
    for (const unit of [normal, forced]) {
      unit.state = 'moving';
      unit.route = [{ x: 700, y: unit.y }];
    }
    forced.forcedMarch = true;
    const before = { normal: normal.supplyStock, forced: forced.supplyStock };
    updateSupplyStock(world, 1);
    const normalDrop = before.normal - normal.supplyStock;
    const forcedDrop = before.forced - forced.supplyStock;
    expect(forcedDrop - normalDrop).toBeCloseTo(
      Math.abs(values.movement.forcedMarch.supplyPerSecond) - Math.abs(values.supplyStock.perSecond.moving), 6,
    );
  });

  it('有路线（进攻）时消耗再乘 attack 因子 1.3', () => {
    const world = makeWorld(cityMap());
    const defending = cutOff(world.spawnUnit('blue', 'light', 300, 300));
    const attacking = cutOff(world.spawnUnit('blue', 'light', 300, 360));
    for (const unit of [defending, attacking]) unit.state = 'combat';
    attacking.route = [{ x: 700, y: 360 }]; // 有路线 → mode = attack
    updateSupplyStock(world, 1);
    // 基础口粮不吃进攻因子，比较前先扣掉
    const defendCombat = (defending.maxSupplyStock - defending.supplyStock) - IDLE;
    const attackCombat = (attacking.maxSupplyStock - attacking.supplyStock) - IDLE;
    expect(attackCombat / defendCombat).toBeCloseTo(values.supplyStock.perSecond.attack, 6);
  });

  it('交战消耗随血量下降：残血部队吃得少（与伤害共用战斗力系数）', () => {
    const world = makeWorld(cityMap());
    const full = cutOff(world.spawnUnit('blue', 'light', 300, 300));
    const hurt = cutOff(world.spawnUnit('blue', 'light', 300, 360));
    const support = cutOff(world.spawnUnit('blue', 'light', 300, 420));
    for (const unit of [full, hurt, support]) unit.state = 'combat';
    full.underFire = true;
    hurt.underFire = true;
    support.underFire = false; // 参战未被瞄准：同样属于"交战项"，一样乘系数
    hurt.hp = hurt.maxHp * 0.4;         // 40% 血量 → 系数 0.4 ÷ 0.8 = 0.5
    support.hp = support.maxHp * 0.4;

    updateSupplyStock(world, 1);
    const combatOf = unit => (unit.maxSupplyStock - unit.supplyStock) - IDLE; // 扣掉不吃系数的口粮
    expect(combatOf(hurt) / combatOf(full)).toBeCloseTo(0.5, 6);
    expect(combatOf(support)).toBeCloseTo(
      Math.abs(values.supplyStock.perSecond.inCombatSupport) * 0.5, 6,
    );
  });

  it('血量 ≥ hp_dps_ratio × 上限 → 系数 = 1（满血与旧行为逐位一致）', () => {
    const world = makeWorld(cityMap());
    const full = cutOff(world.spawnUnit('blue', 'light', 300, 300));
    const atThreshold = cutOff(world.spawnUnit('blue', 'light', 300, 360));
    for (const unit of [full, atThreshold]) {
      unit.state = 'combat';
      unit.underFire = true;
    }
    atThreshold.hp = atThreshold.maxHp * values.combat.hp_dps_ratio;
    updateSupplyStock(world, 1);
    expect(atThreshold.supplyStock).toBeCloseTo(full.supplyStock, 6);
  });

  it('基础口粮与行军不随血量变化（系数只乘交战项）', () => {
    const world = makeWorld(cityMap());
    const full = cutOff(world.spawnUnit('blue', 'light', 300, 300));
    const hurt = cutOff(world.spawnUnit('blue', 'light', 300, 360));
    const fullMarch = cutOff(world.spawnUnit('blue', 'light', 300, 420));
    const hurtMarch = cutOff(world.spawnUnit('blue', 'light', 300, 480));
    for (const unit of [fullMarch, hurtMarch]) {
      unit.state = 'moving';
      unit.route = [{ x: 700, y: unit.y }];
    }
    hurt.hp = hurt.maxHp * 0.2;
    hurtMarch.hp = hurtMarch.maxHp * 0.2;

    updateSupplyStock(world, 1);
    expect(hurt.supplyStock).toBeCloseTo(full.supplyStock, 6);                       // 残血驻军 = 满血驻军
    expect(hurtMarch.supplyStock).toBeCloseTo(fullMarch.supplyStock, 6);             // 残血行军 = 满血行军
    expect(full.supplyStock).toBeCloseTo(full.maxSupplyStock - IDLE, 6);             // 只有口粮
    expect(fullMarch.supplyStock).toBeLessThan(hurt.supplyStock);                    // 但行军确实更贵
  });

  it('溃逃时受击扣的仍是交战项：同样乘战斗力系数', () => {
    const world = makeWorld(cityMap());
    const full = cutOff(world.spawnUnit('blue', 'light', 800, 150));
    const hurt = cutOff(world.spawnUnit('blue', 'light', 800, 220));
    for (const unit of [full, hurt]) {
      unit.state = 'rout';
      unit.underFire = true;
      unit.supplyStock = 0;
    }
    hurt.hp = hurt.maxHp * 0.4; // 系数 0.5
    updateSupplyStock(world, 1);
    const routRate = values.supplyStock.rout.recoverPerSecond;
    const combatCost = Math.abs(values.supplyStock.perSecond.inCombat);
    expect(full.supplyStock).toBeCloseTo(routRate - combatCost, 6);              // 满血：+8 −8 ≈ 0
    expect(hurt.supplyStock).toBeCloseTo(routRate - combatCost * 0.5, 6);        // 半血：+8 −4 = +4
  });
});

describe('补给存量：阈值与归零', () => {
  it('缺补 / 将尽按比例削弱伤害与速度', () => {
    const maxHp = values.units.light.hp;
    const base = values.units.light.damage * values.combat.defend;

    const world = makeWorld(cityMap());
    const blue = world.spawnUnit('blue', 'light', 500, 300);
    const red = world.spawnUnit('red', 'light', 520, 300);
    blue.supplyStock = blue.maxSupplyStock * 0.5; // < 60% → 缺补
    unitStatsRefresh(blue);
    advance(world, STEP);
    expect(red.hp).toBeCloseTo(maxHp - base * values.supplyStock.effects.weakened.damageMultiplier);

    const world2 = makeWorld(cityMap());
    const blue2 = world2.spawnUnit('blue', 'light', 500, 300);
    const red2 = world2.spawnUnit('red', 'light', 520, 300);
    blue2.supplyStock = blue2.maxSupplyStock * 0.2; // < 30% → 将尽
    advance(world2, STEP);
    expect(red2.hp).toBeCloseTo(maxHp - base * values.supplyStock.effects.shaken.damageMultiplier);
  });

  it('存量归零且正被攻击 → 溃逃；无城可退立即投降移除', () => {
    const world = makeWorld(makePlainMap());
    world.cities = world.cities.filter(city => city.faction !== 'red'); // 红方无城可退
    const unit = world.spawnUnit('red', 'light', 600, 100);
    world.spawnUnit('blue', 'light', 620, 100); // 接触 → 本 tick 处于被攻击状态
    unit.supplyStock = 0;
    unit.supplyIntake = 0;
    advance(world, STEP);
    expect(unit.state).toBe('dead');
    expect(world.history.some(e => e.type === 'unitDied' && e.unitId === unit.id && e.cause === 'surrender')).toBe(true);
  });

  it('存量归零但未受攻击 → 失序原地', () => {
    const world = makeWorld(cityMap()); // 保留己城：溃逃/投降那一套不受影响
    const unit = cutOff(world.spawnUnit('blue', 'light', 500, 300));
    unit.supplyStock = 0;
    world.spawnUnit('red', 'light', 900, 300); // 距离 400：不在接触范围

    updateSupplyStock(world, STEP); // 这一 tick 先走"消耗 → 判定归零"这条路
    expect(unit.state).toBe('unordered');
  });

  it('失序时持续搜集补给，到达 stopAt 后恢复为 hold（随后又被基础口粮慢慢吃掉）', () => {
    const world = makeWorld(cityMap());
    const unit = cutOff(world.spawnUnit('blue', 'light', 500, 300));
    unit.supplyStock = 0;
    unit.state = 'unordered';
    world.spawnUnit('red', 'light', 900, 300);
    // 就地搜集 +10/s：跑到它刚好越过 stopAt 的那一刻
    let reached = null;
    for (let i = 0; i < 60 * 5 && reached === null; i += 1) {
      updateSupplyStock(world, STEP);
      if (unit.state === 'hold') reached = unit.supplyStock;
    }
    expect(reached).not.toBeNull();
    expect(reached).toBeGreaterThanOrEqual(values.supplyStock.unordered.stopAt);

    // 恢复成正常状态后不再"就地搜集"，只剩基础口粮 → 存量重新往下掉
    for (let i = 0; i < 60 * 3; i += 1) updateSupplyStock(world, STEP);
    expect(unit.supplyStock).toBeLessThan(reached);
  });

  it('溃逃时 +8/s 就地搜集，恢复到 stopAt 停止溃逃', () => {
    const world = makeWorld(cityMap());
    const unit = world.spawnUnit('blue', 'light', 800, 150);
    unit.supplyStock = 0;
    unit.supplyIntake = 0;
    unit.state = 'rout';
    unit.route = [{ x: 100, y: 600 }];
    advance(world, 3); // +8/s → 3 s = 24 > stopAt(20)
    expect(unit.state).toBe('hold');
    expect(unit.supplyStock).toBeGreaterThanOrEqual(values.supplyStock.rout.stopAt);
  });
});

describe('补给存量：掉血口径', () => {
  it('补给线被切断（断补）不掉血，只有存量归零才掉血', () => {
    const world = makeWorld(cityMap());
    world.cities = world.cities.filter(city => city.faction !== 'blue');
    const unit = world.spawnUnit('blue', 'light', 300, 300);
    world.tick(STEP); // 先让补给系统跑一轮：无城 → supplied=false、进货 0
    // 之后只驱动存量系统（自己也一直行军：有消耗、没进货）
    unit.state = 'moving';
    unit.route = [{ x: 1200, y: 300 }];
    for (let i = 0; i < 60; i += 1) updateSupplyStock(world, STEP);
    expect(unit.supplied).toBe(false);   // 补给线是断的
    expect(unit.supplyStock).toBeLessThan(unit.maxSupplyStock); // 存量在掉
    expect(unit.hp).toBe(unit.maxHp);    // 但血还没掉（存量还有）
  });

  it('存量归零后按 attritionHpPerSecond 掉血，并计入伤亡', () => {
    const world = makeWorld(cityMap());
    const unit = cutOff(world.spawnUnit('blue', 'light', 300, 300));
    unit.supplyStock = 0;
    updateSupplyStock(world, 1);
    expect(unit.hp).toBeCloseTo(unit.maxHp - values.supply.attritionHpPerSecond, 6);
    expect(world.casualties.blue).toBeCloseTo(values.supply.attritionHpPerSecond, 6);
  });

  it('存量耗尽的整条链路：断补 → 存量撑一段时间 → 归零被压制则掉血', () => {
    const world = makeWorld(cityMap()); // 保留己方城市：溃逃时才有地方可退（无城会直接投降）
    const unit = world.spawnUnit('blue', 'light', 300, 300);
    cutOff(unit); // 模拟"补给线被切断"：进货恒为 0
    unit.state = 'combat';
    unit.underFire = true; // 被压制：作战中且一直挨打
    const cap = unit.maxSupplyStock;

    for (let i = 0; i < 60 * 3; i += 1) updateSupplyStock(world, STEP); // 3 s
    expect(unit.supplyStock).toBeLessThan(cap);
    expect(unit.supplyStock).toBeGreaterThan(0);
    expect(unit.hp).toBe(unit.maxHp); // 存量还有 → 不掉血

    for (let i = 0; i < 60 * 20; i += 1) updateSupplyStock(world, STEP); // 再 20 s
    expect(unit.supplyStock).toBe(0);        // 存量已经耗光
    expect(unit.state).toBe('rout');         // 且正被攻击 → 溃逃
    expect(unit.hp).toBeLessThan(unit.maxHp); // 归零后按 attritionHpPerSecond 掉血
  });
});

// 阈值效果由 combat/movement 每 tick 实时调用 effectsFor 推导；测试里手动同步一次
function unitStatsRefresh(unit) {
  unit.effects = effectsFor(stockRatio(unit));
}
