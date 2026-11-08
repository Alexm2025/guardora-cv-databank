'use strict';

/*
 * Keeps stored data in step with improvements to the CV reader. When PARSER_VERSION goes up, every stored CV is
 * re-read once at start-up and profiles are rebuilt. Contact details and CTC that came from the website form,
 * and every field someone corrected by hand, are kept.
 */

const { all, run, tx, get } = require('./db');
const { parseCv } = require('./extract/parse');
const { fingerprint } = require('./match');
const { refreshCandidate, parseJson } = require('./ingest');

const PARSER_VERSION = 2; // 2: areas / railway lines, college and year read from the right line

const KEEP = ['name', 'emails', 'phones', 'currentCtc', 'expectedCtc', 'noticePeriod'];

function reparseAll() {
  const cvs = all('SELECT id, text, parsed, received_at FROM cvs');
  tx(() => {
    for (const cv of cvs) {
      const old = parseJson(cv.parsed, {});
      const fresh = parseCv(cv.text, { receivedAt: cv.received_at });
      for (const k of KEEP) if (old[k] && (!Array.isArray(old[k]) || old[k].length)) fresh[k] = old[k];
      run('UPDATE cvs SET parsed = ?, fingerprint = ?, cv_score = ? WHERE id = ?', JSON.stringify(fresh), JSON.stringify(fingerprint(cv.text)), fresh.cvScore, cv.id);
    }
    for (const c of all('SELECT id FROM candidates')) refreshCandidate(c.id);
  });
  return cvs.length;
}

function upgradeIfNeeded() {
  const current = Number((get("SELECT value FROM settings WHERE key = 'parser_version'") || {}).value || 1);
  if (current >= PARSER_VERSION) return 0;
  const started = Date.now();
  const n = reparseAll();
  run("INSERT INTO settings (key, value) VALUES ('parser_version', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", String(PARSER_VERSION));
  if (n) console.log('[upgrade] Re-read ' + n + ' CVs with the improved reader in ' + Math.round((Date.now() - started) / 1000) + 's.');
  return n;
}

module.exports = { reparseAll, upgradeIfNeeded, PARSER_VERSION };
