import { Router } from 'express';
import {
  createRateLimiter, createSession, deleteSession, findSessionUser, hashPassword,
  clientIp, normalizeUsername, publicUser, readCookie, validateCredentials, verifyPassword,
} from '../auth.js';

// 账号 REST（同源 + HttpOnly Cookie）：
//   POST /api/auth/register  201 / 400 / 409 / 429
//   POST /api/auth/login     200 / 400 / 401 / 429
//   POST /api/auth/logout    204
//   GET  /api/auth/me        200 / 401
export function createAuthRouter({ db, config }) {
  const router = Router();
  const loginLimiter = createRateLimiter({
    limit: config.loginMaxFailures,
    windowMs: config.loginWindowMs,
  });
  const registerLimiter = createRateLimiter({ limit: config.registerMaxPerHour, windowMs: 60 * 60 * 1000 });
  // 用户不存在时也跑一次 scrypt，避免"响应快慢"泄漏用户名是否存在
  const decoy = hashPassword('decoy-password-for-timing');

  function setSessionCookie(res, token) {
    res.cookie(config.sessionCookie, token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: config.sessionTtlMs,
      // 目前是 http（无域名/证书，见 docs/pvp-plan.md §2.3）；将来上 https 再加 secure: true
      secure: false,
    });
  }

  router.post('/register', (req, res) => {
    const ip = clientIp(req);
    if (registerLimiter.blocked(ip)) {
      return res.status(429).json({ ok: false, code: 'RATE_LIMITED', message: '注册过于频繁，请稍后再试' });
    }
    const checked = validateCredentials(req.body ?? {});
    if (!checked.ok) {
      return res.status(400).json({ ok: false, code: checked.code, message: checked.message });
    }
    const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(checked.username);
    if (exists) {
      return res.status(409).json({ ok: false, code: 'USERNAME_TAKEN', message: '该用户名已被注册' });
    }
    const { salt, hash } = hashPassword(String(req.body.password));
    const now = Date.now();
    const info = db.prepare(`INSERT INTO users (username, display_name, password_hash, salt, created_at, last_login_at)
                             VALUES (?, ?, ?, ?, ?, ?)`)
      .run(checked.username, checked.displayName, hash, salt, now, now);
    registerLimiter.hit(ip);

    const user = { id: Number(info.lastInsertRowid), username: checked.username, displayName: checked.displayName, createdAt: now };
    const { token } = createSession(db, user.id, { ttlMs: config.sessionTtlMs });
    setSessionCookie(res, token);
    res.status(201).json({ ok: true, user: publicUser(user) });
  });

  router.post('/login', (req, res) => {
    const ip = clientIp(req);
    if (loginLimiter.blocked(ip)) {
      return res.status(429).json({ ok: false, code: 'RATE_LIMITED', message: '登录失败次数过多，请一分钟后再试' });
    }
    const username = normalizeUsername(req.body?.username);
    const password = String(req.body?.password ?? '');
    if (!username || !password) {
      return res.status(400).json({ ok: false, code: 'MISSING_CREDENTIALS', message: '用户名与密码都要填' });
    }

    const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    const passwordOk = row
      ? verifyPassword(password, row.salt, row.password_hash)
      : (verifyPassword(password, decoy.salt, decoy.hash), false); // 恒定耗时，防用户名枚举
    if (!row || !passwordOk) {
      loginLimiter.hit(ip);
      return res.status(401).json({ ok: false, code: 'BAD_CREDENTIALS', message: '用户名或密码不正确' });
    }

    loginLimiter.reset(ip);
    const now = Date.now();
    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now, row.id);
    const { token } = createSession(db, row.id, { ttlMs: config.sessionTtlMs });
    setSessionCookie(res, token);
    res.json({
      ok: true,
      user: publicUser({ id: row.id, username: row.username, displayName: row.display_name, createdAt: row.created_at }),
    });
  });

  router.post('/logout', (req, res) => {
    deleteSession(db, readCookie(req.headers.cookie, config.sessionCookie));
    res.clearCookie(config.sessionCookie, { path: '/' });
    res.status(204).end();
  });

  router.get('/me', (req, res) => {
    const user = findSessionUser(db, readCookie(req.headers.cookie, config.sessionCookie));
    if (!user) return res.status(401).json({ ok: false, code: 'UNAUTHENTICATED', message: '未登录' });
    res.json({ ok: true, user: publicUser(user) });
  });

  return router;
}

/** 后续阶段（建房/对局）用的中间件：要求已登录，把用户挂到 req.user */
export function requireUser({ db, config }) {
  return function attachUser(req, res, next) {
    const user = findSessionUser(db, readCookie(req.headers.cookie, config.sessionCookie));
    if (!user) return res.status(401).json({ ok: false, code: 'UNAUTHENTICATED', message: '未登录' });
    req.user = user;
    next();
  };
}
