import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { purgeExpiredSessions } from './db.js';

// 账号与会话（P1b）。
//   · 口令：scrypt（Node 内置，无原生依赖）+ 每用户随机盐；库里只存派生值与盐
//   · 会话：32 字节随机 token 存 sessions 表，客户端拿 HttpOnly Cookie（同源，SameSite=Lax）
//   · 限速：登录失败按 IP 滑动窗口（默认 5 次/分钟），成功即清零 —— 既防爆破也防把 1 核打满
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 64;
const USERNAME_RE = /^[A-Za-z0-9_\u4e00-\u9fa5]{3,20}$/;
const KEY_LEN = 64;

export function normalizeUsername(raw) {
  return String(raw ?? '').trim().toLowerCase();
}

export function validateCredentials({ username, password }) {
  const displayName = String(username ?? '').trim();
  const normalized = normalizeUsername(username);
  if (!USERNAME_RE.test(displayName)) {
    return { ok: false, code: 'BAD_USERNAME', message: '用户名需 3–20 位，仅限中英文、数字与下划线' };
  }
  const pass = String(password ?? '');
  if (pass.length < PASSWORD_MIN || pass.length > PASSWORD_MAX) {
    return { ok: false, code: 'BAD_PASSWORD', message: `密码长度需 ${PASSWORD_MIN}–${PASSWORD_MAX} 位` };
  }
  return { ok: true, username: normalized, displayName };
}

export function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  return { salt, hash: scryptSync(password, salt, KEY_LEN).toString('hex') };
}

export function verifyPassword(password, salt, expectedHex) {
  const derived = scryptSync(password, salt, KEY_LEN);
  const expected = Buffer.from(String(expectedHex), 'hex');
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(derived, expected);
}

// ---------- 会话 ----------
export function createSession(db, userId, { ttlMs, now = Date.now() }) {
  const token = randomBytes(32).toString('base64url');
  db.prepare(`INSERT INTO sessions (token, user_id, created_at, expires_at, last_seen_at)
              VALUES (?, ?, ?, ?, ?)`)
    .run(token, userId, now, now + ttlMs, now);
  return { token, expiresAt: now + ttlMs };
}

export function findSessionUser(db, token, now = Date.now()) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT s.token, s.expires_at, u.id, u.username, u.display_name, u.created_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ?
  `).get(token);
  if (!row) return null;
  if (row.expires_at <= now) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token = ?').run(now, token);
  return { id: row.id, username: row.username, displayName: row.display_name, createdAt: row.created_at };
}

export function deleteSession(db, token) {
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

// ---------- 限速（内存滑动窗口，够用且零依赖） ----------
export function createRateLimiter({ limit, windowMs }) {
  const hits = new Map();

  function prune(key, now) {
    const list = (hits.get(key) ?? []).filter((time) => now - time < windowMs);
    if (list.length) hits.set(key, list);
    else hits.delete(key);
    return list;
  }

  return {
    /** 是否已被限流（只读检查） */
    blocked(key, now = Date.now()) {
      return prune(key, now).length >= limit;
    },
    /** 记一次失败 */
    hit(key, now = Date.now()) {
      const list = prune(key, now);
      list.push(now);
      hits.set(key, list);
    },
    /** 成功即清零 */
    reset(key) {
      hits.delete(key);
    },
    /** 测试/运维观察用 */
    size() {
      return hits.size;
    },
    limit,
    windowMs,
  };
}

// ---------- Cookie 解析（不引入 cookie-parser） ----------
export function readCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() !== name) continue;
    return decodeURIComponent(part.slice(index + 1).trim());
  }
  return null;
}

export function clientIp(req) {
  // 线上在 Nginx 后面：用 X-Real-IP（deploy/nginx-wargame.conf 里已设置）
  const forwarded = req.headers['x-real-ip'];
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.trim();
  return req.socket?.remoteAddress ?? 'unknown';
}

export { purgeExpiredSessions };

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName ?? user.username,
    createdAt: user.createdAt ?? null,
  };
}
