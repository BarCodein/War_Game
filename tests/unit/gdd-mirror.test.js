import { describe, expect, it } from 'vitest';
import values from '../../src/config/values.js';

// config/values.js ↔ gdd.md §12 镜像表一致性（architecture.md §9 的同步测试）。
// 下方 MIRROR 常量是 gdd.md §12 表格的代码化镜像——修改数值时必须两处同步，
// 否则本测试失败（防文档漂移）。
const MIRROR = {
  'units.light': { hp: 60, damage: 8, attackInterval: 1.0, range: 40, speed: 90, radius: 10, vision: 140 },
  'units.heavy': { hp: 120, damage: 16, attackInterval: 1.6, range: 55, speed: 55, radius: 14, vision: 160 },
  'morale.initial': 80,
  'morale.perSecond': { friendlyNearby: 2, cityNearby: 5, supplied: 1, unsupplied: -2, inCombat: -1 },
  'morale.ranges': { friendly: 60, city: 120, allyDeath: 100 },
  'morale.onAllyDeath': -10,
  'morale.thresholds': { weakenedBelow: 60, shakenBelow: 30, routAt: 0 },
  'morale.effects.weakened': { damageMultiplier: 0.75, speedMultiplier: 0.85 },
  'morale.effects.shaken': { damageMultiplier: 0.5, speedMultiplier: 0.7 },
  'morale.rout': { recoverPerSecond: 8, stopAt: 20, stuckSeconds: 5 },
  'cities.capture': { radius: 60, perUnitPerSecond: 0.05, capPerSecond: 0.15, decayPerSecond: 0.03 },
  'cities.production': { interval: 12, unitType: 'light', pauseWhenSupplyFull: true },
  'cities.recovery': { radius: 120, hpPerSecond: 3, moralePerSecond: 5 },
  'cities.vision': 180,
  'supply.capacityPerCity': 5,
  'supply.attritionHpPerSecond': 1,
  'supply.attritionMoralePerSecond': 2,
  'fog.forestSpotDistance': 60,
  'fog.showLastKnownGhost': true,
  'terrain.gridCellSize': 20,
  'terrain.codes': { plain: 0, forest: 1, water: 2, bridge: 3 },
  'terrain.passable': { plain: true, forest: true, water: false, bridge: true },
  'terrain.moveMultiplier': { plain: 1.0, forest: 0.6, bridge: 1.0 },
  'terrain.defenseModifier': { plain: 1.0, forest: 0.85, bridge: 0.9 },
  'spatial.cellSize': 64,
  'performance.targetFps': 60,
  'performance.targetUnits': 500,
  'performance.simTickBudgetMs': 8,
  'performance.renderBudgetMs': 8,
  'performance.hudRefreshMs': 100,
  'input.clickHitRadius': 25,
  'input.dragBoxThreshold': 8,
  'input.routeSampleDistance': 8,
  'input.routeMinLength': 4,
  'input.routeUnitOffset': 18,
  'ui.toastDurationMs': 2200,
  'ui.timerRefreshMs': 1000,
  'simulation.fixedStep': 1 / 60,
  'simulation.maxCatchUpTicks': 5,
  'simulation.speeds': [0.5, 1, 2],
  'tutorial.map': { width: 1280, height: 720, midlineX: 640 },
  'tutorial.forces': { blue: { light: 3, heavy: 1 }, red: { light: 2, heavy: 2 } },
  'tutorial.garrisonRadius': 80,
  'tutorial.clearRadius': 200,
  'tutorial.reinforcement': {
    atSecond: 60, count: 2, unitType: 'light', spawn: { x: 1230, y: 400 }, moveTo: { x: 1080, y: 160 },
  },
};

function getByPath(root, path) {
  return path.split('.').reduce((current, key) => current[key], root);
}

describe('config ↔ gdd.md §12 镜像一致性', () => {
  it('config/values.js 与镜像表逐项一致', () => {
    for (const [path, expected] of Object.entries(MIRROR)) {
      expect(getByPath(values, path), path).toEqual(expected);
    }
  });

  it('镜像表覆盖的 config 键均存在（防遗漏）', () => {
    for (const path of Object.keys(MIRROR)) {
      expect(getByPath(values, path)).toBeDefined();
    }
  });
});
