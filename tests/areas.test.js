'use strict';

/* Area, railway-line and "near" searches on a throwaway databank. */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'guardora-areas-'));
process.env.DATA_DIR = DATA;
process.env.MASTER_KEY = '55'.repeat(32);

const { run, get } = require('../server/db');
const { ingestFile, reindex } = require('../server/ingest');
const { searchCandidates, facets } = require('../server/search');
const { makePdf } = require('./fixtures');

const person = (name, phone, address) => makePdf([name, name.toLowerCase().replace(/\s+/g, '.') + '@example.org', '+91 ' + phone, 'Address: ' + address,
  'Experience', 'Accounts Executive - Om Traders Pvt Ltd   Jan 2020 - Present', 'Education', 'B.Com - Mumbai University - 2019', 'Skills: Tally, GST']);

const ids = {};
test.before(async () => {
  const people = [
    ['Mulund', 'Rahul Patil', '9811111111', 'B-204, Sai Darshan CHS, Gavanpada, Mulund East, Mumbai - 400081'],
    ['Kharghar', 'Sneha Kamble', '9822222222', 'Sector 12, Kharghar, Navi Mumbai'],
    ['Andheri', 'Amit Shah', '9833333333', 'Marol Naka, Andheri East, Mumbai'],
    ['Badlapur', 'Ravi More', '9844444444', 'Flat 3, Badlapur East, Thane district'],
    ['Ghatkopar', 'Neha Joshi', '9855555555', 'Pant Nagar, Ghatkopar East, Mumbai']
  ];
  for (const [key, name, phone, address] of people) {
    const r = await ingestFile({ buffer: person(name, phone, address), fileName: name + '.pdf', source: 'upload', ref: key, trusted: true });
    ids[key] = r.candidateId;
  }
  // As if the reader could not tell this person's area: only the address text mentions it.
  run("UPDATE candidates SET area = '', region = '' WHERE id = ?", ids.Ghatkopar);
  reindex(ids.Ghatkopar);
});

const found = (q) => searchCandidates(q).items.map((c) => c.id).sort();
const of = (...keys) => keys.map((k) => ids[k]).sort();

test('areas are read from addresses', () => {
  assert.equal(get('SELECT area FROM candidates WHERE id = ?', ids.Mulund).area, 'Mulund');
  assert.equal(get('SELECT region FROM candidates WHERE id = ?', ids.Mulund).region, 'Eastern suburbs');
  assert.equal(get('SELECT area FROM candidates WHERE id = ?', ids.Kharghar).area, 'Kharghar');
  assert.equal(get('SELECT city FROM candidates WHERE id = ?', ids.Badlapur).city, 'Badlapur');
});

test('search by area, by line and near a station', () => {
  assert.deepEqual(found({ area: 'Mulund' }), of('Mulund'));
  assert.deepEqual(found({ area: 'mulund,kharghar' }), of('Mulund', 'Kharghar'));
  assert.deepEqual(found({ line: 'harbour' }), of('Kharghar', 'Andheri')); // Andheri via the Goregaon branch
  assert.deepEqual(found({ line: 'western' }), of('Andheri'));
  assert.deepEqual(found({ line: 'central' }), of('Mulund', 'Badlapur', 'Ghatkopar'));
  assert.deepEqual(found({ near: 'Thane', stops: 1 }), of('Mulund'));
  // "Thane district" in Badlapur's address must not count as Thane.
  assert.deepEqual(found({ near: 'Mulund', stops: 2 }), of('Mulund'));
  // Ghatkopar's area is unknown here; it is found from the address text.
  assert.deepEqual(found({ near: 'Vikhroli', stops: 2 }), of('Ghatkopar'));
});

test('area facets for the filter', () => {
  const f = facets({});
  assert.ok(f.area.some((a) => a.value === 'Kharghar' && a.region === 'Navi Mumbai'));
});

test.after(() => {
  require('../server/db').db.close();
  fs.rmSync(DATA, { recursive: true, force: true });
});
