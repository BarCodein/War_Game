import { describe, expect, it } from 'vitest';
import { advance, makePlainMap, makeWorld } from './helpers.js';
import { values } from '../../src/config/index.js';
import { capabilityRatio } from '../../src/simulation/capability.js';
import { updateSupplyStock } from '../../src/simulation/systems/supplyStock.js';

// 战斗力系数（血量口径，gdd.md §4、§6）：战斗伤害与**交战补给消耗**共用的唯一曲线。
//   系数 = clamp(血量 ÷ 上限 ÷ combat.hp_dps_ratio, 0, 1)
// 这里同时守两件事：曲线本身，以及"两处真的用的是同一条曲线"（不是各写一套）。

const lightMax = values.units.light.hp;
const heavyMax = values.units.heavy.hp;

function unitAt(type, hpRatio) {
  const world = makeWorld(makePlainMap());
  const unit = world.spawnUnit('blue', type, 300, 300);
  unit.hp = unit.maxHp * hpRatio;
  return unit;
}

describe('capabilityRatio：血量 → 战斗力系数', () => {
  it('血量 ≥ hp_dps_ratio × 上限 → 封顶 1（满战斗力）', () => {
    expect(capabilityRatio(unitAt('light', 1))).toBe(1);
    expect(capabilityRatio(unitAt('light', values.combat.hp_dps_ratio))).toBe(1);
    expect(capabilityRatio(unitAt('light', 0.99))).toBe(1);
  });

  it('低于阈值后按血量比例线性下降', () => {
    expect(capabilityRatio(unitAt('light', 0.4))).toBeCloseTo(0.5, 6);   // 40% ÷ 0.8
    expect(capabilityRatio(unitAt('light', 0.2))).toBeCloseTo(0.25, 6);
    expect(capabilityRatio(unitAt('light', 0.08))).toBeCloseTo(0.1, 6);
  });

  it('阈值用的是同一条曲线：轻/重按各自上限换算（绝对值不同、比例相同）', () => {
    expect(lightMax).not.toBe(heavyMax);
    expect(capabilityRatio(unitAt('heavy', 0.4))).toBeCloseTo(capabilityRatio(unitAt('light', 0.4)), 6);
    expect(capabilityRatio(unitAt('heavy', 1))).toBe(1);
  });

  it('血量见底夹在 0：damageUnit 允许 hp 短暂为负，不能算出负系数', () => {
    const unit = unitAt('light', 0);
    expect(capabilityRatio(unit)).toBe(0);
    unit.hp = -12; // 同 tick 内被打成负血、还没 killUnit 的瞬间
    expect(capabilityRatio(unit)).toBe(0);
  });

  it('战斗伤害与交战补给消耗共用这一条曲线', () => {
    const ratio = 0.5; // 血量 50% → 系数 0.625
    const expected = 0.5 / values.combat.hp_dps_ratio;

    // 伤害侧：蓝军 50% 血打满血红军的伤害 = 满血伤害 × 系数
    const map = makePlainMap();
    const world = makeWorld(map);
    const blue = world.spawnUnit('blue', 'light', 100, 100);
    const red = world.spawnUnit('red', 'light', 120, 100);
    blue.hp = blue.maxHp * ratio;
    red.route = []; // 防守姿态（原地固守），两边口径一致
    advance(world, values.simulation.fixedStep);
    const dealt = red.maxHp - red.hp;
    expect(dealt).toBeCloseTo(values.units.light.damage * values.combat.defend * expected, 6);

    // 补给侧：同一血量的交战消耗 = 满血交战消耗 × 系数
    const supplyWorld = makeWorld(makePlainMap());
    const full = supplyWorld.spawnUnit('blue', 'light', 300, 300);
    const hurt = supplyWorld.spawnUnit('blue', 'light', 300, 360);
    for (const unit of [full, hurt]) {
      unit.supplyIntake = 0;
      unit.state = 'combat';
      unit.underFire = true;
    }
    hurt.hp = hurt.maxHp * ratio;
    updateSupplyStock(supplyWorld, 1);
    const fullDrop = full.maxSupplyStock - full.supplyStock;
    const hurtDrop = hurt.maxSupplyStock - hurt.supplyStock;
    // 基础口粮不吃系数：扣掉它之后，其余部分（纯交战消耗）正好是系数倍
    const idle = Math.abs(values.supplyStock.perSecond.idle);
    expect((hurtDrop - idle) / (fullDrop - idle)).toBeCloseTo(expected, 6);
  });
});
