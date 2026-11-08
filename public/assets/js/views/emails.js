// Emails sent to candidates: scheduled, sending, sent; who received each one and who could not be reached.

import { h, clear, icon, toast, modal, confirmBox, fmtDate, ago } from '../ui.js';
import { api } from '../api.js';

const STATE = { scheduled: ['Scheduled', 'info'], sending: ['Sending…', 'gold'], sent: ['Sent', 'ok'], cancelled: ['Cancelled', 'neutral'], failed: ['Failed', 'bad'] };
const PERSON = { pending: ['Waiting', 'info'], sent: ['Sent', 'ok'], failed: ['Failed', 'bad'], skipped: ['Skipped', 'neutral'] };

export async function render(main, ctx) {
  const canEdit = ctx.user.role !== 'viewer';
  const box = h('div', { class: 'stack' });
  clear(main, h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', { class: 'grow' }, h('h1', {}, 'Emails'),
      h('p', {}, 'Emails to candidates, written once and sent to each person separately. To write one, tick candidates in the databank and press "Email".')),
    h('a', { class: 'btn primary', href: '/candidates', 'data-link': '' }, icon('users'), 'Choose candidates')),
    box));

  let timer = null;
  async function load() {
    const r = await api('/campaigns');
    if (!r.items.length) {
      clear(box, h('div', { class: 'card' }, h('div', { class: 'empty' }, icon('mail'), h('h3', {}, 'No emails yet'),
        h('p', {}, 'In Candidates, tick the people you want to write to and press "Email". You can send now or schedule it.'))));
      return;
    }
    clear(box, r.items.map((c) => {
      const [label, tone] = STATE[c.status] || [c.status, 'neutral'];
      const done = c.sent + c.failed;
      return h('div', { class: 'card pad stack', style: { gap: '8px' } },
        h('div', { class: 'row wrap' },
          h('div', { class: 'grow' }, h('h3', { style: { fontSize: '16px' } }, c.subject),
            h('div', { class: 'small muted' }, 'From ' + (c.from_email || 'a removed mailbox') + ' · ' + (c.status === 'scheduled' ? 'goes out ' + fmtDate(c.send_at, true) : c.finished_at ? 'finished ' + ago(c.finished_at) : 'started ' + ago(c.started_at || c.created_at)) +
              (c.created_by_name ? ' · by ' + c.created_by_name : '') + (c.attachments.length ? ' · ' + c.attachments.length + ' attachment' + (c.attachments.length > 1 ? 's' : '') : ''))),
          h('span', { class: 'pill ' + tone }, c.status === 'scheduled' ? icon('clock', 'sm') : null, label)),
        h('div', { class: 'row wrap small' },
          h('span', {}, h('b', {}, c.sent), ' of ', c.total, ' sent'),
          c.failed ? h('span', { class: 'pill bad' }, c.failed + ' failed') : null,
          c.skipped ? h('span', { class: 'pill neutral', title: 'No email address, blacklisted, or the same address twice' }, c.skipped + ' skipped') : null),
        c.total ? h('div', { class: 'progress' }, h('div', { style: { width: Math.round((done / c.total) * 100) + '%' } })) : null,
        c.note ? h('div', { class: 'banner warn' }, icon('alert'), c.note) : null,
        h('div', { class: 'row wrap' },
          h('button', { class: 'btn sm', onclick: () => showRecipients(c.id) }, 'Who got it'),
          canEdit && c.status === 'scheduled' ? h('button', { class: 'btn sm', onclick: async () => { await api('/campaigns/' + c.id + '/send-now', { method: 'POST' }); toast('Sending now'); setTimeout(load, 800); } }, icon('send', 'sm'), 'Send now') : null,
          h('span', { class: 'spacer' }),
          canEdit && ['scheduled', 'sending'].includes(c.status) ? h('button', { class: 'btn sm danger', onclick: async () => {
            if (!await confirmBox('Cancel this email?', 'People who have not received it yet will not get it.', { label: 'Cancel email', kind: 'danger' })) return;
            await api('/campaigns/' + c.id + '/cancel', { method: 'POST' });
            toast('Cancelled');
            load();
          } }, 'Cancel') : null));
    }));
    clearTimeout(timer);
    if (r.items.some((c) => ['scheduled', 'sending'].includes(c.status))) timer = setTimeout(() => load().catch(() => {}), 4000);
  }

  async function showRecipients(id) {
    const r = await api('/campaigns/' + id);
    modal({
      title: r.campaign.subject, wide: true,
      body: [
        h('div', { class: 'paper', style: { width: '100%', padding: '14px 16px', fontSize: '13px', boxShadow: 'none', border: '1px solid var(--line)', maxHeight: '180px', overflow: 'auto' } }, r.campaign.body),
        h('div', { style: { overflowX: 'auto' } }, h('table', { class: 'log' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Candidate'), h('th', {}, 'Email'), h('th', {}, 'Status'), h('th', {}, ''))),
          h('tbody', {}, r.recipients.map((p) => h('tr', {},
            h('td', {}, p.candidate_id ? h('a', { href: '/candidates/' + p.candidate_id, 'data-link': '' }, p.name || '#' + p.candidate_id) : p.name),
            h('td', { class: 'small' }, p.email || '—'),
            h('td', {}, h('span', { class: 'pill ' + PERSON[p.status][1] }, PERSON[p.status][0])),
            h('td', { class: 'small muted' }, p.status === 'sent' ? fmtDate(p.sent_at, true) : p.error))))))
      ],
      actions: [{ label: 'Close', kind: 'primary' }]
    });
  }

  await load().catch((err) => clear(box, h('div', { class: 'banner bad' }, err.message)));
  return { cleanup: () => clearTimeout(timer) };
}
