'use strict';

/*
 * Mailbox watchers. One per connected mail account that has "import CVs" on. Each stays connected over IMAP:
 *  - first run: goes through the existing mail, oldest first (optionally only since a chosen date);
 *  - then: the server pushes new mail instantly (IMAP IDLE), with a re-check every few minutes as a safety net;
 *  - reconnects by itself after network errors, with increasing waits.
 * Progress is saved after every message, so a restart carries on where it stopped and never imports twice.
 * The same email arriving in two connected mailboxes is imported once.
 */

const { ImapFlow } = require('imapflow');
const { get, run, now } = require('../db');
const { ingestFile, logIngest, isOwnAddress } = require('../ingest');
const accounts = require('../accounts');

const CV_EXT = /\.(pdf|docx?|rtf|odt|txt|jpe?g|png)$/i;
const CV_TYPES = /^(application\/(pdf|msword|rtf|x-rtf|vnd\.openxmlformats-officedocument\.wordprocessingml\.document|vnd\.oasis\.opendocument\.text|octet-stream)|text\/(rtf|plain)|image\/(jpeg|png))$/i;
const MAX_ATTACHMENT = 25 * 1024 * 1024;
const RECHECK_MS = 3 * 60 * 1000;

/* ---------- Helpers shared by every account ---------- */

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
    if (size > limit) throw Object.assign(new Error('Attachment is too large'), { tooLarge: true });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/* ---------- One watcher per account ---------- */

class MailboxWorker {
  constructor(accountId) {
    this.id = accountId;
    this.client = null;
    this.stopping = false;
    this.wake = null;
    this.running = false;
    this.backoff = 5000;
    this.failures = new Map(); // message -> failed download attempts
    this.status = { state: 'connecting', message: 'Starting…', lastSyncAt: null, lastError: '', lastErrorAt: null, imported: 0, checkedMessages: 0, progress: null, folders: [] };
  }

  stateKey(folder) { return 'imap_state:' + this.id + ':' + folder; }

  loadState(folder) {
    const row = get('SELECT value FROM settings WHERE key = ?', this.stateKey(folder));
    try {
      return row ? JSON.parse(row.value) : {};
    } catch {
      return {};
    }
  }

  saveState(folder, state) {
    run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', this.stateKey(folder), JSON.stringify(state));
  }

  async processMessage(folder, msg, account) {
    const env = msg.envelope || {};
    const messageId = env.messageId || '';
    const key = messageId ? 'msg:' + messageId : 'uid:' + this.id + ':' + folder + ':' + msg.uid;
    if (get('SELECT 1 AS x FROM processed WHERE key = ?', key)) return 0;

    const from = (env.from && env.from[0]) || {};
    const replyTo = (env.replyTo && env.replyTo[0]) || {};
    // Website notifications and forwards from our own address: the applicant is in Reply-To.
    const person = isOwnAddress(from.address || '') && replyTo.address && !isOwnAddress(replyTo.address) ? replyTo : from;
    const receivedAt = (msg.internalDate || env.date || new Date()).toISOString();
    let imported = 0;

    for (const p of cvParts(msg.bodyStructure)) {
      let buffer;
      let fileName = p.name;
      try {
        const { content, meta } = await this.client.download(String(msg.uid), p.part, { uid: true, maxBytes: MAX_ATTACHMENT });
        buffer = await readStream(content, MAX_ATTACHMENT);
        if (meta && meta.filename) fileName = meta.filename;
      } catch (err) {
        if (!err.tooLarge) {
          // Network problem: retry this message on the next pass, but never get stuck on one broken message.
          const tries = (this.failures.get(key) || 0) + 1;
          this.failures.set(key, tries);
          if (tries < 5) throw err;
          logIngest('email', key, 'error', 'Gave up downloading "' + p.name + '" from "' + (env.subject || '(no subject)') + '" after 5 tries: ' + err.message);
          continue;
        }
        logIngest('email', key, 'skipped', '"' + p.name + '" in "' + (env.subject || '(no subject)') + '" is larger than 25 MB.');
        continue;
      }
      try {
        const r = await ingestFile({
          buffer, fileName, source: 'email', ref: key + '#' + p.part, receivedAt,
          sender: person.address || '', senderName: person.name || '', subject: env.subject || '', jobTitle: jobTitleFromSubject(env.subject),
          meta: { account: account.email, mailbox: folder, uid: msg.uid, from: from.address || '', messageId }
        });
        if (r.outcome === 'added' || r.outcome === 'new_version') imported++;
      } catch (err) {
        logIngest('email', key, 'error', 'Could not import "' + p.name + '" from "' + (env.subject || '(no subject)') + '": ' + err.message);
      }
    }
    run('INSERT OR IGNORE INTO processed (key, created_at) VALUES (?, ?)', key, now());
    return imported;
  }

  async syncFolder(folder, account) {
    const lock = await this.client.getMailboxLock(folder);
    try {
      const box = this.client.mailbox;
      const state = this.loadState(folder);
      if (state.uidValidity && String(state.uidValidity) !== String(box.uidValidity)) {
        // The server renumbered this folder. Start again: already-imported messages are recognised and skipped.
        state.lastUid = 0;
      }
      state.uidValidity = String(box.uidValidity);
      const last = Number(state.lastUid) || 0;

      let query = { uid: (last + 1) + ':*' };
      if (!last && account.since && !Number.isNaN(Date.parse(account.since))) query = { since: new Date(account.since) };
      const uids = ((await this.client.search(query, { uid: true })) || []).filter((u) => u > last).sort((a, b) => a - b);
      this.status.progress = uids.length ? { mailbox: folder, done: 0, total: uids.length } : null;

      for (let i = 0; i < uids.length && !this.stopping; i += 100) {
        const batch = uids.slice(i, i + 100);
        const messages = [];
        for await (const msg of this.client.fetch(batch.join(','), { uid: true, envelope: true, bodyStructure: true, internalDate: true }, { uid: true })) {
          messages.push(msg);
        }
        messages.sort((a, b) => a.uid - b.uid);
        for (const msg of messages) {
          if (this.stopping) break;
          if (cvParts(msg.bodyStructure).length) this.status.imported += await this.processMessage(folder, msg, account);
          this.status.checkedMessages++;
          state.lastUid = Math.max(Number(state.lastUid) || 0, msg.uid);
          this.saveState(folder, state);
          this.status.progress.done++;
        }
        if (this.stopping) break;
        // Messages in the batch the server did not return (deleted meanwhile) still move the cursor.
        state.lastUid = Math.max(Number(state.lastUid) || 0, batch[batch.length - 1]);
        this.saveState(folder, state);
      }
      this.status.progress = null;
    } finally {
      lock.release();
    }
  }

  async connect(account) {
    this.client = new ImapFlow({
      host: account.imap_host, port: account.imap_port, secure: account.imap_port !== 143,
      auth: { user: account.email, pass: account.password },
      logger: false, emitLogs: false, socketTimeout: 5 * 60 * 1000
    });
    this.client.on('error', (err) => { this.status.lastError = err.message; this.status.lastErrorAt = now(); });
    this.client.on('exists', () => this.wakeUp());
    this.client.on('close', () => this.wakeUp());
    await this.client.connect();
    this.status.folders = (await this.client.list()).map((m) => m.path);
  }

  wakeUp() {
    if (this.wake) {
      const w = this.wake;
      this.wake = null;
      w();
    }
  }

  sleep(ms) {
    return new Promise((resolve) => {
      const t = setTimeout(resolve, ms);
      t.unref();
      this.wake = () => { clearTimeout(t); resolve(); };
    });
  }

  async loop() {
    if (this.running) return;
    this.running = true;
    while (!this.stopping) {
      const account = accounts.getAccount(this.id, { withPassword: true });
      if (!account || !account.import_enabled) break;
      try {
        if (!this.client || !this.client.usable) {
          Object.assign(this.status, { state: 'connecting', message: 'Connecting to ' + account.imap_host + '…' });
          await this.connect(account);
          this.backoff = 5000;
        }
        Object.assign(this.status, { state: 'syncing', message: 'Checking for new mail…' });
        const folders = account.folders.split(',').map((f) => f.trim()).filter(Boolean);
        for (const folder of folders) {
          if (this.stopping) break;
          await this.syncFolder(folder, account);
        }
        if (this.stopping) break;
        Object.assign(this.status, { state: 'watching', message: 'Connected. Watching ' + folders.join(', ') + ' for new CVs.', lastSyncAt: now() });
        // Keep the first folder open so the server can push new mail to us (IDLE); re-check regularly anyway.
        const lock = await this.client.getMailboxLock(folders[0]);
        lock.release();
        await this.sleep(RECHECK_MS);
      } catch (err) {
        if (this.stopping) break;
        const auth = /auth|credentials|login|password|AUTHENTICATIONFAILED|Invalid|Application-specific/i.test(err.message + ' ' + (err.responseText || ''));
        Object.assign(this.status, {
          state: 'error',
          message: auth ? 'Sign-in failed. Check the address and app password in Settings → Mailboxes.' : 'Connection problem; retrying in ' + Math.round(this.backoff / 1000) + 's.',
          lastError: err.responseText || err.message, lastErrorAt: now()
        });
        await this.close();
        await this.sleep(auth ? Math.max(this.backoff, 10 * 60 * 1000) : this.backoff);
        this.backoff = Math.min(this.backoff * 2, 15 * 60 * 1000);
      }
    }
    await this.close();
    this.running = false;
  }

  async close() {
    const c = this.client;
    this.client = null;
    if (c) {
      try {
        await c.logout();
      } catch { /* already closed */ }
    }
  }

  async stop() {
    this.stopping = true;
    this.wakeUp();
    await this.close();
  }
}

/* ---------- All accounts ---------- */

const workers = new Map();
let started = false;

function startWorker(id) {
  const w = new MailboxWorker(id);
  workers.set(id, w);
  w.loop().catch((err) => console.error('[mailbox ' + id + ']', err));
}

function start() {
  started = true;
  for (const a of accounts.list()) if (a.import_enabled && !workers.has(a.id)) startWorker(a.id);
}

// An account was added, changed or removed: restart its watcher with the new details.
async function restart(id) {
  const old = workers.get(id);
  workers.delete(id);
  if (old) await old.stop();
  const a = accounts.getAccount(id);
  if (started && a && a.import_enabled) startWorker(id);
}

async function stop() {
  started = false;
  await Promise.all([...workers.values()].map((w) => w.stop()));
  workers.clear();
}

function sync() {
  for (const w of workers.values()) w.wakeUp();
}

function statuses() {
  return accounts.list().map((a) => {
    const w = workers.get(a.id);
    const st = w ? w.status : { state: 'disabled', message: a.import_enabled ? 'Starting…' : 'Importing is turned off for this mailbox.', imported: 0 };
    return { id: a.id, email: a.email, label: a.label, import_enabled: a.import_enabled, send_enabled: a.send_enabled, ...st };
  });
}

// One line for the menu and the overview card.
function overall() {
  const list = statuses().filter((s) => s.import_enabled);
  if (!list.length) return { state: 'disabled', message: accounts.list().length ? 'No mailbox is set to import CVs.' : 'No mailbox connected yet.' };
  const bad = list.filter((s) => s.state === 'error');
  if (bad.length) return { state: 'error', message: bad.map((s) => s.email).join(', ') + ': ' + bad[0].message };
  const busy = list.find((s) => ['syncing', 'connecting'].includes(s.state) && s.progress);
  if (busy) return { state: 'syncing', message: busy.email + ': importing ' + busy.progress.done + ' of ' + busy.progress.total + ' messages…' };
  if (list.some((s) => ['syncing', 'connecting'].includes(s.state))) return { state: 'syncing', message: 'Checking ' + list.length + ' mailbox' + (list.length > 1 ? 'es' : '') + '…' };
  return { state: 'watching', message: list.length === 1 ? 'Connected. Watching ' + list[0].email + '.' : list.length + ' mailboxes connected: ' + list.map((s) => s.email).join(', ') + '.' };
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

module.exports = { start, stop, restart, sync, statuses, overall, testConnection, jobTitleFromSubject, cvParts };
