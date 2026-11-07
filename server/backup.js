'use strict';

/*
 * Nightly encrypted backups of the database (the CV files in the vault are already encrypted, and are
 * content-addressed, so copying the vault folder is enough for them). Keeps the newest BACKUP_KEEP backups.
 * Restore with:  node tools/restore-backup.js <backup file> <output.db>
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { db } = require('./db');
const { BACKUP_DIR, BACKUP_KEEP } = require('./config');
const { encrypt } = require('./security');

const status = { lastBackupAt: null, lastError: '' };

function backupNow() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const tmp = path.join(BACKUP_DIR, '.tmp-' + stamp + '.db');
  try {
    db.exec("VACUUM INTO '" + tmp.replace(/'/g, "''") + "'");
    const packed = zlib.gzipSync(fs.readFileSync(tmp), { level: 6 });
    const file = path.join(BACKUP_DIR, 'guardora-' + stamp + '.db.gz.gdv');
    fs.writeFileSync(file, encrypt(packed, 'backups'), { mode: 0o600 });
    status.lastBackupAt = new Date().toISOString();
    status.lastError = '';
    prune();
    return path.basename(file);
  } catch (err) {
    status.lastError = err.message;
    throw err;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

function list() {
  return fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.gdv')).sort().reverse()
    .map((name) => ({ name, size: fs.statSync(path.join(BACKUP_DIR, name)).size, created_at: fs.statSync(path.join(BACKUP_DIR, name)).mtime.toISOString() }));
}

function prune() {
  for (const old of list().slice(BACKUP_KEEP)) fs.rmSync(path.join(BACKUP_DIR, old.name), { force: true });
}

const filePath = (name) => {
  if (!/^guardora-[\dT-]+\.db\.gz\.gdv$/.test(name)) return null;
  const p = path.join(BACKUP_DIR, name);
  return fs.existsSync(p) ? p : null;
};

// Every night around 02:30 server time; also once shortly after start if the last backup is over a day old.
function schedule() {
  const tick = () => {
    const d = new Date();
    const latest = list()[0];
    const ageHours = latest ? (Date.now() - Date.parse(latest.created_at)) / 36e5 : Infinity;
    if ((d.getHours() === 2 && d.getMinutes() >= 30 && ageHours > 12) || ageHours > 26) {
      try {
        backupNow();
      } catch (err) {
        console.error('[backup]', err.message);
      }
    }
  };
  setTimeout(tick, 60e3).unref();
  setInterval(tick, 10 * 60e3).unref();
}

module.exports = { backupNow, list, filePath, schedule, status };
