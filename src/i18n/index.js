import zhCN from './zh-CN.js';
import en from './en.js';

const dictionaries = { 'zh-CN': zhCN, en };

// 默认中文；语言选择与持久化（localStorage）在设置模块接入后生效。
export const currentLocale = 'zh-CN';

const active = dictionaries[currentLocale];

// 查表取文案；缺键在开发模式报 warning 并返回键名，避免页面空白。
export function t(key) {
  if (!(key in active)) {
    if (import.meta.env.DEV) console.warn(`[i18n] missing key: ${key}`);
    return key;
  }
  return active[key];
}
