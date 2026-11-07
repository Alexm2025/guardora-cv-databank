'use strict';

/*
 * Mailbox watcher. Stays connected to the HR mailbox over IMAP and imports every CV attachment:
 *  - first run: goes through the existing mail, oldest first (optionally only since a chosen date);
 *  - then: the server pushes new mail instantly (IMAP IDLE), with a re-check every few minutes as a safety net;
 *  - reconnects by itself after network errors, with increasing waits.
 * Progress is saved after every message, so a restart carries on where it stopped and never imports twice.
 */

const { ImapFlow } = require('imapflow');
const { get, run, now } = require('../db');
const { decryptSecret } = require('../security');
const { ingestFile, logIngest, getSetting, isOwnAddress } = require('../ingest');

const CV_EXT = /\.(pdf|docx?|rtf|odt|txt|jpe?g|png)$/i;
const CV_TYPES = /^(application\/(pdf|msword|rtf|x-rtf|vnd\.openxmlformats-officedocument\.wordprocessingml\.document|vnd\.oasis\.opendocument\.text|octet-stream)|text\/(rtf|plain)|image\/(jpeg|png))$/i;
const MAX_ATTACHMENT = 25 * 1024 * 1024;
const RECHECK_MS = 3 * 60 * 1000;

const status = {
  state: 'disabled', message: 'Not set up yet.', lastSyncAt: null, lastError: '', lastErrorAt: null,
  imported: 0, checkedMessages: 0, progress: null, mailboxes: []
};

let client = null;
let stopping = false;
let wake = null;
let loopRunning = false;
let backoff = 5000;

function config() {
  return {
    enabled: getSetting('imap_enabled', '0') === '1',
    host: getSetting('imap_host', 'imap.gmail.com'),
    port: Number(getSetting('imap_port', '993')) || 993,
    user: getSetting('imap_user', ''),
    pass: decryptSecret(getSetting('imap_pass', '')),
    mailboxes: getSetting('imap_mailboxes', 'INBOX').split(',').map((m) => m.trim()).filter(Boolean),
    since: getSetting('imap_since', '')
  };
}

const stateKey = (mailbox) => 'imap_state:' + mailbox;
function loadState(mailbox) {
  const row = get('SELECT value FROM settings WHERE key = ?', stateKey(mailbox));
  try {
    return row ? JSON.parse(row.value) : {};
  } catch {
    return {};
  }
}
function saveState(mailbox, state) {
  run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', stateKey(mailbox), JSON.stringify(state));
}

// Attachment parts anywhere in the message, including inside forwarded emails.
function cvParts(node, out = []) {
  if (!node) return out;
  const name = (node.dispositionParameters && node.dispositionParameters.filename) || (node.parameters && node.parameters.name) || '';
  if (!node.childNodes && node.part && (CV_EXT.test(name) || (CV_TYPES.test(node.type || '') && node.disposition === 'attachment' && !/^text\/plain$/i.test(node.type)))) {
    if (!(node.size > MAX_ATTACHMENT)) out.push({ part: node.part, name: name || 'attachment', type: node.type, size: node.size || 0 });
  }
  for (const child of node.childNodes || []) cvParts(child, out);
  return out;
}

function jobTitleFromSubject(subject) {
  const s = String(subject || '');
  // The website's own format: "[Application] <job title> — <name>" (job titles may contain hyphens).
  let m = s.match(/^\s*\[application\]\s*(.+)\s+—\s+[^—]+$/i) || s.match(/^\s*\[application\]\s*(.+?)\s+-\s+[^-]+$/i);
  if (m) return m[1].trim();
  m = s.match(/\b(?:application|applying|apply|applied|resume|cv|candidature)\s+(?:for|to)\s+(?:the\s+)?(?:post|position|role|job|vacancy|opening)?\s*(?:of|as)?\s*[:\-–]?\s*([A-Za-z][A-Za-z &/().,-]{2,60})/i);
  return m ? m[1].replace(/\s+(at|in|with)\s+.*$/i, '').trim() : '';
}

async function readStream(stream, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > limit) throw new Error('Attachment is too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function processMessage(mailbox, msg) {
  const env = msg.envelope || {};
  const messageId = env.messageId || '';
  const key = messageId ? 'msg:' + messageId : 'uid:' + mailbox + ':' + msg.uid;
  if (get('SELECT 1 AS x FROM processed WHERE key = ?', key)) return 0;

  const from = (env.from && env.from[0]) || {};
  const replyTo = (env.replyTo && env.replyTo[0]) || {};
  // Website notifications and forwards from our own address: the applicant is in Reply-To.
  const person = isOwnAddress(from.address || '') && replyTo.address && !isOwnAddress(replyTo.address) ? replyTo : from;
  const receivedAt = (msg.internalDate || env.date || new Date()).toISOString();
  const parts = cvParts(msg.bodyStructure);
  let imported = 0;

  for (const p of parts) {
    try {
      const { content, meta } = await client.download(String(msg.uid), p.part, { uid: true, maxBytes: MAX_ATTACHMENT });
      const buffer = await readStream(content, MAX_ATTACHMENT);
      const r = await ingestFile({
        buffer,
        fileName: (meta && meta.filename) || p.name,
        source: 'email',
        ref: key + '#' + p.part,
        receivedAt,
        sender: person.address || '',
        senderName: person.name || '',
        subject: env.subject || '',
        jobTitle: jobTitleFromSubject(env.subject),
        meta: { mailbox, uid: msg.uid, from: from.address || '', messageId }
      });
      if (r.outcome === 'added' || r.outcome === 'new_version') imported++;
    } catch (err) {
      logIngest('email', key, 'error', 'Could not import "' + p.name + '" from "' + (env.subject || '(no subject)') + '": ' + err.message);
    }
  }
  run('INSERT OR IGNORE INTO processed (key, created_at) VALUES (?, ?)', key, now());
  return imported;
}

async function syncMailbox(mailbox, cfg) {
  const lock = await client.getMailboxLock(mailbox);
  try {
    const box = client.mailbox;
    const state = loadState(mailbox);
    if (state.uidValidity && String(state.uidValidity) !== String(box.uidValidity)) {
      // The server renumbered this folder. Start again: already-imported messages are recognised and skipped.
      state.lastUid = 0;
    }
    state.uidValidity = String(box.uidValidity);
    const last = Number(state.lastUid) || 0;

    let query = { uid: (last + 1) + ':*' };
    if (!last && cfg.since && !Number.isNaN(Date.parse(cfg.since))) query = { since: new Date(cfg.since) };
    const uids = ((await client.search(query, { uid: true })) || []).filter((u) => u > last).sort((a, b) => a - b);
    status.progress = uids.length ? { mailbox, done: 0, total: uids.length } : null;

    for (let i = 0; i < uids.length && !stopping; i += 100) {
      const batch = uids.slice(i, i + 100);
      const messages = [];
      for await (const msg of client.fetch(batch.join(','), { uid: true, envelope: true, bodyStructure: true, internalDate: true }, { uid: true })) {
        messages.push(msg);
      }
      messages.sort((a, b) => a.uid - b.uid);
      for (const msg of messages) {
        if (stopping) break;
        if (cvParts(msg.bodyStructure).length) status.imported += await processMessage(mailbox, msg);
        status.checkedMessages++;
        state.lastUid = Math.max(Number(state.lastUid) || 0, msg.uid);
        saveState(mailbox, state);
        status.progress.done++;
      }
      // Messages in the batch the server did not return (deleted meanwhile) still move the cursor.
      state.lastUid = Math.max(Number(state.lastUid) || 0, batch[batch.length - 1]);
      saveState(mailbox, state);
    }
    status.progress = null;
  } finally {
    lock.release();
  }
}

async function connect(cfg) {
  client = new ImapFlow({
    host: cfg.host, port: cfg.port, secure: cfg.port === 993,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false, emitLogs: false, socketTimeout: 5 * 60 * 1000
  });
  client.on('error', (err) => { status.lastError = err.message; status.lastErrorAt = now(); });
  client.on('exists', () => wakeUp());
  client.on('close', () => wakeUp());
  await client.connect();
  status.mailboxes = (await client.list()).map((m) => m.path);
}

function wakeUp() {
  if (wake) {
    const w = wake;
    wake = null;
    w();
  }
}

async function loop() {
  if (loopRunning) return;
  loopRunning = true;
  while (!stopping) {
    const cfg = config();
    if (!cfg.enabled || !cfg.user || !cfg.pass) {
      Object.assign(status, { state: 'disabled', message: cfg.enabled ? 'Add the mailbox address and app password in Settings.' : 'Turned off in Settings.' });
      await sleep(60000);
      continue;
    }
    try {
      if (!client || !client.usable) {
        Object.assign(status, { state: 'connecting', message: 'Connecting to ' + cfg.host + '…' });
        await connect(cfg);
        backoff = 5000;
      }
      Object.assign(status, { state: 'syncing', message: 'Checking for new mail…' });
      for (const mailbox of cfg.mailboxes) {
        if (stopping) break;
        await syncMailbox(mailbox, cfg);
      }
      Object.assign(status, { state: 'watching', message: 'Connected. Watching ' + cfg.mailboxes.join(', ') + ' for new CVs.', lastSyncAt: now() });
      // Keep the first folder open so the server can push new mail to us (IDLE), and re-check regularly anyway.
      const lock = await client.getMailboxLock(cfg.mailboxes[0]);
      lock.release();
      await new Promise((resolve) => {
        wake = resolve;
        setTimeout(resolve, RECHECK_MS).unref();
      });
    } catch (err) {
      const auth = /auth|credentials|login|password|AUTHENTICATIONFAILED|Invalid/i.test(err.message + ' ' + (err.responseText || ''));
      Object.assign(status, {
        state: 'error',
        message: auth ? 'Sign-in to the mailbox failed. Check the address and app password in Settings.' : 'Connection problem; retrying in ' + Math.round(backoff / 1000) + 's.',
        lastError: err.responseText || err.message, lastErrorAt: now()
      });
      try {
        if (client) await client.logout();
      } catch { /* already closed */ }
      client = null;
      await sleep(auth ? Math.max(backoff, 10 * 60 * 1000) : backoff);
      backoff = Math.min(backoff * 2, 15 * 60 * 1000);
    }
  }
  loopRunning = false;
}

const sleep = (ms) => new Promise((resolve) => {
  const t = setTimeout(resolve, ms);
  t.unref();
  const prev = wake;
  wake = () => { clearTimeout(t); resolve(); if (prev) prev(); };
});

// Settings changed: drop the connection so the loop reconnects with the new details.
async function restart() {
  if (client) {
    try {
      await client.logout();
    } catch { /* ignore */ }
    client = null;
  }
  wakeUp();
}

function start() {
  stopping = false;
  loop().catch((err) => console.error('[mailbox]', err));
}

async function stop() {
  stopping = true;
  await restart();
}

async function testConnection({ host, port, user, pass }) {
  const c = new ImapFlow({ host, port: Number(port) || 993, secure: Number(port) !== 143, auth: { user, pass }, logger: false });
  try {
    await c.connect();
    const boxes = (await c.list()).map((m) => m.path);
    const lock = await c.getMailboxLock('INBOX');
    const count = c.mailbox.exists;
    lock.release();
    await c.logout();
    return { ok: true, mailboxes: boxes, inboxCount: count };
  } catch (err) {
    try {
      await c.logout();
    } catch { /* ignore */ }
    return { ok: false, error: err.responseText || err.message };
  }
}

module.exports = { start, stop, restart, sync: wakeUp, status, testConnection, jobTitleFromSubject, cvParts };
