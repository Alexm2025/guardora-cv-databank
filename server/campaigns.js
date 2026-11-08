'use strict';

/*
 * Bulk email to selected candidates: written once, sent to each person separately (nobody sees the other
 * addresses), now or at a chosen time. Personal fields like {{first_name}} are filled in per person.
 * Respects each mailbox's daily limit, retries temporary failures, and carries on after a restart.
 */

const { get, all, run, tx, insert, now } = require('./db');
const vault = require('./vault');
const accounts = require('./accounts');
const mailer = require('./mailer');
const { addEvent, parseJson } = require('./ingest');

const TICK_MS = Number(process.env.CAMPAIGN_TICK_MS) || 20000;
const GAP_MS = process.env.CAMPAIGN_GAP_MS !== undefined ? Number(process.env.CAMPAIGN_GAP_MS) : 1500;
const MAX_ATTEMPTS = 3;

const FIELDS = {
  first_name: (c) => String(c.name || '').trim().split(/\s+/)[0] || '',
  name: (c) => c.name || '',
  applied_for: (c) => c.applied_for || '',
  current_title: (c) => c.current_title || '',
  current_company: (c) => c.current_company || '',
  city: (c) => c.city || '',
  area: (c) => c.area || c.city || '',
  experience: (c) => (c.experience_years == null ? '' : c.experience_years + ' years')
};

// "Dear {{first_name}}," -> "Dear Priya,". Unknown fields become empty, never left as {{…}}.
function render(template, candidate) {
  return String(template || '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, key) => {
    const f = FIELDS[key.toLowerCase()];
    return f ? f(candidate) : '';
  }).replace(/[ \t]+([,.!?])/g, '$1');
}

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function htmlBody(text) {
  return '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#1f2b26">' +
    escapeHtml(text).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>').replace(/\n/g, '<br>') + '</div>';
}

function compose(campaign, account, candidate) {
  const body = render(campaign.body, candidate) + (account.signature ? '\n\n' + account.signature : '');
  return { subject: render(campaign.subject, candidate).replace(/\s+/g, ' ').trim(), text: body, html: htmlBody(body) };
}

/* ---------- Create ---------- */

function create({ accountId, subject, body, candidateIds, sendAt, attachments = [], userId }) {
  const account = accounts.getAccount(accountId);
  if (!account || !account.send_enabled) throw new Error('Choose a mailbox that is set up for sending (Settings → Mailboxes).');
  subject = String(subject || '').trim().slice(0, 250);
  body = String(body || '').trim().slice(0, 20000);
  if (!subject) throw new Error('Write a subject.');
  if (!body) throw new Error('Write the message.');
  const when = sendAt ? new Date(sendAt) : new Date();
  if (Number.isNaN(when.getTime())) throw new Error('The send time is not valid.');
  if (when.getTime() > Date.now() + 366 * 864e5) throw new Error('Choose a time within the next year.');
  const ids = [...new Set((candidateIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 2000);
  if (!ids.length) throw new Error('Choose at least one candidate.');

  return tx(() => {
    const id = insert('campaigns', {
      account_id: account.id, subject, body, attachments: JSON.stringify(attachments), status: 'scheduled',
      send_at: (when.getTime() < Date.now() ? new Date() : when).toISOString(), created_by: userId || null, created_at: now()
    });
    const seen = new Set();
    let total = 0;
    for (const cid of ids) {
      const c = get('SELECT id, name, email, blacklisted FROM candidates WHERE id = ?', cid);
      if (!c) continue;
      const email = String(c.email || '').toLowerCase();
      let status = 'pending';
      let error = '';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { status = 'skipped'; error = 'No email address'; }
      else if (c.blacklisted) { status = 'skipped'; error = 'Blacklisted'; }
      else if (seen.has(email)) { status = 'skipped'; error = 'Same email as another person in this list'; }
      seen.add(email);
      if (status === 'pending') total++;
      insert('campaign_recipients', { campaign_id: id, candidate_id: c.id, email, name: c.name, status, error });
    }
    if (!total) throw new Error('None of the chosen candidates can be emailed (no email address, or blacklisted).');
    run('UPDATE campaigns SET total = ? WHERE id = ?', total, id);
    return id;
  });
}

/* ---------- Send (scheduler) ---------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ticking = false;
let timer = null;

async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const due = all("SELECT * FROM campaigns WHERE (status = 'scheduled' AND send_at <= ?) OR status = 'sending' ORDER BY send_at", now());
    for (const c of due) await sendCampaign(c);
  } catch (err) {
    console.error('[campaigns]', err);
  } finally {
    ticking = false;
  }
}

function finishIfDone(id) {
  const left = get("SELECT COUNT(*) AS n FROM campaign_recipients WHERE campaign_id = ? AND status = 'pending'", id).n;
  if (left) return false;
  const c = get('SELECT sent, failed FROM campaigns WHERE id = ?', id);
  run('UPDATE campaigns SET status = ?, finished_at = ? WHERE id = ? AND status = \'sending\'', c.sent === 0 && c.failed > 0 ? 'failed' : 'sent', now(), id);
  return true;
}

async function sendCampaign(campaign) {
  const account = accounts.getAccount(campaign.account_id, { withPassword: true });
  if (!account || !account.send_enabled) {
    run("UPDATE campaigns SET status = 'failed', note = 'The sending mailbox was removed or sending was turned off.', finished_at = ? WHERE id = ?", now(), campaign.id);
    return;
  }
  run("UPDATE campaigns SET status = 'sending', started_at = COALESCE(started_at, ?), note = '' WHERE id = ? AND status IN ('scheduled', 'sending')", now(), campaign.id);
  const files = parseJson(campaign.attachments, []).map((a) => ({ filename: a.name, content: vault.read(a.sha), contentType: a.mime }));

  for (;;) {
    const state = get('SELECT status FROM campaigns WHERE id = ?', campaign.id);
    if (!state || state.status !== 'sending') return; // cancelled meanwhile
    const r = get("SELECT * FROM campaign_recipients WHERE campaign_id = ? AND status = 'pending' AND attempts < ? ORDER BY id LIMIT 1", campaign.id, MAX_ATTEMPTS);
    if (!r) break;

    if (mailer.sentToday(account.id) >= account.daily_limit) {
      const oldest = get('SELECT sent_at FROM mail_sent_log WHERE account_id = ? AND sent_at >= ? ORDER BY sent_at LIMIT 1', account.id, new Date(Date.now() - 864e5).toISOString());
      const resume = new Date(Date.parse(oldest ? oldest.sent_at : now()) + 864e5 + 60e3).toISOString();
      run("UPDATE campaigns SET status = 'scheduled', send_at = ?, note = ? WHERE id = ?", resume, 'Daily limit of ' + account.daily_limit + ' emails from ' + account.email + ' reached; the rest go out automatically from ' + resume + '.', campaign.id);
      return;
    }

    const c = (r.candidate_id && get('SELECT * FROM candidates WHERE id = ?', r.candidate_id)) || { name: r.name };
    const mail = compose(campaign, account, c);
    try {
      await mailer.send(account, { to: r.email, toName: r.name, ...mail, attachments: files });
      tx(() => {
        run("UPDATE campaign_recipients SET status = 'sent', sent_at = ?, attempts = attempts + 1, error = '' WHERE id = ?", now(), r.id);
        run('UPDATE campaigns SET sent = sent + 1 WHERE id = ?', campaign.id);
        if (r.candidate_id) addEvent(r.candidate_id, 'email', 'Email sent from ' + account.email + ': "' + mail.subject + '"', campaign.created_by);
      });
    } catch (err) {
      if (err.auth) {
        run("UPDATE campaign_recipients SET attempts = attempts + 1, error = ? WHERE id = ?", String(err.message).slice(0, 300), r.id);
        run("UPDATE campaigns SET status = 'scheduled', send_at = ?, note = ? WHERE id = ?", new Date(Date.now() + 30 * 60e3).toISOString(),
          'Could not sign in to ' + account.email + ' to send. Check its app password in Settings → Mailboxes; retrying in 30 minutes.', campaign.id);
        return;
      }
      const attempts = r.attempts + 1;
      const final = err.permanent || attempts >= MAX_ATTEMPTS;
      tx(() => {
        run('UPDATE campaign_recipients SET attempts = ?, status = ?, error = ? WHERE id = ?', attempts, final ? 'failed' : 'pending', String(err.message).slice(0, 300), r.id);
        if (final) run('UPDATE campaigns SET failed = failed + 1 WHERE id = ?', campaign.id);
      });
      if (!final) {
        // Temporary problem (network, server busy): try the rest later.
        run("UPDATE campaigns SET status = 'scheduled', send_at = ?, note = ? WHERE id = ?", new Date(Date.now() + 5 * 60e3).toISOString(), 'Temporary sending problem; retrying in 5 minutes.', campaign.id);
        return;
      }
    }
    if (GAP_MS) await sleep(GAP_MS);
  }
  finishIfDone(campaign.id);
}

function cancel(id) {
  return tx(() => {
    const c = get('SELECT status FROM campaigns WHERE id = ?', id);
    if (!c || !['scheduled', 'sending'].includes(c.status)) return false;
    run("UPDATE campaigns SET status = 'cancelled', finished_at = ? WHERE id = ?", now(), id);
    run("UPDATE campaign_recipients SET status = 'skipped', error = 'Cancelled' WHERE campaign_id = ? AND status = 'pending'", id);
    return true;
  });
}

function sendNow(id) {
  run("UPDATE campaigns SET send_at = ?, note = '' WHERE id = ? AND status = 'scheduled'", now(), id);
  setImmediate(tick);
}

function start() {
  if (timer) return;
  timer = setInterval(tick, TICK_MS);
  timer.unref();
  setTimeout(tick, 2000).unref();
}

function stop() {
  clearInterval(timer);
  timer = null;
}

module.exports = { create, cancel, sendNow, tick, start, stop, render, compose, FIELDS };
