const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'tuition.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- One row per class + division, e.g. 8-A. Fee is per month.
CREATE TABLE IF NOT EXISTS batches (
  id INTEGER PRIMARY KEY,
  grade INTEGER NOT NULL,
  division TEXT NOT NULL,
  monthly_fee INTEGER NOT NULL DEFAULT 2500,
  UNIQUE (grade, division)
);

CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  batch_id INTEGER NOT NULL REFERENCES batches(id),
  roll_no TEXT,
  parent_name TEXT,
  phone TEXT,
  address TEXT,
  join_date TEXT NOT NULL,
  fee_start TEXT NOT NULL,          -- YYYY-MM, first month fees are charged
  active INTEGER NOT NULL DEFAULT 1,
  left_on TEXT,                     -- YYYY-MM-DD when marked inactive
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_students_batch ON students(batch_id);

-- Monthly dues: what a student owes for a month.
CREATE TABLE IF NOT EXISTS dues (
  id INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  month TEXT NOT NULL,              -- YYYY-MM
  amount INTEGER NOT NULL,
  UNIQUE (student_id, month)
);

-- Payments: money actually received.
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  mode TEXT NOT NULL,               -- Cash / UPI / Bank
  paid_on TEXT NOT NULL,            -- YYYY-MM-DD
  months_covered TEXT,              -- snapshot for the receipt
  balance_after INTEGER,            -- pending after this payment (snapshot)
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_payments_student ON payments(student_id);
CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(paid_on);

CREATE TABLE IF NOT EXISTS attendance (
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  date TEXT NOT NULL,               -- YYYY-MM-DD
  present INTEGER NOT NULL,
  PRIMARY KEY (student_id, date)
);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date);
`);

// Seed classes 8-10, divisions A-D.
const batchCount = db.prepare('SELECT COUNT(*) AS n FROM batches').get().n;
if (batchCount === 0) {
  const insert = db.prepare('INSERT INTO batches (grade, division, monthly_fee) VALUES (?, ?, ?)');
  db.transaction(() => {
    for (const grade of [8, 9, 10]) {
      for (const div of ['A', 'B', 'C', 'D']) insert.run(grade, div, 2500);
    }
  })();
}

const defaults = {
  center_name: 'My Tuition Center',
  center_address: '',
  center_phone: '',
};
const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(defaults)) insertSetting.run(k, v);

function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}

module.exports = { db, getSettings, setSetting, DB_PATH };
