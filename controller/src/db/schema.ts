import { Database } from "bun:sqlite";
import { join } from "path";
import { mkdirSync } from "fs";

const DB_PATH = process.env.DB_PATH || join(process.cwd(), "data", "manyclaws.db");

let db: Database;

export function getDb(): Database {
  if (!db) {
    mkdirSync(join(DB_PATH, ".."), { recursive: true });
    db = new Database(DB_PATH);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    initSchema(db);
  }
  return db;
}

function initSchema(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS friends (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      discord_id TEXT UNIQUE,
      signal_uuid TEXT UNIQUE,
      whatsapp_id TEXT UNIQUE,
      preferred_channel TEXT,
      namespace TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS friendships (
      agent_id TEXT NOT NULL,
      friend_id TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (agent_id, friend_id)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      friend_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

}
