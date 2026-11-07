'use strict';

/*
 * Opens an encrypted Guardora backup and writes a normal SQLite database file.
 *   node tools/restore-backup.js <guardora-....db.gz.gdv> <output.db>
 * Needs the same master key (MASTER_KEY, or KEY_FILE / data/master.key) that made the backup.
 * To restore: stop Guardora, replace data/guardora.db with the output file, start Guardora.
 */

const fs = require('node:fs');
const zlib = require('node:zlib');

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('Usage: node tools/restore-backup.js <backup file> <output.db>');
  process.exit(1);
}
if (fs.existsSync(output)) {
  console.error('Refusing to overwrite ' + output + '. Choose a new file name.');
  process.exit(1);
}
const { decrypt } = require('../server/security');
const db = zlib.gunzipSync(decrypt(fs.readFileSync(input), 'backups'));
fs.writeFileSync(output, db, { mode: 0o600 });
console.log('Restored ' + (db.length / 1048576).toFixed(1) + ' MB to ' + output);
