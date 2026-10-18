const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const { app } = require("electron");

let db = null;

function initDB() {
  if (db) return db;                          // idempotent

  const dbPath = path.join(app.getPath("userData"), "sync-tracker.db");
  console.log("🧠 [init-db] opening:", dbPath);

  try {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    db = new Database(dbPath);
    console.log("🧠 [init-db] opened OK");
  } catch (err) {
    console.error("❌ [init-db] OPEN FAILED:", err);
    throw err;                              // ← MUST rethrow
  }

  try {
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    db.pragma("busy_timeout = 5000");

    db.exec(`
            CREATE TABLE IF NOT EXISTS tracker (
                path TEXT PRIMARY KEY,
                type TEXT NOT NULL CHECK (type IN ('file','folder')),
                hash TEXT,
                mtime INTEGER DEFAULT 0,
                size INTEGER DEFAULT 0,
                synced INTEGER DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_tracker_type   ON tracker(type);
            CREATE INDEX IF NOT EXISTS idx_tracker_synced ON tracker(synced);
            CREATE INDEX IF NOT EXISTS idx_tracker_mtime  ON tracker(mtime);

            CREATE TABLE IF NOT EXISTS app_settings (
                customer_id INTEGER NOT NULL,
                domain_id   INTEGER NOT NULL,
                domain_name TEXT    NOT NULL,
                user_id     INTEGER NOT NULL,
                "key"       TEXT    NOT NULL,
                value       TEXT    NOT NULL,
                created_at  INTEGER DEFAULT (strftime('%s','now')),
                updated_at  INTEGER DEFAULT (strftime('%s','now')),
                PRIMARY KEY (customer_id, domain_id, domain_name, user_id, "key")
            );
            CREATE INDEX IF NOT EXISTS idx_app_settings_user
                ON app_settings(customer_id, domain_id, domain_name, user_id);
        `);

    db.pragma("wal_checkpoint(TRUNCATE)");  // ← flush WAL immediately
    console.log("✅ [init-db] schema ready");
  } catch (err) {
    console.error("❌ [init-db] SCHEMA FAILED:", err);
    try { db.close(); } catch { }
    db = null;
    throw err;
  }

  return db;
}

function getDB() {
  if (!db) throw new Error("DB not initialized — call initDB() first");
  return db;
}

function closeDB() {
  if (!db) return;
  try {
    try { db.pragma("wal_checkpoint(TRUNCATE)"); } catch { }
    db.close();
    db = null;
    console.log("✅ [init-db] closed");
  } catch (e) {
    console.error("❌ [init-db] close failed:", e.message);
  }
}

module.exports = { initDB, getDB, closeDB };