import { values } from '../../config/index.js';

// 难度/性格档位（docs/ai-design.md 阶段二 F）：三套基线参数 + 关卡级 ai.tuning 覆盖。
// 纯函数，可单测（tests/unit/ai-presets.test.js）。

export const AI_PRESET_NAMES = Object.keys(values.ai.presets);

// 允许被 ai.tuning 覆盖的键（避免关卡写出拼错的键却静默无效）
export const AI_TUNING_KEYS = ['reserveRatio', 'pursuitRadius', 'useForcedMarch', 'terrainBias', 'feint', 'supplyCaution'];

/**
 * 解析本次对局的 AI 配置：`presets[preset]` 覆盖 `values.ai` 的同名项，`tuning` 再覆盖一层。
 * 返回的是浅拷贝后的配置对象（不修改 values，也不修改关卡的 JSON 对象）。
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
        if (!AI_TUNING_KEYS.includes(key)) errors.push(`${where}.tuning unknown key: ${key}`);
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
