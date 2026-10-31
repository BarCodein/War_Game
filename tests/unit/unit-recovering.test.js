import { describe, expect, it } from 'vitest';
import { recoveringNearCity } from '../../src/rendering/unitRenderer.js';
import { values } from '../../src/config/index.js';

// 「愈」角标：与 simulation/systems/supply.js#recoverNearCity 同一判据
// （己方城市恢复半径内 + 没满血；多城不叠加）。战役与联机共用这个判定。
const RADIUS = values.cities.recovery.radius;

function unit(overrides = {}) {
  return { id: 1, faction: 'blue', state: 'hold', hp: 50, maxHp: 100, x: 100, y: 100, ...overrides };
}

const world = (cities) => ({ cities });

describe('基地回血判定（愈角标）', () => {
  it('掉血 + 在己方城市半径内 → true', () => {
    expect(recoveringNearCity(world([{ faction: 'blue', x: 100 + RADIUS - 1, y: 100 }]), unit())).toBe(true);
  });

  it('满血 → false（没有在"回"）', () => {
    expect(recoveringNearCity(world([{ faction: 'blue', x: 100, y: 100 }]), unit({ hp: 100 }))).toBe(false);
  });

  it('半径之外 → false', () => {
    expect(recoveringNearCity(world([{ faction: 'blue', x: 100 + RADIUS + 5, y: 100 }]), unit())).toBe(false);
  });

  it('敌方城市不给自己回血 → false', () => {
    expect(recoveringNearCity(world([{ faction: 'red', x: 100, y: 100 }]), unit())).toBe(false);
  });

  it('阵亡单位 / 空世界 → false', () => {
    expect(recoveringNearCity(world([{ faction: 'blue', x: 100, y: 100 }]), unit({ state: 'dead' }))).toBe(false);
    expect(recoveringNearCity(null, unit())).toBe(false);
    expect(recoveringNearCity(world([]), unit())).toBe(false);
  });
});
