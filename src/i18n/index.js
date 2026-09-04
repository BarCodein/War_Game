import zhCN from './zh-CN.js';
import en from './en.js';

const dictionaries = { 'zh-CN': zhCN, en };

// 默认中文；语言选择与持久化（localStorage）在设置模块接入后生效。
export const currentLocale = 'zh-CN';

const active = dictionaries[currentLocale];

// 查表取文案，支持 {name} 参数插值；缺键在开发模式报 warning 并返回键名。
export function t(key, params = {}) {
  if (!(key in active)) {
    if (import.meta.env.DEV) console.warn(`[i18n] missing key: ${key}`);
    return key;
  }
  let text = active[key];
  for (const [name, value] of Object.entries(params)) {
    text = text.replaceAll(`{${name}}`, String(value));
  }
  return text;
}
