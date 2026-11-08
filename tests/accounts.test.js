'use strict';

/* Upgrading from one mailbox in Settings (version 1) to the list of mailboxes keeps everything. */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'guardora-acc-'));
process.env.DATA_DIR = DATA;
process.env.MASTER_KEY = '88'.repeat(32);

const { run, get, all } = require('../server/db');
const { encryptSecret } = require('../server/security');

test('the old hr@ mailbox becomes account 1 with its password and reading position', () => {
  const set = (k, v) => run('INSERT INTO settings (key, value) VALUES (?, ?)', k, v);
  set('imap_enabled', '1');
  set('imap_host', 'imap.gmail.com');
  set('imap_port', '993');
  set('imap_user', 'HR@guardiansindia.com');
  set('imap_pass', encryptSecret('abcdefghijklmnop'));
  set('imap_mailboxes', 'INBOX, [Gmail]/All Mail');
  set('imap_state:INBOX', JSON.stringify({ uidValidity: '7', lastUid: 4321 }));

  const accounts = require('../server/accounts'); // migrates on load
  const list = accounts.list();
  assert.equal(list.length, 1);
  const a = accounts.getAccount(list[0].id, { withPassword: true });
  assert.equal(a.email, 'hr@guardiansindia.com');
  assert.equal(a.password, 'abcdefghijklmnop');
  assert.equal(a.import_enabled, 1);
  assert.equal(a.folders, 'INBOX, [Gmail]/All Mail');
  assert.equal(a.smtp_host, 'smtp.gmail.com');
  assert.deepEqual(JSON.parse(get('SELECT value FROM settings WHERE key = ?', 'imap_state:' + a.id + ':INBOX').value), { uidValidity: '7', lastUid: 4321 });
  assert.equal(all("SELECT key FROM settings WHERE key LIKE 'imap_%' AND key NOT LIKE 'imap_state:%:%'").length, 0, 'old settings removed');

  accounts.migrateLegacy(); // running again changes nothing
  assert.equal(accounts.list().length, 1);
});

test('provider is guessed from the address', () => {
  const { guessProvider, clean } = require('../server/accounts');
  assert.equal(guessProvider('someone@gmail.com'), 'gmail');
  assert.equal(guessProvider('someone@outlook.com'), 'outlook');
  assert.equal(guessProvider('careers@guardiansindia.com'), 'gmail');
  const { row } = clean({ email: 'Jobs@Zoho.in', password: 'x', import_enabled: true });
  assert.equal(row.imap_host, 'imap.zoho.in');
  assert.equal(row.email, 'jobs@zoho.in');
  assert.throws(() => clean({ email: 'nobody', password: 'x' }), /full email address/);
});

test.after(() => {
  require('../server/db').db.close();
  fs.rmSync(DATA, { recursive: true, force: true });
});
