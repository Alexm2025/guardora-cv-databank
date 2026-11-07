'use strict';

/*
 * Website feed. Signs in to the Guardians admin panel with an admin account and imports:
 *  - every job application (guest and signed-in) with its CV and the details the applicant typed;
 *  - the resumes of registered job seekers (every few hours; unchanged files are recognised and skipped).
 * Read-only: it never changes anything on the website.
 */

const { get, run, now } = require('../db');
const { decryptSecret, encryptSecret } = require('../security');
const { ingestFile, logIngest, getSetting } = require('../ingest');

const status = { state: 'disabled', message: 'Not set up yet.', lastSyncAt: null, lastError: '', lastErrorAt: null, imported: 0, lastApplicationId: 0 };
const INTERVAL_MS = 5 * 60 * 1000;
const ACCOUNTS_EVERY_MS = 6 * 60 * 60 * 1000;

let timer = null;
let running = false;
let stopping = false;

function config() {
  return {
    enabled: getSetting('website_enabled', '0') === '1',
    url: getSetting('website_url', 'https://guardiansindia.com').replace(/\/+$/, ''),
    email: getSetting('website_email', ''),
    pass: decryptSecret(getSetting('website_pass', '')),
    accounts: getSetting('website_accounts', '1') === '1'
  };
}

const setSetting = (key, value) => run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', key, String(value));

class SiteClient {
  constructor({ url, email, pass }) {
    this.url = url;
    this.email = email;
    this.pass = pass;
    this.cookie = decryptSecret(getSetting('website_cookie', ''));
  }

  async login() {
    const res = await fetch(this.url + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'Guardora/1.0' },
      body: JSON.stringify({ email: this.email, password: this.pass }),
      signal: AbortSignal.timeout(30000)
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(body.error || body.message || 'Sign-in failed (' + res.status + ')'), { auth: res.status === 401 || res.status === 403 });
    if (body.user && body.user.role !== 'ADMIN') throw Object.assign(new Error('This website account is not an administrator.'), { auth: true });
    const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie') || ''];
    const session = set.map((c) => c.split(';')[0]).find((c) => c.startsWith('guardians_session='));
    if (!session) throw new Error('The website did not start a session.');
    this.cookie = session;
    setSetting('website_cookie', encryptSecret(session));
  }

  async request(path, { binary = false, retry = true } = {}) {
    if (!this.cookie) await this.login();
    const res = await fetch(this.url + path, {
      headers: { Cookie: this.cookie, Accept: binary ? '*/*' : 'application/json', 'User-Agent': 'Guardora/1.0' },
      signal: AbortSignal.timeout(120000)
    });
    if ((res.status === 401 || res.status === 403) && retry) {
      this.cookie = '';
      await this.login();
      return this.request(path, { binary, retry: false });
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw Object.assign(new Error(body.error || body.message || path + ' returned ' + res.status), { status: res.status });
    }
    if (!binary) return res.json();
    const disposition = res.headers.get('content-disposition') || '';
    const star = disposition.match(/filename\*=UTF-8''([^;]+)/i);
    const plain = disposition.match(/filename="?([^";]+)"?/i);
    const fileName = star ? decodeURIComponent(star[1]) : plain ? plain[1] : 'cv';
    return { buffer: Buffer.from(await res.arrayBuffer()), fileName };
  }
}

async function syncApplications(site) {
  const lastId = Number(getSetting('website_last_app', '0')) || 0;
  const fresh = [];
  for (let page = 1; page < 10000 && !stopping; page++) {
    const data = await site.request('/api/admin/applications?pageSize=100&page=' + page);
    const items = data.items || [];
    fresh.push(...items.filter((a) => a.id > lastId));
    if (!items.length || items[items.length - 1].id <= lastId || page * (data.pageSize || 100) >= data.total) break;
  }
  fresh.sort((a, b) => a.id - b.id);

  let maxDone = lastId;
  for (const a of fresh) {
    if (stopping) break;
    const key = 'app:' + a.id;
    if (!get('SELECT 1 AS x FROM processed WHERE key = ?', key)) {
      if (a.has_cv) {
        try {
          const file = await site.request('/api/admin/applications/' + a.id + '/cv', { binary: true });
          const r = await ingestFile({
            buffer: file.buffer, fileName: file.fileName, source: 'website', ref: key, trusted: true,
            receivedAt: a.created_at, sender: a.email, senderName: a.name, jobTitle: a.job_title,
            form: { name: a.name, email: a.email, phone: a.phone, currentCtc: a.current_ctc, expectedCtc: a.expected_ctc, noticePeriod: a.notice_period },
            meta: { applicationId: a.id, status: a.status, note: a.note || '', account: Boolean(a.user_id) }
          });
          if (r.outcome === 'added' || r.outcome === 'new_version') status.imported++;
        } catch (err) {
          if (err.status !== 404) throw err; // network problems: stop here and retry this one next time
          logIngest('website', key, 'skipped', 'Application #' + a.id + ' (' + a.name + '): the CV file is no longer on the website.');
        }
      } else {
        logIngest('website', key, 'skipped', 'Application #' + a.id + ' (' + a.name + ', ' + a.job_title + ') has no CV attached.');
      }
      run('INSERT OR IGNORE INTO processed (key, created_at) VALUES (?, ?)', key, now());
    }
    maxDone = a.id;
    setSetting('website_last_app', maxDone);
    status.lastApplicationId = maxDone;
  }
}

async function syncAccounts(site) {
  for (let page = 1; page < 10000 && !stopping; page++) {
    const data = await site.request('/api/admin/employees?pageSize=100&page=' + page);
    for (const u of data.items || []) {
      if (stopping || !u.has_resume) continue;
      try {
        const file = await site.request('/api/admin/employees/' + u.id + '/resume', { binary: true });
        const r = await ingestFile({
          buffer: file.buffer, fileName: file.fileName, source: 'website', ref: 'account:' + u.id, trusted: true,
          sender: u.email, senderName: u.name, form: { name: u.name, email: u.email, phone: u.phone },
          meta: { accountId: u.id, headline: u.headline || '', domain: u.domain || '' }
        });
        if (r.outcome === 'added' || r.outcome === 'new_version') status.imported++;
      } catch (err) {
        if (err.status !== 404) throw err;
      }
    }
    if (!(data.items || []).length || page * (data.pageSize || 100) >= data.total) break;
  }
  setSetting('website_accounts_at', Date.now());
}

async function syncOnce() {
  if (running) return;
  const cfg = config();
  if (!cfg.enabled || !cfg.email || !cfg.pass) {
    Object.assign(status, { state: 'disabled', message: cfg.enabled ? 'Add the website admin email and password in Settings.' : 'Turned off in Settings.' });
    return;
  }
  running = true;
  Object.assign(status, { state: 'syncing', message: 'Checking the website for new applications…' });
  try {
    const site = new SiteClient(cfg);
    await syncApplications(site);
    if (cfg.accounts && Date.now() - (Number(getSetting('website_accounts_at', '0')) || 0) > ACCOUNTS_EVERY_MS) await syncAccounts(site);
    Object.assign(status, { state: 'watching', message: 'Connected to ' + cfg.url + '. Checking every 5 minutes.', lastSyncAt: now() });
  } catch (err) {
    Object.assign(status, {
      state: 'error',
      message: err.auth ? 'Sign-in to the website failed. Check the admin email and password in Settings.' : 'Could not reach the website; will retry.',
      lastError: err.message, lastErrorAt: now()
    });
  } finally {
    running = false;
  }
}

function start() {
  stopping = false;
  syncOnce();
  timer = setInterval(syncOnce, INTERVAL_MS);
  timer.unref();
}

function stop() {
  stopping = true;
  clearInterval(timer);
}

function restart() {
  setSetting('website_cookie', '');
  syncOnce();
}

async function testConnection({ url, email, pass }) {
  try {
    const site = new SiteClient({ url: String(url).replace(/\/+$/, ''), email, pass });
    site.cookie = '';
    await site.login();
    const data = await site.request('/api/admin/applications?pageSize=1');
    return { ok: true, applications: data.total };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { start, stop, restart, sync: syncOnce, status, testConnection };
