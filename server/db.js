// server/db.js
//
// Uses @libsql/client instead of better-sqlite3. This is a deliberate swap from
// the original plan — see README.md "Why libSQL instead of a plain SQLite file"
// for the reasoning. Functionally, the SQL below is 100% standard SQLite; only
// the driver and the fact that calls are async are different.
//
// LOCAL DEV: with no TURSO_DATABASE_URL set, this opens a plain local file at
// data/app.db — same as better-sqlite3 would have. No Turso account needed to
// develop or test on your laptop.
//
// PRODUCTION: with TURSO_DATABASE_URL + TURSO_AUTH_TOKEN set, this talks to a
// free hosted libSQL database instead of local disk. That matters because most
// free hosting tiers (including Render's) do NOT give free web services a
// persistent disk — anything written to local disk can vanish on restart/
// redeploy. Turso's free tier gives you real persistence without paying for
// hosting-level disk.

const path = require('path');
const fs = require('fs');
const { createClient } = require('@libsql/client');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const usingTurso = Boolean(process.env.TURSO_DATABASE_URL);

const client = createClient(
  usingTurso
    ? {
        url: process.env.TURSO_DATABASE_URL,
        authToken: process.env.TURSO_AUTH_TOKEN,
      }
    : { url: `file:${path.join(DATA_DIR, 'app.db')}` }
);

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    notes TEXT,
    deadline TEXT NOT NULL,          -- UTC ISO 8601, e.g. 2026-08-24T11:00:00.000Z
    completed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    type TEXT NOT NULL,              -- '5_days_before' | '3_days_before' | '1_day_before' | 'day_of_9h' | ... | 'deadline_moment'
    scheduled_for TEXT NOT NULL,     -- UTC ISO 8601
    sent INTEGER NOT NULL DEFAULT 0,
    sent_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    device_label TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders (sent, scheduled_for)`,
];

async function initDb() {
  await client.execute('PRAGMA foreign_keys = ON;');
  for (const statement of SCHEMA) {
    await client.execute(statement);
  }
  console.log(`[db] ready (${usingTurso ? 'Turso: ' + process.env.TURSO_DATABASE_URL : 'local file'})`);
}

module.exports = { client, initDb, usingTurso };
