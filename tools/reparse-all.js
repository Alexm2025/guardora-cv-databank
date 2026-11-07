'use strict';

/*
 * Re-reads every stored CV with the current CV reader (after an update that improves it) and rebuilds
 * profiles and the search index. Keeps contact details and CTC that came from the website form, and every
 * field someone corrected by hand. Safe to run while Guardora is stopped:
 *   node tools/reparse-all.js            (uses DATA_DIR from .env, default "data")
 */

process.env.DISABLE_SOURCES = '1';
const { all, run, tx } = require('../server/db');
const { parseCv } = require('../server/extract/parse');
const { fingerprint } = require('../server/match');
const { refreshCandidate, parseJson } = require('../server/ingest');

const KEEP = ['name', 'emails', 'phones', 'currentCtc', 'expectedCtc', 'noticePeriod'];
const cvs = all('SELECT id, candidate_id, text, parsed, received_at FROM cvs');
tx(() => {
  for (const cv of cvs) {
    const old = parseJson(cv.parsed, {});
    const fresh = parseCv(cv.text, { receivedAt: cv.received_at });
    for (const k of KEEP) if (old[k] && (!Array.isArray(old[k]) || old[k].length)) fresh[k] = old[k];
    run('UPDATE cvs SET parsed = ?, fingerprint = ?, cv_score = ? WHERE id = ?', JSON.stringify(fresh), JSON.stringify(fingerprint(cv.text)), fresh.cvScore, cv.id);
  }
  for (const c of all('SELECT id FROM candidates')) refreshCandidate(c.id);
});
console.log('Re-read ' + cvs.length + ' CVs.');
