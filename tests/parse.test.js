'use strict';

/* CV reading details that went wrong once and must stay right. */

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCv } = require('../server/extract/parse');
const { redactText } = require('../server/redact');

test('each degree keeps its own college, year and marks', () => {
  const edu = parseCv(['Education',
    'B.Com - VJTI, Mumbai - 2008 - 78%',
    'HSC - Maharashtra Board - 2005 - 56%',
    'MBA',
    'Symbiosis Institute of Business Management, Pune',
    '2015'].join('\n')).education;
  const by = Object.fromEntries(edu.map((e) => [e.degree, e]));
  assert.equal(by['B.Com'].institution, 'VJTI, Mumbai');
  assert.equal(by['B.Com'].year, 2008);
  assert.equal(by['B.Com'].score, '78%');
  assert.equal(by['12th / HSC'].institution, 'Maharashtra Board');
  assert.equal(by['12th / HSC'].year, 2005);
  assert.equal(by.MBA.institution, 'Symbiosis Institute of Business Management, Pune');
  assert.equal(by.MBA.year, 2015);
});

test('the sample CV is read fully', () => {
  const p = parseCv(fs.readFileSync(path.join(__dirname, 'fixtures', 'cv-priya.txt'), 'utf8'), { receivedAt: '2026-11-01T10:00:00Z' });
  assert.equal(p.name, 'Priya Ramesh Sharma');
  assert.equal(p.dob, '1996-08-14');
  assert.equal(p.gender, 'female');
  assert.equal(p.city, 'Dombivli');
  assert.equal(p.educationLevel, 7);
  assert.deepEqual(p.experience.map((r) => r.company), ['Mahindra Logistics Ltd', 'Shree Ganesh Traders Pvt Ltd']);
  assert.equal(p.noticePeriod, '30 days');
});

test('contact details are removed from CV text for companies', () => {
  const cv = fs.readFileSync(path.join(__dirname, 'fixtures', 'cv-contacts.txt'), 'utf8');
  const out = redactText(cv, { name: 'Priya Ramesh Sharma', emails: ['priya.sharma92@mail.test'], phones: ['9876543210'] }, { nameMode: 'initials', code: 'GD-00001' });
  for (const leak of [/@/, /\d{3}[\s.-]?\d{3}[\s.-]?\d{4}/, /linkedin/i, /https?:/, /Sharma/, /Ramesh/, /1996/, /ABCDE1234F/, /1234 5678 9012/, /421201/, /0[\s-]?\[hidden\]/]) {
    assert.ok(!leak.test(out), 'leaked ' + leak);
  }
  assert.match(out, /Priya S\./);
  assert.match(out, /Accounts professional with 5 years of experience/);
  assert.match(out, /B\.Com - K\.V\. Pendharkar College - 2017 - 72%/);
});
