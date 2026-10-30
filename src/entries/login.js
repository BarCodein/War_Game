// 登录页（login.html）——**唯一**的登录/注册入口，账号以服务端为准。
//
// 流程：
//   1. 已有本地会话 → 先用 /api/auth/me 校验；有效就直接进目标页；失效则清掉缓存并显示表单
//   2. 提交登录/注册 → REST `/api/auth/{login,register}` → 成功写本地会话 → 跳 `?next=`
//   3. 服务器不可达 → 明确提示「登录服务不可用」（需求方要求：不允许离线登录）
//   4. 登出（其它页面）→ 服务端删会话 + 清本地缓存 → 回本页

import {
  clearSession, fetchMe, getCurrentUser, getSafeNext, isAuthenticated, loginRemote, registerRemote, syncSessionFromUser,
} from '../auth.js';

const ERROR_TEXT = {
  BAD_CREDENTIALS: '用户名或密码不正确。',
  USERNAME_TAKEN: '这个用户名已经被注册了，请换一个或直接登录。',
  INVALID_USERNAME: '用户名需 3–20 位，只能包含中英文、数字、下划线和短横线。',
  INVALID_PASSWORD: '密码需 8–64 位。',
  RATE_LIMITED: '尝试太频繁，请稍后再试。',
  UNAVAILABLE: '登录服务不可用，请确认联机服务器已启动后重试。',
};

function messageFor(result) {
  const code = result?.data?.code ?? '';
  if (ERROR_TEXT[code]) return ERROR_TEXT[code];
  return result?.data?.message || `登录失败（HTTP ${result?.status ?? '—'}）`;
}

const form = document.querySelector('#authForm');
const usernameInput = document.querySelector('#username');
const passwordInput = document.querySelector('#password');
const message = document.querySelector('#authMessage');
const submitButton = document.querySelector('#authSubmit');
const loginTab = document.querySelector('#loginTab');
const registerTab = document.querySelector('#registerTab');
let mode = 'login';

function setMode(nextMode) {
  mode = nextMode;
  const isRegister = mode === 'register';
  loginTab.classList.toggle('active', !isRegister);
  registerTab.classList.toggle('active', isRegister);
  loginTab.setAttribute('aria-selected', String(!isRegister));
  registerTab.setAttribute('aria-selected', String(isRegister));
  submitButton.textContent = isRegister ? '注册并进入' : '登录';
  document.querySelector('#authTitle').textContent = isRegister ? '创建战区账号' : '登录战区';
  message.textContent = '';
  passwordInput.setAttribute('autocomplete', isRegister ? 'new-password' : 'current-password');
}

function showMessage(text, isSuccess = false) {
  message.textContent = text;
  message.classList.toggle('success', isSuccess);
}

function setBusy(busy) {
  submitButton.disabled = busy;
  loginTab.disabled = busy;
  registerTab.disabled = busy;
}

async function submit() {
  const username = usernameInput.value.trim();
  const password = passwordInput.value;
  if (!username || !password) {
    showMessage('用户名和密码都要填。');
    return;
  }
  setBusy(true);
  showMessage(mode === 'register' ? '注册中…' : '登录中…', true);
  try {
    const result = mode === 'register'
      ? await registerRemote(username, password)
      : await loginRemote(username, password);
    if (!result.ok) {
      showMessage(messageFor(result));
      return;
    }
    // 服务端会话已建立：写本地缓存（战役页据此放行），再跳目标页
    syncSessionFromUser(result.data.user);
    showMessage(`欢迎，${result.data.user.username}。正在进入战区…`, true);
    window.setTimeout(() => window.location.replace(getSafeNext()), 150);
  } catch {
    showMessage(ERROR_TEXT.UNAVAILABLE);
  } finally {
    setBusy(false);
  }
}

loginTab.addEventListener('click', () => { window.playSfx?.('toggle'); setMode('login'); });
registerTab.addEventListener('click', () => { window.playSfx?.('toggle'); setMode('register'); });
form.addEventListener('submit', (event) => {
  event.preventDefault();
  window.playSfx?.('button');
  submit();
});

// 已有本地会话：先用服务端确认（可能在别处登出/会话过期），有效就直接进目标页
(async () => {
  if (!isAuthenticated()) return;
  const cached = getCurrentUser();
  setBusy(true);
  try {
    const me = await fetchMe();
    if (me) {
      syncSessionFromUser(me);
      window.location.replace(getSafeNext());
      return;
    }
    clearSession();     // 服务端已无会话：清掉本地缓存，正常显示表单
  } catch {
    // 服务器不可达：不允许离线登录；若本机已有缓存会话，仍允许继续进战役（联机本来就不可用）
    if (cached?.username) showMessage(ERROR_TEXT.UNAVAILABLE);
  } finally {
    setBusy(false);
  }
})();
