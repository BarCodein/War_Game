// 按账号隔离的本地存储（修复"同机不同账号共享进度"）：
// 进度类数据（战役通关、战绩、成就、登山记录、自定义地图、败仗标记）以前都写在**全局**键
// （war-of-dots.campaign-progress 之类）上，所以同一台机器换账号看到的还是同一套进度。
//
// 现在所有进度类键都带账号命名空间：
//   war-of-dots.u.<账号>.<原名>     例：war-of-dots.u.zhangsan.campaign-progress
// 账号取当前会话（war-of-dots.session 里的 username，注册/登录时已统一转小写）；
// 非字母数字一律换成下划线（用户名可能是邮箱），没有有效会话时落到 guest。
//
// 账号库（war-of-dots.users）与当前会话（war-of-dots.session）仍然全局——它们本来就不属于某个账号。
//
// ⚠️ classic script 页面（battlechoose.html / result.html / climb.js / tutorial.js）不能 import 本模块，
//    用的是 public/user-storage.js 里**同一套逻辑的副本**；两份实现由
//    tests/unit/user-storage.test.js 的一致性用例守护（改了一处必须改另一处）。

export const SESSION_KEY = 'war-of-dots.session';
export const KEY_PREFIX = 'war-of-dots.u.';
export const LEGACY_PREFIX = 'war-of-dots.';
export const GUEST_USER = 'guest';

// 需要按账号隔离的数据名（也是"旧全局键"要迁移的名单）
export const USER_DATA_NAMES = [
  'campaign-progress',
  'level-stats',
  'ach-unlocked',
  'climb-cleared',
  'climb-stats',
  'custom-map',
  'has-defeat',
];

/** 取本地存储（Node/无存储环境下返回 null，所有读写退化为空操作）。 */
function store() {
  try {
    return globalThis.localStorage ?? globalThis.window?.localStorage ?? null;
  } catch {
    return null;
  }
}

/** 账号名归一化：小写 + 非 [a-z0-9] 换成下划线，空则 guest。 */
export function normalizeUser(name) {
  const raw = typeof name === 'string' ? name.trim().toLowerCase() : '';
  const safe = raw.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return safe || GUEST_USER;
}

/** 当前账号（读会话；没有有效会话 = guest）。 */
export function currentUser() {
  try {
    const session = JSON.parse(store()?.getItem(SESSION_KEY) || 'null');
    return normalizeUser(session?.username);
  } catch {
    return GUEST_USER;
  }
}

/** 数据名 → 当前账号的存储键。 */
export function userKey(name, user = currentUser()) {
  return `${KEY_PREFIX}${user}.${name}`;
}

/** 数据名 → 旧版全局键（仅迁移用）。 */
export function legacyKey(name) {
  return `${LEGACY_PREFIX}${name}`;
}

export function readJSON(name, fallback = null) {
  try {
    const raw = store()?.getItem(userKey(name));
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJSON(name, value) {
  try {
    store()?.setItem(userKey(name), JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** '1' 标记型（has-defeat / climb-cleared）。 */
export function readFlag(name) {
  try {
    return store()?.getItem(userKey(name)) === '1';
  } catch {
    return false;
  }
}

export function writeFlag(name) {
  try {
    store()?.setItem(userKey(name), '1');
    return true;
  } catch {
    return false;
  }
}

/**
 * 把旧版全局键的数据迁给**当前登录账号**（只在当前账号还没有对应命名空间数据时），然后删掉旧键。
 * 规则：没有真实会话（guest）时不迁移——否则会先把数据塞给 guest。
 * @returns {string[]} 实际迁移的数据名
 */
export function migrateLegacy(names = USER_DATA_NAMES) {
  const migrated = [];
  const storage = store();
  if (!storage) return migrated;
  let user = GUEST_USER;
  try {
    const session = JSON.parse(storage.getItem(SESSION_KEY) || 'null');
    if (!session?.username) return migrated;
    user = normalizeUser(session.username);
  } catch {
    return migrated;
  }
  for (const name of names) {
    try {
      const legacy = storage.getItem(legacyKey(name));
      if (legacy === null) continue;
      const target = userKey(name, user);
      if (storage.getItem(target) === null) {
        storage.setItem(target, legacy);
        migrated.push(name);
      }
      storage.removeItem(legacyKey(name));
    } catch {
      /* 存储不可用时跳过 */
    }
  }
  return migrated;
}
