// 关卡定位：把"要看/要玩哪一关"从 URL 里解析出来，并在页面间跳转时带上。
//
// 为什么不能只看 ?level=<id>：
// 静态服务器的 cleanUrls 会把 /game.html?level=x 301 重写成 /game，
// **查询参数会被丢掉**（实测 npx serve 14.x：Location: /battlebackground）。
// 于是目标页面拿不到关卡 id，只能退回默认关卡——表现就是"点宿北，出来塔山"。
// 这里按 查询参数 → URL hash → sessionStorage 的顺序兜底：
//   · hash 由服务器改写，永远保留；
//   · sessionStorage 覆盖"同一标签页内的点击跳转"。
export const LEVEL_STORAGE_KEY = 'war-of-dots.campaign';

// 从 URL 里取关卡 id：?level=<id> 优先，其次 #level=<id>。
// 只认带 level= 的 hash：裸 hash（#bench、#fromEditor 之类）是别的用途的标记，
// 当成关卡 id 会误加载不存在的关卡。
export function levelIdFromLocation(location = window.location) {
  const search = location?.search ?? '';
  const hash = location?.hash ?? '';
  const fromQuery = new URLSearchParams(search).get('level');
  if (fromQuery) return fromQuery;
  const fromHash = new URLSearchParams(hash.replace(/^#/, '')).get('level');
  return fromHash || null;
}

// 记住/读取最近一次选择的关卡（同一标签页内有效；失败时静默忽略，例如隐私模式）
export function rememberLevelId(id, storage = window.sessionStorage) {
  if (!id) return;
  try {
    storage?.setItem(LEVEL_STORAGE_KEY, String(id));
  } catch {
    /* 忽略：存储不可用不影响跳转本身 */
  }
}

export function recallLevelId(storage = window.sessionStorage) {
  try {
    return storage?.getItem(LEVEL_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

// 页面跳转地址：同时带上查询参数与 hash，前者给开发/预览服务器，后者保证被重写也不丢
export function levelHref(page, id) {
  if (!id) return page;
  const value = encodeURIComponent(id);
  return `${page}?level=${value}#level=${value}`;
}

// 完整解析顺序：查询参数 → hash → sessionStorage → 缺省值
export function resolveLevelId({ location = window.location, storage = window.sessionStorage, fallback = null } = {}) {
  return levelIdFromLocation(location) ?? recallLevelId(storage) ?? fallback;
}
