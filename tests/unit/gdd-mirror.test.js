import { describe, expect, it } from 'vitest';
import values from '../../src/config/values.js';

// config/values.js ↔ gdd.md §12 镜像表一致性（architecture.md §9 的同步测试）。
// 下方 MIRROR 常量是 gdd.md §12 表格的代码化镜像——修改数值时必须两处同步，
// 否则本测试失败（防文档漂移）。
const MIRROR = {
  'units.light': { hp: 60, damage: 0.8, attackInterval: 0.2, range: 40, speed: 40, radius: 14, vision: 140 },
  'units.heavy': { hp: 80, damage: 1, attackInterval: 0.2, range: 40, speed: 40, radius: 14, vision: 160 },
  'combat.defend': 0.75,
  'combat.hp_dps_ratio': 0.8,
  'morale.initial': 80,
  'morale.perSecond': { friendlyNearby: 2, cityNearby: 5, supplied: 1, unsupplied: -2, inCombat: -8, moving: -5, attack: 1.3 },
  'morale.ranges': { friendly: 60, city: 120, allyDeath: 100 },
  'morale.onAllyDeath': -10,
  'morale.thresholds': { weakenedBelow: 60, shakenBelow: 30, routAt: 0 },
  'morale.effects.weakened': { damageMultiplier: 0.75, speedMultiplier: 0.85 },
  'morale.effects.shaken': { damageMultiplier: 0.5, speedMultiplier: 0.7 },
  'morale.rout': { recoverPerSecond: 8, stopAt: 20, stuckSeconds: 5 },
  'morale.unordered': { recoverPerSecond: 10, stopAt: 20, stuckSeconds: 5 },
  'cities.capture': { radius: 60, perUnitPerSecond: 0.05, capPerSecond: 0.15, decayPerSecond: 0.03 },
  'cities.production': { interval: 12, unitType: 'light', pauseWhenSupplyFull: true },
  'cities.recovery': { radius: 100, hpPerSecond: 3, moralePerSecond: 5 },
  'cities.vision': 180,
  'capturePoints.vision': 180,
  'capturePoints.capture': { radius: 60, perUnitPerSecond: 0.05, capPerSecond: 0.15, decayPerSecond: 0.03 },
  'supply.capacityPerCity': 5,
  'supply.attritionHpPerSecond': 1,
  'supply.attritionMoralePerSecond': 2,
  'fog.forestSpotDistance': 60,
  'fog.showLastKnownGhost': true,
  'terrain.gridCellSize': 10,
  'terrain.codes': { plain: 0, forest: 1, water: 2, bridge: 3, mountain: 4, highMountain: 5, road: 6, town: 7 },
  'terrain.passable': { plain: true, forest: true, water: true, bridge: true, mountain: true, highMountain: false, road: true, town: true },
  'terrain.moveMultiplier': { plain: 1.0, forest: 0.6, water: 0.4, bridge: 1.0, mountain: 0.65, highMountain: 0, road: 1.25, town: 1.0 },
  'terrain.defenseModifier': { plain: 1.0, forest: 0.85, bridge: 0.9, mountain: 0.75, road: 1.0, town: 0.6 },
  'terrain.moraleMoveMultiplier': { plain: 1.0, forest: 1.0, water: 1.0, bridge: 1.0, mountain: 1.0, highMountain: 1.0, road: 0.5, town: 1.0 },
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
  'movement.routSpeedMultiplier': 0.6,
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
