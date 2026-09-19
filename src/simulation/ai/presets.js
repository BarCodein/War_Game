import { values } from '../../config/index.js';

// 难度/性格档位（docs/ai-design.md 阶段二 F）：三套基线参数 + 关卡级 ai.tuning 覆盖。
// 纯函数，可单测（tests/unit/ai-presets.test.js）。

export const AI_PRESET_NAMES = Object.keys(values.ai.presets);

// 允许被 ai.tuning 覆盖的键（避免关卡写出拼错的键却静默无效）
export const AI_TUNING_KEYS = ['reserveRatio', 'pursuitRadius', 'useForcedMarch', 'terrainBias', 'feint', 'supplyCaution'];

// 可以**按子对象**覆盖的域（阶段六，docs/ai-design.md §3.9）：只覆盖给出的那几项，其余保持原值。
// 用途：关卡想调"这台 AI 多看重补给 / 多爱断粮道 / 撤退时多怕被围"，以及离线调参脚本
// （scripts/tune.mjs）逐参数扫描。值一律是纯数字 + [min, max] 区间校验；
// `{min,max}` 这类"档位插值区间"（supply.reachRatio 等）不在可覆盖范围内。
export const AI_TUNING_GROUPS = {
  weights: {
    threat: [0, 2], kill: [0, 2], distance: [0, 2], value: [0, 2], vulnerability: [0, 2],
    chase: [0, 2], terrain: [0, 2], approach: [0, 2], supply: [0, 2], interdiction: [0, 2],
  },
  supply: {
    lowRatio: [0, 1], squadCutFraction: [0, 1], regroupCautionRange: [0, 1], regroupRatioFallback: [0, 1],
  },
  interdiction: {
    minCuts: [1, 8], corridorSamples: [1, 9], minCorridor: [0, 2000],
    minDistance: [0, 2000], maxDistance: [1, 5000], cutRadius: [1, 1000],
  },
  relief: {
    threatRadius: [1, 2000], standoff: [0, 2000], minUsers: [1, 20], minLoadPoints: [0, 20],
    forceRatio: [0, 3], maxDistance: [1, 5000], retreatThreatPenalty: [0, 5000],
  },
};

/**
 * 解析本次对局的 AI 配置：`presets[preset]` 覆盖 `values.ai` 的同名项，`tuning` 再覆盖一层。
 * 返回的是浅拷贝后的配置对象（不修改 values，也不修改关卡的 JSON 对象）；
 * 嵌套域（`weights` / `supply` / `interdiction` / `relief`）被覆盖时只做一层浅拷贝，
 * 所以改动不会渗回 `values.ai`。
 */
export function resolveAiConfig(preset, tuning) {
  const cfg = { ...values.ai };
  const name = AI_PRESET_NAMES.includes(preset) ? preset : values.ai.preset;
  const base = values.ai.presets[name] ?? {};
  Object.assign(cfg, base);
  cfg.preset = name;
  if (tuning && typeof tuning === 'object') {
    for (const key of AI_TUNING_KEYS) {
      if (tuning[key] !== undefined) cfg[key] = tuning[key];
    }
    for (const [group, spec] of Object.entries(AI_TUNING_GROUPS)) {
      const override = tuning[group];
      if (!override || typeof override !== 'object') continue;
      const merged = { ...(values.ai[group] ?? {}) };
      for (const key of Object.keys(spec)) {
        if (override[key] !== undefined) merged[key] = override[key];
      }
      cfg[group] = merged;
    }
  }
  // pursuitRadius 就是本局的交战/追击半径（取代阶段一的固定 engageRadius）
  if (typeof cfg.pursuitRadius === 'number') cfg.engageRadius = cfg.pursuitRadius;
  return cfg;
}

// 关卡 JSON 里 ai.preset / ai.tuning / ai.fog 的校验（由 level.js 调用）
export function validateAiTuning(ai, where = 'ai') {
  const errors = [];
  if (ai?.preset !== undefined && !AI_PRESET_NAMES.includes(ai.preset)) {
    errors.push(`${where}.preset must be one of ${AI_PRESET_NAMES.join(' | ')}`);
  }
  // 阶段三：迷雾公平开关（默认关，关卡显式开启）
  if (ai?.fog !== undefined && typeof ai.fog !== 'boolean') {
    errors.push(`${where}.fog must be a boolean`);
  }
  if (ai?.tuning !== undefined) {
    if (!ai.tuning || typeof ai.tuning !== 'object') {
      errors.push(`${where}.tuning must be an object`);
    } else {
      for (const key of Object.keys(ai.tuning)) {
        if (!AI_TUNING_KEYS.includes(key) && !AI_TUNING_GROUPS[key]) {
          errors.push(`${where}.tuning unknown key: ${key}`);
        }
      }
      // 嵌套域：逐个检查子键是否在允许列表里、值是否落在区间内
      for (const [group, spec] of Object.entries(AI_TUNING_GROUPS)) {
        const override = ai.tuning[group];
        if (override === undefined) continue;
        if (!override || typeof override !== 'object') {
          errors.push(`${where}.tuning.${group} must be an object`);
          continue;
        }
        for (const [key, value] of Object.entries(override)) {
          const range = spec[key];
          if (!range) {
            errors.push(`${where}.tuning.${group} unknown key: ${key}`);
            continue;
          }
          if (typeof value !== 'number' || !Number.isFinite(value) || value < range[0] || value > range[1]) {
            errors.push(`${where}.tuning.${group}.${key} must be a number in [${range[0]}, ${range[1]}]`);
          }
        }
      }
      const t = ai.tuning;
      if (t.reserveRatio !== undefined && !(typeof t.reserveRatio === 'number' && t.reserveRatio >= 0 && t.reserveRatio < 1)) {
        errors.push(`${where}.tuning.reserveRatio must be in [0, 1)`);
      }
      if (t.pursuitRadius !== undefined && !(typeof t.pursuitRadius === 'number' && t.pursuitRadius > 0)) {
        errors.push(`${where}.tuning.pursuitRadius must be > 0`);
      }
      if (t.useForcedMarch !== undefined && typeof t.useForcedMarch !== 'boolean') {
        errors.push(`${where}.tuning.useForcedMarch must be a boolean`);
      }
      if (t.feint !== undefined && typeof t.feint !== 'boolean') {
        errors.push(`${where}.tuning.feint must be a boolean`);
      }
      if (t.terrainBias !== undefined && !values.ai.terrainBias[t.terrainBias]) {
        errors.push(`${where}.tuning.terrainBias must be one of ${Object.keys(values.ai.terrainBias).join(' | ')}`);
      }
      if (t.supplyCaution !== undefined
        && !(typeof t.supplyCaution === 'number' && t.supplyCaution >= 0 && t.supplyCaution <= 1)) {
        errors.push(`${where}.tuning.supplyCaution must be in [0, 1]`);
      }
    }
  }
  return errors;
}
