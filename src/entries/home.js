import { t } from '../i18n/index.js';
import { logout } from '../auth.js';

// 主页入口（index.html，落地页）：用 i18n 填充界面文案，无需跑游戏/编辑器场景。
document.querySelectorAll('[data-i18n]').forEach((el) => {
  el.textContent = t(el.dataset.i18n);
});
document.title = t('home.title');
document.querySelector('#logoutButton')?.addEventListener('click', () => {
  window.playSfx?.('shutdown');
  // 稍作延迟，让关机音效先响起再跳转登录页
  window.setTimeout(logout, 350);
});

// UI 音效：菜单卡片
// 悬停（放大缩小）→ 轻盈滑动音（满音量）；点击进入 → 重按钮音
document.querySelectorAll('.home-card').forEach((card) => {
  card.addEventListener('mouseenter', () => window.playSfx?.('slide'));
  card.addEventListener('click', () => window.playSfx?.('button'));
});
