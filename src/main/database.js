/**
 * Database — SQLite3 persistent storage for AidDesk.
 * 
 * Uses better-sqlite3 for synchronous, fast, zero-config SQLite.
 * Stores session logs, address book entries, ACL whitelist, and auth config.
 */

const path = require('path');
const { app } = require('electron');

let Database;
try {
  Database = require('better-sqlite3');
} catch (err) {
  console.error('[Database] better-sqlite3 not available. Run: npm run rebuild');
  console.error('[Database] Falling back to in-memory stub.');
  Database = null;
}

let db = null;

/**
 * Initialize the database connection and create tables.
 * @returns {object} The database instance (or a stub if better-sqlite3 is unavailable)
 */
function initDatabase() {
  if (db) return db;

  if (!Database) {
    // Return a minimal stub so the app doesn't crash without native modules
    return createStub();
  }

  const dbPath = path.join(app.getPath('userData'), 'aiddesk.db');
  db = new Database(dbPath);

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // ─── Create Tables ──────────────────────────────────────────────────────

  db.exec(`
    -- Session history log
    CREATE TABLE IF NOT EXISTS sessions (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id      TEXT    NOT NULL UNIQUE,
      remote_device_id TEXT   NOT NULL,
      direction       TEXT    NOT NULL CHECK(direction IN ('incoming', 'outgoing')),
      start_time      TEXT    NOT NULL DEFAULT (datetime('now')),
      end_time        TEXT,
      duration_seconds INTEGER DEFAULT 0,
      disconnect_reason TEXT   DEFAULT 'unknown'
    );

    -- Address book (saved remote devices)
    CREATE TABLE IF NOT EXISTS address_book (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id       TEXT    NOT NULL UNIQUE,
      alias           TEXT    NOT NULL DEFAULT '',
      last_connected  TEXT,
      notes           TEXT    DEFAULT '',
      created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- ACL whitelist: devices that can connect without interactive approval
    CREATE TABLE IF NOT EXISTS acl_whitelist (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id       TEXT    NOT NULL UNIQUE,
      added_at        TEXT    NOT NULL DEFAULT (datetime('now')),
      notes           TEXT    DEFAULT ''
    );

    -- Auth configuration (password hash, 2FA secret)
    CREATE TABLE IF NOT EXISTS auth_config (
      key             TEXT    PRIMARY KEY,
      value           TEXT    NOT NULL,
      updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- Failed login attempts for lockout
    CREATE TABLE IF NOT EXISTS login_attempts (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      remote_device_id TEXT   NOT NULL,
      attempted_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      success         INTEGER NOT NULL DEFAULT 0
    );

    -- Indexes for common queries
    CREATE INDEX IF NOT EXISTS idx_sessions_remote ON sessions(remote_device_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_start ON sessions(start_time);
    CREATE INDEX IF NOT EXISTS idx_attempts_device ON login_attempts(remote_device_id);
    CREATE INDEX IF NOT EXISTS idx_attempts_time ON login_attempts(attempted_at);
  `);

  console.log('[Database] Initialized at', dbPath);
  return db;
}

/**
 * Create a no-op stub for when better-sqlite3 is not built.
 * This allows the app to launch (UI-only) without native module.
 */
function createStub() {
  const noop = () => ({});
  const noopAll = () => [];
  return {
    prepare: () => ({ run: noop, get: noop, all: noopAll, bind: () => ({ run: noop, get: noop, all: noopAll }) }),
    exec: noop,
    pragma: noop,
    _isStub: true,
  };
}

/**
 * Get the database instance.
 */
function getDatabase() {
  return db;
}

module.exports = { initDatabase, getDatabase };
