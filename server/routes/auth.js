'use strict';

const express = require('express');
const QRCode = require('qrcode');
const { get, all, run, insert, now } = require('../db');
const { hashPassword, verifyPassword, passwordProblem, newTotpSecret, encryptSecret, decryptSecret, verifyTotp } = require('../security');
const {
  HttpError, createSession, destroySession, requireRole, rateLimit, checkPassword, checkTotp, audit, publicUser
} = require('../auth');
const { SETUP_TOKEN } = require('../setup-token');

const router = express.Router();
const loginLimit = rateLimit(20, 15 * 60e3);
const str = (v, max = 200) => String(v == null ? '' : v).trim().slice(0, max);

router.get('/session', (req, res) => {
  const setupNeeded = !get('SELECT 1 AS x FROM users LIMIT 1');
  res.json({ ok: true, user: publicUser(req.user), setupNeeded, twoFactorPending: Boolean(req.session && req.session.pending_2fa) });
});

// First start only: create the owner account. Needs the one-time code printed in the server log.
router.post('/setup', loginLimit, (req, res) => {
  if (get('SELECT 1 AS x FROM users LIMIT 1')) throw new HttpError(409, 'Guardora is already set up. Please sign in.');
  const b = req.body || {};
  if (str(b.setupCode).toUpperCase().replace(/[\s-]/g, '') !== SETUP_TOKEN) throw new HttpError(403, 'The setup code is not right. It is printed in the server window / log when Guardora starts.');
  const name = str(b.name, 80);
  const email = str(b.email, 160).toLowerCase();
  if (!name) throw new HttpError(400, 'Please enter your name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Please enter a valid email address.');
  const problem = passwordProblem(b.password);
  if (problem) throw new HttpError(400, problem);
  const id = insert('users', { name, email, role: 'owner', password_hash: hashPassword(b.password), created_at: now() });
  createSession(req, res, id, { remember: true });
  req.user = get('SELECT * FROM users WHERE id = ?', id);
  audit(req, 'setup.owner_created', 'user:' + id);
  res.json({ ok: true, user: publicUser(req.user) });
});

router.post('/login', loginLimit, (req, res) => {
  const b = req.body || {};
  const user = checkPassword(b.email, String(b.password || ''));
  if (user.totp_enabled) {
    createSession(req, res, user.id, { pending: true });
    return res.json({ ok: true, twoFactor: true });
  }
  createSession(req, res, user.id, { remember: Boolean(b.remember) });
  run('UPDATE users SET last_login_at = ? WHERE id = ?', now(), user.id);
  req.user = user;
  audit(req, 'auth.login');
  res.json({ ok: true, user: publicUser(user) });
});

router.post('/login/2fa', loginLimit, (req, res) => {
  const s = req.session;
  if (!s || !s.pending_2fa) throw new HttpError(401, 'Please sign in again.');
  const user = get('SELECT * FROM users WHERE id = ?', s.user_id);
  if (!checkTotp(user, (req.body || {}).code)) throw new HttpError(401, 'That code is not right. Use the current 6-digit code from your authenticator app.');
  run('DELETE FROM sessions WHERE token_hash = ?', s.token_hash);
  createSession(req, res, user.id, { remember: Boolean((req.body || {}).remember) });
  run('UPDATE users SET last_login_at = ? WHERE id = ?', now(), user.id);
  req.user = user;
  audit(req, 'auth.login', '', '2fa');
  res.json({ ok: true, user: publicUser(user) });
});

router.post('/logout', (req, res) => {
  if (req.user) audit(req, 'auth.logout');
  destroySession(req, res);
  res.json({ ok: true });
});

/* ---------- My account ---------- */

const me = express.Router();
me.use(requireRole('viewer'));

me.post('/password', loginLimit, (req, res) => {
  const b = req.body || {};
  if (!verifyPassword(String(b.current || ''), req.user.password_hash)) throw new HttpError(400, 'Your current password is not right.');
  const problem = passwordProblem(b.next);
  if (problem) throw new HttpError(400, problem);
  run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(b.next), req.user.id);
  run('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?', req.user.id, req.session.token_hash);
  audit(req, 'account.password_changed');
  res.json({ ok: true });
});

me.post('/2fa/setup', async (req, res) => {
  const secret = newTotpSecret();
  run('UPDATE users SET totp_secret = ?, totp_enabled = 0 WHERE id = ?', encryptSecret(secret), req.user.id);
  const uri = 'otpauth://totp/' + encodeURIComponent('Guardora:' + req.user.email) + '?secret=' + secret + '&issuer=Guardora&digits=6&period=30';
  res.json({ ok: true, secret, uri, qr: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) });
});

me.post('/2fa/enable', (req, res) => {
  const user = get('SELECT * FROM users WHERE id = ?', req.user.id);
  if (!verifyTotp(decryptSecret(user.totp_secret), (req.body || {}).code)) throw new HttpError(400, 'That code is not right. Try the newest code in the app.');
  run('UPDATE users SET totp_enabled = 1 WHERE id = ?', req.user.id);
  audit(req, 'account.2fa_enabled');
  res.json({ ok: true });
});

me.post('/2fa/disable', (req, res) => {
  if (!verifyPassword(String((req.body || {}).password || ''), req.user.password_hash)) throw new HttpError(400, 'Your password is not right.');
  run("UPDATE users SET totp_enabled = 0, totp_secret = '' WHERE id = ?", req.user.id);
  audit(req, 'account.2fa_disabled');
  res.json({ ok: true });
});

me.get('/sessions', (req, res) => {
  const rows = all('SELECT token_hash, created_at, last_seen_at, ip, agent FROM sessions WHERE user_id = ? AND pending_2fa = 0 ORDER BY last_seen_at DESC', req.user.id);
  res.json({ ok: true, items: rows.map((r) => ({ id: r.token_hash.slice(0, 16), created_at: r.created_at, last_seen_at: r.last_seen_at, ip: r.ip, agent: r.agent, current: r.token_hash === req.session.token_hash })) });
});

me.delete('/sessions/:id', (req, res) => {
  const id = str(req.params.id, 16);
  if (id.length !== 16) throw new HttpError(400, 'Bad session.');
  run("DELETE FROM sessions WHERE user_id = ? AND substr(token_hash, 1, 16) = ? AND token_hash != ?", req.user.id, id, req.session.token_hash);
  audit(req, 'account.session_ended');
  res.json({ ok: true });
});

me.post('/sessions/others/delete', (req, res) => {
  run('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?', req.user.id, req.session.token_hash);
  audit(req, 'account.other_sessions_ended');
  res.json({ ok: true });
});

module.exports = { router, me };
