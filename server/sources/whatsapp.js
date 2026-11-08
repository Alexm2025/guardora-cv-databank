'use strict';

/*
 * WhatsApp feed. Guardora links to a WhatsApp number as a "linked device" (like WhatsApp Web: scan a QR code once)
 * and imports CV files people send to that number. It only reads: it never sends messages, never marks chats as read,
 * and ignores your own messages, statuses and channels. Groups are ignored unless turned on.
 *
 * Note: WhatsApp does not officially support third-party linked devices on normal / WhatsApp Business app numbers.
 * Use a dedicated HR number; the link can be removed any time from the phone (Linked devices) or from Guardora.
 */

const fs = require('node:fs');
const path = require('node:path');
const QRCode = require('qrcode');
const { get, run, now } = require('../db');
const { DATA_DIR } = require('../config');
const { ingestFile, logIngest, getSetting } = require('../ingest');
const { jobTitleFromSubject } = require('./mailbox');

const AUTH_DIR = path.join(DATA_DIR, 'whatsapp-session');
const CV_NAME = /\.(pdf|docx?|rtf|odt|txt)$/i;
const CV_MIME = /^(application\/(pdf|msword|rtf|vnd\.openxmlformats-officedocument\.wordprocessingml\.document|vnd\.oasis\.opendocument\.text)|text\/(plain|rtf))/i;
const CV_HINT = /\b(cv|c\.v|resume|r[eé]sum[eé]|bio[- ]?data|profile|curriculum)\b/i;
const MAX_FILE = 25 * 1024 * 1024;

const status = {
  state: 'disabled', message: 'Not connected.', qr: '', number: '', name: '', imported: 0, lastAt: null, lastError: '', lastErrorAt: null
};

const setSetting = (key, value) => run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', key, String(value));
const options = () => ({
  enabled: getSetting('whatsapp_enabled', '0') === '1',
  groups: getSetting('whatsapp_groups', '0') === '1',
  history: getSetting('whatsapp_history', '1') === '1'
});

/* ---------- Reading one message (no WhatsApp connection needed: tested on its own) ---------- */

function unwrap(message) {
  let m = message || {};
  for (let i = 0; i < 6; i++) {
    const inner = (m.ephemeralMessage || m.viewOnceMessage || m.viewOnceMessageV2 || m.viewOnceMessageV2Extension ||
      m.documentWithCaptionMessage || m.editedMessage || {}).message;
    if (!inner) break;
    m = inner;
  }
  return m;
}

/** The CV file in a message, or null. */
function cvAttachment(msg) {
  const m = unwrap(msg.message);
  const doc = m.documentMessage;
  if (doc) {
    const name = doc.fileName || doc.title || '';
    if (CV_NAME.test(name) || CV_MIME.test(doc.mimetype || '')) {
      return { kind: 'document', fileName: name || 'cv.' + ((doc.mimetype || '').includes('pdf') ? 'pdf' : 'doc'), caption: doc.caption || '', size: Number(doc.fileLength) || 0 };
    }
    return null;
  }
  // A photo is only a CV when the message says so ("my resume").
  const img = m.imageMessage;
  if (img && CV_HINT.test(img.caption || '')) return { kind: 'image', fileName: 'cv-photo.jpg', caption: img.caption || '', size: Number(img.fileLength) || 0 };
  return null;
}

// WhatsApp ids: "919876543210@s.whatsapp.net" is a phone number; "…@lid" is a hidden id; "…@g.us" is a group.
function senderPhone(key) {
  const jid = [key.senderPn, key.participantPn, key.remoteJidAlt, key.participantAlt, key.participant, key.remoteJid]
    .find((j) => typeof j === 'string' && j.endsWith('@s.whatsapp.net'));
  if (!jid) return '';
  const digits = jid.split('@')[0].split(':')[0].replace(/\D/g, '');
  return digits.length >= 10 ? '+' + digits : '';
}

/**
 * Imports the CV in one message, if it has one.
 * @param msg       a WhatsApp message (Baileys format)
 * @param download  async (msg) => Buffer
 * @param opts      { groups: boolean }
 */
async function handleMessage(msg, download, opts = {}) {
  const key = msg && msg.key;
  if (!key || key.fromMe || !key.remoteJid) return 'ignored';
  const chat = key.remoteJid;
  if (chat === 'status@broadcast' || chat.endsWith('@newsletter') || chat.endsWith('@broadcast')) return 'ignored';
  const group = chat.endsWith('@g.us');
  if (group && !opts.groups) return 'ignored';
  const file = cvAttachment(msg);
  if (!file) return 'ignored';

  const ref = 'wa:' + chat + ':' + key.id;
  if (get('SELECT 1 AS x FROM processed WHERE key = ?', ref)) return 'done';
  const phone = senderPhone(key);
  const who = (msg.pushName || '') + (phone ? ' (' + phone + ')' : '');
  if (file.size > MAX_FILE) {
    logIngest('whatsapp', ref, 'skipped', '"' + file.fileName + '" from ' + (who || 'WhatsApp') + ' is larger than 25 MB.');
    run('INSERT OR IGNORE INTO processed (key, created_at) VALUES (?, ?)', ref, now());
    return 'skipped';
  }

  let buffer;
  try {
    buffer = await download(msg);
  } catch (err) {
    const gone = /404|410|not found|expired|media/i.test(err.message);
    if (!gone) throw err; // connection problem: try again later
    logIngest('whatsapp', ref, 'skipped', '"' + file.fileName + '" from ' + (who || 'WhatsApp') + ' is no longer available on WhatsApp\'s servers.');
    run('INSERT OR IGNORE INTO processed (key, created_at) VALUES (?, ?)', ref, now());
    return 'skipped';
  }

  const ts = Number(msg.messageTimestamp && msg.messageTimestamp.low !== undefined ? msg.messageTimestamp.low : msg.messageTimestamp) || 0;
  const r = await ingestFile({
    buffer,
    fileName: file.fileName,
    source: 'whatsapp',
    ref,
    receivedAt: ts ? new Date(ts * 1000).toISOString() : now(),
    senderPhone: phone,
    senderName: msg.pushName || '',
    subject: file.caption,
    jobTitle: jobTitleFromSubject(file.caption),
    meta: { chat, group, phone, name: msg.pushName || '' }
  });
  run('INSERT OR IGNORE INTO processed (key, created_at) VALUES (?, ?)', ref, now());
  if (r.outcome === 'added' || r.outcome === 'new_version') {
    status.imported++;
    status.lastAt = now();
  }
  return r.outcome;
}

/* ---------- The connection ---------- */

let sock = null;
let baileys = null;
let stopping = false;
let reconnectTimer = null;
let queue = Promise.resolve();
let backoff = 3000;
let qrShown = 0;

const logger = require('pino')({ level: 'silent' });

function enqueue(messages, opts) {
  for (const msg of messages || []) {
    queue = queue.then(() => handleMessage(msg, (m) => baileys.downloadMediaMessage(m, 'buffer', {}, { logger, reuploadRequest: sock && sock.updateMediaMessage }), opts))
      .catch((err) => {
        status.lastError = err.message;
        status.lastErrorAt = now();
        logIngest('whatsapp', 'wa:' + ((msg.key || {}).id || ''), 'error', 'Could not import a CV from WhatsApp: ' + err.message);
      });
  }
}

async function connect() {
  const opts = options();
  if (!opts.enabled) {
    Object.assign(status, { state: 'disabled', message: 'Not connected.', qr: '' });
    return;
  }
  clearTimeout(reconnectTimer);
  baileys = baileys || await import('@whiskeysockets/baileys');
  fs.mkdirSync(AUTH_DIR, { recursive: true, mode: 0o700 });
  const { state, saveCreds } = await baileys.useMultiFileAuthState(AUTH_DIR);
  let version;
  try {
    ({ version } = await baileys.fetchLatestBaileysVersion());
  } catch { /* use the library's built-in version */ }
  Object.assign(status, { state: 'starting', message: 'Connecting to WhatsApp…' });
  const s = baileys.default({
    version, auth: state, logger, browser: baileys.Browsers.windows('Guardora'),
    markOnlineOnConnect: false, syncFullHistory: opts.history, shouldSyncHistoryMessage: () => opts.history,
    generateHighQualityLinkPreview: false, emitOwnEvents: false
  });
  sock = s;
  s.ev.on('creds.update', saveCreds);
  s.ev.on('connection.update', async (u) => {
    if (s !== sock) return;
    if (u.qr) {
      qrShown++;
      Object.assign(status, { state: 'waiting_qr', message: 'Scan this QR code with WhatsApp on the phone: Settings → Linked devices → Link a device.', qr: await QRCode.toDataURL(u.qr, { margin: 1, width: 260 }) });
    }
    if (u.connection === 'open') {
      qrShown = 0;
      backoff = 3000;
      const me = s.user || {};
      Object.assign(status, { state: 'connected', message: 'Connected. CVs sent to this number are imported automatically.', qr: '', number: senderPhone({ remoteJid: (me.id || '').replace(/:\d+@/, '@') }), name: me.name || '' });
    }
    if (u.connection === 'close') {
      const code = u.lastDisconnect && u.lastDisconnect.error && u.lastDisconnect.error.output && u.lastDisconnect.error.output.statusCode;
      sock = null;
      if (stopping) return;
      if (code === baileys.DisconnectReason.loggedOut) {
        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        setSetting('whatsapp_enabled', '0');
        Object.assign(status, { state: 'disconnected', message: 'This WhatsApp was unlinked (from the phone or here). Press Connect to link it again.', qr: '', number: '' });
        return;
      }
      if (status.state === 'waiting_qr' && qrShown >= 5) {
        setSetting('whatsapp_enabled', '0');
        Object.assign(status, { state: 'disconnected', message: 'The QR code was not scanned in time. Press Connect to get a new one.', qr: '' });
        return;
      }
      const restart = code === baileys.DisconnectReason.restartRequired;
      Object.assign(status, { state: 'reconnecting', message: restart ? 'Linked. Finishing the connection…' : 'Connection lost; reconnecting…', lastError: u.lastDisconnect && u.lastDisconnect.error ? u.lastDisconnect.error.message : '', lastErrorAt: now() });
      reconnectTimer = setTimeout(() => connect().catch(onFail), restart ? 500 : backoff);
      reconnectTimer.unref();
      backoff = Math.min(backoff * 2, 5 * 60e3);
    }
  });
  s.ev.on('messages.upsert', ({ messages }) => enqueue(messages, options()));
  s.ev.on('messaging-history.set', ({ messages }) => { if (options().history) enqueue(messages, options()); });
}

function onFail(err) {
  Object.assign(status, { state: 'error', message: 'Could not connect to WhatsApp; retrying.', lastError: err.message, lastErrorAt: now() });
  reconnectTimer = setTimeout(() => connect().catch(onFail), backoff);
  reconnectTimer.unref();
  backoff = Math.min(backoff * 2, 5 * 60e3);
}

function start() {
  stopping = false;
  if (options().enabled) connect().catch(onFail);
}

async function enable() {
  setSetting('whatsapp_enabled', '1');
  qrShown = 0;
  stopping = false;
  if (!sock) await connect().catch(onFail);
}

// Unlink: removes Guardora from the phone's linked devices and deletes the saved session.
async function unlink() {
  setSetting('whatsapp_enabled', '0');
  stopping = true;
  clearTimeout(reconnectTimer);
  const s = sock;
  sock = null;
  if (s) {
    try {
      await s.logout();
    } catch { /* already gone */ }
    try { s.end(undefined); } catch { /* ignore */ }
  }
  fs.rmSync(AUTH_DIR, { recursive: true, force: true });
  Object.assign(status, { state: 'disabled', message: 'Not connected.', qr: '', number: '', name: '' });
  stopping = false;
}

async function stop() {
  stopping = true;
  clearTimeout(reconnectTimer);
  if (sock) {
    try { sock.end(undefined); } catch { /* ignore */ }
    sock = null;
  }
}

function sync() { /* WhatsApp pushes messages as they arrive; nothing to poll */ }

const isLinked = () => fs.existsSync(path.join(AUTH_DIR, 'creds.json'));

module.exports = { start, stop, enable, unlink, sync, status, options, setSetting, isLinked, handleMessage, cvAttachment, senderPhone, unwrap };
