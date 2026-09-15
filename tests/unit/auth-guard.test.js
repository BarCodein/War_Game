import { describe, expect, it } from 'vitest';

// 登录页守卫的回归测试。
//
// Bug：守卫用 pathname.endsWith('/login.html') 判断"这是不是登录页"。
// 静态服务器（`npx serve`，cleanUrls 默认开启）会把 /login.html 301 重写成 /login，
// 于是登录页被误判成受保护页面 → requireAuth() 跳回 /login.html → 又被重写 → 无限弹跳。
// vite dev / vite preview 不做这种重写，所以只有换个静态服务器才能复现。
//
// auth.js 的守卫是**模块副作用**（import 时执行），所以每个用例先装好假的 window，
// 再用不同的 query 动态 import 一份新的模块实例。

function installFakeWindow({ pathname = '/', search = '', hash = '', session = null } = {}) {
  const replaced = [];
  const store = new Map();
  if (session) store.set('war-of-dots.session', JSON.stringify({ username: session }));
  globalThis.window = {
    location: { pathname, search, hash, replace: (url) => replaced.push(url) },
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key),
    },
  };
  return replaced;
}

// 固定的字面量 specifier：带不同 query 让 ESM 缓存失效，从而重新执行模块
const load = {
  cleanUrl: () => import('../../src/auth.js?guard=clean-url'),
  dotHtml: () => import('../../src/auth.js?guard=dot-html'),
  trailingSlash: () => import('../../src/auth.js?guard=trailing-slash'),
  subPath: () => import('../../src/auth.js?guard=sub-path'),
  protected: () => import('../../src/auth.js?guard=protected'),
  loggedIn: () => import('../../src/auth.js?guard=logged-in'),
};

describe('登录守卫：干净 URL 下不再无限弹跳', () => {
  it('登录页在 /login（干净 URL）下不触发重定向（回归）', async () => {
    const replaced = installFakeWindow({ pathname: '/login' });
    await load.cleanUrl();
    expect(replaced).toEqual([]);
  });

  it('登录页在 /login.html 与 /login/ 下都不触发重定向', async () => {
    const a = installFakeWindow({ pathname: '/login.html' });
    await load.dotHtml();
    expect(a).toEqual([]);

    const b = installFakeWindow({ pathname: '/login/' });
    await load.trailingSlash();
    expect(b).toEqual([]);
  });

  it('部署在子路径下的登录页（/war/login）同样被识别', async () => {
    const replaced = installFakeWindow({ pathname: '/war/login' });
    await load.subPath();
    expect(replaced).toEqual([]);
  });

  it('未登录访问受保护页面 → 跳登录页并带上 next', async () => {
    const replaced = installFakeWindow({ pathname: '/game.html', search: '?level=tashan_battle' });
    await load.protected();
    expect(replaced).toEqual(['/login.html?next=%2Fgame.html%3Flevel%3Dtashan_battle']);
  });

  it('getSafeNext 不会把已登录用户送回登录页（另一种死循环）', async () => {
    // 注意：getSafeNext() 是读取"当前 window"的纯函数，所以每个断言前都要装好对应的假 window
    const replaced = installFakeWindow({ pathname: '/login', search: '?next=/login', session: 'tester' });
    const auth = await load.loggedIn();
    expect(replaced).toEqual([]);                 // 已登录且在登录页 → 不自我重定向
    expect(auth.getSafeNext()).toBe('/index.html'); // next=/login → 回首页

    installFakeWindow({ pathname: '/login.html', search: '?next=/login.html', session: 'tester' });
    expect(auth.getSafeNext()).toBe('/index.html');

    installFakeWindow({ pathname: '/login', search: '?next=/game.html?level=subei_battle', session: 'tester' });
    expect(auth.getSafeNext()).toBe('/game.html?level=subei_battle');

    installFakeWindow({ pathname: '/login', search: '?next=//evil.example.com', session: 'tester' });
    expect(auth.getSafeNext()).toBe('/index.html'); // 协议相对地址仍然被拒绝
  });
});
