'use strict';

/* Mailboxes and bulk email, against a real server process. Mail goes to a test transport, never out. */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');
const assert = require('node:assert/strict');
const { makePdf } = require('./fixtures');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'guardora-mail-'));
const PORT = 8798;
const BASE = 'http://localhost:' + PORT;
let server;
let cookie = '';

async function call(method, url, body) {
  const headers = { Accept: 'application/json', Cookie: cookie };
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(BASE + url, { method, headers, body: payload });
  const s = res.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith('gd_session='));
  if (s) cookie = s;
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v || Date.now() > end) return v;
    await wait(150);
  }
}

const ids = {};
let senderId;

test.before(async () => {
  server = spawn(process.execPath, ['server/index.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DATA_DIR: DATA, PORT: String(PORT), DISABLE_SOURCES: '1', MASTER_KEY: '77'.repeat(32), GUARDORA_MAIL_TRANSPORT: 'json', CAMPAIGN_TICK_MS: '300', CAMPAIGN_GAP_MS: '0', NODE_ENV: 'test' },
    stdio: 'ignore'
  });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(BASE + '/healthz')).ok) break; } catch { /* starting */ }
    await wait(200);
  }
  assert.equal((await call('POST', '/api/setup', { name: 'Owner', email: 'owner@test.local', password: 'a-long-password-1' })).status, 200);
  const people = [['priya', 'Priya Sharma', 'priya.sharma@mail.test'], ['rahul', 'Rahul Verma', 'failbox@mail.test'], ['zoya', 'Zoya Khan', 'zoya.khan@mail.test'], ['noemail', 'No Email Person', '']];
  for (const [i, [key, name, email]] of people.entries()) {
    const form = new FormData();
    form.append('files', new Blob([makePdf([name, email, '+91 98' + String(i + 1).repeat(8), 'Location: Thane', 'Experience', 'Accountant - Om Traders Pvt Ltd   Jan 2020 - Present', 'Education', 'B.Com - Mumbai University - 2019', 'Skills: Tally'])]), name + '.pdf');
    ids[key] = (await call('POST', '/api/upload', form)).data.results[0].candidateId;
  }
  await call('POST', '/api/candidates/' + ids.zoya + '/blacklist', { blacklisted: true, reason: 'test' });
});

test.after(() => {
  server.kill();
  setTimeout(() => fs.rmSync(DATA, { recursive: true, force: true }), 500);
});

test('connect several mailboxes', async () => {
  const a = await call('POST', '/api/mail-accounts', { email: 'hr@guardiansindia.com', password: 'abcd efgh ijkl mnop', import_enabled: false, send_enabled: true, from_name: 'The Guardians HR', signature: 'Regards,\nThe Guardians' });
  assert.equal(a.status, 200, JSON.stringify(a.data));
  senderId = a.data.id;
  const b = await call('POST', '/api/mail-accounts', { email: 'jobs@guardiansindia.com', password: 'x', import_enabled: false, send_enabled: false });
  assert.equal(b.status, 200);
  assert.equal((await call('POST', '/api/mail-accounts', { email: 'hr@guardiansindia.com', password: 'x' })).status, 400, 'no duplicates');
  assert.equal((await call('POST', '/api/mail-accounts', { email: 'x@y.com', import_enabled: true })).status, 400, 'password needed');
  const list = await call('GET', '/api/mail-accounts');
  assert.equal(list.data.items.length, 2);
  assert.equal(list.data.items[0].smtp_host, 'smtp.gmail.com', 'Google Workspace preset from the domain');
  assert.ok(!JSON.stringify(list.data).includes('abcdefghijklmnop'), 'password never sent back');
  const senders = await call('GET', '/api/mail-accounts/senders');
  assert.deepEqual(senders.data.items.map((s) => s.email), ['hr@guardiansindia.com']);
});

test('preview fills in personal fields', async () => {
  const p = await call('POST', '/api/campaigns/preview', { accountId: senderId, candidateId: ids.priya, subject: 'Opening for {{ first_name }}', body: 'Dear {{first_name}},\nWe have a role in {{city}}. {{unknown_field}}' });
  assert.equal(p.data.subject, 'Opening for Priya');
  assert.match(p.data.text, /^Dear Priya,\nWe have a role in Thane\.\s*\n\nRegards,\nThe Guardians$/);
});

test('send now: each person gets their own email; blacklisted and no-email are skipped; bad address fails', async () => {
  const form = new FormData();
  form.append('data', JSON.stringify({ accountId: senderId, subject: 'Interview call', body: 'Dear {{first_name}}, please call us.', candidateIds: Object.values(ids) }));
  form.append('files', new Blob(['%PDF-1.4 job description']), 'JD.pdf');
  const r = await call('POST', '/api/campaigns', form);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.total, 2);
  const done = await until(async () => {
    const c = (await call('GET', '/api/campaigns/' + r.data.id)).data;
    return ['sent', 'failed'].includes(c.campaign.status) && c;
  });
  assert.ok(done, 'campaign finished');
  const by = Object.fromEntries(done.recipients.map((x) => [x.candidate_id, x]));
  assert.equal(by[ids.priya].status, 'sent');
  assert.equal(by[ids.rahul].status, 'failed');
  assert.match(by[ids.rahul].error, /does not exist/);
  assert.equal(by[ids.zoya].status, 'skipped');
  assert.equal(by[ids.zoya].error, 'Blacklisted');
  assert.equal(by[ids.noemail].status, 'skipped');
  assert.equal(done.campaign.status, 'sent');
  assert.equal(done.campaign.sent, 1);
  assert.equal(done.campaign.failed, 1);
  const events = (await call('GET', '/api/candidates/' + ids.priya)).data.events.map((e) => e.message).join(' | ');
  assert.match(events, /Email sent from hr@guardiansindia.com: "Interview call"/);
});

test('scheduled email goes out at the chosen time; a cancelled one never does', async () => {
  const at = new Date(Date.now() + 1500).toISOString();
  const form = new FormData();
  form.append('data', JSON.stringify({ accountId: senderId, subject: 'Scheduled', body: 'Hi {{first_name}}', candidateIds: [ids.priya], sendAt: at }));
  const r = (await call('POST', '/api/campaigns', form)).data;
  assert.equal((await call('GET', '/api/campaigns/' + r.id)).data.campaign.status, 'scheduled');
  const sent = await until(async () => (await call('GET', '/api/campaigns/' + r.id)).data.campaign.status === 'sent');
  assert.ok(sent, 'sent at the scheduled time');
  const sentAt = (await call('GET', '/api/campaigns/' + r.id)).data.recipients[0].sent_at;
  assert.ok(Date.parse(sentAt) >= Date.parse(at) - 50, 'not before the chosen time');

  const later = new FormData();
  later.append('data', JSON.stringify({ accountId: senderId, subject: 'Later', body: 'x', candidateIds: [ids.priya], sendAt: new Date(Date.now() + 3600e3).toISOString() }));
  const c = (await call('POST', '/api/campaigns', later)).data;
  assert.equal((await call('POST', '/api/campaigns/' + c.id + '/cancel')).status, 200);
  const after = (await call('GET', '/api/campaigns/' + c.id)).data;
  assert.equal(after.campaign.status, 'cancelled');
  assert.equal(after.recipients[0].status, 'skipped');
});

test('daily limit pauses sending and says when it continues', async () => {
  const acc = (await call('GET', '/api/mail-accounts')).data.items.find((a) => a.id === senderId);
  assert.equal((await call('PUT', '/api/mail-accounts/' + senderId, { ...acc, daily_limit: 1 })).status, 200);
  const form = new FormData();
  form.append('data', JSON.stringify({ accountId: senderId, subject: 'Limit', body: 'x', candidateIds: [ids.priya] }));
  const r = (await call('POST', '/api/campaigns', form)).data;
  const c = await until(async () => {
    const x = (await call('GET', '/api/campaigns/' + r.id)).data.campaign;
    return x.note ? x : null;
  });
  assert.equal(c.status, 'scheduled');
  assert.match(c.note, /Daily limit of 1/);
  assert.equal(c.sent, 0);
});

test('a viewer cannot send email or see mailbox settings', async () => {
  await call('POST', '/api/users', { name: 'V', email: 'v@test.local', role: 'viewer', password: 'viewer-password-1' });
  const ownerCookie = cookie;
  await call('POST', '/api/login', { email: 'v@test.local', password: 'viewer-password-1' });
  assert.equal((await call('GET', '/api/mail-accounts')).status, 403);
  assert.equal((await call('POST', '/api/campaigns/preview', {})).status, 403);
  cookie = ownerCookie;
});
