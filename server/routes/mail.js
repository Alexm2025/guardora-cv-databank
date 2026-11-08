'use strict';

/* Connected mailboxes (read CVs from / send through) and bulk email campaigns. */

const express = require('express');
const multer = require('multer');
const { get, all } = require('../db');
const { HttpError, requireRole, audit } = require('../auth');
const accounts = require('../accounts');
const mailbox = require('../sources/mailbox');
const mailer = require('../mailer');
const campaigns = require('../campaigns');
const vault = require('../vault');
const { parseJson } = require('../ingest');

const router = express.Router();
const owner = requireRole('owner');
const editor = requireRole('recruiter');
const viewer = requireRole('viewer');
const bad = (err) => new HttpError(400, err.message || String(err));

/* ---------- Mailboxes ---------- */

router.get('/mail-accounts', owner, (req, res) => {
  res.json({ ok: true, items: accounts.list(), statuses: mailbox.statuses(), presets: accounts.PRESETS });
});

// For the "send from" choice when writing an email.
router.get('/mail-accounts/senders', editor, (req, res) => {
  res.json({ ok: true, items: accounts.list().filter((a) => a.send_enabled).map((a) => ({ id: a.id, email: a.email, from_name: a.from_name, daily_limit: a.daily_limit, sent_today: mailer.sentToday(a.id) })) });
});

async function check(row, password) {
  const problems = [];
  if (row.import_enabled) {
    const r = await mailbox.testConnection({ host: row.imap_host, port: row.imap_port, user: row.email, pass: password });
    if (!r.ok) problems.push('Reading mail failed: ' + r.error);
  }
  if (row.send_enabled) {
    const r = await mailer.verifySmtp({ ...row, password });
    if (!r.ok) problems.push('Sending mail failed: ' + r.error);
  }
  return problems;
}

router.post('/mail-accounts/test', owner, async (req, res) => {
  const b = req.body || {};
  const existing = b.id ? accounts.getAccount(b.id, { withPassword: true }) : null;
  let cleaned;
  try {
    cleaned = accounts.clean({ ...b, import_enabled: true, send_enabled: Boolean(b.send_enabled) }, existing);
  } catch (err) { throw bad(err); }
  const imap = await mailbox.testConnection({ host: cleaned.row.imap_host, port: cleaned.row.imap_port, user: cleaned.row.email, pass: cleaned.password });
  const smtp = b.send_enabled ? await mailer.verifySmtp({ ...cleaned.row, password: cleaned.password }) : null;
  res.json({ ok: true, imap, smtp });
});

router.post('/mail-accounts', owner, async (req, res) => {
  let cleaned;
  try {
    cleaned = accounts.clean(req.body || {});
  } catch (err) { throw bad(err); }
  const problems = await check(cleaned.row, cleaned.password);
  if (problems.length) throw new HttpError(400, problems.join(' '));
  let id;
  try {
    id = accounts.save(cleaned);
  } catch (err) { throw bad(err); }
  audit(req, 'mailbox.added', cleaned.row.email, [cleaned.row.import_enabled && 'import', cleaned.row.send_enabled && 'send'].filter(Boolean).join('+'));
  await mailbox.restart(id);
  res.json({ ok: true, id });
});

router.put('/mail-accounts/:id', owner, async (req, res) => {
  const id = Number(req.params.id);
  const existing = accounts.getAccount(id, { withPassword: true });
  if (!existing) throw new HttpError(404, 'Mailbox not found.');
  let cleaned;
  try {
    cleaned = accounts.clean({ ...req.body, email: existing.email }, existing);
  } catch (err) { throw bad(err); }
  const problems = await check(cleaned.row, cleaned.password);
  if (problems.length) throw new HttpError(400, problems.join(' '));
  accounts.save(cleaned, id);
  audit(req, 'mailbox.updated', existing.email);
  await mailbox.restart(id);
  res.json({ ok: true });
});

router.delete('/mail-accounts/:id', owner, async (req, res) => {
  const a = accounts.getAccount(Number(req.params.id));
  if (!a) throw new HttpError(404, 'Mailbox not found.');
  accounts.remove(a.id);
  await mailbox.restart(a.id);
  audit(req, 'mailbox.removed', a.email);
  res.json({ ok: true });
});

/* ---------- Campaigns ---------- */

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 5 } });

router.get('/campaigns', viewer, (req, res) => {
  const items = all(`SELECT c.*, a.email AS from_email, u.name AS created_by_name FROM campaigns c LEFT JOIN mail_accounts a ON a.id = c.account_id
                     LEFT JOIN users u ON u.id = c.created_by ORDER BY c.id DESC LIMIT 200`)
    .map((c) => ({ ...c, attachments: parseJson(c.attachments, []).map((a) => ({ name: a.name, size: a.size })), skipped: get("SELECT COUNT(*) AS n FROM campaign_recipients WHERE campaign_id = ? AND status = 'skipped'", c.id).n }));
  res.json({ ok: true, items, fields: Object.keys(campaigns.FIELDS) });
});

router.get('/campaigns/:id', viewer, (req, res) => {
  const c = get('SELECT * FROM campaigns WHERE id = ?', Number(req.params.id));
  if (!c) throw new HttpError(404, 'Email not found.');
  res.json({ ok: true, campaign: { ...c, attachments: parseJson(c.attachments, []) }, recipients: all('SELECT id, candidate_id, email, name, status, error, sent_at FROM campaign_recipients WHERE campaign_id = ? ORDER BY id', c.id) });
});

// What the first chosen person will receive, with the personal fields filled in.
router.post('/campaigns/preview', editor, (req, res) => {
  const b = req.body || {};
  const account = accounts.getAccount(b.accountId) || { signature: '' };
  const c = get('SELECT * FROM candidates WHERE id = ?', Number(b.candidateId)) || { name: 'Priya Sharma', applied_for: 'Accounts Executive', city: 'Thane' };
  const mail = campaigns.compose({ subject: b.subject, body: b.body }, account, c);
  res.json({ ok: true, to: c.email || '', subject: mail.subject, text: mail.text });
});

router.post('/campaigns', editor, upload.array('files', 5), async (req, res) => {
  let data;
  try {
    data = JSON.parse((req.body || {}).data || '{}');
  } catch { throw new HttpError(400, 'Bad request.'); }
  const files = req.files || [];
  if (files.reduce((s, f) => s + f.size, 0) > 10 * 1024 * 1024) throw new HttpError(400, 'Attachments together must be under 10 MB.');
  const attachments = files.map((f) => ({ sha: vault.put(f.buffer), name: Buffer.from(f.originalname, 'latin1').toString('utf8').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120), size: f.size, mime: f.mimetype }));
  let id;
  try {
    id = campaigns.create({ ...data, attachments, userId: req.user.id });
  } catch (err) { throw bad(err); }
  const c = get('SELECT total, send_at FROM campaigns WHERE id = ?', id);
  audit(req, 'email.scheduled', 'campaign:' + id, c.total + ' recipients, ' + c.send_at);
  if (Date.parse(c.send_at) <= Date.now() + 1000) setImmediate(campaigns.tick);
  res.json({ ok: true, id, total: c.total, sendAt: c.send_at });
});

// Send a copy to yourself before sending to everyone.
router.post('/campaigns/test', editor, async (req, res) => {
  const b = req.body || {};
  const account = accounts.getAccount(b.accountId, { withPassword: true });
  if (!account || !account.send_enabled) throw new HttpError(400, 'Choose a mailbox that is set up for sending.');
  const c = get('SELECT * FROM candidates WHERE id = ?', Number(b.candidateId)) || { name: req.user.name };
  const mail = campaigns.compose({ subject: '[Test] ' + String(b.subject || ''), body: String(b.body || '') }, account, c);
  try {
    await mailer.send(account, { to: req.user.email, toName: req.user.name, ...mail });
  } catch (err) { throw new HttpError(400, 'Could not send: ' + err.message); }
  res.json({ ok: true, to: req.user.email });
});

router.post('/campaigns/:id/cancel', editor, (req, res) => {
  if (!campaigns.cancel(Number(req.params.id))) throw new HttpError(400, 'This email has already been sent or cancelled.');
  audit(req, 'email.cancelled', 'campaign:' + req.params.id);
  res.json({ ok: true });
});

router.post('/campaigns/:id/send-now', editor, (req, res) => {
  campaigns.sendNow(Number(req.params.id));
  res.json({ ok: true });
});

module.exports = router;
