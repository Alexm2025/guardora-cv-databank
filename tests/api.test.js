'use strict';

/* Security and API tests against a real server process on a throwaway data folder: node --test tests/ */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.MASTER_KEY = '22'.repeat(32);
const { totpAt } = require('../server/security');
const { makePdf } = require('./fixtures');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'guardora-api-'));
const PORT = 8799;
const BASE = 'http://localhost:' + PORT;
let server;

const jar = () => ({ cookie: '' });
async function call(c, method, url, body, extra = {}) {
  const headers = { Accept: 'application/json', ...(c && c.cookie ? { Cookie: c.cookie } : {}), ...(extra.headers || {}) };
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(BASE + url, { method, headers, body: payload });
  const set = res.headers.getSetCookie();
  const session = set.map((s) => s.split(';')[0]).find((s) => s.startsWith('gd_session='));
  if (c && session) c.cookie = session.endsWith('=') ? '' : session;
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
  return { status: res.status, data, headers: res.headers };
}

const owner = jar();
const viewer = jar();
let candidateId;
let cvId;
const PDF = makePdf(['Zoya Fernandes', 'zoya.f@example.org', '+91 90000 12345', 'Location: Goa', 'Experience', 'Front Office Executive - Taj Hotels Ltd   Jan 2021 - Present',
  'Education', 'BHM - IHM Goa - 2020 - 71%', 'Skills: Front Office, Hospitality, Customer Service', 'Date of Birth: 03/03/1998', 'Gender: Female']);

test.before(async () => {
  server = spawn(process.execPath, ['server/index.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DATA_DIR: DATA, PORT: String(PORT), DISABLE_SOURCES: '1', TRUST_PROXY: '1', SETUP_CODE: 'TESTSETUP9', MASTER_KEY: '33'.repeat(32), NODE_ENV: 'test' },
    stdio: 'ignore'
  });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(BASE + '/healthz')).ok) return;
    } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('server did not start');
});

test.after(() => {
  server.kill();
  setTimeout(() => fs.rmSync(DATA, { recursive: true, force: true }), 500);
});

test('first start needs the setup code', async () => {
  assert.equal((await call(null, 'GET', '/api/session')).data.setupNeeded, true);
  const bad = await call(owner, 'POST', '/api/setup', { name: 'Owner', email: 'owner@test.local', password: 'a-long-password-1', setupCode: 'WRONG' });
  assert.equal(bad.status, 403);
  const ok = await call(owner, 'POST', '/api/setup', { name: 'Owner', email: 'owner@test.local', password: 'a-long-password-1', setupCode: 'test-setup9' });
  assert.equal(ok.status, 200);
  assert.ok(owner.cookie);
  const again = await call(null, 'POST', '/api/setup', { name: 'X', email: 'x@test.local', password: 'a-long-password-2', setupCode: 'TESTSETUP9' });
  assert.equal(again.status, 409);
});

test('signed-out requests and cross-site requests are refused; headers are set', async () => {
  assert.equal((await call(null, 'GET', '/api/candidates')).status, 401);
  assert.equal((await call(null, 'GET', '/api/cvs/1/file')).status, 401);
  const cross = await call(owner, 'POST', '/api/logout', {}, { headers: { Origin: 'https://evil.example' } });
  assert.equal(cross.status, 403);
  const page = await fetch(BASE + '/');
  assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(page.headers.get('x-frame-options'), 'DENY');
  assert.equal(page.headers.get('x-robots-tag'), 'noindex, nofollow');
});

test('upload, search, view the CV; the stored file is encrypted', async () => {
  const form = new FormData();
  form.append('files', new Blob([PDF], { type: 'application/pdf' }), 'Zoya CV.pdf');
  const up = await call(owner, 'POST', '/api/upload', form);
  assert.equal(up.status, 200);
  assert.equal(up.data.results[0].outcome, 'added');
  candidateId = up.data.results[0].candidateId;
  cvId = up.data.results[0].cvId;

  const found = await call(owner, 'GET', '/api/candidates?q=hospitality&city=Goa&gender=female&ageMin=20&ageMax=35');
  assert.equal(found.data.total, 1);
  assert.equal(found.data.items[0].name, 'Zoya Fernandes');

  const file = await call(owner, 'GET', '/api/cvs/' + cvId + '/file');
  assert.equal(file.status, 200);
  assert.ok(Buffer.compare(file.data, PDF) === 0, 'downloaded file is identical to the upload');

  const vaultDir = path.join(DATA, 'vault');
  const stored = fs.readdirSync(vaultDir).flatMap((d) => fs.readdirSync(path.join(vaultDir, d)).map((f) => fs.readFileSync(path.join(vaultDir, d, f))));
  assert.ok(stored.length && stored.every((b) => !b.includes(Buffer.from('%PDF')) && !b.includes(Buffer.from('Zoya'))));
});

test('a viewer can read but not change anything', async () => {
  const add = await call(owner, 'POST', '/api/users', { name: 'Viewer', email: 'viewer@test.local', role: 'viewer', password: 'viewer-password-1' });
  assert.equal(add.status, 200);
  assert.equal((await call(viewer, 'POST', '/api/login', { email: 'viewer@test.local', password: 'viewer-password-1' })).status, 200);
  assert.equal((await call(viewer, 'GET', '/api/candidates/' + candidateId)).status, 200);
  assert.equal((await call(viewer, 'POST', '/api/candidates/' + candidateId + '/done', { done: true })).status, 403);
  assert.equal((await call(viewer, 'POST', '/api/candidates/' + candidateId + '/blacklist', { blacklisted: true, reason: 'x' })).status, 403);
  assert.equal((await call(viewer, 'GET', '/api/settings')).status, 403);
  assert.equal((await call(viewer, 'GET', '/api/export.csv')).status, 403);
  assert.equal((await call(viewer, 'DELETE', '/api/candidates/' + candidateId)).status, 403);
});

test('done tick, blacklist with reason, and export guards against spreadsheet formulas', async () => {
  assert.equal((await call(owner, 'POST', '/api/candidates/' + candidateId + '/done', { done: true })).status, 200);
  assert.equal((await call(owner, 'POST', '/api/candidates/' + candidateId + '/blacklist', { blacklisted: true })).status, 400);
  assert.equal((await call(owner, 'POST', '/api/candidates/' + candidateId + '/blacklist', { blacklisted: true, reason: 'No-show twice' })).status, 200);
  const c = (await call(owner, 'GET', '/api/candidates/' + candidateId)).data.candidate;
  assert.equal(c.done, 1);
  assert.equal(c.blacklisted, 1);
  await call(owner, 'PATCH', '/api/candidates/' + candidateId, { current_title: '=HYPERLINK("http://evil")' });
  const csv = (await call(owner, 'GET', '/api/export.csv')).data.toString('utf8');
  assert.ok(csv.includes('"\'=HYPERLINK(""http://evil"")"'), 'formula is neutralised');
});

test('two-step sign-in', async () => {
  const setup = await call(owner, 'POST', '/api/account/2fa/setup');
  const secret = setup.data.secret;
  const code = () => totpAt(secret, Math.floor(Date.now() / 30000));
  assert.equal((await call(owner, 'POST', '/api/account/2fa/enable', { code: '000000' })).status, 400);
  assert.equal((await call(owner, 'POST', '/api/account/2fa/enable', { code: code() })).status, 200);
  await call(owner, 'POST', '/api/logout');
  const first = await call(owner, 'POST', '/api/login', { email: 'owner@test.local', password: 'a-long-password-1' });
  assert.equal(first.data.twoFactor, true);
  assert.equal((await call(owner, 'GET', '/api/candidates')).status, 401, 'password alone does not open the bank');
  assert.equal((await call(owner, 'POST', '/api/login/2fa', { code: '123456' })).status, 401);
  assert.equal((await call(owner, 'POST', '/api/login/2fa', { code: code() })).status, 200);
  assert.equal((await call(owner, 'GET', '/api/candidates')).status, 200);
});

test('account locks after repeated wrong passwords', async () => {
  const x = jar();
  for (let i = 0; i < 6; i++) assert.equal((await call(x, 'POST', '/api/login', { email: 'viewer@test.local', password: 'wrong-' + i })).status, 401);
  assert.equal((await call(x, 'POST', '/api/login', { email: 'viewer@test.local', password: 'viewer-password-1' })).status, 429);
});

test('shortlists shared with a company never contain contact details', async () => {
  const lines = fs.readFileSync(path.join(__dirname, 'fixtures', 'cv-contacts.txt'), 'utf8').split(/\r?\n/);
  const form = new FormData();
  form.append('files', new Blob([makePdf(lines)], { type: 'application/pdf' }), 'Priya CV.pdf');
  const up = await call(owner, 'POST', '/api/upload', form);
  const priya = up.data.results[0].candidateId;

  assert.equal((await call(viewer, 'POST', '/api/shares', { company: 'X', candidateIds: [priya] })).status, 403);
  const made = await call(owner, 'POST', '/api/shares', { company: 'ABC Logistics', title: 'Accounts', candidateIds: [priya, candidateId], pin: '4321', options: { nameMode: 'initials' } });
  assert.equal(made.status, 200);
  const token = made.data.link.split('/s/')[1];
  const company = jar();

  assert.equal((await fetch(BASE + '/s/' + token)).status, 200);
  const noPin = await call(company, 'GET', '/api/public/shares/' + token);
  assert.equal(noPin.status, 401);
  assert.equal(noPin.data.pinRequired, true);
  assert.equal((await call(company, 'GET', '/api/public/shares/' + token, undefined, { headers: { 'X-Share-Pin': '1111' } })).status, 401);
  const seen = await call(company, 'GET', '/api/public/shares/' + token, undefined, { headers: { 'X-Share-Pin': '4321' } });
  assert.equal(seen.status, 200);
  assert.equal(seen.data.candidates.length, 2);
  const p = seen.data.candidates.find((c) => c.cv.includes('Accounts'));
  assert.equal(p.name, 'Priya S.');
  const json = JSON.stringify(seen.data);
  for (const secret of ['98765', '43210', '9123456780', 'priya.sharma92', 'linkedin', 'Sharma', 'Ramesh', '1996', 'ABCDE1234F', '1234 5678 9012', '421201', 'Mahindra', 'zoya.f@', '90000 12345']) {
    assert.ok(!json.includes(secret), 'company must not see "' + secret + '"');
  }

  // The team's own preview does not count as a company view.
  await call(owner, 'GET', '/api/public/shares/' + token);
  const list = (await call(owner, 'GET', '/api/shares')).data.items[0];
  assert.equal(list.views, 1);

  const fb = await call(company, 'POST', '/api/public/shares/' + token + '/feedback', { code: p.code, feedback: 'interested', note: 'Tuesday 11am' }, { headers: { 'X-Share-Pin': '4321' } });
  assert.equal(fb.status, 200);
  const after = (await call(owner, 'GET', '/api/shares')).data.items[0];
  assert.equal(after.feedback.interested, 1);
  const history = (await call(owner, 'GET', '/api/candidates/' + priya)).data.events.map((e) => e.message).join(' | ');
  assert.match(history, /ABC Logistics: Interested — "Tuesday 11am"/);

  await call(owner, 'POST', '/api/shares/' + list.id, { revoked: true });
  assert.equal((await call(company, 'GET', '/api/public/shares/' + token, undefined, { headers: { 'X-Share-Pin': '4321' } })).status, 410);
  assert.equal((await call(company, 'GET', '/api/public/shares/not-a-real-token-at-all-123')).status, 404);
});

test('owner can erase a person completely', async () => {
  const vaultDir = path.join(DATA, 'vault');
  const files = () => fs.readdirSync(vaultDir).flatMap((d) => fs.readdirSync(path.join(vaultDir, d)));
  const before = files().length;
  assert.equal((await call(owner, 'DELETE', '/api/candidates/' + candidateId)).status, 200);
  assert.equal((await call(owner, 'GET', '/api/candidates/' + candidateId)).status, 404);
  assert.equal((await call(owner, 'GET', '/api/cvs/' + cvId + '/file')).status, 404);
  assert.equal(files().length, before - 1, 'their CV file is removed from the vault');
});
