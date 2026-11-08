'use strict';

/*
 * Every CV, from any source, comes through here:
 *   1. the same file seen before?              -> just record the new source
 *   2. read the text and fields
 *   3. which person is it?                     -> email / phone, then name + date of birth, then near-identical text
 *   4. store it as a new version of that person (or a new person)
 *   5. compare with their previous CV           -> fraud flags
 *   6. blacklisted person?                      -> alert
 *   7. rebuild the person's profile and search index
 */

const { get, all, run, tx, insert, update, now } = require('./db');
const vault = require('./vault');
const { sha256 } = require('./security');
const { extractText, MIMES } = require('./extract/text');
const { parseCv, normalizePhone, formatPhone } = require('./extract/parse');
const { fingerprint, similarity, nameKey, nameSimilarity } = require('./match');
const { compareVersions } = require('./fraud');
const { EDUCATION_LEVELS } = require('./extract/dictionary');

const OWN_DOMAINS = () => (getSetting('own_domains', 'guardiansindia.com') || '').split(/[\s,]+/).filter(Boolean).map((d) => d.toLowerCase());
const CV_HINT = /\b(cv|c\.v|resume|r[eé]sum[eé]|bio[- ]?data|profile|curriculum|application|applying|apply|candidature|job|vacancy|opening|post of|position)\b/i;

function getSetting(key, fallback = '') {
  const row = get('SELECT value FROM settings WHERE key = ?', key);
  return row ? row.value : fallback;
}

const parseJson = (s, fallback) => {
  try {
    return s ? JSON.parse(s) : fallback;
  } catch {
    return fallback;
  }
};

function logIngest(source, ref, outcome, message, candidateId = null) {
  insert('ingest_log', { source, ref: String(ref || '').slice(0, 300), outcome, message: String(message || '').slice(0, 500), candidate_id: candidateId, created_at: now() });
}

function addEvent(candidateId, kind, message, userId = null) {
  insert('events', { candidate_id: candidateId, user_id: userId, kind, message: String(message).slice(0, 500), created_at: now() });
}

const isOwnAddress = (email) => OWN_DOMAINS().some((d) => String(email).toLowerCase().endsWith('@' + d)) || /no-?reply|mailer-daemon|postmaster/i.test(email);

/* ---------- Main entry ---------- */

/**
 * @param {object} input
 *   buffer, fileName, source ('email'|'website'|'upload'), ref (unique per source item), receivedAt (ISO),
 *   sender, senderName, subject, jobTitle, form: {name, email, phone, currentCtc, expectedCtc, noticePeriod}, meta
 *   trusted: true when a person uploaded it or it came from the website form (skips the "is this a CV?" check)
 */
async function ingestFile(input) {
  const source = input.source;
  const ref = input.ref || '';
  const receivedAt = input.receivedAt && !Number.isNaN(Date.parse(input.receivedAt)) ? new Date(input.receivedAt).toISOString() : now();
  const buffer = input.buffer;
  const fileName = String(input.fileName || 'cv').replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').slice(0, 150);
  const label = fileName + (input.subject ? ' — "' + String(input.subject).slice(0, 80) + '"' : '');

  if (!buffer || !buffer.length) return result('skipped', 'Empty file: ' + label);
  const hash = sha256(buffer);

  // 1. Same file already stored: record where it came from this time.
  const known = get('SELECT id, candidate_id FROM cvs WHERE sha256 = ?', hash);
  if (known) {
    tx(() => {
      addSource(known.id, input, receivedAt);
      touchCandidate(known.candidate_id, receivedAt, source, input.jobTitle);
    });
    return result('duplicate', 'Same file already in the databank: ' + label, known.candidate_id, known.id);
  }

  // 2. Read it.
  let extracted;
  try {
    extracted = await extractText(buffer, fileName);
  } catch (err) {
    extracted = { kind: '', text: '', error: err.message };
  }
  const ext = fileName.toLowerCase().split('.').pop();
  const kind = extracted.kind || (['pdf', 'doc', 'docx', 'rtf', 'odt'].includes(ext) ? ext : '');
  if (!kind) return result('skipped', 'Not a supported CV format: ' + label);

  const parsed = parseCv(extracted.text, { receivedAt });
  const hinted = CV_HINT.test(fileName) || CV_HINT.test(input.subject || '');
  let needsReview = '';
  if (extracted.text.length < 80) {
    if (!input.trusted && !hinted) return result('skipped', 'No readable text and nothing says it is a CV: ' + label);
    needsReview = kind === 'image' ? 'image' : extracted.error ? 'unreadable' : 'scanned';
  } else if (!input.trusted && parsed.cvScore < (hinted ? 25 : 40)) {
    return result('skipped', "Doesn't look like a CV (score " + parsed.cvScore + '): ' + label);
  }

  // Contact details: the website form is typed by the applicant, so it wins; then the CV; then the email sender.
  const form = input.form || {};
  const emails = unique([form.email, ...parsed.emails].map((e) => String(e || '').toLowerCase().trim()).filter((e) => e && !isOwnAddress(e)));
  const phones = unique([normalizePhone(form.phone), ...parsed.phones].filter(Boolean));
  // The sender identifies the person only when the CV itself has no contact details (CVs are often forwarded).
  if (!emails.length && !phones.length) {
    if (input.senderPhone && normalizePhone(input.senderPhone)) phones.push(normalizePhone(input.senderPhone));
    else if (input.sender && /@/.test(input.sender) && !isOwnAddress(input.sender)) emails.push(String(input.sender).toLowerCase());
  }
  const name = form.name || parsed.name || (input.senderName && !isOwnAddress(input.sender || '') ? input.senderName : '') || nameFromFile(fileName);
  Object.assign(parsed, {
    name, emails, phones,
    currentCtc: form.currentCtc || parsed.currentCtc,
    expectedCtc: form.expectedCtc || parsed.expectedCtc,
    noticePeriod: form.noticePeriod || parsed.noticePeriod
  });
  const print = fingerprint(extracted.text);
  const fileHash = vault.put(buffer);

  // 3-7 in one transaction.
  return tx(() => {
    const again = get('SELECT id, candidate_id FROM cvs WHERE sha256 = ?', hash); // stored by a parallel worker meanwhile
    if (again) {
      addSource(again.id, input, receivedAt);
      return result('duplicate', 'Same file already in the databank: ' + label, again.candidate_id, again.id);
    }

    const match = findCandidate({ emails, phones, name, dob: parsed.dob, print });
    let candidateId = match.id;
    const isNew = !candidateId;
    if (isNew) {
      candidateId = insert('candidates', {
        name, name_key: nameKey(name), first_seen_at: receivedAt, last_seen_at: receivedAt, created_at: now(), updated_at: now()
      });
    }
    const cvId = insert('cvs', {
      candidate_id: candidateId, sha256: fileHash, file_name: fileName, mime: MIMES[kind] || 'application/octet-stream',
      size: buffer.length, kind, pages: extracted.pages || null, text: extracted.text, parsed: JSON.stringify(parsed),
      fingerprint: JSON.stringify(print), cv_score: parsed.cvScore, needs_review: needsReview, received_at: receivedAt, created_at: now()
    });
    addSource(cvId, input, receivedAt);

    const candidate = get('SELECT * FROM candidates WHERE id = ?', candidateId);
    if (isNew) {
      addEvent(candidateId, 'created', 'First CV received by ' + sourceLabel(source) + (input.jobTitle ? ' for ' + input.jobTitle : '') + '.');
    } else {
      addEvent(candidateId, 'cv', 'New CV received by ' + sourceLabel(source) + (input.jobTitle ? ' for ' + input.jobTitle : '') + ' (matched by ' + match.reason + ').');
      flagChanges(candidateId, cvId);
      if (candidate.blacklisted) {
        insert('flags', {
          candidate_id: candidateId, cv_id: cvId, kind: 'blacklisted_reapplied', severity: 3,
          message: 'Blacklisted candidate sent a new CV' + (candidate.blacklist_reason ? ' (blacklisted for: ' + candidate.blacklist_reason + ')' : '') + '.',
          details: '{}', created_at: now()
        });
      }
      if (candidate.done) addEvent(candidateId, 'returned', 'Sent a new CV after being marked done.');
    }
    for (const s of match.suggestions) suggestDuplicate(candidateId, s.id, s.score, s.reasons);

    refreshCandidate(candidateId, { source, jobTitle: input.jobTitle });
    const outcome = isNew ? 'added' : 'new_version';
    logIngest(source, ref, outcome, (isNew ? 'New candidate: ' : 'New CV for existing candidate: ') + (name || 'unknown') + ' — ' + label, candidateId);
    return { outcome, candidateId, cvId, message: label };
  });

  function result(outcome, message, candidateId = null, cvId = null) {
    if (outcome !== 'duplicate' || source !== 'email') logIngest(source, ref, outcome, message, candidateId);
    return { outcome, message, candidateId, cvId };
  }
}

const unique = (arr) => [...new Set(arr)];
const sourceLabel = (s) => ({ email: 'email', website: 'the website', upload: 'manual upload' })[s] || s;

function nameFromFile(fileName) {
  const base = fileName.replace(/\.[a-z0-9]+$/i, '').replace(/[_\-.]+/g, ' ').replace(/\b(cv|resume|updated|latest|new|final|biodata|profile|\d+)\b/gi, ' ').trim();
  return /^[a-z ]{4,40}$/i.test(base) && base.split(/\s+/).length <= 4 ? base.replace(/\b\w/g, (c) => c.toUpperCase()) : '';
}

function addSource(cvId, input, receivedAt) {
  run(`INSERT OR IGNORE INTO cv_sources (cv_id, source, ref, received_at, sender, subject, job_title, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    cvId, input.source, String(input.ref || ''), receivedAt, String(input.sender || input.senderPhone || '').slice(0, 200), String(input.subject || '').slice(0, 300),
    String(input.jobTitle || '').slice(0, 200), JSON.stringify(input.meta || {}));
}

function touchCandidate(candidateId, receivedAt, source, jobTitle) {
  const c = get('SELECT last_seen_at FROM candidates WHERE id = ?', candidateId);
  if (c && receivedAt > c.last_seen_at) {
    run('UPDATE candidates SET last_seen_at = ?, last_source = ?, applied_for = COALESCE(NULLIF(?, \'\'), applied_for), updated_at = ? WHERE id = ?',
      receivedAt, source, jobTitle || '', now(), candidateId);
  }
}

/* ---------- Matching a CV to a person ---------- */

function findCandidate({ emails, phones, name, dob, print }) {
  const suggestions = [];
  const keys = [...emails.map((e) => 'e:' + e), ...phones.map((p) => 'p:' + p)];
  const hits = new Map();
  for (const key of keys) {
    for (const r of all('SELECT candidate_id FROM candidate_keys WHERE key = ?', key)) {
      hits.set(r.candidate_id, [...(hits.get(r.candidate_id) || []), key.startsWith('e:') ? 'email' : 'phone']);
    }
  }
  if (hits.size) {
    const ids = [...hits.keys()];
    const rows = ids.map((id) => get('SELECT id, name, last_seen_at FROM candidates WHERE id = ?', id)).filter(Boolean);
    rows.sort((a, b) => hits.get(b.id).length - hits.get(a.id).length || b.last_seen_at.localeCompare(a.last_seen_at));
    const best = rows[0];
    for (const other of rows.slice(1)) suggestions.push({ id: other.id, score: 90, reasons: ['Shares ' + hits.get(other.id).join(' and ') + ' with this CV'] });
    // Only the phone number matches, while both the name and the email differ: phone numbers get shared in a family
    // and recycled by operators, so keep this as a separate person and let someone decide.
    const byPhoneOnly = !hits.get(best.id).includes('email');
    if (byPhoneOnly && name && best.name && nameSimilarity(name, best.name) < 0.5 && emails.length) {
      return { id: null, reason: '', suggestions: [...suggestions, { id: best.id, score: 70, reasons: ['Same phone number, but a different name and email'] }] };
    }
    return { id: best.id, reason: unique(hits.get(best.id)).join(' + '), suggestions };
  }

  const key = nameKey(name);
  if (key && key.includes(' ')) {
    const sameName = all('SELECT id, dob, latest_cv_id, city FROM candidates WHERE name_key = ? LIMIT 25', key);
    if (dob) {
      const byDob = sameName.find((c) => c.dob === dob);
      if (byDob) return { id: byDob.id, reason: 'name + date of birth', suggestions };
    }
    for (const c of sameName) {
      const cv = c.latest_cv_id && get('SELECT fingerprint FROM cvs WHERE id = ?', c.latest_cv_id);
      const sim = cv ? similarity(print, parseJson(cv.fingerprint, [])) : 0;
      if (sim >= 0.8) return { id: c.id, reason: 'name + ' + Math.round(sim * 100) + '% identical CV text', suggestions };
      const dobConflict = Boolean(c.dob && dob && c.dob !== dob);
      if (sim >= 0.3 || !dobConflict) {
        suggestions.push({ id: c.id, score: Math.round(50 + sim * 40), reasons: ['Same name' + (sim ? ', ' + Math.round(sim * 100) + '% similar CV text' : '')] });
      }
    }
  }
  return { id: null, reason: '', suggestions };
}

function suggestDuplicate(a, b, score, reasons) {
  if (a === b) return;
  const [x, y] = a < b ? [a, b] : [b, a];
  run(`INSERT INTO duplicate_suggestions (candidate_id, other_id, score, reasons, status, created_at) VALUES (?, ?, ?, ?, 'open', ?)
       ON CONFLICT (candidate_id, other_id) DO UPDATE SET score = MAX(score, excluded.score)`, x, y, score, JSON.stringify(reasons), now());
}

/* ---------- Fraud flags between versions ---------- */

function loadCv(id) {
  const cv = get('SELECT id, received_at, parsed FROM cvs WHERE id = ?', id);
  return cv && { ...cv, parsed: parseJson(cv.parsed, {}) };
}

function flagChanges(candidateId, cvId) {
  const cv = loadCv(cvId);
  const earlier = get('SELECT id FROM cvs WHERE candidate_id = ? AND id != ? AND received_at <= ? ORDER BY received_at DESC LIMIT 1', candidateId, cvId, cv.received_at);
  const later = earlier ? null : get('SELECT id FROM cvs WHERE candidate_id = ? AND id != ? AND received_at > ? ORDER BY received_at ASC LIMIT 1', candidateId, cvId, cv.received_at);
  const [oldCv, newCv] = earlier ? [loadCv(earlier.id), cv] : later ? [cv, loadCv(later.id)] : [null, null];
  if (!oldCv) return;
  for (const f of compareVersions(oldCv, newCv)) {
    insert('flags', {
      candidate_id: candidateId, cv_id: newCv.id, previous_cv_id: oldCv.id, kind: f.kind, severity: f.severity,
      message: f.message, details: JSON.stringify(f.details), created_at: now()
    });
  }
}

/* ---------- Rebuilding a person's profile from their CVs ---------- */

const PROFILE_FIELDS = {
  name: (p) => p.name,
  dob: (p) => p.dob,
  birth_year: (p) => p.birthYear,
  gender: (p) => p.gender,
  city: (p) => p.city,
  state: (p) => p.state,
  address: (p) => p.address,
  area: (p) => p.area,
  region: (p) => p.region,
  education_level: (p) => p.educationLevel || null,
  education: (p) => (p.education && p.education.length ? JSON.stringify(p.education) : null),
  skills: (p) => (p.skills && p.skills.length ? JSON.stringify(p.skills) : null),
  experience_years: (p) => p.experienceYears,
  current_title: (p) => p.currentTitle,
  current_company: (p) => p.currentCompany,
  experience: (p) => (p.experience && p.experience.length ? JSON.stringify(p.experience) : null),
  current_ctc: (p) => p.currentCtc,
  expected_ctc: (p) => p.expectedCtc,
  notice_period: (p) => p.noticePeriod,
  languages: (p) => (p.languages && p.languages.length ? JSON.stringify(p.languages) : null)
};

function refreshCandidate(candidateId, { source, jobTitle } = {}) {
  const c = get('SELECT * FROM candidates WHERE id = ?', candidateId);
  if (!c) return;
  const cvs = all('SELECT id, parsed, text, received_at FROM cvs WHERE candidate_id = ? ORDER BY received_at ASC, id ASC', candidateId);
  const edited = new Set(parseJson(c.edited_fields, []));
  const row = {};

  // Oldest to newest: a newer CV's value replaces an older one; a field the newer CV lacks keeps the older value.
  const emailsByCv = [];
  const phonesByCv = [];
  for (const cv of cvs) {
    const p = parseJson(cv.parsed, {});
    for (const [field, pick] of Object.entries(PROFILE_FIELDS)) {
      const v = pick(p);
      if (v !== undefined && v !== null && v !== '' && !edited.has(field)) row[field] = v;
    }
    emailsByCv.unshift(p.emails || []);
    phonesByCv.unshift(p.phones || []);
  }
  const allEmails = emailsByCv.flat(); // newest CV first
  const allPhones = phonesByCv.flat();
  const keepEmails = unique([...(edited.has('email') ? [c.email] : []), ...allEmails, ...parseJson(c.emails, [])].filter(Boolean));
  const keepPhones = unique([...(edited.has('phone') ? [normalizePhone(c.phone)] : []), ...allPhones, ...parseJson(c.phones, [])].filter(Boolean));
  row.emails = JSON.stringify(keepEmails);
  row.phones = JSON.stringify(keepPhones);
  if (!edited.has('email')) row.email = keepEmails[0] || '';
  if (!edited.has('phone')) row.phone = keepPhones[0] ? formatPhone(keepPhones[0]) : '';
  if (row.name || c.name) row.name_key = nameKey(row.name || c.name);

  const latest = cvs[cvs.length - 1];
  const first = cvs[0];
  row.cv_count = cvs.length;
  row.latest_cv_id = latest ? latest.id : null;
  if (first && first.received_at < c.first_seen_at) row.first_seen_at = first.received_at;
  const lastSource = latest ? get('SELECT source, job_title FROM cv_sources WHERE cv_id = ? ORDER BY received_at DESC LIMIT 1', latest.id) : null;
  if (latest && latest.received_at >= c.last_seen_at) {
    row.last_seen_at = latest.received_at;
    row.last_source = source || (lastSource && lastSource.source) || c.last_source;
  }
  const applied = jobTitle || (lastSource && lastSource.job_title);
  if (applied) row.applied_for = applied;
  row.updated_at = now();
  update('candidates', candidateId, row);

  // Exact-match keys used to recognise this person next time.
  run('DELETE FROM candidate_keys WHERE candidate_id = ?', candidateId);
  for (const e of keepEmails) run('INSERT OR IGNORE INTO candidate_keys (key, candidate_id) VALUES (?, ?)', 'e:' + e, candidateId);
  for (const p of keepPhones) run('INSERT OR IGNORE INTO candidate_keys (key, candidate_id) VALUES (?, ?)', 'p:' + p, candidateId);

  const fresh = get('SELECT * FROM candidates WHERE id = ?', candidateId);
  run('DELETE FROM candidate_skills WHERE candidate_id = ?', candidateId);
  for (const s of parseJson(fresh.skills, [])) run('INSERT OR IGNORE INTO candidate_skills (candidate_id, skill) VALUES (?, ?)', candidateId, s);
  run('UPDATE candidates SET degrees = ? WHERE id = ?', ' ' + parseJson(fresh.education, []).map((e) => e.degree).join(' | ') + ' ', candidateId);

  refreshRisk(candidateId);
  reindex(candidateId, cvs);
}

function refreshRisk(candidateId) {
  const r = get('SELECT COUNT(*) AS n, COALESCE(MAX(severity), 0) AS s FROM flags WHERE candidate_id = ? AND resolved = 0', candidateId);
  run('UPDATE candidates SET open_flags = ?, risk = ? WHERE id = ?', r.n, r.s, candidateId);
}

const ftsClean = (s) => String(s || '').replace(/\.(?=\s|$)/g, ' ').replace(/\s+/g, ' ');

function reindex(candidateId, cvs) {
  const c = get('SELECT * FROM candidates WHERE id = ?', candidateId);
  if (!c) return;
  cvs = cvs || all('SELECT text FROM cvs WHERE candidate_id = ?', candidateId);
  const edu = parseJson(c.education, []);
  const exp = parseJson(c.experience, []);
  const notes = all('SELECT body FROM notes WHERE candidate_id = ?', candidateId).map((n) => n.body).join(' ');
  const level = (EDUCATION_LEVELS.find((l) => l.level === c.education_level) || {}).label || '';
  run('DELETE FROM candidate_fts WHERE rowid = ?', candidateId);
  run('INSERT INTO candidate_fts (rowid, name, contact, location, education, skills, work, body) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    candidateId,
    ftsClean(c.name),
    ftsClean([...parseJson(c.emails, []), ...parseJson(c.phones, []), c.phone].join(' ')),
    ftsClean([c.area, c.region, c.city, c.state, c.address].join(' ')),
    ftsClean([level, ...edu.map((e) => [e.degree, e.field, e.institution].join(' '))].join(' ')),
    ftsClean([...parseJson(c.skills, []), ...parseJson(c.tags, [])].join(' , ')),
    ftsClean([c.current_title, c.current_company, c.applied_for, ...exp.map((e) => e.title + ' ' + e.company)].join(' ')),
    ftsClean(cvs.map((cv) => cv.text).join('\n').slice(0, 300000) + ' ' + notes));
}

/* ---------- Manual corrections: merge, split, delete ---------- */

function mergeCandidates(targetId, sourceId, userId) {
  if (targetId === sourceId) throw new Error('Choose two different candidates.');
  tx(() => {
    const src = get('SELECT * FROM candidates WHERE id = ?', sourceId);
    const dst = get('SELECT * FROM candidates WHERE id = ?', targetId);
    if (!src || !dst) throw new Error('Candidate not found.');
    for (const t of ['cvs', 'notes', 'events', 'flags']) run('UPDATE ' + t + ' SET candidate_id = ? WHERE candidate_id = ?', targetId, sourceId);
    const merged = {
      emails: JSON.stringify(unique([...parseJson(dst.emails, []), ...parseJson(src.emails, [])])),
      phones: JSON.stringify(unique([...parseJson(dst.phones, []), ...parseJson(src.phones, [])])),
      tags: JSON.stringify(unique([...parseJson(dst.tags, []), ...parseJson(src.tags, [])])),
      blacklisted: dst.blacklisted || src.blacklisted,
      blacklist_reason: dst.blacklist_reason || src.blacklist_reason,
      blacklisted_at: dst.blacklisted_at || src.blacklisted_at,
      starred: dst.starred || src.starred,
      rating: Math.max(dst.rating, src.rating),
      first_seen_at: dst.first_seen_at < src.first_seen_at ? dst.first_seen_at : src.first_seen_at
    };
    update('candidates', targetId, merged);
    run("UPDATE duplicate_suggestions SET status = 'merged' WHERE (candidate_id = ? AND other_id = ?) OR (candidate_id = ? AND other_id = ?)", targetId, sourceId, sourceId, targetId);
    run('DELETE FROM candidate_fts WHERE rowid = ?', sourceId);
    run('DELETE FROM candidates WHERE id = ?', sourceId);
    addEvent(targetId, 'merged', 'Merged with duplicate record of ' + (src.name || '#' + sourceId) + ' (' + src.cv_count + ' CV).', userId);
    refreshCandidate(targetId);
  });
}

function splitCv(cvId, userId) {
  return tx(() => {
    const cv = get('SELECT * FROM cvs WHERE id = ?', cvId);
    if (!cv) throw new Error('CV not found.');
    const count = get('SELECT COUNT(*) AS n FROM cvs WHERE candidate_id = ?', cv.candidate_id).n;
    if (count < 2) throw new Error('This is the only CV of this candidate.');
    const p = parseJson(cv.parsed, {});
    const newId = insert('candidates', { name: p.name || '', name_key: nameKey(p.name), first_seen_at: cv.received_at, last_seen_at: cv.received_at, created_at: now(), updated_at: now() });
    run('UPDATE cvs SET candidate_id = ? WHERE id = ?', newId, cvId);
    run('DELETE FROM flags WHERE cv_id = ? OR previous_cv_id = ?', cvId, cvId);
    addEvent(newId, 'split', 'Separated from candidate #' + cv.candidate_id + ' (it was a different person).', userId);
    addEvent(cv.candidate_id, 'split', 'CV "' + cv.file_name + '" moved to a separate candidate #' + newId + '.', userId);
    // Contact keys of the old record are rebuilt from its remaining CVs only.
    run("UPDATE candidates SET emails = '[]', phones = '[]' WHERE id = ?", cv.candidate_id);
    refreshCandidate(cv.candidate_id);
    refreshCandidate(newId);
    return newId;
  });
}

function deleteCandidate(candidateId) {
  const files = all('SELECT sha256 FROM cvs WHERE candidate_id = ?', candidateId).map((r) => r.sha256);
  tx(() => {
    run('DELETE FROM candidate_fts WHERE rowid = ?', candidateId);
    run('DELETE FROM candidates WHERE id = ?', candidateId);
  });
  for (const h of files) vault.remove(h);
}

module.exports = {
  ingestFile, refreshCandidate, refreshRisk, reindex, mergeCandidates, splitCv, deleteCandidate,
  addEvent, logIngest, getSetting, parseJson, isOwnAddress, nameSimilarity
};
