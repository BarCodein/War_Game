/* 战役文本的轻量富文本渲染（classic script，挂到 window.richText）。
 *
 * 用途：battlebackground.html 的 history / objective / forcesHtml 允许写少量标签
 * （<br> 换行、<strong> 加粗）。两个坑：
 *   1. 用 textContent 渲染 → 标签会被当成普通文字显示出来（历史背景里直接露出 "<br>"）；
 *   2. 直接 innerHTML → 文本里出现的 "<" "&" 会被当成标签，可能破坏 DOM 结构。
 * 做法：先把 & < > 全部转义，再把白名单标签还原。
 */
(function (global) {
  var ALLOWED_TAG = /&lt;(\/?)(br|strong|em|b|i)\s*\/?&gt;/gi;

  function richText(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(ALLOWED_TAG, '<$1$2>');
  }

  global.richText = richText;
  if (typeof module !== 'undefined' && module.exports) module.exports = { richText: richText };
}(typeof window !== 'undefined' ? window : this));
