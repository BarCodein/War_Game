import { describe, expect, it } from 'vitest';
import {
  LEVEL_STORAGE_KEY, levelHref, levelIdFromLocation, recallLevelId, rememberLevelId, resolveLevelId,
} from '../../src/level-link.js';

// 回归背景：静态服务器（npx serve 的 cleanUrls）会把 "/battlebackground.html?level=x"
// 301 重写成 "/battlebackground" 并且**丢掉查询参数**，于是目标页面拿不到关卡 id，
// 只能退回默认关卡——表现就是"点宿北却显示塔山"。
// 因此关卡 id 必须能从 hash / sessionStorage 兜底取到，跳转时也要带上 hash。
describe('关卡定位：URL / hash / sessionStorage 三重兜底', () => {
  const loc = (search = '', hash = '') => ({ search, hash });

  it('优先读查询参数', () => {
    expect(levelIdFromLocation(loc('?level=subei_battle'))).toBe('subei_battle');
    expect(levelIdFromLocation(loc('?foo=1&level=tashan_battle'))).toBe('tashan_battle');
  });

  it('查询参数丢失（cleanUrls 重写）时退回 hash', () => {
    expect(levelIdFromLocation(loc('', '#level=subei_battle'))).toBe('subei_battle');
    // 只认 #level=<id>：裸 hash 是别的用途（#bench / #fromEditor），不能当关卡 id
    expect(levelIdFromLocation(loc('', '#subei_battle'))).toBe(null);
    expect(levelIdFromLocation(loc('', '#fromEditor'))).toBe(null);
    expect(levelIdFromLocation(loc('', '#bench'))).toBe(null);
  });

  it('跳转地址同时带查询参数与 hash', () => {
    expect(levelHref('/game.html', 'subei_battle')).toBe('/game.html?level=subei_battle#level=subei_battle');
    expect(levelHref('/game.html', null)).toBe('/game.html');
    expect(levelHref('./loading.html', 'xian_battle')).toBe('./loading.html?level=xian_battle#level=xian_battle');
  });

  it('记住 / 读取最近一次选择（存储不可用时静默失败）', () => {
    const store = new Map();
    const storage = {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
    };
    expect(recallLevelId(storage)).toBe(null);
    rememberLevelId('tashan_battle', storage);
    expect(store.get(LEVEL_STORAGE_KEY)).toBe('tashan_battle');
    expect(recallLevelId(storage)).toBe('tashan_battle');

    // 隐私模式等场景：storage 抛错也不能影响跳转
    const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
    expect(() => rememberLevelId('subei_battle', broken)).not.toThrow();
    expect(recallLevelId(broken)).toBe(null);
  });

  it('完整解析顺序：查询参数 → hash → 存储 → 缺省值', () => {
    const storage = { getItem: () => 'xian_battle' };
    expect(resolveLevelId({ location: loc('?level=subei_battle', '#level=tashan_battle'), storage }))
      .toBe('subei_battle');
    expect(resolveLevelId({ location: loc('', '#level=tashan_battle'), storage })).toBe('tashan_battle');
    expect(resolveLevelId({ location: loc('', ''), storage })).toBe('xian_battle');
    expect(resolveLevelId({ location: loc('', ''), storage: { getItem: () => null }, fallback: 'fracture-canyon' }))
      .toBe('fracture-canyon');
  });
});
