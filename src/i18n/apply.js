// 给静态 HTML 里的文案套上 i18n（PvP 对局页用；战役页面仍然由 hud.js 动态生成）。
// 用法：`<span data-i18n="pvp.hud.prep"></span>`，页面启动时调一次 applyStaticI18n()。
import { t } from './index.js';

export function applyStaticI18n(root = document) {
  if (!root?.querySelectorAll) return 0;
  let applied = 0;
  for (const element of root.querySelectorAll('[data-i18n]')) {
    const key = element.getAttribute('data-i18n');
    const text = t(key);
    if (!text || text === key) continue;
    element.textContent = text;
    applied += 1;
  }
  for (const element of root.querySelectorAll('[data-i18n-title]')) {
    const key = element.getAttribute('data-i18n-title');
    const text = t(key);
    if (!text || text === key) continue;
    element.setAttribute('title', text);
    applied += 1;
  }
  return applied;
}
