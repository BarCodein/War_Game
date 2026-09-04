import { describe, expect, it } from 'vitest';
import values from '../../src/config/values.js';

describe('config values', () => {
  it('整体与嵌套对象均被冻结（禁止运行时篡改数值）', () => {
    expect(Object.isFrozen(values)).toBe(true);
    expect(Object.isFrozen(values.units)).toBe(true);
    expect(() => {
      values.units.light.hp = 999;
    }).toThrow();
  });

  it('与 docs/gdd.md §12 镜像表中的关键数值一致', () => {
    expect(values.units.light).toEqual({ hp: 60, damage: 8, attackInterval: 1.0, range: 40, speed: 90, radius: 10, vision: 140 });
    expect(values.units.heavy).toEqual({ hp: 120, damage: 16, attackInterval: 1.6, range: 55, speed: 55, radius: 14, vision: 160 });
    expect(values.morale.initial).toBe(80);
    expect(values.morale.rout.stopAt).toBe(20);
    expect(values.cities.production.interval).toBe(12);
    expect(values.supply.capacityPerCity).toBe(5);
    expect(values.fog.forestSpotDistance).toBe(60);
    expect(values.performance.targetUnits).toBe(500);
    expect(values.simulation.fixedStep).toBe(1 / 60);
  });
});
