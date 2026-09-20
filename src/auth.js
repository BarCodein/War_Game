// 登录注册界面逻辑

import { migrateLegacy } from './user-storage.js';

const USERS_KEY = 'war-of-dots.users';
const SESSION_KEY = 'war-of-dots.session';

function readUsers() {
  try {
    const users = JSON.parse(localStorage.getItem(USERS_KEY) || '[]');
    return Array.isArray(users) ? users : [];
  } catch {
    return [];
  }
}

function writeUsers(users) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

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

export function register(username, password) {
  const normalizedUsername = username.trim().toLowerCase();
  if (!normalizedUsername) {
    return { ok: false, message: '请输入用户名或邮箱。' };
  }
  if (!password) {
    return { ok: false, message: '请输入密码。' };
  }

  const users = readUsers();
  if (users.some(user => user.username === normalizedUsername)) {
    return { ok: false, message: '该用户名已注册，请直接登录。' };
  }

  users.push({ username: normalizedUsername, password });
  writeUsers(users);
  setSession(normalizedUsername);
  return { ok: true };
}

export function login(username, password) {
  const normalizedUsername = username.trim().toLowerCase();
  const user = readUsers().find(item => item.username === normalizedUsername && item.password === password);
  if (!user) return { ok: false, message: '用户名或密码不正确。' };
  setSession(user.username);
  return { ok: true };
}

export function setSession(username) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ username, loggedInAt: Date.now() }));
  // 升级后第一次登录：把旧版**全局**进度迁给这个账号（之后旧键删掉，其他账号从零开始）
  migrateLegacy();
}

export function logout() {
  localStorage.removeItem(SESSION_KEY);
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
