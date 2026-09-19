import { describe, expect, it } from 'vitest';
import { values } from '../../src/config/index.js';
import {
  AI_PRESET_NAMES, AI_TUNING_GROUPS, AI_TUNING_KEYS, resolveAiConfig, validateAiTuning,
} from '../../src/simulation/ai/presets.js';

// 难度/性格档位（docs/ai-design.md 阶段二 F）：三套基线 + 关卡级覆盖。
describe('档位解析', () => {
  it('三档都存在，且按性格单调变化（追击距离 / 预备队 / 佯动）', () => {
    expect(AI_PRESET_NAMES).toEqual(['cautious', 'standard', 'sly']);
    const { cautious, standard, sly } = values.ai.presets;
    expect(cautious.pursuitRadius).toBeLessThan(standard.pursuitRadius);
    expect(standard.pursuitRadius).toBeLessThan(sly.pursuitRadius);
    expect(cautious.reserveRatio).toBeGreaterThan(standard.reserveRatio);
    expect(standard.reserveRatio).toBeGreaterThan(sly.reserveRatio);
    expect(cautious.useForcedMarch).toBe(false); // 谨慎不走急行军
    expect(sly.feint).toBe(true);                 // 狡诈才佯动分兵
    expect(new Set([cautious.terrainBias, standard.terrainBias, sly.terrainBias]).size).toBe(3);
  });

  it('resolveAiConfig：档位覆盖同名项，pursuitRadius 同步为 engageRadius', () => {
    const standard = resolveAiConfig('standard');
    expect(standard.preset).toBe('standard');
    expect(standard.engageRadius).toBe(values.ai.presets.standard.pursuitRadius);
    expect(standard.reserveRatio).toBe(values.ai.presets.standard.reserveRatio);

    const cautious = resolveAiConfig('cautious');
    expect(cautious.engageRadius).toBe(values.ai.presets.cautious.pursuitRadius);
    expect(cautious.engageRadius).toBeLessThan(standard.engageRadius);
    expect(cautious.feint).toBe(false);
  });

  it('resolveAiConfig：ai.tuning 只覆盖列出的键，未列出的键不许出现', () => {
    const cfg = resolveAiConfig('standard', { pursuitRadius: 250, reserveRatio: 0.4, nope: 1 });
    expect(cfg.engageRadius).toBe(250);
    expect(cfg.reserveRatio).toBe(0.4);
    expect(cfg.nope).toBeUndefined();                 // 未知键被忽略（结构校验会报错）
    expect(cfg.squad).toBe(values.ai.squad);          // 未覆盖的域仍是原引用（不做深拷贝）
    expect(AI_TUNING_KEYS).toContain('terrainBias');
  });

  it('resolveAiConfig：未知档位回退到全局默认，不报错', () => {
    const cfg = resolveAiConfig('brutal');
    expect(cfg.preset).toBe(values.ai.preset);
  });

  it('resolveAiConfig 不修改 values.ai（可重复调用）', () => {
    const before = JSON.stringify(values.ai.presets);
    resolveAiConfig('sly', { pursuitRadius: 999, reserveRatio: 0 });
    expect(JSON.stringify(values.ai.presets)).toBe(before);
    expect(values.ai.engageRadius).toBe(320);
  });

  it('嵌套域覆盖（阶段六）：只改给出的那几项，其余保持原值，也不渗回 values.ai', () => {
    const cfg = resolveAiConfig('standard', {
      weights: { interdiction: 0.5 },
      interdiction: { minCuts: 3, cutRadius: 120 },
      relief: { forceRatio: 0.9 },
      supply: { lowRatio: 0.4 },
    });
    expect(cfg.weights.interdiction).toBe(0.5);
    expect(cfg.weights.supply).toBe(values.ai.weights.supply);              // 同域未覆盖的项原样
    expect(cfg.weights).not.toBe(values.ai.weights);                        // 只浅拷贝一层
    expect(cfg.interdiction.minCuts).toBe(3);
    expect(cfg.interdiction.maxDistance).toBe(values.ai.interdiction.maxDistance);
    expect(cfg.relief.forceRatio).toBe(0.9);
    expect(cfg.supply.lowRatio).toBe(0.4);
    expect(cfg.supply.squadCutFraction).toBe(values.ai.supply.squadCutFraction);
    // 原值不动（体量：4 组共 27 个可覆盖键）
    expect(values.ai.weights.interdiction).toBe(0.2);
    expect(values.ai.interdiction.minCuts).toBe(2);
    expect(Object.values(AI_TUNING_GROUPS).reduce((sum, spec) => sum + Object.keys(spec).length, 0)).toBe(27);
  });
});

describe('关卡 JSON 校验', () => {
  it('合法档位与覆盖项通过', () => {
    expect(validateAiTuning({ faction: 'red', preset: 'sly', tuning: { reserveRatio: 0, pursuitRadius: 500, useForcedMarch: true, terrainBias: 'mobility', feint: true } }))
      .toEqual([]);
    expect(validateAiTuning({ faction: 'red' })).toEqual([]);
    expect(validateAiTuning({ faction: 'red', tuning: {} })).toEqual([]);
  });

  it('非法档位 / 未知覆盖键 / 越界数值逐个报出来', () => {
    const errors = validateAiTuning({
      preset: 'brutal',
      tuning: { nope: 1, reserveRatio: 2, pursuitRadius: -5, useForcedMarch: 'yes', feint: 1, terrainBias: 'sneaky' },
    });
    expect(errors.some(e => e.includes('preset must be one of'))).toBe(true);
    expect(errors.some(e => e.includes('unknown key: nope'))).toBe(true);
    expect(errors.some(e => e.includes('reserveRatio must be in [0, 1)'))).toBe(true);
    expect(errors.some(e => e.includes('pursuitRadius must be > 0'))).toBe(true);
    expect(errors.some(e => e.includes('useForcedMarch must be a boolean'))).toBe(true);
    expect(errors.some(e => e.includes('feint must be a boolean'))).toBe(true);
    expect(errors.some(e => e.includes('terrainBias must be one of'))).toBe(true);
    expect(validateAiTuning({ tuning: 5 }).some(e => e.includes('tuning must be an object'))).toBe(true);
  });

  it('嵌套域的校验：未知子键 / 类型不对 / 越界都会报出来', () => {
    const errors = validateAiTuning({
      tuning: {
        weights: { interdiction: 5, nope: 1 },
        interdiction: 'yes',
        relief: { forceRatio: -1 },
      },
    });
    expect(errors.some(e => e.includes('tuning.weights.interdiction must be a number in [0, 2]'))).toBe(true);
    expect(errors.some(e => e.includes('tuning.weights unknown key: nope'))).toBe(true);
    expect(errors.some(e => e.includes('tuning.interdiction must be an object'))).toBe(true);
    expect(errors.some(e => e.includes('tuning.relief.forceRatio must be a number in [0, 3]'))).toBe(true);
    expect(validateAiTuning({ tuning: { weights: { interdiction: 0.3 } } })).toEqual([]);
    expect(validateAiTuning({ tuning: { interdiction: { minCuts: 3, cutRadius: 120 } } })).toEqual([]);
  });
});
