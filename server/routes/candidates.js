'use strict';

const express = require('express');
const multer = require('multer');
const { get, all, run, tx, insert, update, now } = require('../db');
const vault = require('../vault');
const { HttpError, requireRole, audit } = require('../auth');
const { searchCandidates, facets, STATUSES } = require('../search');
const { lineDiff } = require('../diff');
const { compareVersions } = require('../fraud');
const { formatPhone, normalizePhone } = require('../extract/parse');
const { nameKey } = require('../match');
const { areaInfo } = require('../extract/areas');
const { MAX_UPLOAD_MB } = require('../config');
const {
  ingestFile, refreshCandidate, refreshRisk, reindex, mergeCandidates, splitCv, deleteCandidate, addEvent, parseJson
} = require('../ingest');

const router = express.Router();
const viewer = requireRole('viewer');
const editor = requireRole('recruiter');
const owner = requireRole('owner');

const id = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, 'Bad id.');
  return n;
};
const str = (v, max = 300) => String(v == null ? '' : v).trim().slice(0, max);
const candidateOr404 = (cid) => {
  const c = get('SELECT * FROM candidates WHERE id = ?', cid);
  if (!c) throw new HttpError(404, 'Candidate not found. They may have been merged into another record.');
  return c;
};

function listItem(c) {
  return { ...c, skills: parseJson(c.skills, []).slice(0, 12), tags: parseJson(c.tags, []), degrees: String(c.degrees || '').split('|').map((d) => d.trim()).filter(Boolean) };
}

/* ---------- Search ---------- */

router.get('/candidates', viewer, (req, res) => {
  const r = searchCandidates(req.query);
  res.json({ ok: true, ...r, items: r.items.map(listItem) });
});

router.get('/candidates/facets', viewer, (req, res) => {
  res.json({ ok: true, ...facets(req.query) });
});

/* ---------- One candidate ---------- */

router.get('/candidates/:id', viewer, (req, res) => {
  const c = candidateOr404(id(req.params.id));
  const cvs = all(`SELECT id, file_name, mime, size, kind, pages, cv_score, needs_review, received_at, parsed FROM cvs
                   WHERE candidate_id = ? ORDER BY received_at DESC, id DESC`, c.id).map((cv) => ({
    ...cv,
    parsed: parseJson(cv.parsed, {}),
    sources: all('SELECT source, ref, received_at, sender, subject, job_title, meta FROM cv_sources WHERE cv_id = ? ORDER BY received_at', cv.id)
      .map((s) => ({ ...s, meta: parseJson(s.meta, {}) }))
  }));
  const flags = all(`SELECT f.*, u.name AS resolved_by_name FROM flags f LEFT JOIN users u ON u.id = f.resolved_by
                     WHERE f.candidate_id = ? ORDER BY f.resolved, f.severity DESC, f.id DESC`, c.id).map((f) => ({ ...f, details: parseJson(f.details, {}) }));
  const notes = all('SELECT n.id, n.body, n.created_at, n.user_id, u.name AS author FROM notes n LEFT JOIN users u ON u.id = n.user_id WHERE n.candidate_id = ? ORDER BY n.id DESC', c.id);
  const events = all('SELECT e.kind, e.message, e.created_at, u.name AS author FROM events e LEFT JOIN users u ON u.id = e.user_id WHERE e.candidate_id = ? ORDER BY e.id DESC LIMIT 200', c.id);
  const duplicates = all(`SELECT d.id, d.score, d.reasons, CASE WHEN d.candidate_id = ? THEN d.other_id ELSE d.candidate_id END AS other_id
                          FROM duplicate_suggestions d WHERE d.status = 'open' AND (d.candidate_id = ? OR d.other_id = ?)`, c.id, c.id, c.id)
    .map((d) => ({ ...d, reasons: parseJson(d.reasons, []), other: get('SELECT id, name, email, phone, city, cv_count, last_seen_at FROM candidates WHERE id = ?', d.other_id) }))
    .filter((d) => d.other);
  res.json({
    ok: true,
    candidate: {
      ...c,
      emails: parseJson(c.emails, []), phones: parseJson(c.phones, []).map(formatPhone), education: parseJson(c.education, []),
      skills: parseJson(c.skills, []), experience: parseJson(c.experience, []), languages: parseJson(c.languages, []),
      tags: parseJson(c.tags, []), edited_fields: parseJson(c.edited_fields, [])
    },
    cvs, flags, notes, events, duplicates
  });
});

// Hand corrections. Edited fields are remembered so a later CV does not overwrite them.
const EDITABLE = {
  name: (v) => str(v, 100),
  email: (v) => str(v, 160).toLowerCase(),
  phone: (v) => { const p = normalizePhone(v); return p ? formatPhone(p) : str(v, 30); },
  dob: (v) => (/^\d{4}-\d{2}-\d{2}$/.test(str(v)) || !str(v) ? str(v) : (() => { throw new HttpError(400, 'Date of birth must be YYYY-MM-DD.'); })()),
  gender: (v) => (['male', 'female', 'other', ''].includes(str(v)) ? str(v) : ''),
  city: (v) => str(v, 80),
  area: (v) => { const a = areaInfo(str(v, 80)); return a ? a.name : str(v, 80); },
  state: (v) => str(v, 80),
  address: (v) => str(v, 300),
  education_level: (v) => Math.max(0, Math.min(8, Number(v) || 0)),
  skills: (v) => JSON.stringify((Array.isArray(v) ? v : String(v || '').split(',')).map((s) => str(s, 40)).filter(Boolean).slice(0, 80)),
  experience_years: (v) => (v === '' || v == null ? null : Math.max(0, Math.min(60, Number(v) || 0))),
  current_title: (v) => str(v, 100),
  current_company: (v) => str(v, 120),
  current_ctc: (v) => str(v, 60),
  expected_ctc: (v) => str(v, 60),
  notice_period: (v) => str(v, 60),
  applied_for: (v) => str(v, 150)
};

router.patch('/candidates/:id', editor, (req, res) => {
  const c = candidateOr404(id(req.params.id));
  const body = req.body || {};
  const row = {};
  const edited = new Set(parseJson(c.edited_fields, []));
  for (const [field, clean] of Object.entries(EDITABLE)) {
    if (!(field in body)) continue;
    row[field] = clean(body[field]);
    edited.add(field);
  }
  if ('dob' in row) row.birth_year = row.dob ? Number(row.dob.slice(0, 4)) : c.birth_year;
  if ('age' in body && !row.dob) {
    const age = Number(body.age);
    if (age >= 14 && age <= 90) { row.birth_year = new Date().getUTCFullYear() - age; edited.add('birth_year'); }
  }
  if ('name' in row) row.name_key = nameKey(row.name);
  if ('area' in row) { const a = areaInfo(row.area); row.region = a ? a.region : ''; edited.add('region'); }
  if ('tags' in body) row.tags = JSON.stringify([...new Set((Array.isArray(body.tags) ? body.tags : []).map((t) => str(t, 30)).filter(Boolean))].slice(0, 20));
  row.edited_fields = JSON.stringify([...edited]);
  row.updated_at = now();
  tx(() => {
    update('candidates', c.id, row);
    if ('email' in row && row.email) run('INSERT OR IGNORE INTO candidate_keys (key, candidate_id) VALUES (?, ?)', 'e:' + row.email, c.id);
    if ('phone' in row && normalizePhone(row.phone)) run('INSERT OR IGNORE INTO candidate_keys (key, candidate_id) VALUES (?, ?)', 'p:' + normalizePhone(row.phone), c.id);
    if ('skills' in row) {
      run('DELETE FROM candidate_skills WHERE candidate_id = ?', c.id);
      for (const s of JSON.parse(row.skills)) run('INSERT OR IGNORE INTO candidate_skills (candidate_id, skill) VALUES (?, ?)', c.id, s);
    }
    const changed = Object.keys(row).filter((k) => EDITABLE[k] || k === 'tags');
    if (changed.length) addEvent(c.id, 'edited', 'Edited: ' + changed.join(', ').replace(/_/g, ' ') + '.', req.user.id);
    reindex(c.id);
  });
  audit(req, 'candidate.edited', 'candidate:' + c.id, Object.keys(row).join(','));
  res.json({ ok: true });
});

// Undo hand corrections: take the fields from the CVs again.
router.post('/candidates/:id/reparse', editor, (req, res) => {
  const c = candidateOr404(id(req.params.id));
  tx(() => {
    run("UPDATE candidates SET edited_fields = '[]' WHERE id = ?", c.id);
    refreshCandidate(c.id);
    addEvent(c.id, 'edited', 'Details reset to what the CVs say.', req.user.id);
  });
  res.json({ ok: true });
});

router.post('/candidates/:id/status', editor, (req, res) => {
  const c = candidateOr404(id(req.params.id));
  const status = str((req.body || {}).status, 20);
  if (!STATUSES.includes(status)) throw new HttpError(400, 'Unknown status.');
  run('UPDATE candidates SET status = ?, updated_at = ? WHERE id = ?', status, now(), c.id);
  addEvent(c.id, 'status', 'Status: ' + status.replace(/_/g, ' ') + '.', req.user.id);
  audit(req, 'candidate.status', 'candidate:' + c.id, status);
  res.json({ ok: true });
});

router.post('/candidates/:id/done', editor, (req, res) => {
  const c = candidateOr404(id(req.params.id));
  const done = Boolean((req.body || {}).done);
  run('UPDATE candidates SET done = ?, done_at = ?, updated_at = ? WHERE id = ?', done ? 1 : 0, done ? now() : null, now(), c.id);
  addEvent(c.id, 'done', done ? 'Marked as done.' : 'Done tick removed.', req.user.id);
  audit(req, done ? 'candidate.done' : 'candidate.undone', 'candidate:' + c.id);
  res.json({ ok: true });
});

router.post('/candidates/bulk', editor, (req, res) => {
  const b = req.body || {};
  const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 1000);
  const action = str(b.action, 20);
  tx(() => {
    for (const cid of ids) {
      if (!get('SELECT 1 AS x FROM candidates WHERE id = ?', cid)) continue;
      if (action === 'done' || action === 'undone') {
        run('UPDATE candidates SET done = ?, done_at = ? WHERE id = ?', action === 'done' ? 1 : 0, action === 'done' ? now() : null, cid);
        addEvent(cid, 'done', action === 'done' ? 'Marked as done.' : 'Done tick removed.', req.user.id);
      } else if (action === 'status' && STATUSES.includes(b.status)) {
        run('UPDATE candidates SET status = ? WHERE id = ?', b.status, cid);
        addEvent(cid, 'status', 'Status: ' + b.status.replace(/_/g, ' ') + '.', req.user.id);
      } else if (action === 'tag' && str(b.tag, 30)) {
        const c = get('SELECT tags FROM candidates WHERE id = ?', cid);
        run('UPDATE candidates SET tags = ? WHERE id = ?', JSON.stringify([...new Set([...parseJson(c.tags, []), str(b.tag, 30)])]), cid);
        reindex(cid);
      } else if (action === 'star') {
        run('UPDATE candidates SET starred = 1 WHERE id = ?', cid);
      }
    }
  });
  audit(req, 'candidate.bulk_' + action, ids.length + ' candidates');
  res.json({ ok: true, count: ids.length });
});

router.post('/candidates/:id/blacklist', editor, (req, res) => {
  const c = candidateOr404(id(req.params.id));
  const on = Boolean((req.body || {}).blacklisted);
  const reason = str((req.body || {}).reason, 300);
  if (on && !reason) throw new HttpError(400, 'Please write why, so the team knows later.');
  run('UPDATE candidates SET blacklisted = ?, blacklist_reason = ?, blacklisted_at = ?, updated_at = ? WHERE id = ?',
    on ? 1 : 0, on ? reason : '', on ? now() : null, now(), c.id);
  addEvent(c.id, 'blacklist', on ? 'Blacklisted: ' + reason : 'Removed from blacklist.', req.user.id);
  audit(req, on ? 'candidate.blacklisted' : 'candidate.unblacklisted', 'candidate:' + c.id, reason);
  res.json({ ok: true });
});

router.post('/candidates/:id/star', editor, (req, res) => {
  const c = candidateOr404(id(req.params.id));
  const b = req.body || {};
  if ('starred' in b) run('UPDATE candidates SET starred = ? WHERE id = ?', b.starred ? 1 : 0, c.id);
  if ('rating' in b) run('UPDATE candidates SET rating = ? WHERE id = ?', Math.max(0, Math.min(5, Number(b.rating) || 0)), c.id);
  res.json({ ok: true });
});

router.post('/candidates/:id/notes', editor, (req, res) => {
  const c = candidateOr404(id(req.params.id));
  const body = str((req.body || {}).body, 5000);
  if (!body) throw new HttpError(400, 'Write a note first.');
  const noteId = insert('notes', { candidate_id: c.id, user_id: req.user.id, body, created_at: now() });
  reindex(c.id);
  res.json({ ok: true, id: noteId });
});

router.delete('/candidates/:id/notes/:noteId', editor, (req, res) => {
  const n = get('SELECT * FROM notes WHERE id = ? AND candidate_id = ?', id(req.params.noteId), id(req.params.id));
  if (!n) throw new HttpError(404, 'Note not found.');
  if (n.user_id !== req.user.id && req.user.role !== 'owner') throw new HttpError(403, 'Only the author or the owner can delete this note.');
  run('DELETE FROM notes WHERE id = ?', n.id);
  reindex(n.candidate_id);
  res.json({ ok: true });
});

router.post('/candidates/:id/merge', editor, (req, res) => {
  const target = candidateOr404(id(req.params.id));
  const other = candidateOr404(id((req.body || {}).otherId));
  mergeCandidates(target.id, other.id, req.user.id);
  audit(req, 'candidate.merged', 'candidate:' + target.id, 'merged #' + other.id);
  res.json({ ok: true, id: target.id });
});

router.post('/duplicates/:id/dismiss', editor, (req, res) => {
  run("UPDATE duplicate_suggestions SET status = 'dismissed' WHERE id = ?", id(req.params.id));
  res.json({ ok: true });
});

// Erase a person completely (for example when they ask you to delete their data).
router.delete('/candidates/:id', owner, (req, res) => {
  const c = candidateOr404(id(req.params.id));
  deleteCandidate(c.id);
  audit(req, 'candidate.deleted', 'candidate:' + c.id, c.name + ' <' + c.email + '>');
  res.json({ ok: true });
});

router.post('/flags/:id/resolve', editor, (req, res) => {
  const f = get('SELECT * FROM flags WHERE id = ?', id(req.params.id));
  if (!f) throw new HttpError(404, 'Alert not found.');
  const resolved = (req.body || {}).resolved !== false;
  run('UPDATE flags SET resolved = ?, resolved_by = ?, resolved_at = ? WHERE id = ?', resolved ? 1 : 0, resolved ? req.user.id : null, resolved ? now() : null, f.id);
  refreshRisk(f.candidate_id);
  addEvent(f.candidate_id, 'flag', (resolved ? 'Checked and cleared: ' : 'Re-opened: ') + f.message, req.user.id);
  res.json({ ok: true });
});

/* ---------- CV files ---------- */

const cvOr404 = (cvId) => {
  const cv = get('SELECT * FROM cvs WHERE id = ?', cvId);
  if (!cv) throw new HttpError(404, 'CV not found.');
  return cv;
};

router.get('/cvs/:id/file', viewer, (req, res) => {
  const cv = cvOr404(id(req.params.id));
  const data = vault.read(cv.sha256);
  const inline = req.query.download !== '1' && ['pdf', 'image', 'txt'].includes(cv.kind);
  const type = cv.kind === 'image' ? (data[0] === 0x89 ? 'image/png' : data[0] === 0xff ? 'image/jpeg' : 'image/webp') : cv.mime;
  res.set({
    'Content-Type': type,
    'Content-Length': data.length,
    'Cache-Control': 'private, no-store',
    'Content-Disposition': (inline ? 'inline' : 'attachment') + "; filename*=UTF-8''" + encodeURIComponent(cv.file_name),
    'X-Content-Type-Options': 'nosniff'
  });
  // Text and images can never run anything; PDFs are left to the browser's own viewer.
  if (cv.kind !== 'pdf') res.set('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox");
  if (req.query.download === '1') audit(req, 'cv.downloaded', 'cv:' + cv.id, cv.file_name);
  res.end(data);
});

router.get('/cvs/:id/text', viewer, (req, res) => {
  const cv = cvOr404(id(req.params.id));
  res.json({ ok: true, text: cv.text, kind: cv.kind, needs_review: cv.needs_review });
});

router.get('/cvs/:a/compare/:b', viewer, (req, res) => {
  const a = cvOr404(id(req.params.a));
  const b = cvOr404(id(req.params.b));
  const [older, newer] = a.received_at <= b.received_at ? [a, b] : [b, a];
  const pack = (cv) => ({ id: cv.id, file_name: cv.file_name, received_at: cv.received_at, parsed: parseJson(cv.parsed, {}) });
  const findings = compareVersions(pack(older), pack(newer));
  res.json({ ok: true, older: pack(older), newer: pack(newer), findings, diff: lineDiff(older.text, newer.text) });
});

router.post('/cvs/:id/split', editor, (req, res) => {
  const newId = splitCv(id(req.params.id), req.user.id);
  audit(req, 'cv.split', 'cv:' + req.params.id, 'new candidate #' + newId);
  res.json({ ok: true, id: newId });
});

/* ---------- Manual upload (drag and drop, or shared from the phone) ---------- */

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 100 } });

router.post('/upload', editor, upload.array('files', 100), async (req, res) => {
  const results = [];
  for (const f of req.files || []) {
    try {
      const r = await ingestFile({
        buffer: f.buffer, fileName: Buffer.from(f.originalname, 'latin1').toString('utf8'), source: 'upload',
        ref: 'upload:' + req.user.id + ':' + Date.now() + ':' + results.length, trusted: true, sender: req.user.email, meta: { by: req.user.name }
      });
      results.push({ file: f.originalname, ...r });
    } catch (err) {
      results.push({ file: f.originalname, outcome: 'error', message: err.message });
    }
  }
  audit(req, 'cv.uploaded', '', results.length + ' files');
  res.json({ ok: true, results });
});

module.exports = router;
