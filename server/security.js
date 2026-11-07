'use strict';

/*
 * Keys, encryption, password hashing and two-factor codes.
 *
 * One 256-bit master key protects everything encrypted at rest: CV files, saved mailbox/website passwords,
 * two-factor secrets and backups. Separate sub-keys are derived from it for each purpose (HKDF).
 * The master key comes from MASTER_KEY, or from a key file created on first start.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { MASTER_KEY, KEY_FILE } = require('./config');

function loadMasterKey() {
  let raw = MASTER_KEY.trim();
  let origin = 'MASTER_KEY';
  if (!raw) {
    origin = KEY_FILE;
    if (!fs.existsSync(KEY_FILE)) {
      fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
      fs.writeFileSync(KEY_FILE, crypto.randomBytes(32).toString('base64') + '\n', { mode: 0o600 });
      console.log('[security] Created a new master key in ' + KEY_FILE + '. Keep a copy somewhere safe: without it the vault cannot be opened.');
    }
    raw = fs.readFileSync(KEY_FILE, 'utf8').trim();
  }
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('The master key (' + origin + ') must be 32 bytes, as 64 hex or 44 base64 characters.');
  return key;
}

const master = loadMasterKey();
const subKey = (purpose) => Buffer.from(crypto.hkdfSync('sha256', master, Buffer.alloc(0), 'guardora:' + purpose, 32));
const KEYS = { files: subKey('files'), secrets: subKey('secrets'), backups: subKey('backups') };

/* ---------- AES-256-GCM ---------- */

const MAGIC = Buffer.from('GDV1');

function encrypt(buffer, purpose = 'files') {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEYS[purpose], iv);
  const body = Buffer.concat([cipher.update(buffer), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body]);
}

function decrypt(buffer, purpose = 'files') {
  if (!buffer.subarray(0, 4).equals(MAGIC)) throw new Error('Not a Guardora encrypted file.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEYS[purpose], buffer.subarray(4, 16));
  decipher.setAuthTag(buffer.subarray(16, 32));
  return Buffer.concat([decipher.update(buffer.subarray(32)), decipher.final()]);
}

const encryptSecret = (text) => (text ? encrypt(Buffer.from(String(text), 'utf8'), 'secrets').toString('base64') : '');
function decryptSecret(value) {
  if (!value) return '';
  try {
    return decrypt(Buffer.from(value, 'base64'), 'secrets').toString('utf8');
  } catch {
    return '';
  }
}

/* ---------- Passwords (scrypt) ---------- */

const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 32, SCRYPT);
  return ['scrypt', SCRYPT.N, salt.toString('base64'), hash.toString('base64')].join('$');
}

function verifyPassword(password, stored) {
  const [scheme, n, salt, hash] = String(stored || '').split('$');
  if (scheme !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = crypto.scryptSync(String(password), Buffer.from(salt, 'base64'), expected.length, { ...SCRYPT, N: Number(n) });
  return crypto.timingSafeEqual(actual, expected);
}

const COMMON = new Set(['password', 'password123', '12345678', '123456789', 'qwerty123', 'guardians', 'guardora', 'admin123', 'welcome123', 'iloveyou']);
function passwordProblem(password) {
  const p = String(password || '');
  if (p.length < 10) return 'Use at least 10 characters.';
  if (p.length > 200) return 'That password is too long.';
  if (COMMON.has(p.toLowerCase())) return 'That password is too common.';
  if (/^(.)\1+$/.test(p)) return 'That password is too simple.';
  return '';
}

/* ---------- Tokens ---------- */

const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

/* ---------- TOTP (RFC 6238) for authenticator apps ---------- */

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(text) {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of String(text).toUpperCase().replace(/[^A-Z2-7]/g, '')) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function totpAt(secret, counter) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}

const newTotpSecret = () => base32Encode(crypto.randomBytes(20));

// Accepts the current code and one step either side, for clock drift.
function verifyTotp(secret, code) {
  const clean = String(code || '').replace(/\D/g, '');
  if (clean.length !== 6 || !secret) return false;
  const step = Math.floor(Date.now() / 30000);
  return [-1, 0, 1].some((d) => crypto.timingSafeEqual(Buffer.from(totpAt(secret, step + d)), Buffer.from(clean)));
}

module.exports = {
  encrypt, decrypt, encryptSecret, decryptSecret,
  hashPassword, verifyPassword, passwordProblem,
  randomToken, sha256, newTotpSecret, verifyTotp, totpAt
};
