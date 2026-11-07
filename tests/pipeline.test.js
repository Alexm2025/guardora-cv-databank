'use strict';

/* End-to-end tests of the CV pipeline on a throwaway data folder: node --test tests/ */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'guardora-test-'));
process.env.DATA_DIR = DATA;
process.env.MASTER_KEY = '11'.repeat(32);

const { get, all } = require('../server/db');
const { ingestFile, mergeCandidates, splitCv } = require('../server/ingest');
const { searchCandidates, facets } = require('../server/search');
const { makePdf, makeDocx } = require('./fixtures');
const vault = require('../server/vault');

const PRIYA_V1 = [
  'PRIYA RAMESH SHARMA',
  'Email: priya.sharma92@mail.test | Mobile: +91 98765 43210',
  'Address: Flat 302, Sai Krupa CHS, Dombivli East, Thane 421201, Maharashtra',
  '',
  'Career Objective',
  'To work as an Accounts professional in a growth-oriented organisation.',
  '',
  'Work Experience',
  'Accounts Executive - Mahindra Logistics Ltd     Apr 2021 - Present',
  'Vendor payments, Bank Reconciliation, GST returns',
  'Accounts Assistant, Shree Ganesh Traders Pvt Ltd     Jun 2019 - Mar 2021',
  'Tally ERP 9 entries, petty cash, TDS working',
  '',
  'Educational Qualifications',
  'M.Com (Accounts) - University of Mumbai - 2019 - 68%',
  'B.Com - K.V. Pendharkar College, Dombivli - 2017 - 72%',
  'HSC - Maharashtra Board - 2014 - 74%',
  '',
  'Key Skills',
  'Tally Prime, Advanced Excel, VLOOKUP, GST, TDS, Accounts Payable',
  '',
  'Personal Details',
  'Date of Birth: 14/08/1996',
  'Gender: Female',
  'Languages Known: English, Hindi, Marathi',
  'Declaration: I hereby declare that the above information is true.'
];

// Five years later: same email, but history rewritten.
const PRIYA_V2 = PRIYA_V1.map((l) => l
  .replace('14/08/1996', '14/08/1994')
  .replace('B.Com - K.V. Pendharkar College, Dombivli - 2017 - 72%', 'B.Com - K.V. Pendharkar College, Dombivli - 2015 - 72%')
  .replace('To work as', 'Accounts professional with 11 years of experience. To work as'))
  .flatMap((l) => (l.startsWith('Accounts Assistant') ? [l, 'Senior Accountant - Infosys BPM Ltd     Jan 2016 - May 2019', 'Accounts payable for global clients'] : [l]));

const RAHUL = [
  'Rahul Verma',
  'Phone: 9123456780',
  'Location: Pune, Maharashtra',
  'Professional Summary: Sales executive with 3 years of experience in B2B Sales and Lead Generation.',
  'Experience',
  'Sales Executive - Bajaj Finance Ltd   Jan 2023 - Present',
  'Education',
  'BBA - Symbiosis College, Pune - 2022 - 7.8 CGPA',
  'Skills: B2B Sales, Lead Generation, CRM, MS Excel',
  'Date of Birth: 02-03-2000',
  'Sex: Male'
];

const INVOICE = ['TAX INVOICE', 'GSTIN: 27AAACG1234F1Z5', 'Bill To: Guardians HR', 'Invoice No 1043', 'Amount due: Rs 25,000', 'Bank: HDFC'];

test('new CV creates a candidate with parsed fields', async () => {
  const r = await ingestFile({ buffer: makePdf(PRIYA_V1), fileName: 'Priya_CV.pdf', source: 'email', ref: 'm1#2', receivedAt: '2021-05-01T09:00:00Z', sender: 'priya.sharma92@mail.test', subject: 'Application for Accounts Executive' });
  assert.equal(r.outcome, 'added');
  const c = get('SELECT * FROM candidates WHERE id = ?', r.candidateId);
  assert.equal(c.name, 'Priya Ramesh Sharma');
  assert.equal(c.email, 'priya.sharma92@mail.test');
  assert.equal(c.phone, '+91 98765 43210');
  assert.equal(c.dob, '1996-08-14');
  assert.equal(c.gender, 'female');
  assert.equal(c.city, 'Dombivli');
  assert.equal(c.state, 'Maharashtra');
  assert.equal(c.education_level, 7);
  assert.ok(JSON.parse(c.skills).includes('Tally Prime'));
  assert.equal(c.cv_count, 1);
});

test('the same file from the website is stored once, with both sources', async () => {
  const r = await ingestFile({ buffer: makePdf(PRIYA_V1), fileName: 'cv.pdf', source: 'website', ref: 'app:7', trusted: true, receivedAt: '2021-05-02T09:00:00Z', form: { name: 'Priya Sharma', email: 'priya.sharma92@mail.test', phone: '9876543210' } });
  assert.equal(r.outcome, 'duplicate');
  assert.equal(get('SELECT COUNT(*) AS n FROM cvs').n, 1);
  assert.equal(get('SELECT COUNT(*) AS n FROM cv_sources').n, 2);
});

test('a rewritten CV from the same person becomes version 2 with fraud alerts', async () => {
  const r = await ingestFile({ buffer: makeDocx(PRIYA_V2), fileName: 'Priya Sharma Resume 2026.docx', source: 'email', ref: 'm2#2', receivedAt: '2026-10-01T09:00:00Z', sender: 'priya.sharma92@mail.test', subject: 'Resume' });
  assert.equal(r.outcome, 'new_version');
  const c = get('SELECT * FROM candidates WHERE id = ?', r.candidateId);
  assert.equal(c.cv_count, 2);
  assert.equal(c.risk, 3);
  const kinds = all('SELECT kind FROM flags WHERE candidate_id = ?', c.id).map((f) => f.kind);
  for (const k of ['dob_changed', 'degree_year_changed', 'employer_backdated', 'experience_inflated']) assert.ok(kinds.includes(k), 'expected flag ' + k + ' in ' + kinds);
  assert.equal(get('SELECT COUNT(*) AS n FROM candidates').n, 1);
});

test('a document that is not a CV is skipped', async () => {
  const r = await ingestFile({ buffer: makePdf(INVOICE), fileName: 'invoice_1043.pdf', source: 'email', ref: 'm3#2', subject: 'Invoice for October' });
  assert.equal(r.outcome, 'skipped');
});

test('matching by phone number when the email differs, and blacklist alerts', async () => {
  const a = await ingestFile({ buffer: makePdf(RAHUL), fileName: 'Rahul.pdf', source: 'email', ref: 'm4#2', receivedAt: '2025-01-10T09:00:00Z', sender: 'rahul.v@mail.test', subject: 'CV' });
  assert.equal(a.outcome, 'added');
  const c = get('SELECT * FROM candidates WHERE id = ?', a.candidateId);
  assert.equal(c.gender, 'male');
  assert.equal(c.city, 'Pune');
  assert.equal(c.dob, '2000-03-02');
  require('../server/db').run("UPDATE candidates SET blacklisted = 1, blacklist_reason = 'Fake experience letter' WHERE id = ?", c.id);

  const b = await ingestFile({ buffer: makePdf([...RAHUL, 'Email: rahul.verma.new@mail.test']), fileName: 'Rahul Verma CV.pdf', source: 'email', ref: 'm5#2', receivedAt: '2026-02-10T09:00:00Z', sender: 'rahul.verma.new@mail.test', subject: 'CV' });
  assert.equal(b.outcome, 'new_version');
  assert.equal(b.candidateId, c.id);
  assert.ok(get("SELECT 1 AS x FROM flags WHERE candidate_id = ? AND kind = 'blacklisted_reapplied'", c.id));
});

test('a different person with the same name is kept separate but suggested as a possible duplicate', async () => {
  const other = ['Priya Ramesh Sharma', 'priya.rs@mail.test', '+91 70000 11111', 'Nurse at Fortis Hospital, Bengaluru', 'Experience', 'Staff Nurse - Fortis Hospital   Jan 2020 - Present', 'Education', 'B.Sc Nursing - Rajiv Gandhi University - 2019', 'Skills: Patient Care, Nursing'];
  const r = await ingestFile({ buffer: makePdf(other), fileName: 'resume.pdf', source: 'upload', ref: 'u1', trusted: true });
  assert.equal(r.outcome, 'added');
  assert.equal(get('SELECT COUNT(*) AS n FROM candidates').n, 3);
  assert.ok(get("SELECT 1 AS x FROM duplicate_suggestions WHERE status = 'open'"));
});

test('search: text, filters and facets', () => {
  assert.equal(searchCandidates({ q: 'tally' }).total, 1);
  assert.equal(searchCandidates({ q: 'priya' }).total, 2);
  assert.equal(searchCandidates({ q: '98765 43210' }).total, 1);
  assert.equal(searchCandidates({ q: 'priya.sharma92@mail.test' }).total, 1);
  assert.equal(searchCandidates({ gender: 'female' }).total, 1);
  assert.equal(searchCandidates({ city: 'Pune' }).total, 1);
  assert.equal(searchCandidates({ skills: 'B2B Sales' }).total, 1);
  assert.equal(searchCandidates({ eduMin: 7 }).total, 1);
  assert.equal(searchCandidates({ ageMin: 20, ageMax: 28 }).total, 1); // Rahul, born 2000
  assert.equal(searchCandidates({ view: 'blacklisted' }).total, 1);
  assert.equal(searchCandidates({ view: 'flagged' }).total, 2);
  assert.equal(searchCandidates({ source: 'website' }).total, 1);
  const f = facets({});
  assert.ok(f.city.some((c) => c.value === 'Pune'));
});

test('files in the vault are encrypted at rest', () => {
  const cv = get('SELECT sha256 FROM cvs LIMIT 1');
  const dir = path.join(DATA, 'vault', cv.sha256.slice(0, 2));
  const raw = fs.readFileSync(path.join(dir, fs.readdirSync(dir)[0]));
  assert.ok(!raw.includes(Buffer.from('%PDF')) && !raw.includes(Buffer.from('Sharma')));
  assert.ok(vault.read(cv.sha256).subarray(0, 4).toString() === '%PDF' || vault.read(cv.sha256).subarray(0, 2).toString() === 'PK');
});

test('merge and split', () => {
  const ids = all('SELECT id FROM candidates WHERE name_key = ? ORDER BY id', 'priya ramesh sharma').map((r) => r.id);
  mergeCandidates(ids[0], ids[1], null);
  assert.equal(get('SELECT cv_count FROM candidates WHERE id = ?', ids[0]).cv_count, 3);
  const nurseCv = get("SELECT id FROM cvs WHERE text LIKE '%Fortis%'");
  const newId = splitCv(nurseCv.id, null);
  assert.equal(get('SELECT cv_count FROM candidates WHERE id = ?', ids[0]).cv_count, 2);
  assert.equal(get('SELECT email FROM candidates WHERE id = ?', newId).email, 'priya.rs@mail.test');
  assert.equal(get('SELECT email FROM candidates WHERE id = ?', ids[0]).email, 'priya.sharma92@mail.test');
});

test.after(() => {
  require('../server/db').db.close();
  fs.rmSync(DATA, { recursive: true, force: true });
});
