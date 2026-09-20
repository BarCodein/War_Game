/* 按账号隔离的本地存储 —— classic script 版本（window.UserStorage）。
 *
 * 与 src/user-storage.js（ES 模块）是**同一套逻辑的两份实现**：
 * classic script 页面（battlechoose.html / result.html / climb.js / tutorial.js）不能 import 模块，
 * 只能靠这一份。两份实现由 tests/unit/user-storage.test.js 的一致性用例守护——改一处必须改另一处。
 *
 * 键形如：war-of-dots.u.<账号>.<数据名>（没有有效会话时账号 = guest）。
 * 账号库 war-of-dots.users 与会话 war-of-dots.session 仍然全局。
 */
(function () {
  var SESSION_KEY = 'war-of-dots.session';
  var KEY_PREFIX = 'war-of-dots.u.';
  var LEGACY_PREFIX = 'war-of-dots.';
  var GUEST_USER = 'guest';
  var USER_DATA_NAMES = [
    'campaign-progress',
    'level-stats',
    'ach-unlocked',
    'climb-cleared',
    'climb-stats',
    'custom-map',
    'has-defeat'
  ];

  function store() {
    try {
      if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
      return (typeof window !== 'undefined' && window.localStorage) || null;
    } catch (e) {
      return null;
    }
  }

  function normalizeUser(name) {
    var raw = typeof name === 'string' ? name.trim().toLowerCase() : '';
    var safe = raw.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return safe || GUEST_USER;
  }

  function readSession() {
    try {
      var s = store();
      return s ? JSON.parse(s.getItem(SESSION_KEY) || 'null') : null;
    } catch (e) {
      return null;
    }
  }

  function currentUser() {
    var session = readSession();
    return normalizeUser(session && session.username);
  }

  function userKey(name, user) {
    return KEY_PREFIX + (user || currentUser()) + '.' + name;
  }

  function legacyKey(name) {
    return LEGACY_PREFIX + name;
  }

  function readJSON(name, fallback) {
    var fb = fallback === undefined ? null : fallback;
    try {
      var s = store();
      if (!s) return fb;
      var raw = s.getItem(userKey(name));
      return raw ? JSON.parse(raw) : fb;
    } catch (e) {
      return fb;
    }
  }

  function writeJSON(name, value) {
    try {
      var s = store();
      if (!s) return false;
      s.setItem(userKey(name), JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  function readFlag(name) {
    try {
      var s = store();
      return Boolean(s) && s.getItem(userKey(name)) === '1';
    } catch (e) {
      return false;
    }
  }

  function writeFlag(name) {
    try {
      var s = store();
      if (!s) return false;
      s.setItem(userKey(name), '1');
      return true;
    } catch (e) {
      return false;
    }
  }

  function migrateLegacy(names) {
    var migrated = [];
    var s = store();
    if (!s) return migrated;
    var session = readSession();
    if (!session || !session.username) return migrated; // 没有真实会话不迁移（否则先塞给 guest）
    var user = normalizeUser(session.username);
    var list = names || USER_DATA_NAMES;
    for (var i = 0; i < list.length; i += 1) {
      var name = list[i];
      try {
        var legacy = s.getItem(legacyKey(name));
        if (legacy === null) continue;
        var target = userKey(name, user);
        if (s.getItem(target) === null) {
          s.setItem(target, legacy);
          migrated.push(name);
        }
        s.removeItem(legacyKey(name));
      } catch (e) {
        /* 存储不可用时跳过 */
      }
    }
    return migrated;
  }

  window.UserStorage = {
    SESSION_KEY: SESSION_KEY,
    KEY_PREFIX: KEY_PREFIX,
    LEGACY_PREFIX: LEGACY_PREFIX,
    GUEST_USER: GUEST_USER,
    USER_DATA_NAMES: USER_DATA_NAMES,
    normalizeUser: normalizeUser,
    currentUser: currentUser,
    userKey: userKey,
    legacyKey: legacyKey,
    readJSON: readJSON,
    writeJSON: writeJSON,
    readFlag: readFlag,
    writeFlag: writeFlag,
    migrateLegacy: migrateLegacy
  };
})();
