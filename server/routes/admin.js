'use strict';

const express = require('express');
const { get, all, run, insert, now } = require('../db');
const { HttpError, requireRole, audit, publicUser } = require('../auth');
const { encryptSecret, decryptSecret, hashPassword, passwordProblem } = require('../security');
const { getSetting } = require('../ingest');
const mailbox = require('../sources/mailbox');
const website = require('../sources/website');
const backup = require('../backup');

const router = express.Router();
const owner = requireRole('owner');
const viewer = requireRole('viewer');
const str = (v, max = 300) => String(v == null ? '' : v).trim().slice(0, max);
const setSetting = (key, value) => run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', key, String(value));

/* ---------- Sources: status, sync now, history ---------- */

router.get('/sources', viewer, (req, res) => {
  res.json({
    ok: true,
    mailbox: mailbox.status,
    website: website.status,
    backup: { ...backup.status, latest: backup.list()[0] || null },
    counts: all("SELECT source, outcome, COUNT(*) AS n FROM ingest_log WHERE created_at >= ? GROUP BY source, outcome", new Date(Date.now() - 7 * 864e5).toISOString())
  });
});

router.post('/sources/sync', requireRole('recruiter'), (req, res) => {
  mailbox.sync();
  website.sync();
  res.json({ ok: true });
});

router.get('/ingest-log', viewer, (req, res) => {
  const where = [];
  const params = [];
  if (['added', 'new_version', 'duplicate', 'skipped', 'error'].includes(req.query.outcome)) { where.push('outcome = ?'); params.push(req.query.outcome); }
  if (['email', 'website', 'upload'].includes(req.query.source)) { where.push('source = ?'); params.push(req.query.source); }
  const w = where.length ? ' WHERE ' + where.join(' AND ') : '';
  const page = Math.max(1, Number(req.query.page) || 1);
  res.json({
    ok: true,
    total: get('SELECT COUNT(*) AS n FROM ingest_log' + w, ...params).n,
    items: all('SELECT * FROM ingest_log' + w + ' ORDER BY id DESC LIMIT 100 OFFSET ?', ...params, (page - 1) * 100)
  });
});

/* ---------- Settings (owner only). Passwords are stored encrypted and never sent back. ---------- */

router.get('/settings', owner, (req, res) => {
  res.json({
    ok: true,
    mailbox: {
      enabled: getSetting('imap_enabled', '0') === '1',
      host: getSetting('imap_host', 'imap.gmail.com'),
      port: Number(getSetting('imap_port', '993')),
      user: getSetting('imap_user', ''),
      hasPassword: Boolean(decryptSecret(getSetting('imap_pass', ''))),
      mailboxes: getSetting('imap_mailboxes', 'INBOX'),
      since: getSetting('imap_since', ''),
      available: mailbox.status.mailboxes
    },
    website: {
      enabled: getSetting('website_enabled', '0') === '1',
      url: getSetting('website_url', 'https://guardiansindia.com'),
      email: getSetting('website_email', ''),
      hasPassword: Boolean(decryptSecret(getSetting('website_pass', ''))),
      accounts: getSetting('website_accounts', '1') === '1'
    },
    general: {
      ownDomains: getSetting('own_domains', 'guardiansindia.com'),
      shareEmail: getSetting('share_contact_email', 'hr@guardiansindia.com'),
      sharePhone: getSetting('share_contact_phone', '')
    }
  });
});

router.put('/settings/mailbox', owner, async (req, res) => {
  const b = req.body || {};
  const host = str(b.host, 120) || 'imap.gmail.com';
  const port = Number(b.port) || 993;
  const user = str(b.user, 160);
  const pass = b.password ? String(b.password).replace(/\s+/g, '') : decryptSecret(getSetting('imap_pass', ''));
  const enabled = Boolean(b.enabled);
  if (enabled) {
    if (!user || !pass) throw new HttpError(400, 'Enter the mailbox address and its app password.');
    const test = await mailbox.testConnection({ host, port, user, pass });
    if (!test.ok) throw new HttpError(400, 'Could not sign in to the mailbox: ' + test.error);
  }
  setSetting('imap_enabled', enabled ? '1' : '0');
  setSetting('imap_host', host);
  setSetting('imap_port', port);
  setSetting('imap_user', user);
  if (b.password) setSetting('imap_pass', encryptSecret(pass));
  setSetting('imap_mailboxes', str(b.mailboxes, 500) || 'INBOX');
  setSetting('imap_since', /^\d{4}-\d{2}-\d{2}$/.test(str(b.since)) ? str(b.since) : '');
  audit(req, 'settings.mailbox', user, enabled ? 'on' : 'off');
  await mailbox.restart();
  res.json({ ok: true });
});

router.post('/settings/mailbox/test', owner, async (req, res) => {
  const b = req.body || {};
  const pass = b.password ? String(b.password).replace(/\s+/g, '') : decryptSecret(getSetting('imap_pass', ''));
  res.json(await mailbox.testConnection({ host: str(b.host) || 'imap.gmail.com', port: Number(b.port) || 993, user: str(b.user), pass }));
});

router.put('/settings/website', owner, async (req, res) => {
  const b = req.body || {};
  const url = str(b.url, 200).replace(/\/+$/, '') || 'https://guardiansindia.com';
  if (!/^https?:\/\/[^\s/]+/.test(url)) throw new HttpError(400, 'Enter the website address, like https://guardiansindia.com');
  const email = str(b.email, 160);
  const pass = b.password ? String(b.password) : decryptSecret(getSetting('website_pass', ''));
  const enabled = Boolean(b.enabled);
  if (enabled) {
    if (!email || !pass) throw new HttpError(400, 'Enter the website admin email and password.');
    const test = await website.testConnection({ url, email, pass });
    if (!test.ok) throw new HttpError(400, 'Could not sign in to the website: ' + test.error);
  }
  setSetting('website_enabled', enabled ? '1' : '0');
  setSetting('website_url', url);
  setSetting('website_email', email);
  if (b.password) setSetting('website_pass', encryptSecret(pass));
  setSetting('website_accounts', b.accounts === false ? '0' : '1');
  audit(req, 'settings.website', url, enabled ? 'on' : 'off');
  website.restart();
  res.json({ ok: true });
});

router.post('/settings/website/test', owner, async (req, res) => {
  const b = req.body || {};
  const pass = b.password ? String(b.password) : decryptSecret(getSetting('website_pass', ''));
  res.json(await website.testConnection({ url: str(b.url) || 'https://guardiansindia.com', email: str(b.email), pass }));
});

router.put('/settings/general', owner, (req, res) => {
  const domains = str((req.body || {}).ownDomains, 500).toLowerCase().split(/[\s,]+/).filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d));
  setSetting('own_domains', domains.join(', ') || 'guardiansindia.com');
  const b = req.body || {};
  if ('shareEmail' in b) setSetting('share_contact_email', /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str(b.shareEmail)) ? str(b.shareEmail, 160) : 'hr@guardiansindia.com');
  if ('sharePhone' in b) setSetting('share_contact_phone', str(b.sharePhone, 40));
  audit(req, 'settings.general');
  res.json({ ok: true });
});

/* ---------- Team accounts ---------- */

router.get('/users', owner, (req, res) => {
  res.json({ ok: true, items: all('SELECT id, name, email, role, status, totp_enabled, created_at, last_login_at FROM users ORDER BY id') });
});

router.post('/users', owner, (req, res) => {
  const b = req.body || {};
  const name = str(b.name, 80);
  const email = str(b.email, 160).toLowerCase();
  const role = ['owner', 'recruiter', 'viewer'].includes(b.role) ? b.role : 'recruiter';
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter a name and a valid email.');
  if (get('SELECT 1 AS x FROM users WHERE email = ?', email)) throw new HttpError(409, 'There is already an account with this email.');
  const problem = passwordProblem(b.password);
  if (problem) throw new HttpError(400, problem);
  const uid = insert('users', { name, email, role, password_hash: hashPassword(b.password), created_at: now() });
  audit(req, 'user.created', 'user:' + uid, email + ' (' + role + ')');
  res.json({ ok: true, id: uid });
});

router.patch('/users/:id', owner, (req, res) => {
  const u = get('SELECT * FROM users WHERE id = ?', Number(req.params.id));
  if (!u) throw new HttpError(404, 'User not found.');
  const b = req.body || {};
  if (u.id === req.user.id && (b.role && b.role !== 'owner' || b.status === 'disabled')) throw new HttpError(400, 'You cannot remove your own owner access.');
  if (b.role && ['owner', 'recruiter', 'viewer'].includes(b.role)) run('UPDATE users SET role = ? WHERE id = ?', b.role, u.id);
  if (b.status && ['active', 'disabled'].includes(b.status)) {
    run('UPDATE users SET status = ? WHERE id = ?', b.status, u.id);
    if (b.status === 'disabled') run('DELETE FROM sessions WHERE user_id = ?', u.id);
  }
  if (b.password) {
    const problem = passwordProblem(b.password);
    if (problem) throw new HttpError(400, problem);
    run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(b.password), u.id);
    run('DELETE FROM sessions WHERE user_id = ?', u.id);
  }
  if (b.resetTwoFactor) run("UPDATE users SET totp_enabled = 0, totp_secret = '' WHERE id = ?", u.id);
  audit(req, 'user.updated', 'user:' + u.id, Object.keys(b).filter((k) => k !== 'password').join(',') + (b.password ? ',password' : ''));
  res.json({ ok: true, user: publicUser(get('SELECT * FROM users WHERE id = ?', u.id)) });
});

/* ---------- Backups and audit log ---------- */

router.get('/backups', owner, (req, res) => res.json({ ok: true, items: backup.list(), status: backup.status }));

router.post('/backups', owner, (req, res) => {
  const name = backup.backupNow();
  audit(req, 'backup.created', name);
  res.json({ ok: true, name });
});

router.get('/backups/:name', owner, (req, res) => {
  const file = backup.filePath(String(req.params.name));
  if (!file) throw new HttpError(404, 'Backup not found.');
  audit(req, 'backup.downloaded', req.params.name);
  res.download(file);
});

router.get('/audit', owner, (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  res.json({ ok: true, items: all('SELECT * FROM audit ORDER BY id DESC LIMIT 100 OFFSET ?', (page - 1) * 100), total: get('SELECT COUNT(*) AS n FROM audit').n });
});

module.exports = router;
