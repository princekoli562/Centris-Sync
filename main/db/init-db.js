const Database = require("better-sqlite3");
const path = require("path");
const { app } = require("electron");

let db;

function initDB() {
    const dbPath = path.join(app.getPath("userData"), "sync-tracker.db");

    console.log("🧠 Electron userData path:", app.getPath("userData"));
    db = new Database(dbPath);

    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");

    // 1️⃣ Create table if not exists
    db.exec(`
      CREATE TABLE IF NOT EXISTS tracker (
        path TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN ('file','folder')),
        hash TEXT,
        mtime INTEGER DEFAULT 0,
        size INTEGER DEFAULT 0,
        synced INTEGER DEFAULT 0
      );
    `);

    // 2️⃣ Create B-Tree indexes (default in SQLite)
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tracker_type ON tracker(type);
      CREATE INDEX IF NOT EXISTS idx_tracker_synced ON tracker(synced);
      CREATE INDEX IF NOT EXISTS idx_tracker_mtime ON tracker(mtime);
      CREATE INDEX IF NOT EXISTS idx_tracker_path ON tracker(path);
    `);

    return db;
}

function getDB() {
    if (!db) throw new Error("DB not initialized");
    return db;
}

module.exports = { initDB, getDB };