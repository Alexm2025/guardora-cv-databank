'use strict';

/* Mailbox helpers: which parts of an email are CVs, and which job the subject line names. */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'guardora-mail-'));
process.env.DATA_DIR = DATA;
process.env.MASTER_KEY = '44'.repeat(32);
const { cvParts, jobTitleFromSubject } = require('../server/sources/mailbox');

test('finds CV attachments, including inside a forwarded email, and ignores logos and signatures', () => {
  const structure = {
    type: 'multipart/mixed',
    childNodes: [
      { part: '1', type: 'text/plain', size: 400 },
      { part: '2', type: 'application/pdf', disposition: 'attachment', dispositionParameters: { filename: 'Neha_Resume.pdf' }, size: 90000 },
      { part: '3', type: 'image/png', disposition: 'inline', parameters: { name: 'logo.gif' }, size: 3000 },
      { part: '4', type: 'application/octet-stream', disposition: 'attachment', dispositionParameters: { filename: 'CV - Ravi.docx' }, size: 40000 },
      {
        part: '5', type: 'message/rfc822', childNodes: [{
          type: 'multipart/mixed', childNodes: [
            { part: '5.1', type: 'text/html', size: 900 },
            { part: '5.2', type: 'application/msword', disposition: 'attachment', dispositionParameters: { filename: 'biodata.doc' }, size: 50000 }
          ]
        }]
      },
      { part: '6', type: 'application/pdf', disposition: 'attachment', dispositionParameters: { filename: 'huge.pdf' }, size: 60 * 1024 * 1024 }
    ]
  };
  assert.deepEqual(cvParts(structure).map((p) => p.part), ['2', '4', '5.2']);
});

test('reads the job from common subject lines', () => {
  assert.equal(jobTitleFromSubject('[Application] Senior Executive - Finance & Accounts — Tejas Mirikar'), 'Senior Executive - Finance & Accounts');
  assert.equal(jobTitleFromSubject('Application for the post of Accountant'), 'Accountant');
  assert.equal(jobTitleFromSubject('Resume for HR Executive position at your firm'), 'HR Executive position');
  assert.equal(jobTitleFromSubject('Hello sir'), '');
});

test.after(() => {
  require('../server/db').db.close();
  fs.rmSync(DATA, { recursive: true, force: true });
});
