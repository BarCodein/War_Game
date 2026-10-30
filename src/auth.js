// 账号：**服务端为准**（PvP 需要多端一致），本地只缓存"当前登录了谁"。
//
// 历史：这里以前是纯前端的账号表（localStorage `war-of-dots.users`，密码明文比对），
// 与联机页（服务端 SQLite + HttpOnly Cookie）是两套账号。现已合并成一套：
//   · 登录/注册只走 REST `/api/auth/{login,register}`（见 login.html 与 src/entries/login.js）
//   · 成功后把服务端用户写进本地 session（`war-of-dots.session`），仅供：
//       1) 战役页 `requireAuth()` 同步判断是否登录（战役页不联网也能继续玩）
//       2) 显示用户名 / 成就等按账号隔离的数据键（src/user-storage.js）
//   · 服务器不可达时**不允许**离线登录（需求方明确要求）
//
// ⚠️ 本模块被所有战役页 import，导入即有守卫副作用；测试见 tests/unit/auth-guard.test.js。

import { migrateLegacy } from './user-storage.js';

export const SESSION_KEY = 'war-of-dots.session';

export function getCurrentUser() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
  } catch {
    return null;
  }
}

export function isAuthenticated() {
  return Boolean(getCurrentUser()?.username);
}

/** 把服务端用户写进本地会话（`user` 为 null = 清空）。 */
export function syncSessionFromUser(user) {
  clearSession();
  if (!user?.username) return;
  localStorage.setItem(SESSION_KEY, JSON.stringify({ username: user.username, loggedInAt: Date.now() }));
  // 升级后第一次登录：把旧版**全局**进度迁给这个账号（之后旧键删掉，其他账号从零开始）
  migrateLegacy();
}

export function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch { /* 隐私模式忽略 */ }
}

/** 兼容旧调用点：直接按用户名写本地会话。 */
export function setSession(username) {
  syncSessionFromUser(username ? { username } : null);
}

// ---------------- 服务端账号（唯一账号源） ----------------

async function requestJson(path, body) {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    credentials: 'same-origin',
    cache: 'no-store',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  return { ok: response.ok && Boolean(data?.ok), status: response.status, data };
}

/** 当前服务端会话（未登录返回 null；网络错误会抛异常）。 */
export async function fetchMe() {
  const { ok, data } = await requestJson('/api/auth/me');
  return ok && data?.user ? data.user : null;
}

export async function loginRemote(username, password) {
  return requestJson('/api/auth/login', { username, password });
}

export async function registerRemote(username, password) {
  return requestJson('/api/auth/register', { username, password });
}

/** 登出：先让服务端删会话，再清本地缓存；无论成功与否都回登录页。 */
export async function logout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
  } catch { /* 服务器不可达也照常清本地 */ }
  clearSession();
  window.location.replace('/login.html');
}

// 当前页面是否就是登录页。
// ⚠️ 不能只判断 pathname.endsWith('/login.html')：静态服务器会把 /login.html 重写成干净 URL /login
// （npx serve 的 cleanUrls 默认开启，vite preview / dev 不会），此时守卫会误判成"受保护页面"，
// 于是 requireAuth() 跳回 /login.html → 又被重写成 /login → 再一次触发守卫 → 页面无限弹跳。
// 这里按"最后一段路径去掉 .html 后是否等于 login"判断，兼容 /login、/login.html、/login/ 以及部署在子路径的情况。
function isLoginPage() {
  const path = (window.location.pathname || '').replace(/\/+$/, '');
  const last = path.split('/').pop() || '';
  return last.replace(/\.html$/i, '') === 'login';
}

export function getSafeNext() {
  const next = new URLSearchParams(window.location.search).get('next');
  if (!next || !next.startsWith('/') || next.startsWith('//')) return '/index.html';
  // next 指向登录页自身会造成"已登录 → 跳登录页 → 又跳一次"的死循环，同样忽略
  const target = (next.split(/[?#]/)[0] || '').replace(/\/+$/, '');
  if ((target.split('/').pop() || '').replace(/\.html$/i, '') === 'login') return '/index.html';
  return next;
}

export function requireAuth() {
  if (isAuthenticated()) return true;
  if (isLoginPage()) return true; // 已经在登录页上，不再重定向（防御无限跳转）
  const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  window.location.replace(`/login.html?next=${encodeURIComponent(currentPath)}`);
  return false;
}

// 所有引入本模块的页面默认受保护；登录页跳过守卫。
if (!isLoginPage()) {
  requireAuth();
  // 已登录的页面加载时也顺手迁一次旧版全局进度（用户可能直接进战斗页而不是先回首页）
  if (isAuthenticated()) migrateLegacy();
}
