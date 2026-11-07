'use strict';

/*
 * The databank: one SQLite file (Node's built-in driver) with full-text search (FTS5).
 * A candidate is a person; each CV file they send is a row in `cvs` (their versions over the years);
 * each place a CV arrived from (an email, a website application, a manual upload) is a row in `cv_sources`.
 */

const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const { DATA_DIR, VAULT_DIR, BACKUP_DIR, DB_FILE } = require('./config');

for (const dir of [DATA_DIR, VAULT_DIR, BACKUP_DIR]) fs.mkdirSync(dir, { recursive: true });

const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

const MIGRATIONS = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    role TEXT NOT NULL DEFAULT 'recruiter',          -- owner | recruiter | viewer
    password_hash TEXT NOT NULL,
    totp_secret TEXT NOT NULL DEFAULT '',            -- encrypted
    totp_enabled INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',           -- active | disabled
    created_at TEXT NOT NULL,
    last_login_at TEXT
  );

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    ip TEXT NOT NULL DEFAULT '',
    agent TEXT NOT NULL DEFAULT '',
    pending_2fa INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_sessions_user ON sessions(user_id);

  CREATE TABLE candidates (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    name_key TEXT NOT NULL DEFAULT '',               -- lower-case sorted name tokens, for duplicate checks
    email TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',                  -- display form
    emails TEXT NOT NULL DEFAULT '[]',               -- every address seen for this person (JSON)
    phones TEXT NOT NULL DEFAULT '[]',               -- every number seen, last 10 digits (JSON)
    dob TEXT NOT NULL DEFAULT '',                    -- YYYY-MM-DD when known
    birth_year INTEGER,                              -- from DOB, or estimated from a stated age
    gender TEXT NOT NULL DEFAULT '',                 -- male | female | other | ''
    city TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    education_level INTEGER NOT NULL DEFAULT 0,      -- see EDUCATION_LEVELS in extract/dictionary.js
    education TEXT NOT NULL DEFAULT '[]',            -- [{degree, field, year, institution, score}]
    degrees TEXT NOT NULL DEFAULT '',                -- " B.Com MBA " for filtering
    skills TEXT NOT NULL DEFAULT '[]',
    experience_years REAL,
    current_title TEXT NOT NULL DEFAULT '',
    current_company TEXT NOT NULL DEFAULT '',
    experience TEXT NOT NULL DEFAULT '[]',           -- [{title, company, start, end, current, line}]
    current_ctc TEXT NOT NULL DEFAULT '',
    expected_ctc TEXT NOT NULL DEFAULT '',
    notice_period TEXT NOT NULL DEFAULT '',
    languages TEXT NOT NULL DEFAULT '[]',
    applied_for TEXT NOT NULL DEFAULT '',            -- last job title they applied for
    status TEXT NOT NULL DEFAULT 'new',              -- new | reviewing | shortlisted | placed | done | rejected
    done INTEGER NOT NULL DEFAULT 0,
    done_at TEXT,
    blacklisted INTEGER NOT NULL DEFAULT 0,
    blacklist_reason TEXT NOT NULL DEFAULT '',
    blacklisted_at TEXT,
    starred INTEGER NOT NULL DEFAULT 0,
    rating INTEGER NOT NULL DEFAULT 0,
    tags TEXT NOT NULL DEFAULT '[]',
    edited_fields TEXT NOT NULL DEFAULT '[]',        -- fields a person corrected by hand; new CVs will not overwrite them
    cv_count INTEGER NOT NULL DEFAULT 0,
    latest_cv_id INTEGER,
    risk INTEGER NOT NULL DEFAULT 0,                 -- 0 none, 1 low, 2 medium, 3 high (open fraud flags)
    open_flags INTEGER NOT NULL DEFAULT 0,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    last_source TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_cand_last_seen ON candidates(last_seen_at DESC);
  CREATE INDEX idx_cand_name_key ON candidates(name_key);
  CREATE INDEX idx_cand_email ON candidates(email);
  CREATE INDEX idx_cand_phone ON candidates(phone);
  CREATE INDEX idx_cand_city ON candidates(city);
  CREATE INDEX idx_cand_state ON candidates(state);
  CREATE INDEX idx_cand_gender ON candidates(gender);
  CREATE INDEX idx_cand_birth ON candidates(birth_year);
  CREATE INDEX idx_cand_edu ON candidates(education_level);
  CREATE INDEX idx_cand_exp ON candidates(experience_years);
  CREATE INDEX idx_cand_status ON candidates(status, last_seen_at);
  CREATE INDEX idx_cand_flags ON candidates(blacklisted, done, risk);

  -- Exact identifiers for instant duplicate matching: e:<email>, p:<10 digits>
  CREATE TABLE candidate_keys (
    key TEXT NOT NULL,
    candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    PRIMARY KEY (key, candidate_id)
  );
  CREATE INDEX idx_keys_candidate ON candidate_keys(candidate_id);

  CREATE TABLE candidate_skills (
    candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    skill TEXT NOT NULL COLLATE NOCASE,
    PRIMARY KEY (candidate_id, skill)
  );
  CREATE INDEX idx_skills_skill ON candidate_skills(skill);

  CREATE TABLE cvs (
    id INTEGER PRIMARY KEY,
    candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    sha256 TEXT NOT NULL UNIQUE,
    file_name TEXT NOT NULL,
    mime TEXT NOT NULL DEFAULT '',
    size INTEGER NOT NULL DEFAULT 0,
    kind TEXT NOT NULL DEFAULT '',                   -- pdf | docx | doc | rtf | odt | txt | image
    pages INTEGER,
    text TEXT NOT NULL DEFAULT '',
    parsed TEXT NOT NULL DEFAULT '{}',
    fingerprint TEXT NOT NULL DEFAULT '',            -- word-shingle hashes for similarity
    cv_score INTEGER NOT NULL DEFAULT 0,             -- how CV-like the document is, 0-100
    needs_review TEXT NOT NULL DEFAULT '',           -- e.g. "scanned" when there is no text layer
    received_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_cvs_candidate ON cvs(candidate_id, received_at);

  CREATE TABLE cv_sources (
    id INTEGER PRIMARY KEY,
    cv_id INTEGER NOT NULL REFERENCES cvs(id) ON DELETE CASCADE,
    source TEXT NOT NULL,                            -- email | website | upload
    ref TEXT NOT NULL,                               -- message id, application id, upload id
    received_at TEXT NOT NULL,
    sender TEXT NOT NULL DEFAULT '',
    subject TEXT NOT NULL DEFAULT '',
    job_title TEXT NOT NULL DEFAULT '',
    meta TEXT NOT NULL DEFAULT '{}',
    UNIQUE (source, ref, cv_id)
  );
  CREATE INDEX idx_sources_cv ON cv_sources(cv_id);
  CREATE INDEX idx_sources_source ON cv_sources(source, received_at);

  CREATE TABLE flags (
    id INTEGER PRIMARY KEY,
    candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    cv_id INTEGER REFERENCES cvs(id) ON DELETE CASCADE,
    previous_cv_id INTEGER REFERENCES cvs(id) ON DELETE SET NULL,
    kind TEXT NOT NULL,
    severity INTEGER NOT NULL,                       -- 1 low, 2 medium, 3 high
    message TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT '{}',
    resolved INTEGER NOT NULL DEFAULT 0,
    resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    resolved_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_flags_open ON flags(resolved, created_at);
  CREATE INDEX idx_flags_candidate ON flags(candidate_id);

  CREATE TABLE duplicate_suggestions (
    id INTEGER PRIMARY KEY,
    candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    other_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    score INTEGER NOT NULL,
    reasons TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'open',             -- open | merged | dismissed
    created_at TEXT NOT NULL,
    UNIQUE (candidate_id, other_id)
  );

  CREATE TABLE notes (
    id INTEGER PRIMARY KEY,
    candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_notes_candidate ON notes(candidate_id);

  CREATE TABLE events (
    id INTEGER PRIMARY KEY,
    candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    kind TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_events_candidate ON events(candidate_id, id);

  CREATE TABLE saved_searches (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    query TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE ingest_log (
    id INTEGER PRIMARY KEY,
    source TEXT NOT NULL,
    ref TEXT NOT NULL DEFAULT '',
    outcome TEXT NOT NULL,                           -- added | new_version | duplicate | skipped | error
    message TEXT NOT NULL DEFAULT '',
    candidate_id INTEGER,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_ingest_time ON ingest_log(id DESC);

  CREATE TABLE processed (
    key TEXT PRIMARY KEY,                            -- e.g. msg:<message-id>, app:<website id>
    created_at TEXT NOT NULL
  );

  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  CREATE TABLE audit (
    id INTEGER PRIMARY KEY,
    user_id INTEGER,
    user_name TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL,
    target TEXT NOT NULL DEFAULT '',
    details TEXT NOT NULL DEFAULT '',
    ip TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_audit_time ON audit(id DESC);

  -- Full-text index over each candidate: profile fields plus the text of every CV they sent.
  CREATE VIRTUAL TABLE candidate_fts USING fts5(
    name, contact, location, education, skills, work, body,
    tokenize = "unicode61 remove_diacritics 2 tokenchars '+#.'",
    prefix = '2 3'
  );
  `,
  // 2: shortlists shared with client companies, without the candidates' contact details.
  `
  CREATE TABLE shares (
    id INTEGER PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,                  -- the link's secret, hashed (for lookup)
    token_enc TEXT NOT NULL,                          -- the link's secret, encrypted (to show the link again)
    company TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    message TEXT NOT NULL DEFAULT '',
    options TEXT NOT NULL DEFAULT '{}',               -- what the company may see
    pin_hash TEXT NOT NULL DEFAULT '',
    expires_at TEXT NOT NULL,
    revoked INTEGER NOT NULL DEFAULT 0,
    views INTEGER NOT NULL DEFAULT 0,
    last_viewed_at TEXT,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE share_items (
    share_id INTEGER NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
    candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    feedback TEXT NOT NULL DEFAULT '',                -- interested | maybe | not_suitable
    feedback_note TEXT NOT NULL DEFAULT '',
    feedback_at TEXT,
    PRIMARY KEY (share_id, candidate_id)
  );
  CREATE INDEX idx_share_items_candidate ON share_items(candidate_id);

  CREATE TABLE share_views (
    id INTEGER PRIMARY KEY,
    share_id INTEGER NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
    ip TEXT NOT NULL DEFAULT '',
    agent TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_share_views_share ON share_views(share_id, id);
  `
];

function migrate() {
  const version = db.prepare('PRAGMA user_version').get().user_version;
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec('PRAGMA user_version = ' + (v + 1));
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}
migrate();

const cache = new Map();
const stmt = (sql) => {
  let s = cache.get(sql);
  if (!s) {
    s = db.prepare(sql);
    cache.set(sql, s);
  }
  return s;
};
const get = (sql, ...params) => stmt(sql).get(...params);
const all = (sql, ...params) => stmt(sql).all(...params);
const run = (sql, ...params) => stmt(sql).run(...params);

let depth = 0;
function tx(fn) {
  if (depth > 0) return fn();
  depth++;
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    depth--;
  }
}

function insert(table, row) {
  const keys = Object.keys(row);
  const sql = 'INSERT INTO ' + table + ' (' + keys.join(', ') + ') VALUES (' + keys.map(() => '?').join(', ') + ')';
  return Number(run(sql, ...keys.map((k) => row[k])).lastInsertRowid);
}

function update(table, id, row) {
  const keys = Object.keys(row);
  if (!keys.length) return;
  run('UPDATE ' + table + ' SET ' + keys.map((k) => k + ' = ?').join(', ') + ' WHERE id = ?', ...keys.map((k) => row[k]), id);
}

const now = () => new Date().toISOString();

module.exports = { db, get, all, run, tx, insert, update, now };
