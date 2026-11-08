'use strict';

/*
 * Turns the filter bar into SQL. Text search uses the FTS5 index (prefix matching, ranked by relevance with
 * name and skills weighted highest); every other filter uses an indexed column.
 */

const { all, get } = require('./db');
const { normalizePhone } = require('./extract/parse');
const { areaInfo, placesOnLines, placesNear } = require('./extract/areas');

const STATUSES = ['new', 'reviewing', 'shortlisted', 'interview', 'placed', 'on_hold', 'rejected'];

const list = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((s) => String(s).trim()).filter(Boolean).slice(0, 30);
const num = (v) => (v === undefined || v === null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

// User text -> safe FTS5 query: every word must match (as a prefix); "quoted phrases" stay together.
function ftsQuery(q) {
  const parts = [];
  const text = String(q || '').slice(0, 200);
  for (const m of text.matchAll(/"([^"]+)"|(\S+)/g)) {
    if (m[1]) {
      const phrase = m[1].replace(/[^\p{L}\p{N}+#.\s]/gu, ' ').replace(/\.(?=\s|$)/g, ' ').trim();
      if (phrase) parts.push('"' + phrase + '"');
    } else {
      const word = m[2].replace(/[^\p{L}\p{N}+#.]/gu, '').replace(/\.+$/, '');
      if (!word || /^(and|or|not|near)$/i.test(word)) continue;
      parts.push('"' + word + '"*');
    }
  }
  return parts.join(' AND ');
}

function buildFilter(q) {
  const where = [];
  const params = [];
  let fts = '';
  const year = new Date().getUTCFullYear();

  const text = String(q.q || '').trim();
  if (text) {
    const digits = text.replace(/\D/g, '');
    const asPhone = /^[+\d\s()-]{6,}$/.test(text) ? normalizePhone(text) || digits : '';
    if (asPhone && digits.length >= 6) {
      where.push('c.id IN (SELECT candidate_id FROM candidate_keys WHERE key LIKE ?)');
      params.push('p:%' + digits.slice(-10) + '%');
    } else if (/^[^\s@]+@[^\s@]+$/.test(text)) {
      where.push('c.id IN (SELECT candidate_id FROM candidate_keys WHERE key LIKE ?)');
      params.push('e:' + text.toLowerCase().replace(/[%_]/g, '') + '%');
    } else {
      fts = ftsQuery(text);
    }
  }
  if (num(q.ageMin) != null) { where.push('c.birth_year <= ?'); params.push(year - num(q.ageMin)); }
  if (num(q.ageMax) != null) { where.push('c.birth_year >= ?'); params.push(year - num(q.ageMax) - 1); }
  const genders = list(q.gender).filter((g) => ['male', 'female', 'other', 'unknown'].includes(g));
  if (genders.length) {
    where.push('(' + genders.map((g) => (g === 'unknown' ? "c.gender = ''" : 'c.gender = ?')).join(' OR ') + ')');
    params.push(...genders.filter((g) => g !== 'unknown'));
  }
  const cities = list(q.city);
  if (cities.length) { where.push('c.city IN (' + cities.map(() => '?').join(',') + ')'); params.push(...cities); }
  // Areas: picked by name, by railway line, or "within N stations of".
  const places = new Set(list(q.area).map((a) => (areaInfo(a) || {}).name || a));
  for (const p of placesOnLines(list(q.line))) places.add(p);
  if (q.near) for (const p of placesNear(String(q.near).slice(0, 60), q.stops === undefined || q.stops === '' ? 2 : q.stops)) places.add(p);
  if (places.size) {
    const names = [...places].slice(0, 400);
    // A known area decides; when the CV's area could not be read, look for the place names in the address text.
    where.push('(c.area IN (' + names.map(() => '?').join(',') + ") OR (c.area = '' AND c.id IN (SELECT rowid FROM candidate_fts WHERE candidate_fts MATCH ?)))");
    params.push(...names, 'location : (' + names.map((n) => '"' + n.replace(/"/g, '') + '"').join(' OR ') + ')');
  }
  const states = list(q.state);
  if (states.length) { where.push('c.state IN (' + states.map(() => '?').join(',') + ')'); params.push(...states); }
  if (num(q.eduMin) != null) { where.push('c.education_level >= ?'); params.push(num(q.eduMin)); }
  if (num(q.eduMax) != null) { where.push('c.education_level <= ?'); params.push(num(q.eduMax)); }
  for (const d of list(q.degree)) { where.push('instr(c.degrees, ?) > 0'); params.push(' ' + d + ' '); }
  for (const s of list(q.skills)) { where.push('c.id IN (SELECT candidate_id FROM candidate_skills WHERE skill = ?)'); params.push(s); }
  if (num(q.expMin) != null) { where.push('c.experience_years >= ?'); params.push(num(q.expMin)); }
  if (num(q.expMax) != null) { where.push('c.experience_years <= ?'); params.push(num(q.expMax)); }
  const statuses = list(q.status).filter((s) => STATUSES.includes(s));
  if (statuses.length) { where.push('c.status IN (' + statuses.map(() => '?').join(',') + ')'); params.push(...statuses); }

  // "view" covers the quick tabs: active, done, returned, blacklisted, flagged, starred, all
  const view = String(q.view || 'all');
  if (view === 'active') where.push('c.done = 0 AND c.blacklisted = 0');
  else if (view === 'done') where.push('c.done = 1');
  else if (view === 'returned') where.push('c.done = 1 AND c.last_seen_at > c.done_at');
  else if (view === 'blacklisted') where.push('c.blacklisted = 1');
  else if (view === 'flagged') where.push('c.open_flags > 0');
  else if (view === 'starred') where.push('c.starred = 1');
  else if (view === 'review') where.push("c.latest_cv_id IN (SELECT id FROM cvs WHERE needs_review != '')");
  if (q.hideBlacklisted === '1' && view !== 'blacklisted') where.push('c.blacklisted = 0');
  if (num(q.risk) != null) { where.push('c.risk >= ?'); params.push(num(q.risk)); }

  const sources = list(q.source).filter((s) => ['email', 'website', 'upload', 'whatsapp'].includes(s));
  if (sources.length) {
    where.push('c.id IN (SELECT cv.candidate_id FROM cvs cv JOIN cv_sources s ON s.cv_id = cv.id WHERE s.source IN (' + sources.map(() => '?').join(',') + '))');
    params.push(...sources);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.from || '')) { where.push('c.last_seen_at >= ?'); params.push(q.from); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.to || '')) { where.push('c.last_seen_at < ?'); params.push(q.to + 'T23:59:59.999Z'); }
  for (const t of list(q.tag)) { where.push('c.tags LIKE ?'); params.push('%' + JSON.stringify(t).replace(/[%_]/g, '') + '%'); }
  if (q.applied) { where.push('c.applied_for LIKE ?'); params.push('%' + String(q.applied).replace(/[%_]/g, '') + '%'); }
  return { where, params, fts };
}

const SORTS = {
  recent: 'c.last_seen_at DESC',
  oldest: 'c.first_seen_at ASC',
  name: 'c.name COLLATE NOCASE ASC',
  experience: 'c.experience_years IS NULL, c.experience_years DESC',
  youngest: 'c.birth_year IS NULL, c.birth_year DESC',
  oldest_age: 'c.birth_year IS NULL, c.birth_year ASC',
  education: 'c.education_level DESC, c.last_seen_at DESC',
  rating: 'c.starred DESC, c.rating DESC, c.last_seen_at DESC',
  risk: 'c.risk DESC, c.open_flags DESC, c.last_seen_at DESC',
  versions: 'c.cv_count DESC, c.last_seen_at DESC'
};

function fromClause(fts) {
  return fts
    ? 'candidates c JOIN (SELECT rowid AS fid, bm25(candidate_fts, 12.0, 6.0, 4.0, 4.0, 5.0, 4.0, 1.0) AS rank FROM candidate_fts WHERE candidate_fts MATCH ?) f ON f.fid = c.id'
    : 'candidates c';
}

const LIST_COLUMNS = `c.id, c.name, c.email, c.phone, c.birth_year, c.dob, c.gender, c.city, c.state, c.education_level, c.degrees,
  c.skills, c.experience_years, c.current_title, c.current_company, c.applied_for, c.status, c.done, c.done_at, c.blacklisted,
  c.starred, c.rating, c.risk, c.open_flags, c.cv_count, c.last_seen_at, c.first_seen_at, c.last_source, c.tags, c.latest_cv_id,
  c.notice_period, c.expected_ctc, c.area, c.region,
  (SELECT kind FROM cvs WHERE id = c.latest_cv_id) AS cv_kind,
  (SELECT needs_review FROM cvs WHERE id = c.latest_cv_id) AS needs_review`;

function searchCandidates(q, { limit, columns = LIST_COLUMNS } = {}) {
  const started = process.hrtime.bigint();
  const { where, params, fts } = buildFilter(q);
  const page = Math.max(1, Number(q.page) || 1);
  const pageSize = limit || Math.min(200, Math.max(1, Number(q.pageSize) || 50));
  const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : '';
  const from = fromClause(fts);
  const allParams = fts ? [fts, ...params] : params;
  const sort = q.sort && SORTS[q.sort] ? SORTS[q.sort] : fts ? 'f.rank ASC' : SORTS.recent;

  const total = get('SELECT COUNT(*) AS n FROM ' + from + whereSql, ...allParams).n;
  const items = all('SELECT ' + columns + ' FROM ' + from + whereSql + ' ORDER BY ' + sort + ' LIMIT ? OFFSET ?', ...allParams, pageSize, (page - 1) * pageSize);
  const tookMs = Number(process.hrtime.bigint() - started) / 1e6;
  return { items, total, page, pageSize, tookMs: Math.round(tookMs * 10) / 10 };
}

function facets(q) {
  const { where, params, fts } = buildFilter(q);
  const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : '';
  const from = fromClause(fts);
  const p = fts ? [fts, ...params] : params;
  const base = 'SELECT c.id FROM ' + from + whereSql;
  return {
    gender: all('SELECT gender AS value, COUNT(*) AS n FROM candidates WHERE id IN (' + base + ') GROUP BY gender ORDER BY n DESC', ...p),
    education: all('SELECT education_level AS value, COUNT(*) AS n FROM candidates WHERE id IN (' + base + ') GROUP BY education_level ORDER BY value DESC', ...p),
    city: all("SELECT city AS value, state, COUNT(*) AS n FROM candidates WHERE city != '' AND id IN (" + base + ') GROUP BY city ORDER BY n DESC LIMIT 40', ...p),
    state: all("SELECT state AS value, COUNT(*) AS n FROM candidates WHERE state != '' AND id IN (" + base + ') GROUP BY state ORDER BY n DESC LIMIT 40', ...p),
    area: all("SELECT area AS value, region, COUNT(*) AS n FROM candidates WHERE area != '' AND id IN (" + base + ') GROUP BY area ORDER BY n DESC LIMIT 300', ...p),
    skills: all('SELECT skill AS value, COUNT(*) AS n FROM candidate_skills WHERE candidate_id IN (' + base + ') GROUP BY skill COLLATE NOCASE ORDER BY n DESC LIMIT 60', ...p),
    status: all('SELECT status AS value, COUNT(*) AS n FROM candidates WHERE id IN (' + base + ') GROUP BY status ORDER BY n DESC', ...p)
  };
}

module.exports = { searchCandidates, facets, buildFilter, ftsQuery, STATUSES, LIST_COLUMNS };
