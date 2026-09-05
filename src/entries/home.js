import { t } from '../i18n/index.js';

// 主页入口（index.html，落地页）：用 i18n 填充界面文案，无需跑游戏/编辑器场景。
document.querySelectorAll('[data-i18n]').forEach((el) => {
  el.textContent = t(el.dataset.i18n);
});
document.title = t('home.title');
