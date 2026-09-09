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
}

export function logout() {
  localStorage.removeItem(SESSION_KEY);
  window.location.replace('/login.html');
}

export function getSafeNext() {
  const next = new URLSearchParams(window.location.search).get('next');
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/index.html';
}

export function requireAuth() {
  if (isAuthenticated()) return true;
  const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  window.location.replace(`/login.html?next=${encodeURIComponent(currentPath)}`);
  return false;
}

// 所有引入本模块的页面默认受保护；登录页通过路径判断跳过守卫。
if (!window.location.pathname.endsWith('/login.html')) {
  requireAuth();
}
