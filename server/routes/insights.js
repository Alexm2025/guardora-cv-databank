'use strict';

const express = require('express');
const { get, all, run, insert, now } = require('../db');
const { HttpError, requireRole, audit } = require('../auth');
const { searchCandidates, STATUSES } = require('../search');
const { parseCv } = require('../extract/parse');
const { EDUCATION_LEVELS, SKILLS, CITIES, CITY_ALIASES, STATES } = require('../extract/dictionary');
const { parseJson } = require('../ingest');
const mailbox = require('../sources/mailbox');
const website = require('../sources/website');

const router = express.Router();
const viewer = requireRole('viewer');
const editor = requireRole('recruiter');
const str = (v, max = 300) => String(v == null ? '' : v).trim().slice(0, max);
const count = (sql, ...p) => get(sql, ...p).n;

router.get('/meta', viewer, (req, res) => {
  res.json({
    ok: true,
    educationLevels: EDUCATION_LEVELS,
    statuses: STATUSES,
    cities: Object.keys(CITIES).filter((c) => !CITY_ALIASES[c]).sort(),
    states: STATES,
    degrees: [...new Set(all("SELECT DISTINCT degrees FROM candidates WHERE trim(degrees) != ''").flatMap((r) => r.degrees.split('|').map((d) => d.trim())))].filter(Boolean).sort(),
    tags: [...new Set(all("SELECT tags FROM candidates WHERE tags != '[]'").flatMap((r) => parseJson(r.tags, [])))].sort()
  });
});

router.get('/skills', viewer, (req, res) => {
  const q = str(req.query.q, 40);
  const known = all('SELECT skill, COUNT(*) AS n FROM candidate_skills WHERE skill LIKE ? GROUP BY skill COLLATE NOCASE ORDER BY n DESC LIMIT 15', q.replace(/[%_]/g, '') + '%');
  const dict = SKILLS.filter((s) => s.toLowerCase().startsWith(q.toLowerCase()) && !known.some((k) => k.skill.toLowerCase() === s.toLowerCase())).slice(0, 10);
  res.json({ ok: true, items: [...known.map((k) => ({ skill: k.skill, n: k.n })), ...dict.map((s) => ({ skill: s, n: 0 }))].slice(0, 20) });
});

// Small and frequent: the badges in the menu and the live status of the two feeds.
router.get('/counts', viewer, (req, res) => {
  res.json({
    ok: true,
    alerts: count('SELECT COUNT(DISTINCT candidate_id) AS n FROM flags WHERE resolved = 0 AND severity >= 2'),
    duplicates: count("SELECT COUNT(*) AS n FROM duplicate_suggestions WHERE status = 'open'"),
    mailbox: mailbox.status.state,
    website: website.status.state
  });
});

router.get('/dashboard', viewer, (req, res) => {
  const day = (n) => new Date(Date.now() - n * 864e5).toISOString();
  const byDay = all('SELECT substr(received_at, 1, 10) AS day, COUNT(*) AS n FROM cvs WHERE received_at >= ? GROUP BY day ORDER BY day', day(30));
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const d = day(i).slice(0, 10);
    days.push({ day: d, n: (byDay.find((r) => r.day === d) || {}).n || 0 });
  }
  res.json({
    ok: true,
    totals: {
      candidates: count('SELECT COUNT(*) AS n FROM candidates'),
      cvs: count('SELECT COUNT(*) AS n FROM cvs'),
      new7: count('SELECT COUNT(*) AS n FROM candidates WHERE first_seen_at >= ?', day(7)),
      cvs7: count('SELECT COUNT(*) AS n FROM cvs WHERE received_at >= ?', day(7)),
      new30: count('SELECT COUNT(*) AS n FROM candidates WHERE first_seen_at >= ?', day(30)),
      active: count('SELECT COUNT(*) AS n FROM candidates WHERE done = 0 AND blacklisted = 0'),
      done: count('SELECT COUNT(*) AS n FROM candidates WHERE done = 1'),
      returned: count('SELECT COUNT(*) AS n FROM candidates WHERE done = 1 AND last_seen_at > done_at'),
      blacklisted: count('SELECT COUNT(*) AS n FROM candidates WHERE blacklisted = 1'),
      flagged: count('SELECT COUNT(*) AS n FROM candidates WHERE open_flags > 0'),
      highRisk: count('SELECT COUNT(*) AS n FROM candidates WHERE risk = 3'),
      duplicates: count("SELECT COUNT(*) AS n FROM duplicate_suggestions WHERE status = 'open'"),
      returning: count('SELECT COUNT(*) AS n FROM candidates WHERE cv_count > 1'),
      review: count("SELECT COUNT(*) AS n FROM candidates WHERE latest_cv_id IN (SELECT id FROM cvs WHERE needs_review != '')")
    },
    byDay: days,
    bySource: all('SELECT source AS label, COUNT(DISTINCT cv_id) AS n FROM cv_sources GROUP BY source ORDER BY n DESC'),
    topSkills: all('SELECT skill AS label, COUNT(*) AS n FROM candidate_skills GROUP BY skill COLLATE NOCASE ORDER BY n DESC LIMIT 12'),
    topCities: all("SELECT city AS label, COUNT(*) AS n FROM candidates WHERE city != '' GROUP BY city ORDER BY n DESC LIMIT 10"),
    education: all('SELECT education_level AS level, COUNT(*) AS n FROM candidates GROUP BY education_level ORDER BY level DESC'),
    gender: all('SELECT gender AS label, COUNT(*) AS n FROM candidates GROUP BY gender ORDER BY n DESC'),
    recentAlerts: all(`SELECT f.id, f.kind, f.severity, f.message, f.created_at, c.id AS candidate_id, c.name FROM flags f JOIN candidates c ON c.id = f.candidate_id
                       WHERE f.resolved = 0 ORDER BY f.severity DESC, f.id DESC LIMIT 6`),
    recent: all(`SELECT id, name, city, applied_for, last_seen_at, last_source, cv_count, risk, blacklisted, done FROM candidates ORDER BY last_seen_at DESC LIMIT 8`),
    sources: { mailbox: mailbox.status, website: website.status }
  });
});

/* ---------- Alerts (fraud flags and blacklist hits) ---------- */

router.get('/alerts', viewer, (req, res) => {
  const resolved = req.query.resolved === '1' ? 1 : 0;
  const page = Math.max(1, Number(req.query.page) || 1);
  const where = ['f.resolved = ?'];
  const params = [resolved];
  if (Number(req.query.severity)) { where.push('f.severity >= ?'); params.push(Number(req.query.severity)); }
  if (req.query.kind) { where.push('f.kind = ?'); params.push(str(req.query.kind, 40)); }
  const w = ' WHERE ' + where.join(' AND ');
  const total = count('SELECT COUNT(*) AS n FROM flags f' + w, ...params);
  const items = all(`SELECT f.*, c.name, c.email, c.phone, c.city, c.blacklisted, cv.file_name, pcv.file_name AS previous_file_name, u.name AS resolved_by_name
                     FROM flags f JOIN candidates c ON c.id = f.candidate_id LEFT JOIN cvs cv ON cv.id = f.cv_id
                     LEFT JOIN cvs pcv ON pcv.id = f.previous_cv_id LEFT JOIN users u ON u.id = f.resolved_by` + w +
                     ' ORDER BY f.severity DESC, f.id DESC LIMIT 50 OFFSET ?', ...params, (page - 1) * 50)
    .map((f) => ({ ...f, details: parseJson(f.details, {}) }));
  const kinds = all('SELECT kind, COUNT(*) AS n FROM flags WHERE resolved = ? GROUP BY kind ORDER BY n DESC', resolved);
  res.json({ ok: true, items, total, page, kinds });
});

router.get('/duplicates', viewer, (req, res) => {
  const pick = 'id, name, email, phone, city, dob, education_level, experience_years, cv_count, last_seen_at, first_seen_at, blacklisted, done';
  const items = all("SELECT * FROM duplicate_suggestions WHERE status = 'open' ORDER BY score DESC, id DESC LIMIT 200")
    .map((d) => ({
      id: d.id, score: d.score, reasons: parseJson(d.reasons, []), created_at: d.created_at,
      a: get('SELECT ' + pick + ' FROM candidates WHERE id = ?', d.candidate_id),
      b: get('SELECT ' + pick + ' FROM candidates WHERE id = ?', d.other_id)
    })).filter((d) => d.a && d.b);
  res.json({ ok: true, items });
});

/* ---------- Job match: paste a job description, get the best-fitting people ---------- */

router.post('/match', viewer, (req, res) => {
  const jd = str((req.body || {}).text, 20000);
  if (jd.length < 20) throw new HttpError(400, 'Paste the job description (at least a few lines).');
  const wanted = parseCv(jd);
  const skills = wanted.skills.slice(0, 25);
  const filters = (req.body || {}).filters || {};

  // Candidates who have any of the skills or text match, then scored in detail.
  const terms = skills.map((s) => '"' + s.replace(/"/g, '') + '"').join(' OR ');
  const q = { ...filters, view: filters.view || 'active', hideBlacklisted: '1', page: 1 };
  const pool = new Map();
  if (terms) {
    for (const c of all(`SELECT rowid AS id, bm25(candidate_fts, 2, 1, 1, 2, 6, 3, 1) AS rank FROM candidate_fts WHERE candidate_fts MATCH ? ORDER BY rank LIMIT 600`, terms)) pool.set(c.id, c.rank);
  }
  const filtered = searchCandidates({ ...q, pageSize: 200 }, { limit: 5000, columns: 'c.id' }).items.map((r) => r.id);
  const allowed = new Set(filtered);
  const minExp = (jd.match(/(\d{1,2})\s*(?:\+|-|to|–)?\s*(?:\d{1,2})?\s*(?:years?|yrs?)/i) || [])[1];
  const results = [];
  for (const [cid, rank] of pool) {
    if (!allowed.has(cid)) continue;
    const c = get('SELECT id, name, email, phone, city, state, education_level, degrees, skills, experience_years, current_title, current_company, last_seen_at, expected_ctc, notice_period, risk, done, gender, birth_year FROM candidates WHERE id = ?', cid);
    const have = parseJson(c.skills, []).map((s) => s.toLowerCase());
    const matched = skills.filter((s) => have.includes(s.toLowerCase()));
    let score = skills.length ? (matched.length / skills.length) * 70 : 0;
    score += Math.min(15, -rank * 1.5);
    if (minExp && c.experience_years != null) score += c.experience_years >= Number(minExp) ? 10 : -10;
    if (wanted.educationLevel && c.education_level >= wanted.educationLevel) score += 5;
    if (c.risk >= 3) score -= 15;
    results.push({ ...c, skills: parseJson(c.skills, []).slice(0, 12), matched, missing: skills.filter((s) => !matched.includes(s)), score: Math.max(0, Math.min(100, Math.round(score))) });
  }
  results.sort((a, b) => b.score - a.score);
  res.json({ ok: true, wanted: { skills, educationLevel: wanted.educationLevel, minExperience: minExp ? Number(minExp) : null }, items: results.slice(0, 100), considered: pool.size });
});

/* ---------- Export the current filter as a spreadsheet (CSV) ---------- */

router.get('/export.csv', editor, (req, res) => {
  const cols = `c.id, c.name, c.email, c.phone, c.dob, c.birth_year, c.gender, c.city, c.state, c.education_level, c.degrees, c.skills,
    c.experience_years, c.current_title, c.current_company, c.current_ctc, c.expected_ctc, c.notice_period, c.applied_for, c.status, c.done,
    c.blacklisted, c.blacklist_reason, c.risk, c.cv_count, c.first_seen_at, c.last_seen_at, c.tags`;
  const { items } = searchCandidates({ ...req.query, page: 1 }, { limit: 50000, columns: cols });
  const levels = Object.fromEntries(EDUCATION_LEVELS.map((l) => [l.level, l.label]));
  const year = new Date().getUTCFullYear();
  const header = ['ID', 'Name', 'Email', 'Phone', 'Date of birth', 'Age', 'Gender', 'City', 'State', 'Education', 'Degrees', 'Skills',
    'Experience (years)', 'Current title', 'Current company', 'Current CTC', 'Expected CTC', 'Notice period', 'Applied for', 'Status', 'Done',
    'Blacklisted', 'Blacklist reason', 'Risk', 'CVs', 'First seen', 'Last seen', 'Tags'];
  // Cells that start with = + - @ are prefixed so spreadsheet apps do not run them as formulas.
  const cell = (v) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const rows = items.map((c) => [c.id, c.name, c.email, c.phone, c.dob, c.birth_year ? year - c.birth_year : '', c.gender, c.city, c.state,
    levels[c.education_level] || '', String(c.degrees || '').split('|').map((d) => d.trim()).filter(Boolean).join('; '), parseJson(c.skills, []).join('; '),
    c.experience_years ?? '', c.current_title, c.current_company, c.current_ctc, c.expected_ctc, c.notice_period, c.applied_for, c.status,
    c.done ? 'yes' : '', c.blacklisted ? 'yes' : '', c.blacklist_reason, ['', 'low', 'medium', 'high'][c.risk], c.cv_count,
    c.first_seen_at.slice(0, 10), c.last_seen_at.slice(0, 10), parseJson(c.tags, []).join('; ')].map(cell).join(','));
  audit(req, 'export.csv', '', items.length + ' candidates');
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="guardora-candidates-' + new Date().toISOString().slice(0, 10) + '.csv"', 'Cache-Control': 'no-store' });
  res.send('﻿' + [header.join(','), ...rows].join('\r\n'));
});

/* ---------- Saved searches ---------- */

router.get('/searches', viewer, (req, res) => {
  const items = all('SELECT id, name, query, created_at FROM saved_searches WHERE user_id = ? ORDER BY name', req.user.id)
    .map((s) => ({ ...s, query: parseJson(s.query, {}), count: searchCandidates({ ...parseJson(s.query, {}), pageSize: 1 }).total }));
  res.json({ ok: true, items });
});

router.post('/searches', viewer, (req, res) => {
  const name = str((req.body || {}).name, 60);
  if (!name) throw new HttpError(400, 'Give the search a name.');
  const query = (req.body || {}).query || {};
  const sid = insert('saved_searches', { user_id: req.user.id, name, query: JSON.stringify(query).slice(0, 4000), created_at: now() });
  res.json({ ok: true, id: sid });
});

router.delete('/searches/:id', viewer, (req, res) => {
  run('DELETE FROM saved_searches WHERE id = ? AND user_id = ?', Number(req.params.id), req.user.id);
  res.json({ ok: true });
});

module.exports = router;
