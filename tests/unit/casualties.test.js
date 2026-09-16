import { describe, expect, it } from 'vitest';
import { values } from '../../src/config/index.js';
import { makePlainMap, makeWorld } from './helpers.js';
import { resultQuery } from '../../src/rendering/hud.js';
import { updateCombat } from '../../src/simulation/systems/combat.js';

// 伤亡统计（gdd.md §11）：1 点损失的血量 = 1 点伤亡，按阵营累计后随 URL 参数传给结算页。
describe('伤亡统计', () => {
  it('1 点损失的血量记 1 点伤亡，且只记在被扣血的一方头上', () => {
    const world = makeWorld(makePlainMap({ width: 640, height: 480 }));
    const blue = world.spawnUnit('blue', 'light', 300, 240);
    const red = world.spawnUnit('red', 'light', 340, 240);

    world.damageUnit(red, 12.5);
    expect(world.casualties.red).toBeCloseTo(12.5, 6);
    expect(blue.hp).toBe(values.units.light.hp);
    expect(world.casualties.blue).toBe(0);

    world.damageUnit(blue, 3);
    expect(world.casualties.blue).toBeCloseTo(3, 6);
    expect(world.casualties.red).toBeCloseTo(12.5, 6);
  });

  it('超杀不算：只剩 5 血时挨 100 伤害只记 5 点伤亡', () => {
    const world = makeWorld(makePlainMap({ width: 640, height: 480 }));
    const red = world.spawnUnit('red', 'light', 340, 240);
    red.hp = 5;
    world.damageUnit(red, 100);
    expect(red.hp).toBe(-95); // 伤害照常结算（killUnit 会归零）
    expect(world.casualties.red).toBe(5);
  });

  it('阵亡单位不再重复记账；治疗也不算伤亡', () => {
    const world = makeWorld(makePlainMap({ width: 640, height: 480 }));
    const red = world.spawnUnit('red', 'light', 340, 240);
    world.damageUnit(red, 10);
    world.killUnit(red, 'combat');
    world.damageUnit(red, 10); // 已阵亡：不再记账
    expect(world.casualties.red).toBe(10);

    const blue = world.spawnUnit('blue', 'light', 300, 240);
    blue.hp = 10;
    blue.hp = Math.min(blue.maxHp, blue.hp + 30); // 城市恢复（治疗）直接改 hp
    expect(blue.hp).toBe(40);
    expect(world.casualties.blue).toBe(0);
  });

  it('战斗系统扣血走统一入口：交战后双方伤亡等于各自损失的血量', () => {
    const world = makeWorld(makePlainMap({ width: 640, height: 480 }));
    const blue = world.spawnUnit('blue', 'light', 300, 240);
    const red = world.spawnUnit('red', 'light', 328, 240); // 半径和 28 → 接触
    const blueHpBefore = blue.hp;
    const redHpBefore = red.hp;

    for (let i = 0; i < 30; i += 1) world.tick(values.simulation.fixedStep);
    updateCombat(world, 1 / 60);

    expect(world.casualties.blue).toBeCloseTo(blueHpBefore - blue.hp, 6);
    expect(world.casualties.red).toBeCloseTo(redHpBefore - red.hp, 6);
    expect(world.casualties.blue + world.casualties.red).toBeGreaterThan(0);
  });

  it('结算 URL 参数带双方伤亡（四舍五入为整数）', () => {
    const query = resultQuery({
      win: true,
      campaignId: 'subei_battle',
      timeText: '01:23',
      casualties: { blue: 123.4, red: 456.7 },
    });
    const params = new URLSearchParams(query);
    expect(params.get('result')).toBe('victory');
    expect(params.get('level')).toBe('subei_battle');
    expect(params.get('t')).toBe('01:23');
    expect(params.get('casualtiesBlue')).toBe('123');
    expect(params.get('casualtiesRed')).toBe('457');
  });

  it('结算 URL 参数：缺伤亡数据 / 无关卡时也不报错', () => {
    const params = new URLSearchParams(resultQuery({ win: false, campaignId: null, timeText: '00:05' }));
    expect(params.get('result')).toBe('defeat');
    expect(params.has('level')).toBe(false);
    expect(params.get('casualtiesBlue')).toBe('0');
    expect(params.get('casualtiesRed')).toBe('0');
  });
});
