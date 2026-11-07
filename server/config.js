'use strict';

/* Settings from the environment, with a small .env loader so nothing extra is needed to run locally. */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let value = m[2];
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}
loadDotEnv(path.join(ROOT, '.env'));

const env = process.env;
const DATA_DIR = path.resolve(ROOT, env.DATA_DIR || 'data');

module.exports = {
  ROOT,
  DATA_DIR,
  VAULT_DIR: path.join(DATA_DIR, 'vault'),
  BACKUP_DIR: path.resolve(ROOT, env.BACKUP_DIR || path.join(DATA_DIR, 'backups')),
  DB_FILE: path.join(DATA_DIR, 'guardora.db'),
  KEY_FILE: path.resolve(ROOT, env.KEY_FILE || path.join(DATA_DIR, 'master.key')),
  PUBLIC_DIR: path.join(ROOT, 'public'),
  PORT: Number(env.PORT) || 8787,
  HOST: env.HOST || '0.0.0.0',
  PRODUCTION: env.NODE_ENV === 'production',
  MASTER_KEY: env.MASTER_KEY || '',
  // Set to 1 behind a reverse proxy (nginx, Hostinger, Cloudflare) so client IPs and https are read correctly.
  TRUST_PROXY: env.TRUST_PROXY === '1',
  BACKUP_KEEP: Number(env.BACKUP_KEEP) || 30,
  MAX_UPLOAD_MB: Number(env.MAX_UPLOAD_MB) || 20,
  DISABLE_SOURCES: env.DISABLE_SOURCES === '1', // tests: do not start the mailbox / website workers
  SITE_NAME: 'Guardora'
};
