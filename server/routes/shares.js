'use strict';

/*
 * Shortlists for client companies. The company sees each candidate's professional profile and a cleaned copy of
 * the CV, but never their phone, email, address, ID numbers or links — so every contact goes through The Guardians.
 * The original CV files are never sent.
 */

const express = require('express');
const { get, all, run, tx, insert, now } = require('../db');
const { HttpError, requireRole, audit, rateLimit } = require('../auth');
const { randomToken, sha256, encryptSecret, decryptSecret, hashPassword, verifyPassword } = require('../security');
const { redactText, displayName } = require('../redact');
const { addEvent, parseJson, getSetting } = require('../ingest');
const { EDUCATION_LEVELS } = require('../extract/dictionary');

const router = express.Router();
const publicRouter = express.Router();
const viewer = requireRole('viewer');
const editor = requireRole('recruiter');
const str = (v, max = 300) => String(v == null ? '' : v).trim().slice(0, max);

const DEFAULT_OPTIONS = {
  nameMode: 'initials', // full | initials | code
  showAge: true, showGender: true, showLocation: true, showNotice: true, showExpected: true,
  showCtc: false, showEmployer: false, showCv: true
};
const FEEDBACK = { interested: 'Interested', maybe: 'Maybe', not_suitable: 'Not suitable' };
const levels = Object.fromEntries(EDUCATION_LEVELS.map((l) => [l.level, l.label]));

const codeFor = (id) => 'GD-' + String(id).padStart(5, '0');
const idFromCode = (code) => Number(String(code || '').replace(/^GD-0*/i, '')) || 0;

function cleanOptions(o = {}) {
  const out = { ...DEFAULT_OPTIONS };
  if (['full', 'initials', 'code'].includes(o.nameMode)) out.nameMode = o.nameMode;
  for (const k of Object.keys(DEFAULT_OPTIONS)) if (k !== 'nameMode' && k in o) out[k] = Boolean(o[k]);
  return out;
}

function linkFor(req, token) {
  return req.protocol + '://' + req.get('host') + '/s/' + token;
}

// True when the address Guardora is opened on cannot be reached by an outside company.
function privateHost(req) {
  const host = String(req.hostname || '');
  return /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$)/.test(host) || !host.includes('.');
}

/* ---------- What the company sees ---------- */

function publicCandidate(c, options, item) {
  const code = codeFor(c.id);
  const exp = parseJson(c.experience, []);
  const companies = [c.current_company, ...exp.map((e) => e.company)].filter(Boolean);
  const latest = c.latest_cv_id ? get('SELECT text FROM cvs WHERE id = ?', c.latest_cv_id) : null;
  const person = { name: c.name, emails: parseJson(c.emails, []), phones: parseJson(c.phones, []), address: c.address, dob: c.dob };
  const age = c.birth_year ? new Date().getUTCFullYear() - c.birth_year : null;
  return {
    code,
    name: displayName(c.name, options.nameMode, code),
    headline: [c.current_title, options.showEmployer ? c.current_company : ''].filter(Boolean).join(' at ') || c.applied_for || '',
    age: options.showAge ? age : null,
    gender: options.showGender ? c.gender : '',
    location: options.showLocation ? [...new Set([c.city, c.state].filter(Boolean))].join(', ') : '',
    education: levels[c.education_level] && c.education_level ? levels[c.education_level] : '',
    degrees: parseJson(c.education, []).map((e) => ({ degree: e.degree, field: e.field, year: e.year, institution: e.institution, score: e.score, pursuing: e.pursuing })),
    experienceYears: c.experience_years,
    jobs: exp.map((e) => ({ title: e.title, company: options.showEmployer ? e.company : '', start: e.start, end: e.end })),
    skills: parseJson(c.skills, []),
    languages: parseJson(c.languages, []),
    notice: options.showNotice ? c.notice_period : '',
    currentCtc: options.showCtc ? c.current_ctc : '',
    expectedCtc: options.showExpected ? c.expected_ctc : '',
    cv: options.showCv && latest ? redactText(latest.text, person, { nameMode: options.nameMode, code, hideCompanies: options.showEmployer ? [] : companies }) : '',
    feedback: item.feedback,
    feedbackNote: item.feedback_note
  };
}

function publicShare(share) {
  const options = cleanOptions(parseJson(share.options, {}));
  const items = all('SELECT * FROM share_items WHERE share_id = ? ORDER BY position, candidate_id', share.id);
  const candidates = items.map((it) => {
    const c = get('SELECT * FROM candidates WHERE id = ?', it.candidate_id);
    return c ? publicCandidate(c, options, it) : null;
  }).filter(Boolean);
  return {
    company: share.company, title: share.title, message: share.message, createdAt: share.created_at, expiresAt: share.expires_at,
    agency: { name: 'The Guardians', tagline: 'Touch Futurefull Careers', email: getSetting('share_contact_email', 'hr@guardiansindia.com'), phone: getSetting('share_contact_phone', '') },
    candidates
  };
}

/* ---------- For the team (signed in) ---------- */

router.get('/shares', viewer, (req, res) => {
  const items = all('SELECT s.*, u.name AS created_by_name FROM shares s LEFT JOIN users u ON u.id = s.created_by ORDER BY s.id DESC LIMIT 500').map((s) => {
    const counts = all('SELECT feedback, COUNT(*) AS n FROM share_items WHERE share_id = ? GROUP BY feedback', s.id);
    const token = decryptSecret(s.token_enc);
    return {
      id: s.id, company: s.company, title: s.title, created_at: s.created_at, expires_at: s.expires_at, revoked: s.revoked, views: s.views,
      last_viewed_at: s.last_viewed_at, created_by_name: s.created_by_name, hasPin: Boolean(s.pin_hash), options: cleanOptions(parseJson(s.options, {})),
      total: counts.reduce((a, c) => a + c.n, 0),
      feedback: Object.fromEntries(counts.filter((c) => c.feedback).map((c) => [c.feedback, c.n])),
      link: token ? linkFor(req, token) : '',
      candidates: all(`SELECT c.id, c.name, i.feedback, i.feedback_note, i.feedback_at FROM share_items i JOIN candidates c ON c.id = i.candidate_id
                       WHERE i.share_id = ? ORDER BY i.position`, s.id)
    };
  });
  res.json({ ok: true, items, privateHost: privateHost(req) });
});

router.post('/shares', editor, (req, res) => {
  const b = req.body || {};
  const company = str(b.company, 120);
  if (!company) throw new HttpError(400, 'Enter the company name.');
  const ids = [...new Set((Array.isArray(b.candidateIds) ? b.candidateIds : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 200);
  if (!ids.length) throw new HttpError(400, 'Choose at least one candidate.');
  const days = Math.max(1, Math.min(365, Number(b.expiresDays) || 30));
  const pin = str(b.pin, 12);
  if (pin && !/^\d{4,8}$/.test(pin)) throw new HttpError(400, 'The PIN must be 4 to 8 digits.');
  const token = randomToken(24);
  const options = cleanOptions(b.options);

  const id = tx(() => {
    const shareId = insert('shares', {
      token_hash: sha256(token), token_enc: encryptSecret(token), company, title: str(b.title, 150), message: str(b.message, 2000),
      options: JSON.stringify(options), pin_hash: pin ? hashPassword(pin) : '', expires_at: new Date(Date.now() + days * 864e5).toISOString(),
      created_by: req.user.id, created_at: now()
    });
    ids.forEach((cid, i) => {
      const c = get('SELECT id, status, blacklisted FROM candidates WHERE id = ?', cid);
      if (!c) return;
      run('INSERT OR IGNORE INTO share_items (share_id, candidate_id, position) VALUES (?, ?, ?)', shareId, cid, i);
      addEvent(cid, 'shared', 'Profile shared with ' + company + (b.title ? ' (' + str(b.title, 150) + ')' : '') + ', contact details hidden.', req.user.id);
      if (['new', 'reviewing'].includes(c.status)) run("UPDATE candidates SET status = 'shortlisted' WHERE id = ?", cid);
    });
    return shareId;
  });
  audit(req, 'share.created', 'share:' + id, company + ' — ' + ids.length + ' candidates');
  res.json({ ok: true, id, link: linkFor(req, token), privateHost: privateHost(req) });
});

router.post('/shares/:id', editor, (req, res) => {
  const s = get('SELECT * FROM shares WHERE id = ?', Number(req.params.id));
  if (!s) throw new HttpError(404, 'Share not found.');
  const b = req.body || {};
  if ('revoked' in b) run('UPDATE shares SET revoked = ? WHERE id = ?', b.revoked ? 1 : 0, s.id);
  if (b.extendDays) run('UPDATE shares SET expires_at = ?, revoked = 0 WHERE id = ?', new Date(Math.max(Date.now(), Date.parse(s.expires_at)) + Math.min(365, Number(b.extendDays)) * 864e5).toISOString(), s.id);
  audit(req, b.revoked ? 'share.revoked' : 'share.updated', 'share:' + s.id, s.company);
  res.json({ ok: true });
});

router.get('/candidates/:id/shares', viewer, (req, res) => {
  res.json({ ok: true, items: all(`SELECT s.id, s.company, s.title, s.created_at, s.revoked, s.expires_at, i.feedback, i.feedback_note, i.feedback_at
                                   FROM share_items i JOIN shares s ON s.id = i.share_id WHERE i.candidate_id = ? ORDER BY s.id DESC`, Number(req.params.id)) });
});

/* ---------- For the company (public link, no account) ---------- */

const publicLimit = rateLimit(120, 15 * 60e3);
const pinFailures = new Map(); // share id -> [timestamps]

function openShare(req) {
  const token = str(req.params.token, 100);
  const s = token.length >= 20 ? get('SELECT * FROM shares WHERE token_hash = ?', sha256(token)) : null;
  if (!s) throw new HttpError(404, 'This shortlist link is not valid.');
  if (s.revoked) throw new HttpError(410, 'This shortlist has been withdrawn. Please contact The Guardians for an updated one.');
  if (s.expires_at < now()) throw new HttpError(410, 'This shortlist link has expired. Please contact The Guardians for a new one.');
  if (s.pin_hash && !req.user) {
    const recent = (pinFailures.get(s.id) || []).filter((t) => Date.now() - t < 15 * 60e3);
    if (recent.length >= 8) throw new HttpError(429, 'Too many wrong PINs. Please wait 15 minutes.');
    const pin = str(req.headers['x-share-pin'], 12);
    if (!pin) throw Object.assign(new HttpError(401, 'Enter the PIN you received from The Guardians.'), { pinRequired: true });
    if (!verifyPassword(pin, s.pin_hash)) {
      pinFailures.set(s.id, [...recent, Date.now()]);
      throw Object.assign(new HttpError(401, 'That PIN is not right.'), { pinRequired: true });
    }
  }
  return s;
}

// The API router has already loaded the session: the team can preview or print without being counted as a company view.
publicRouter.use((req, res, next) => {
  res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  next();
});

publicRouter.get('/shares/:token', publicLimit, (req, res) => {
  const s = openShare(req);
  if (!req.user) {
    run('UPDATE shares SET views = views + 1, last_viewed_at = ? WHERE id = ?', now(), s.id);
    insert('share_views', { share_id: s.id, ip: req.ip || '', agent: String(req.headers['user-agent'] || '').slice(0, 200), created_at: now() });
  }
  res.json({ ok: true, ...publicShare(s), preview: Boolean(req.user) });
});

publicRouter.post('/shares/:token/feedback', publicLimit, (req, res) => {
  const s = openShare(req);
  const b = req.body || {};
  const cid = idFromCode(b.code);
  const item = get('SELECT * FROM share_items WHERE share_id = ? AND candidate_id = ?', s.id, cid);
  if (!item) throw new HttpError(404, 'Candidate not found in this shortlist.');
  const feedback = FEEDBACK[b.feedback] ? b.feedback : '';
  const note = str(b.note, 1000);
  run('UPDATE share_items SET feedback = ?, feedback_note = ?, feedback_at = ? WHERE share_id = ? AND candidate_id = ?', feedback, note, now(), s.id, cid);
  if (!req.user) addEvent(cid, 'feedback', s.company + ': ' + (FEEDBACK[feedback] || 'feedback cleared') + (note ? ' — "' + note + '"' : ''));
  res.json({ ok: true });
});

publicRouter.use((err, req, res, next) => {
  if (err.pinRequired) return res.status(err.status).json({ ok: false, error: err.message, pinRequired: true });
  next(err);
});

module.exports = { router, publicRouter, codeFor };
