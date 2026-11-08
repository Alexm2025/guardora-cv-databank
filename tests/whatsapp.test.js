'use strict';

/* WhatsApp import rules, with messages in the format the WhatsApp library delivers them. */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'guardora-wa-'));
process.env.DATA_DIR = DATA;
process.env.MASTER_KEY = '66'.repeat(32);

const { get, all } = require('../server/db');
const { handleMessage, senderPhone, cvAttachment } = require('../server/sources/whatsapp');
const { makePdf } = require('./fixtures');

const cvWithContacts = makePdf(['Kiran Rao', 'kiran.rao@example.org', '+91 98200 11111', 'Location: Thane', 'Experience', 'HR Executive - Lodha Group Ltd   Jan 2021 - Present',
  'Education', 'MBA (HR) - Mumbai University - 2020', 'Skills: Recruitment, Onboarding, Payroll']);
const cvNoContacts = makePdf(['Farhan Shaikh', 'Location: Kurla, Mumbai', 'Experience', 'Sales Executive - Bajaj Finance Ltd   Jan 2022 - Present',
  'Education', 'B.Com - Mumbai University - 2021', 'Skills: Field Sales, Lead Generation', 'Declaration: true to my knowledge']);

let n = 0;
const doc = (over = {}, file = {}) => ({
  key: { remoteJid: '919820011111@s.whatsapp.net', fromMe: false, id: 'MSG' + (++n), ...over },
  pushName: 'Kiran',
  messageTimestamp: 1793000000 + n,
  message: { documentMessage: { fileName: 'Kiran Rao CV.pdf', mimetype: 'application/pdf', fileLength: 2000, caption: 'Resume for HR Executive', ...file } }
});
const give = (buf) => async () => buf;

test('a CV sent in a personal chat is imported', async () => {
  const outcome = await handleMessage(doc(), give(cvWithContacts), {});
  assert.equal(outcome, 'added');
  const c = get("SELECT * FROM candidates WHERE name = 'Kiran Rao'");
  assert.equal(c.applied_for, 'HR Executive');
  assert.equal(c.last_source, 'whatsapp');
  const src = get("SELECT * FROM cv_sources WHERE source = 'whatsapp'");
  assert.equal(src.sender, '+919820011111');
});

test('the same message twice is imported once', async () => {
  const m = doc();
  await handleMessage(m, give(makePdf(['Other Person', 'o@example.org', 'Skills: Excel', 'Experience', 'Education'])), {});
  assert.equal(await handleMessage(m, give(cvWithContacts), {}), 'done');
});

test('own messages, statuses, channels, non-CV files and plain photos are ignored', async () => {
  const fail = async () => { throw new Error('should not download'); };
  assert.equal(await handleMessage(doc({ fromMe: true }), fail, {}), 'ignored');
  assert.equal(await handleMessage(doc({ remoteJid: 'status@broadcast' }), fail, {}), 'ignored');
  assert.equal(await handleMessage(doc({ remoteJid: '1203630@newsletter' }), fail, {}), 'ignored');
  assert.equal(await handleMessage(doc({}, { fileName: 'song.mp3', mimetype: 'audio/mpeg' }), fail, {}), 'ignored');
  assert.equal(await handleMessage({ key: { remoteJid: '91982@s.whatsapp.net', id: 'IMG1' }, message: { imageMessage: { caption: 'Happy Diwali' } } }, fail, {}), 'ignored');
});

test('groups are ignored unless turned on', async () => {
  const g = () => doc({ remoteJid: '120363000000@g.us', participant: '919833300000@s.whatsapp.net' });
  assert.equal(await handleMessage(g(), give(cvWithContacts), { groups: false }), 'ignored');
  assert.notEqual(await handleMessage(g(), give(cvWithContacts), { groups: true }), 'ignored');
});

test('the sender number identifies the person when the CV has no contact details', async () => {
  // Newer WhatsApp hides numbers behind "lid" ids; the real number comes in senderPn.
  const m = doc({ remoteJid: '123456789@lid', senderPn: '919867700000@s.whatsapp.net' }, { fileName: 'Farhan.pdf' });
  m.pushName = 'Farhan';
  assert.equal(await handleMessage(m, give(cvNoContacts), {}), 'added');
  const c = get("SELECT * FROM candidates WHERE name = 'Farhan Shaikh'");
  assert.equal(c.phone, '+91 98677 00000');
  assert.equal(c.area, 'Kurla');
});

test('wrapped messages (disappearing, document with caption) and photo CVs', async () => {
  const wrapped = { key: { remoteJid: '919811100000@s.whatsapp.net', id: 'W1' }, message: { ephemeralMessage: { message: { documentWithCaptionMessage: { message: { documentMessage: { fileName: 'cv.docx', mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', caption: 'my cv' } } } } } } };
  assert.equal(cvAttachment(wrapped).fileName, 'cv.docx');
  const photo = { key: { remoteJid: '919811100000@s.whatsapp.net', id: 'P1' }, message: { imageMessage: { caption: 'Sir this is my resume', fileLength: 1000 } } };
  assert.equal(cvAttachment(photo).kind, 'image');
});

test('expired media is logged and skipped; connection errors are retried', async () => {
  assert.equal(await handleMessage(doc(), async () => { throw new Error('Media not found (410)'); }, {}), 'skipped');
  await assert.rejects(handleMessage(doc(), async () => { throw new Error('socket hang up'); }, {}), /socket hang up/);
  assert.ok(all("SELECT * FROM ingest_log WHERE source = 'whatsapp' AND outcome = 'skipped'").length >= 1);
});

test('phone numbers from WhatsApp ids', () => {
  assert.equal(senderPhone({ remoteJid: '919820011111@s.whatsapp.net' }), '+919820011111');
  assert.equal(senderPhone({ remoteJid: '120363@g.us', participant: '447700900123@s.whatsapp.net' }), '+447700900123');
  assert.equal(senderPhone({ remoteJid: '12345@lid' }), '');
});

test.after(() => {
  require('../server/db').db.close();
  fs.rmSync(DATA, { recursive: true, force: true });
});
