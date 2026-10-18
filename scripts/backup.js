// Safe online backup of the SQLite database. Keeps the last KEEP_DAYS copies.
// Usage: node scripts/backup.js [backup-dir]
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'tuition.db');
const DIR = process.argv[2] || process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups');
const KEEP_DAYS = Number(process.env.KEEP_DAYS || 30);

fs.mkdirSync(DIR, { recursive: true });
const stamp = new Date().toISOString().slice(0, 10);
const target = path.join(DIR, `tuition-${stamp}.db`);

const db = new Database(DB_PATH, { readonly: true });
db.backup(target)
  .then(() => {
    db.close();
    const files = fs.readdirSync(DIR).filter((f) => /^tuition-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
    for (const f of files.slice(0, Math.max(0, files.length - KEEP_DAYS))) fs.unlinkSync(path.join(DIR, f));
    console.log(`Backup written: ${target}`);
  })
  .catch((err) => {
    console.error('Backup failed:', err);
    process.exit(1);
  });
