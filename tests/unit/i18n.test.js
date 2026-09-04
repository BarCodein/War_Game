import { describe, expect, it } from 'vitest';
import { t } from '../../src/i18n/index.js';

describe('i18n', () => {
  it('默认语言为中文，已知键返回中文文案', () => {
    expect(t('hud.brand.title')).toBe('WAR OF DOTS');
    expect(t('hud.selection.none')).toBe('未选择单位');
  });

  it('支持 {name} 参数插值', () => {
    expect(t('hud.units.count', { n: '03' })).toBe('03 UNITS');
    expect(t('unit.fullname', { faction: '蓝军', name: '步兵师', id: 1 })).toBe('蓝军步兵师-1');
  });

  it('缺键时返回键名本身（开发模式同时告警，不抛异常）', () => {
    expect(t('hud.doesNotExist')).toBe('hud.doesNotExist');
  });
});
