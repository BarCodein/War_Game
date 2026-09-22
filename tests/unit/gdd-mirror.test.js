import { describe, expect, it } from 'vitest';
import values from '../../src/config/values.js';

// config/values.js ↔ gdd.md §12 镜像表一致性（architecture.md §9 的同步测试）。
// 下方 MIRROR 常量是 gdd.md §12 表格的代码化镜像——修改数值时必须两处同步，
// 否则本测试失败（防文档漂移）。
const MIRROR = {
  'units.light': { hp: 60, damage: 0.8, attackInterval: 0.2, range: 40, speed: 40, radius: 14, vision: 140, supplyStock: 80 },
  'units.heavy': { hp: 80, damage: 1, attackInterval: 0.2, range: 40, speed: 40, radius: 14, vision: 160, supplyStock: 120 },
  'combat.defend': 0.75,
  'combat.hp_dps_ratio': 0.8,
  'combat.disorderedDamageTaken': 1.5,
  'supplyStock.min': 0,
  'supplyStock.perSecond': { idle: -1, inCombat: -8, inCombatSupport: -3, moving: -5, attack: 1.3 },
  'supplyStock.thresholds': { weakenedBelow: 0.6, shakenBelow: 0.3, routAt: 0 },
  'supplyStock.effects.weakened': { damageMultiplier: 0.75, speedMultiplier: 0.85 },
  'supplyStock.effects.shaken': { damageMultiplier: 0.5, speedMultiplier: 0.7 },
  'supplyStock.rout': { recoverPerSecond: 8, stopAt: 20, stuckSeconds: 5 },
  'supplyStock.unordered': { recoverPerSecond: 10, stopAt: 20, stuckSeconds: 5 },
  'cities.capture': { radius: 60, perUnitPerSecond: 0.05, capPerSecond: 0.15, decayPerSecond: 0.03 },
  'cities.production': { enabled: false, interval: 12, unitType: 'light', pauseWhenSupplyFull: true },
  'cities.recovery': { radius: 100, hpPerSecond: 3 },
  'cities.vision': 180,
  'capturePoints.vision': 180,
  'capturePoints.capture': { radius: 60, perUnitPerSecond: 0.05, capPerSecond: 0.15, decayPerSecond: 0.03 },
  'supply.demandPerUnit': 1,
  'supply.capacityPerCity': 5,
  'supply.stockPerPoint': 10,
  'supply.attritionHpPerSecond': 1,
  'supply.refreshSeconds': 0.5,
  'supply.fieldRefreshSeconds': 1,
  'supply.enemyControlBlocks': true,
  'supply.waterIsBarrier': false,
  'supply.factor': { fullCost: 100, zeroCost: 900, min: 0.2 },
  'supply.path': { cellSize: 20, maxCost: 1500, controlBlockMin: 0.01 },
  'fog.forestSpotDistance': 60,
  'fog.showLastKnownGhost': true,
  'stats.hpPerCasualty': 1,
  'controlLine.cellSize': 20,
  'controlLine.refreshTicks': 6,
  'controlLine.temporalSmoothing': 0.35,
  'controlLine.fieldBlurPasses': 0,
  'controlLine.pathSmoothing': 2,
  'controlLine.neutralEpsilon': 0,
  'controlLine.partitionMap': true,
  'controlLine.partitionFillValue': 0.01,
  'controlLine.guaranteeUnitCell': true,
  'controlLine.curve': {
    maxDistance: 40,
    coreExitRatio: 0.2,
    midDistance: 25,
    midEndRatio: 0.0625,
    edgeEndRatio: 0.025,
  },
  'controlLine.unit': { influenceRadius: 140, strength: 100 },
  'controlLine.city': { influenceRadius: 140, strength: 80, coreRadius: 20 },
  'controlLine.capturePoint': { influenceRadius: 140, strength: 60, coreRadius: 20 },
  'terrain.gridCellSize': 10,
  'terrain.codes': { plain: 0, forest: 1, water: 2, bridge: 3, mountain: 4, highMountain: 5, road: 6, town: 7 },
  'terrain.passable': { plain: true, forest: true, water: true, bridge: true, mountain: true, highMountain: false, road: true, town: true },
  'terrain.moveMultiplier': { plain: 1.0, forest: 0.6, water: 0.4, bridge: 1.0, mountain: 0.65, highMountain: 0, road: 1.25, town: 1.0 },
  'terrain.defenseModifier': { plain: 1.0, forest: 0.85, bridge: 0.9, mountain: 0.75, road: 1.0, town: 0.6 },
  'terrain.attackMultiplier': { plain: 1.0, forest: 1.0, water: 0.5, bridge: 1.0, mountain: 1.0, highMountain: 0, road: 1.0, town: 1.0 },
  'terrain.waterHpPerSecond': 1,
  'terrain.marchSupplyMultiplier': { plain: 1.0, forest: 1.0, water: 1.0, bridge: 1.0, mountain: 1.0, highMountain: 1.0, road: 0.5, town: 1.0 },
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
  'movement.forcedMarch': { speedMultiplier: 1.5, supplyPerSecond: -10, hpPerSecond: 1.5 },
  'ui.toastDurationMs': 2200,
  'ui.timerRefreshMs': 1000,
  'ui.resultHoldMs': 1000,
  'simulation.fixedStep': 1 / 60,
  'simulation.maxCatchUpTicks': 5,
  'simulation.speeds': [0.5, 1, 2],
  'prep.seconds': 5,
  'camera': { zoomMin: 1, zoomMax: 3, zoomStep: 1.1, zoomSmoothing: 1 },
  'ai.preset': 'standard',
  'ai.presets': {
    cautious: { reserveRatio: 0.3, pursuitRadius: 180, useForcedMarch: false, terrainBias: 'defensive', feint: false, supplyCaution: 0.8 },
    standard: { reserveRatio: 0.15, pursuitRadius: 320, useForcedMarch: true, terrainBias: 'balanced', feint: false, supplyCaution: 0.5 },
    sly: { reserveRatio: 0, pursuitRadius: 520, useForcedMarch: true, terrainBias: 'mobility', feint: true, supplyCaution: 0.2 },
  },
  'ai.decisionIntervalSeconds': 0.5,
  'ai.hysteresis': 0.15,
  'ai.engageRadius': 320,
  'ai.localForceRadius': 180,
  'ai.weights': {
    threat: 0.3, kill: 0.15, distance: 0.15, value: 0.15, vulnerability: 0.1, chase: 0.15, terrain: 0.15,
    approach: 0.4, supply: 0.25, interdiction: 0.2,
  },
  'ai.supply': {
    lowRatio: 0.3, squadCutFraction: 0.5,
    reachRatio: { min: 0.95, max: 0.65 }, weightScale: { min: 0.7, max: 1.4 },
    forcedMarchStock: { min: 0.35, max: 0.7 }, regroupCautionRange: 0.2, regroupRatioFallback: 0.5,
  },
  'ai.interdiction': {
    minCuts: 2, corridorSamples: 3, minCorridor: 240, minDistance: 160, maxDistance: 900, cutRadius: 140,
  },
  'ai.relief': {
    threatRadius: 200, standoff: 180, minUsers: 2, minLoadPoints: 1, forceRatio: 0.5,
    maxDistance: 1200, retreatThreatPenalty: 400,
  },
  'ai.squad': {
    cohesionRadius: 170, cohesionRatio: 0.7, slotSpacing: 34, maxAttackersPerTarget: 2,
    columnSampleStep: 20, advanceStep: 60,
  },
  'ai.weakSpot': { frontSearchRadius: 460, sampleRadius: 170, pointLimit: 24, axisCount: 3, axisSpread: 0.6, standoff: 220 },
  'ai.terrainBias': {
    defensive: { defense: 0.7, mobility: 0.1 },
    balanced: { defense: 0.4, mobility: 0.4 },
    mobility: { defense: 0.15, mobility: 0.7 },
  },
  'ai.reserve': { commitMainRatio: 0.6, commitWeaknessRatio: 0.7, rallyBehind: 170 },
  'ai.regroup': { hpRatio: 0.45, supplyRatio: 0.5, recoverHpRatio: 0.75, recoverSupplyRatio: 0.75, cooldownSeconds: 12 },
  'ai.march': { minDistance: 650 },
  'ai.fog': false,
  'ai.memory': { fadeSeconds: 25, staleConfidence: 0.35 },
  'ai.scout': { enabled: true, perGroup: 1, minSquadSize: 3, maxExploreRadius: 900 },
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
