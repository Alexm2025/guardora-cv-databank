'use strict';

/*
 * Encrypted file store for CVs. Files are addressed by the SHA-256 of their content, so the same CV
 * arriving twice (by email and from the website, say) is stored once. Each file is compressed when that
 * helps, then encrypted with AES-256-GCM; nothing in the vault folder is readable without the master key.
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { VAULT_DIR } = require('./config');
const { encrypt, decrypt, sha256 } = require('./security');

const fileFor = (hash) => path.join(VAULT_DIR, hash.slice(0, 2), hash + '.gdv');

function put(buffer) {
  const hash = sha256(buffer);
  const file = fileFor(hash);
  if (!fs.existsSync(file)) {
    const packed = zlib.deflateRawSync(buffer, { level: 6 });
    const useDeflate = packed.length < buffer.length * 0.9;
    const payload = Buffer.concat([Buffer.from([useDeflate ? 1 : 0]), useDeflate ? packed : buffer]);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, encrypt(payload, 'files'), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }
  return hash;
}

function read(hash) {
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error('Bad file id');
  const payload = decrypt(fs.readFileSync(fileFor(hash)), 'files');
  return payload[0] === 1 ? zlib.inflateRawSync(payload.subarray(1), { maxOutputLength: 200 * 1024 * 1024 }) : payload.subarray(1);
}

const exists = (hash) => /^[0-9a-f]{64}$/.test(hash) && fs.existsSync(fileFor(hash));

function remove(hash) {
  if (exists(hash)) fs.rmSync(fileFor(hash));
}

module.exports = { put, read, exists, remove };
