'use strict';

/* Sends email through a connected mail account's own SMTP server (for Gmail: smtp.gmail.com with the app password). */

const nodemailer = require('nodemailer');
const { get, insert, now } = require('./db');

// Tests run with GUARDORA_MAIL_TRANSPORT=json: nothing leaves the machine, messages are kept in `outbox`.
const TEST_MODE = process.env.GUARDORA_MAIL_TRANSPORT === 'json';
const outbox = [];
const transports = new Map(); // account id -> { key, transport }

function transportFor(account) {
  if (TEST_MODE) return nodemailer.createTransport({ jsonTransport: true });
  const key = [account.smtp_host, account.smtp_port, account.email, account.password].join('|');
  const cached = transports.get(account.id);
  if (cached && cached.key === key) return cached.transport;
  if (cached) cached.transport.close();
  const transport = nodemailer.createTransport({
    host: account.smtp_host, port: account.smtp_port, secure: account.smtp_port === 465, requireTLS: account.smtp_port === 587,
    auth: { user: account.email, pass: account.password }, pool: true, maxConnections: 1,
    connectionTimeout: 30000, greetingTimeout: 30000, socketTimeout: 60000
  });
  transports.set(account.id, { key, transport });
  return transport;
}

async function verifySmtp(account) {
  if (TEST_MODE) return { ok: true };
  try {
    await nodemailer.createTransport({
      host: account.smtp_host, port: account.smtp_port, secure: account.smtp_port === 465, requireTLS: account.smtp_port === 587,
      auth: { user: account.email, pass: account.password }, connectionTimeout: 20000
    }).verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.response || err.message };
  }
}

const sentToday = (accountId) => get('SELECT COUNT(*) AS n FROM mail_sent_log WHERE account_id = ? AND sent_at >= ?', accountId, new Date(Date.now() - 864e5).toISOString()).n;

/** Sends one email. Throws with .permanent = true when retrying cannot help (bad address, rejected). */
async function send(account, { to, toName, subject, text, html, attachments = [] }) {
  const message = {
    from: { name: account.from_name || account.label || '', address: account.email },
    to: toName ? { name: toName, address: to } : to,
    replyTo: account.email,
    subject, text, html, attachments
  };
  if (TEST_MODE && /^fail/.test(to)) throw Object.assign(new Error('550 5.1.1 The email account that you tried to reach does not exist.'), { responseCode: 550, permanent: true });
  try {
    const info = await transportFor(account).sendMail(message);
    insert('mail_sent_log', { account_id: account.id, sent_at: now() });
    if (TEST_MODE) outbox.push({ ...message, attachments: attachments.map((a) => a.filename) });
    return info.messageId || '';
  } catch (err) {
    const code = Number(err.responseCode) || 0;
    err.permanent = code >= 500 && code !== 554 && !/rate|limit|try again|temporar/i.test(err.message);
    err.auth = err.code === 'EAUTH' || code === 535 || code === 534;
    throw err;
  }
}

function closeAll() {
  for (const { transport } of transports.values()) transport.close();
  transports.clear();
}

module.exports = { send, verifySmtp, sentToday, outbox, closeAll, TEST_MODE };
