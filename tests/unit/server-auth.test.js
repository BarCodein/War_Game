import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createPvpServer } from '../../server/src/app.js';

// P1b 账号体系契约：注册 / 登录 / 登出 / me / 限速 / 口令存储。
// 每个用例用唯一用户名（互不干扰），整体跑在 :memory: 数据库上。
let server;
let baseUrl;
let db;

beforeAll(async () => {
  server = createPvpServer({ quiet: true, dbPath: ':memory:' });
  db = server.db;
  const { url } = await server.listen(0, '127.0.0.1');
  baseUrl = url;
});

afterAll(async () => {
  await server?.close();
});

let counter = 0;
function freshName(prefix = 'player') {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter}`;
}

// 每个用例用独立的 X-Real-IP，避免"登录失败限速"在用例之间互相污染
// （server/src/auth.js 的 clientIp() 优先读 x-real-ip，Nginx 线上也是这么传的）
let ipCounter = 0;
function freshIp() {
  ipCounter += 1;
  return `203.0.113.${ipCounter}`;
}

const JSON_HEADERS = { 'content-type': 'application/json' };

async function call(path, { method = 'GET', body, cookie, ip } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? JSON_HEADERS : {}),
      ...(cookie ? { cookie } : {}),
      ...(ip ? { 'x-real-ip': ip } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { response, json, text, setCookie: response.headers.getSetCookie?.() ?? [] };
}

async function register(username, password = 'good-password-1') {
  return call('/api/auth/register', { method: 'POST', body: { username, password } });
}

function sessionCookie(setCookieList) {
  const raw = setCookieList.find((item) => item.startsWith('wod_session='));
  expect(raw, '应下发 wod_session Cookie').toBeTruthy();
  return raw.split(';')[0];
}

describe('账号：注册', () => {
  it('注册成功：201 + 下发 HttpOnly Cookie + 返回用户信息（不含任何口令字段）', async () => {
    const username = freshName();
    const { response, json, setCookie } = await register(username);

    expect(response.status).toBe(201);
    expect(json.ok).toBe(true);
    expect(json.user).toMatchObject({ username: username.toLowerCase() });
    expect(JSON.stringify(json)).not.toMatch(/password|salt|hash/i);

    const cookie = setCookie.find((item) => item.startsWith('wod_session='));
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
  });

  it('库里存的是 scrypt 派生值 + 随机盐，没有明文口令', async () => {
    const username = freshName('store');
    const password = 'plaintext-should-not-appear';
    await register(username, password);

    const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username.toLowerCase());
    expect(row).toBeTruthy();
    expect(row.password_hash).toMatch(/^[0-9a-f]{128}$/);   // 64 字节 → 128 hex
    expect(row.salt).toMatch(/^[0-9a-f]{32}$/);             // 16 字节 → 32 hex
    expect(row.password_hash).not.toContain(password);
    expect(JSON.stringify(row)).not.toContain(password);
  });

  it('用户名已存在（大小写不敏感）→ 409', async () => {
    const username = freshName('dup');
    expect((await register(username)).response.status).toBe(201);
    const again = await register(username.toUpperCase());
    expect(again.response.status).toBe(409);
    expect(again.json.code).toBe('USERNAME_TAKEN');
  });

  it('用户名/口令不合法 → 400 并给出可读原因', async () => {
    const shortName = await register('ab');
    expect(shortName.response.status).toBe(400);
    expect(shortName.json.code).toBe('BAD_USERNAME');

    const badChars = await register('bad name!');
    expect(badChars.response.status).toBe(400);

    const shortPass = await register(freshName('pw'), '123');
    expect(shortPass.response.status).toBe(400);
    expect(shortPass.json.code).toBe('BAD_PASSWORD');
  });
});

describe('账号：登录 / 会话', () => {
  it('登录成功 → 200 + Cookie；/me 带 Cookie 返回本人；登出后 /me 401', async () => {
    const username = freshName('login');
    const password = 'good-password-2';
    await register(username, password);

    const login = await call('/api/auth/login', { method: 'POST', body: { username, password } });
    expect(login.response.status).toBe(200);
    expect(login.json.user.username).toBe(username.toLowerCase());

    const cookie = sessionCookie(login.setCookie);
    const me = await call('/api/auth/me', { cookie });
    expect(me.response.status).toBe(200);
    expect(me.json.user.username).toBe(username.toLowerCase());

    const logout = await call('/api/auth/logout', { method: 'POST', cookie });
    expect(logout.response.status).toBe(204);

    const meAfter = await call('/api/auth/me', { cookie });
    expect(meAfter.response.status).toBe(401);
    expect(meAfter.json.code).toBe('UNAUTHENTICATED');
  });

  it('未登录访问 /me → 401', async () => {
    const { response, json } = await call('/api/auth/me');
    expect(response.status).toBe(401);
    expect(json.ok).toBe(false);
  });

  it('密码错误 → 401，且不泄漏"用户名是否存在"（两种情况同一个错误码）', async () => {
    const username = freshName('wrong');
    const ip = freshIp();
    await register(username, 'good-password-3');

    const wrongPassword = await call('/api/auth/login', { method: 'POST', body: { username, password: 'nope-nope-1' }, ip });
    const noSuchUser = await call('/api/auth/login', { method: 'POST', body: { username: freshName('ghost'), password: 'nope-nope-1' }, ip });

    expect(wrongPassword.response.status).toBe(401);
    expect(noSuchUser.response.status).toBe(401);
    expect(wrongPassword.json.code).toBe('BAD_CREDENTIALS');
    expect(noSuchUser.json.code).toBe('BAD_CREDENTIALS');
  });

  it('登录失败 5 次后同一 IP 被限速（429），且不同 IP 互不影响', async () => {
    const username = freshName('brute');
    const ip = freshIp();
    await register(username, 'good-password-4');

    for (let i = 0; i < 5; i += 1) {
      const attempt = await call('/api/auth/login', { method: 'POST', body: { username, password: `bad-${i}` }, ip });
      expect(attempt.response.status).toBe(401);
    }
    const blocked = await call('/api/auth/login', { method: 'POST', body: { username, password: 'bad-final' }, ip });
    expect(blocked.response.status).toBe(429);
    expect(blocked.json.code).toBe('RATE_LIMITED');

    // 换个 IP 用正确口令仍然能登录（限速是按 IP 的，不是把账号锁死）
    const otherIp = await call('/api/auth/login', { method: 'POST', body: { username, password: 'good-password-4' }, ip: freshIp() });
    expect(otherIp.response.status).toBe(200);
  });

  it('过期会话视为未登录，并被自动清理', async () => {
    const username = freshName('expire');
    const password = 'good-password-5';
    const ip = freshIp();
    await register(username, password);
    const login = await call('/api/auth/login', { method: 'POST', body: { username, password }, ip });
    const cookie = sessionCookie(login.setCookie);
    const token = cookie.split('=')[1];

    db.prepare('UPDATE sessions SET expires_at = ? WHERE token = ?').run(Date.now() - 1000, token);
    const me = await call('/api/auth/me', { cookie });
    expect(me.response.status).toBe(401);
    expect(db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE token = ?').get(token).n).toBe(0);
  });
});

describe('账号：/api/health 可观测性', () => {
  it('health 里的 accounts 随注册增长，且不暴露任何账号细节', async () => {
    const before = (await call('/api/health')).json.accounts;
    await register(freshName('count'));
    const after = (await call('/api/health')).json.accounts;
    expect(after).toBe(before + 1);
    expect(JSON.stringify((await call('/api/health')).json)).not.toMatch(/password|salt|hash/i);
  });
});
