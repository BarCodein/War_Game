import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// SQLite 存储（P1b 只有账号；房间/对局记录在 P3/P4 追加迁移）。
// 迁移用 meta.schema_version 记录，往后加表只加一段 if (version < N)。
const SCHEMA_VERSION = 1;

export function createDb(dbPath) {
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');   // 读多写少的场景更稳（对局期间大量读）
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 3000');
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const current = Number(db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()?.value ?? 0);

  if (current < 1) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        username      TEXT    NOT NULL UNIQUE,   -- 规范化后的登录名（小写、trim）
        display_name  TEXT    NOT NULL,          -- 玩家看到的写法（保留大小写/中文）
        password_hash TEXT    NOT NULL,          -- scrypt 派生结果（hex）
        salt          TEXT    NOT NULL,          -- 每用户随机盐（hex）
        created_at    INTEGER NOT NULL,
        last_login_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS sessions (
        token        TEXT    PRIMARY KEY,
        user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at   INTEGER NOT NULL,
        expires_at   INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
    `);
    db.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES ('schema_version', '1')").run();
  }
}

/** 过期会话清理（登录/校验时顺手做，避免 sessions 表无限增长） */
export function purgeExpiredSessions(db, now = Date.now()) {
  return db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now).changes;
}

export function countUsers(db) {
  return db.prepare('SELECT COUNT(*) AS total FROM users').get().total;
}
