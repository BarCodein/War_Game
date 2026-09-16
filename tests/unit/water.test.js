import { describe, expect, it } from 'vitest';
import { values } from '../../src/config/index.js';
import { makePlainMap, makeWorld } from './helpers.js';
import { updateSupply } from '../../src/simulation/systems/supply.js';
import { updateCombat } from '../../src/simulation/systems/combat.js';

// 水域的两条规则（gdd.md §5）：水里站不稳 → 攻击力 ×0.5；水里待着 → 每秒掉 1 血（可溺水阵亡）。
const STEP = values.simulation.fixedStep;

// 一张中间横贯水域的图：x ∈ [400, 500] 是水（gridCellSize 10 → 格子 40..49）
function mapWithWater() {
  const terrainCells = {};
  for (let cx = 40; cx <= 49; cx += 1) {
    for (let cy = 0; cy < 48; cy += 1) terrainCells[`${cx},${cy}`] = values.terrain.codes.water;
  }
  return makePlainMap({ width: 800, height: 480, terrainCells });
}

// 攻方站在 attackerX，目标站在其右侧 28px（接触距离），返回目标这一次掉的血
function damageFrom(attackerX) {
  const world = makeWorld(mapWithWater());
  const attacker = world.spawnUnit('blue', 'light', attackerX, 240);
  const target = world.spawnUnit('red', 'light', attackerX + 28, 240);
  const before = target.hp;
  world.spatial.rebuild(world.units);
  updateCombat(world, STEP);
  return { dealt: before - target.hp, attacker, world };
}

describe('水域：攻击力下降', () => {
  it('站在水里的单位攻击力按 attackMultiplier.water 打折', () => {
    const onLand = damageFrom(300);   // 陆上
    const inWater = damageFrom(420);  // 水里（目标 448 也在水里，但防御地形对水域无修正）
    expect(onLand.dealt).toBeGreaterThan(0);
    expect(inWater.dealt).toBeCloseTo(onLand.dealt * values.terrain.attackMultiplier.water, 6);
  });

  it('攻击倍率只与攻方所在地形有关，桥梁/平原等都不打折', () => {
    const world = makeWorld(mapWithWater());
    expect(world.terrain.attackMultiplierAt(420, 240)).toBe(values.terrain.attackMultiplier.water);
    expect(world.terrain.attackMultiplierAt(300, 240)).toBe(1);
    expect(world.terrain.attackMultiplierAt(450, 240)).toBe(values.terrain.attackMultiplier.water);
    expect(world.terrain.isWaterAt(420, 240)).toBe(true);
    expect(world.terrain.isWaterAt(300, 240)).toBe(false);
  });
});

describe('水域：持续掉血', () => {
  it('身处水域每秒掉 waterHpPerSecond 点血，并计入伤亡', () => {
    const world = makeWorld(mapWithWater());
    const unit = world.spawnUnit('blue', 'light', 420, 240); // 水里
    const dry = world.spawnUnit('blue', 'light', 300, 240);  // 岸上

    for (let i = 0; i < 600; i += 1) updateSupply(world, STEP); // 10 s（只跑损耗系统）
    expect(unit.maxHp - unit.hp).toBeCloseTo(values.terrain.waterHpPerSecond * 10, 1);
    expect(world.casualties.blue).toBeCloseTo(values.terrain.waterHpPerSecond * 10, 1);
    expect(dry.hp).toBe(dry.maxHp); // 岸上不掉血
  });

  it('水域掉血与补给状态无关（岸边补给正常也照样掉）', () => {
    const world = makeWorld(mapWithWater());
    const unit = world.spawnUnit('blue', 'light', 420, 240);
    updateSupply(world, STEP);
    expect(unit.supplied).toBe(true); // 有己方城市 → 补给正常
    expect(unit.hp).toBeLessThan(unit.maxHp);
  });

  it('泡在水里会溺水阵亡（cause = water）', () => {
    const world = makeWorld(mapWithWater());
    const unit = world.spawnUnit('blue', 'light', 420, 240);
    unit.hp = values.terrain.waterHpPerSecond * STEP * 2; // 只够两 tick
    world.tick(STEP);
    world.tick(STEP);
    expect(unit.state).toBe('dead');
    expect(world.history.some(e => e.type === 'unitDied' && e.unitId === unit.id && e.cause === 'water')).toBe(true);
  });

  it('桥梁不算水域：过桥不掉血', () => {
    const world = makeWorld(makePlainMap({
      width: 400, height: 240,
      terrainCells: { '20,10': values.terrain.codes.bridge },
    }));
    const unit = world.spawnUnit('blue', 'light', 205, 105); // 站在桥格上
    expect(world.terrain.terrainAt(unit.x, unit.y)).toBe(values.terrain.codes.bridge);
    for (let i = 0; i < 120; i += 1) updateSupply(world, STEP);
    expect(unit.hp).toBe(unit.maxHp);
    expect(world.casualties.blue).toBe(0);
  });
});
