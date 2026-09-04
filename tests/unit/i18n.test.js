import { describe, expect, it } from 'vitest';
import { t } from '../../src/i18n/index.js';

describe('i18n', () => {
  it('默认语言为中文，已知键返回中文文案', () => {
    expect(t('game.title')).toBe('WAR OF DOTS');
    expect(t('game.placeholder')).toContain('骨架');
  });

  it('缺键时返回键名本身（开发模式同时告警，不抛异常）', () => {
    expect(t('hud.doesNotExist')).toBe('hud.doesNotExist');
  });
});
