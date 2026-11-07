'use strict';

/*
 * Sign-in and access control.
 *  - Sessions live on the server; the browser holds a random HttpOnly cookie (SameSite=Strict, Secure on https).
 *  - Optional two-factor sign-in with any authenticator app (Google Authenticator, Microsoft Authenticator…).
 *  - 6 wrong passwords lock the account for 15 minutes; sign-in attempts are also limited per IP address.
 *  - Roles: owner (everything), recruiter (all candidate work, no settings/users), viewer (read only).
 */

const { get, run, insert, now } = require('./db');
const { sha256, randomToken, verifyPassword, decryptSecret, verifyTotp } = require('./security');
const { PRODUCTION } = require('./config');

const COOKIE = 'gd_session';
const SESSION_DAYS = 30;
const SHORT_SESSION_HOURS = 12;
const PENDING_MINUTES = 10;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return '';
}

function setCookie(req, res, value, maxAgeSeconds) {
  const secure = PRODUCTION || req.secure;
  res.append('Set-Cookie', COOKIE + '=' + value + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + maxAgeSeconds + (secure ? '; Secure' : ''));
}

function createSession(req, res, userId, { remember = false, pending = false } = {}) {
  const token = randomToken();
  const ms = pending ? PENDING_MINUTES * 60e3 : remember ? SESSION_DAYS * 864e5 : SHORT_SESSION_HOURS * 36e5;
  insert('sessions', {
    token_hash: sha256(token), user_id: userId, created_at: now(), last_seen_at: now(),
    expires_at: new Date(Date.now() + ms).toISOString(), ip: req.ip || '', agent: String(req.headers['user-agent'] || '').slice(0, 200),
    pending_2fa: pending ? 1 : 0
  });
  setCookie(req, res, token, Math.round(ms / 1000));
  return token;
}

function destroySession(req, res) {
  const token = readCookie(req, COOKIE);
  if (token) run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
  setCookie(req, res, '', 0);
}

function loadUser(req, res, next) {
  req.user = null;
  req.session = null;
  const token = readCookie(req, COOKIE);
  if (token) {
    const s = get('SELECT * FROM sessions WHERE token_hash = ?', sha256(token));
    if (s && s.expires_at > now()) {
      const user = get('SELECT * FROM users WHERE id = ?', s.user_id);
      if (user && user.status === 'active') {
        req.session = s;
        if (!s.pending_2fa) {
          req.user = user;
          // Sliding expiry: touch at most once a minute.
          if (Date.now() - Date.parse(s.last_seen_at) > 60e3) run('UPDATE sessions SET last_seen_at = ?, ip = ? WHERE token_hash = ?', now(), req.ip || '', s.token_hash);
        }
      }
    } else if (s) run('DELETE FROM sessions WHERE token_hash = ?', s.token_hash);
  }
  next();
}

const ROLE_RANK = { viewer: 1, recruiter: 2, owner: 3 };

function requireRole(minRole) {
  return (req, res, next) => {
    if (!req.user) return next(new HttpError(401, 'Please sign in.'));
    if ((ROLE_RANK[req.user.role] || 0) < ROLE_RANK[minRole]) return next(new HttpError(403, 'Your account cannot do this.'));
    next();
  };
}

/* ---------- Brute-force protection ---------- */

const failures = new Map(); // email -> [timestamps]
const LOCK_AFTER = 6;
const LOCK_MS = 15 * 60e3;
const recentFailures = (email) => (failures.get(email) || []).filter((t) => Date.now() - t < LOCK_MS);

function rateLimit(limit, windowMs) {
  const hits = new Map();
  setInterval(() => {
    for (const [k, times] of hits) {
      const recent = times.filter((t) => Date.now() - t < windowMs);
      if (recent.length) hits.set(k, recent);
      else hits.delete(k);
    }
  }, windowMs).unref();
  return (req, res, next) => {
    if (process.env.DISABLE_RATE_LIMIT === '1' && !PRODUCTION) return next();
    const times = (hits.get(req.ip) || []).filter((t) => Date.now() - t < windowMs);
    if (times.length >= limit) return next(new HttpError(429, 'Too many attempts. Please wait a few minutes and try again.'));
    times.push(Date.now());
    hits.set(req.ip, times);
    next();
  };
}

function checkPassword(email, password) {
  const key = String(email || '').toLowerCase().trim();
  if (recentFailures(key).length >= LOCK_AFTER) throw new HttpError(429, 'Too many wrong passwords. This account is locked for 15 minutes.');
  const user = get('SELECT * FROM users WHERE email = ?', key);
  // Hash even when the user does not exist, so response time does not reveal which emails have accounts.
  const ok = verifyPassword(password, user ? user.password_hash : 'scrypt$32768$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
  if (!user || !ok) {
    failures.set(key, [...recentFailures(key), Date.now()]);
    throw new HttpError(401, 'Incorrect email or password.');
  }
  if (user.status !== 'active') throw new HttpError(403, 'This account is turned off.');
  failures.delete(key);
  return user;
}

function checkTotp(user, code) {
  return verifyTotp(decryptSecret(user.totp_secret), code);
}

function audit(req, action, target = '', details = '') {
  insert('audit', {
    user_id: req.user ? req.user.id : null, user_name: req.user ? req.user.name : '', action, target: String(target),
    details: typeof details === 'string' ? details : JSON.stringify(details), ip: req.ip || '', created_at: now()
  });
}

/* CSRF defence: state-changing API calls must come from this site (plus SameSite=Strict cookies). */
function sameOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (origin) {
    let host = '';
    try {
      host = new URL(origin).host;
    } catch { /* treated as a mismatch */ }
    const allowed = [req.headers.host, req.headers['x-forwarded-host']].filter(Boolean);
    if (!allowed.includes(host)) {
      return next(new HttpError(403, 'Request blocked: it did not come from Guardora.'));
    }
  }
  next();
}

const publicUser = (u) => u && { id: u.id, name: u.name, email: u.email, role: u.role, totpEnabled: Boolean(u.totp_enabled) };

module.exports = {
  HttpError, COOKIE, createSession, destroySession, loadUser, requireRole, rateLimit, checkPassword, checkTotp, audit, sameOrigin, publicUser, readCookie
};
