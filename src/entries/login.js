import { getCurrentUser, getSafeNext, isAuthenticated, login, logout, register } from '../auth.js';

if (isAuthenticated()) {
  window.location.replace(getSafeNext());
} else {
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
    document.querySelector('#authTitle').textContent = isRegister ? '创建战区账户' : '登录战区';
    message.textContent = '';
    passwordInput.setAttribute('autocomplete', isRegister ? 'new-password' : 'current-password');
  }

  function showMessage(text, isSuccess = false) {
    message.textContent = text;
    message.classList.toggle('success', isSuccess);
  }

  loginTab.addEventListener('click', () => setMode('login'));
  registerTab.addEventListener('click', () => setMode('register'));

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const result = mode === 'register'
      ? register(usernameInput.value, passwordInput.value)
      : login(usernameInput.value, passwordInput.value);

    if (!result.ok) {
      showMessage(result.message);
      return;
    }

    const user = getCurrentUser();
    showMessage(`欢迎，${user.username}。正在进入战区...`, true);
    window.setTimeout(() => window.location.replace(getSafeNext()), 150);
  });
}
