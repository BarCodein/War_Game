import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  GUEST_USER, KEY_PREFIX, USER_DATA_NAMES, currentUser, legacyKey, migrateLegacy,
  normalizeUser, readFlag, readJSON, userKey, writeFlag, writeJSON,
} from '../../src/user-storage.js';

// 按账号隔离的本地存储（修复"同机不同账号共享进度"）：
//   · 进度类数据的键 = war-of-dots.u.<账号>.<数据名>；
//   · 账号取 war-of-dots.session 的 username（没有有效会话 = guest）；
//   · 旧版全局键在首次登录/打开页面时迁给当前账号，然后删掉；
//   · src/user-storage.js（ES 模块）与 public/user-storage.js（classic 副本）必须同逻辑 —— 最后两条用例守住。

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial).map(([key, value]) => [key, String(value)]));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
    keys: () => [...map.keys()],
    raw: map,
  };
}

function install(session, initial = {}) {
  const storage = fakeStorage(initial);
  if (session !== undefined && session !== null) {
    storage.setItem('war-of-dots.session', JSON.stringify({ username: session }));
  }
  globalThis.localStorage = storage;
  return storage;
}

afterEach(() => {
  delete globalThis.localStorage;
});

describe('账号命名空间', () => {
  it('账号名归一化：小写 + 非字母数字转下划线；空 / 全符号 → guest', () => {
    expect(normalizeUser('Zhang San')).toBe('zhang_san');
    expect(normalizeUser('E2E-User')).toBe('e2e_user');
    expect(normalizeUser('dz634220@163.com')).toBe('dz634220_163_com');
    expect(normalizeUser('  Bob  ')).toBe('bob');
    expect(normalizeUser('')).toBe(GUEST_USER);
    expect(normalizeUser('...')).toBe(GUEST_USER);
    expect(normalizeUser(undefined)).toBe(GUEST_USER);
  });

  it('键形如 war-of-dots.u.<账号>.<数据名>；没有会话时落到 guest', () => {
    install('zhangsan');
    expect(currentUser()).toBe('zhangsan');
    expect(userKey('campaign-progress')).toBe(`${KEY_PREFIX}zhangsan.campaign-progress`);
    expect(userKey('campaign-progress')).toBe('war-of-dots.u.zhangsan.campaign-progress');

    install(null);
    expect(currentUser()).toBe(GUEST_USER);
    expect(userKey('level-stats')).toBe('war-of-dots.u.guest.level-stats');

    // 会话损坏（不是 JSON）也不能崩，按 guest 处理
    const broken = fakeStorage({ 'war-of-dots.session': 'not-json' });
    globalThis.localStorage = broken;
    expect(currentUser()).toBe(GUEST_USER);
  });

  it('两个账号的数据互不可见（同一台机器、同一个浏览器）', () => {
    const storage = install('alice');
    writeJSON('campaign-progress', { subei_battle: { completed: true, wins: 1 } });
    writeFlag('has-defeat');

    // 换成 bob：读不到 alice 的进度，写自己的也不影响 alice
    storage.setItem('war-of-dots.session', JSON.stringify({ username: 'bob' }));
    expect(readJSON('campaign-progress', {})).toEqual({});
    expect(readFlag('has-defeat')).toBe(false);
    writeJSON('campaign-progress', { tashan_battle: { completed: true, wins: 1 } });

    storage.setItem('war-of-dots.session', JSON.stringify({ username: 'alice' }));
    expect(readJSON('campaign-progress', {})).toEqual({ subei_battle: { completed: true, wins: 1 } });
    expect(readFlag('has-defeat')).toBe(true);
    // 两个命名空间同时在，互不覆盖
    expect(storage.getItem('war-of-dots.u.alice.campaign-progress')).toContain('subei_battle');
    expect(storage.getItem('war-of-dots.u.bob.campaign-progress')).toContain('tashan_battle');
  });

  it('读写 / 标记 / 缺省值', () => {
    install('alice');
    expect(readJSON('level-stats', {})).toEqual({});
    expect(readJSON('level-stats')).toBeNull();
    expect(readFlag('climb-cleared')).toBe(false);
    writeJSON('level-stats', { subei_battle: { cleared: true, bestTime: 120 } });
    expect(readJSON('level-stats', {}).subei_battle.bestTime).toBe(120);
    writeFlag('climb-cleared');
    expect(readFlag('climb-cleared')).toBe(true);
    // 存储损坏 → 按缺省值处理，不抛错
    globalThis.localStorage = { getItem: () => '{坏值', setItem: () => {}, removeItem: () => {} };
    expect(readJSON('level-stats', { fallback: true })).toEqual({ fallback: true });
    expect(readFlag('climb-cleared')).toBe(false);
  });
});

describe('旧版全局数据迁移', () => {
  it('迁给当前登录账号，然后删掉旧键；重复调用不再迁移', () => {
    const storage = install('alice', {
      'war-of-dots.campaign-progress': JSON.stringify({ subei_battle: { completed: true } }),
      'war-of-dots.has-defeat': '1',
      'war-of-dots.climb-stats': JSON.stringify({ deaths: 3 }),
    });
    // 迁移顺序跟随 USER_DATA_NAMES（campaign-progress → climb-stats → has-defeat）
    expect(migrateLegacy()).toEqual(['campaign-progress', 'climb-stats', 'has-defeat']);
    expect(readJSON('campaign-progress', {})).toEqual({ subei_battle: { completed: true } });
    expect(readFlag('has-defeat')).toBe(true);
    expect(storage.getItem(legacyKey('campaign-progress'))).toBeNull();
    expect(storage.getItem(legacyKey('has-defeat'))).toBeNull();
    // 幂等：第二次没有旧键可迁
    expect(migrateLegacy()).toEqual([]);
  });

  it('当前账号已有同名数据时不覆盖（旧键仍然清掉）', () => {
    const storage = install('alice', {
      'war-of-dots.campaign-progress': JSON.stringify({ old: true }),
      'war-of-dots.u.alice.campaign-progress': JSON.stringify({ fresh: true }),
    });
    expect(migrateLegacy(['campaign-progress'])).toEqual([]);
    expect(readJSON('campaign-progress', {})).toEqual({ fresh: true });
    expect(storage.getItem(legacyKey('campaign-progress'))).toBeNull();
  });

  it('没有真实会话（guest）时不迁移，旧键原样留着', () => {
    const storage = install(null, { 'war-of-dots.campaign-progress': JSON.stringify({ a: 1 }) });
    expect(migrateLegacy()).toEqual([]);
    expect(storage.getItem(legacyKey('campaign-progress'))).toBe(JSON.stringify({ a: 1 }));
    expect(storage.getItem('war-of-dots.u.guest.campaign-progress')).toBeNull();
  });

  it('迁移名单覆盖所有进度类数据', () => {
    expect(USER_DATA_NAMES).toEqual([
      'campaign-progress', 'level-stats', 'ach-unlocked', 'climb-cleared', 'climb-stats', 'custom-map', 'has-defeat',
    ]);
  });
});

describe('classic 副本（public/user-storage.js）与模块同逻辑', () => {
  function loadClassic(session) {
    const code = readFileSync(new URL('../../public/user-storage.js', import.meta.url), 'utf8');
    const storage = fakeStorage();
    if (session) storage.setItem('war-of-dots.session', JSON.stringify({ username: session }));
    // classic 文件用 window + 全局 localStorage；这里用函数参数模拟浏览器环境
    const factory = new Function('window', 'localStorage', `${code}\nreturn window.UserStorage;`);
    return { api: factory({ localStorage: storage }, storage), storage };
  }

  it('常量与键生成规则完全一致', () => {
    const { api } = loadClassic('zhangsan');
    expect(api.KEY_PREFIX).toBe(KEY_PREFIX);
    expect(api.GUEST_USER).toBe(GUEST_USER);
    expect(api.USER_DATA_NAMES).toEqual(USER_DATA_NAMES);
    for (const name of ['', 'Zhang San', 'dz634220@163.com', 'e2e-user']) {
      const user = normalizeUser(name);
      expect(api.userKey('campaign-progress', user)).toBe(userKey('campaign-progress', user));
      expect(api.normalizeUser(name)).toBe(user);
    }
    expect(api.userKey('level-stats')).toBe(`war-of-dots.u.zhangsan.level-stats`);
    expect(api.legacyKey('custom-map')).toBe(legacyKey('custom-map'));
  });

  it('副本的读写与迁移行为一致（换账号互不可见 + 旧键迁移）', () => {
    const { api, storage } = loadClassic('alice');
    api.writeJSON('campaign-progress', { subei_battle: { completed: true } });
    expect(storage.getItem('war-of-dots.u.alice.campaign-progress')).toBeTruthy();

    storage.setItem('war-of-dots.session', JSON.stringify({ username: 'bob' }));
    expect(api.readJSON('campaign-progress', {})).toEqual({});

    storage.setItem('war-of-dots.session', JSON.stringify({ username: 'carol' }));
    storage.setItem('war-of-dots.has-defeat', '1');
    expect(api.migrateLegacy()).toEqual(['has-defeat']);
    expect(api.readFlag('has-defeat')).toBe(true);
    expect(storage.getItem('war-of-dots.has-defeat')).toBeNull();
  });
});
