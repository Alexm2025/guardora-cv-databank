'use strict';

/*
 * Mail accounts: every mailbox Guardora reads CVs from and/or sends email through.
 * Passwords (app passwords) are stored encrypted and never sent back to the browser.
 */

const { get, all, run, insert, update, now } = require('./db');
const { encryptSecret, decryptSecret } = require('./security');

const PRESETS = {
  gmail: { label: 'Gmail / Google Workspace', imap_host: 'imap.gmail.com', imap_port: 993, smtp_host: 'smtp.gmail.com', smtp_port: 465 },
  outlook: { label: 'Outlook / Microsoft 365', imap_host: 'outlook.office365.com', imap_port: 993, smtp_host: 'smtp.office365.com', smtp_port: 587 },
  zoho: { label: 'Zoho Mail (India)', imap_host: 'imap.zoho.in', imap_port: 993, smtp_host: 'smtp.zoho.in', smtp_port: 465 },
  hostinger: { label: 'Hostinger email', imap_host: 'imap.hostinger.com', imap_port: 993, smtp_host: 'smtp.hostinger.com', smtp_port: 465 },
  yahoo: { label: 'Yahoo Mail', imap_host: 'imap.mail.yahoo.com', imap_port: 993, smtp_host: 'smtp.mail.yahoo.com', smtp_port: 465 },
  rediff: { label: 'Rediffmail Pro', imap_host: 'imap.rediffmailpro.com', imap_port: 993, smtp_host: 'smtp.rediffmailpro.com', smtp_port: 465 },
  titan: { label: 'Titan (GoDaddy / Hostinger Titan)', imap_host: 'imap.titan.email', imap_port: 993, smtp_host: 'smtp.titan.email', smtp_port: 465 },
  custom: { label: 'Other (enter the servers)', imap_host: '', imap_port: 993, smtp_host: '', smtp_port: 465 }
};

// Guess the provider from the address, so most people only type their email and app password.
function guessProvider(email) {
  const domain = String(email).split('@')[1] || '';
  if (/^(gmail|googlemail)\.com$/.test(domain)) return 'gmail';
  if (/^(outlook|hotmail|live|msn)\.com$/.test(domain)) return 'outlook';
  if (/^(yahoo|ymail)\.(com|co\.in|in)$/.test(domain)) return 'yahoo';
  if (/^zoho(mail)?\.(in|com)$/.test(domain)) return 'zoho';
  if (domain === 'guardiansindia.com') return 'gmail';
  return '';
}

const PUBLIC_FIELDS = 'id, label, provider, email, imap_host, imap_port, smtp_host, smtp_port, folders, since, import_enabled, send_enabled, from_name, signature, daily_limit, created_at';

const list = () => all('SELECT ' + PUBLIC_FIELDS + ", pass_enc != '' AS has_password FROM mail_accounts ORDER BY id");

function getAccount(id, { withPassword = false } = {}) {
  const a = get('SELECT * FROM mail_accounts WHERE id = ?', Number(id));
  if (!a) return null;
  const out = { ...a, has_password: Boolean(a.pass_enc) };
  if (withPassword) out.password = decryptSecret(a.pass_enc);
  delete out.pass_enc;
  return out;
}

const str = (v, max = 300) => String(v == null ? '' : v).trim().slice(0, max);

/** Normalises what the settings form sends. Throws a readable message for anything wrong. */
function clean(input, existing = null) {
  const email = str(input.email, 160).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter the full email address of the mailbox.');
  const provider = PRESETS[input.provider] ? input.provider : guessProvider(email) || 'custom';
  const p = PRESETS[provider];
  const row = {
    label: str(input.label, 80),
    provider,
    email,
    imap_host: str(input.imap_host, 120) || p.imap_host,
    imap_port: Number(input.imap_port) || p.imap_port,
    smtp_host: str(input.smtp_host, 120) || p.smtp_host,
    smtp_port: Number(input.smtp_port) || p.smtp_port,
    folders: str(input.folders, 500) || 'INBOX',
    since: /^\d{4}-\d{2}-\d{2}$/.test(str(input.since)) ? str(input.since) : '',
    import_enabled: input.import_enabled ? 1 : 0,
    send_enabled: input.send_enabled ? 1 : 0,
    from_name: str(input.from_name, 80),
    signature: str(input.signature, 2000),
    daily_limit: Math.max(1, Math.min(5000, Number(input.daily_limit) || 400))
  };
  const password = input.password ? String(input.password).replace(/\s+/g, '') : existing ? existing.password : '';
  if ((row.import_enabled || row.send_enabled) && !password) throw new Error('Enter the app password for ' + email + '.');
  if (row.import_enabled && !row.imap_host) throw new Error('Enter the IMAP server (for reading mail).');
  if (row.send_enabled && !row.smtp_host) throw new Error('Enter the SMTP server (for sending mail).');
  return { row, password };
}

function save({ row, password }, id = null) {
  if (id) {
    update('mail_accounts', id, { ...row, pass_enc: encryptSecret(password) });
    return id;
  }
  if (get('SELECT 1 AS x FROM mail_accounts WHERE email = ?', row.email)) throw new Error(row.email + ' is already connected.');
  return insert('mail_accounts', { ...row, pass_enc: encryptSecret(password), created_at: now() });
}

function remove(id) {
  run('DELETE FROM mail_accounts WHERE id = ?', Number(id));
  run('DELETE FROM settings WHERE key LIKE ?', 'imap_state:' + Number(id) + ':%');
}

// Version 1 had one mailbox in the settings table. Turn it into account no. 1, keeping how far it had read.
function migrateLegacy() {
  if (get('SELECT 1 AS x FROM mail_accounts LIMIT 1')) return;
  const s = (k, d = '') => (get('SELECT value FROM settings WHERE key = ?', k) || { value: d }).value;
  const user = s('imap_user');
  if (!user) return;
  const id = insert('mail_accounts', {
    label: '', provider: guessProvider(user) || 'custom', email: user.toLowerCase(), imap_host: s('imap_host', 'imap.gmail.com'), imap_port: Number(s('imap_port', '993')) || 993,
    smtp_host: s('imap_host', '') === 'imap.gmail.com' ? 'smtp.gmail.com' : '', smtp_port: 465, pass_enc: s('imap_pass'), folders: s('imap_mailboxes', 'INBOX'),
    since: s('imap_since'), import_enabled: s('imap_enabled', '0') === '1' ? 1 : 0, send_enabled: 0, from_name: '', signature: '', daily_limit: 400, created_at: now()
  });
  for (const r of all("SELECT key, value FROM settings WHERE key LIKE 'imap_state:%'")) {
    if (/^imap_state:\d+:/.test(r.key)) continue;
    run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', 'imap_state:' + id + ':' + r.key.slice('imap_state:'.length), r.value);
    run('DELETE FROM settings WHERE key = ?', r.key);
  }
  run("DELETE FROM settings WHERE key IN ('imap_enabled','imap_host','imap_port','imap_user','imap_pass','imap_mailboxes','imap_since')");
}
migrateLegacy();

module.exports = { PRESETS, guessProvider, list, getAccount, clean, save, remove, migrateLegacy };
