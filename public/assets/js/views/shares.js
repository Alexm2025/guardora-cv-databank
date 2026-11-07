// Shortlists sent to client companies: what was shared, whether they opened it, and what they answered.

import { h, clear, icon, toast, fmtDate, ago, confirmBox } from '../ui.js';
import { api } from '../api.js';
import { showResult } from './share-dialog.js';

const FEEDBACK = { interested: ['Interested', 'ok'], maybe: ['Maybe', 'warn'], not_suitable: ['Not suitable', 'bad'] };

export async function render(main, ctx) {
  const canEdit = ctx.user.role !== 'viewer';
  const box = h('div', { class: 'stack' });
  clear(main, h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', { class: 'grow' }, h('h1', {}, 'Shortlists'),
      h('p', {}, 'Candidates you shared with companies, without their contact details. To share, tick candidates in the databank and choose "Share with company".')),
    h('a', { class: 'btn primary', href: '/candidates', 'data-link': '' }, icon('users'), 'Choose candidates')),
    box));

  async function load() {
    const r = await api('/shares');
    if (!r.items.length) {
      clear(box, h('div', { class: 'card' }, h('div', { class: 'empty' }, icon('send'), h('h3', {}, 'No shortlists yet'),
        h('p', {}, 'In Candidates, tick the people you want to propose and press "Share with company".'))));
      return;
    }
    clear(box, r.items.map((s) => {
      const expired = s.expires_at < new Date().toISOString();
      const state = s.revoked ? ['Withdrawn', 'neutral'] : expired ? ['Expired', 'neutral'] : ['Active', 'ok'];
      return h('div', { class: 'card pad stack', style: { gap: '10px' } },
        h('div', { class: 'row wrap' },
          h('div', { class: 'grow' }, h('h3', { style: { fontSize: '17px' } }, s.company + (s.title ? ' — ' + s.title : '')),
            h('div', { class: 'small muted' }, s.total + ' candidate' + (s.total === 1 ? '' : 's') + ' · shared ' + fmtDate(s.created_at) + (s.created_by_name ? ' by ' + s.created_by_name : '') +
              ' · ' + (s.revoked ? 'withdrawn' : (expired ? 'expired ' : 'valid until ') + fmtDate(s.expires_at)) + (s.hasPin ? ' · PIN' : ''))),
          h('span', { class: 'pill ' + state[1] }, state[0]),
          h('span', { class: 'pill info', title: s.last_viewed_at ? 'Last opened ' + fmtDate(s.last_viewed_at, true) : 'Not opened yet' }, icon('external', 'sm'), s.views ? 'Opened ' + s.views + '× · ' + ago(s.last_viewed_at) : 'Not opened yet'),
          Object.entries(s.feedback).map(([k, n]) => h('span', { class: 'pill ' + FEEDBACK[k][1] }, n + ' ' + FEEDBACK[k][0].toLowerCase()))),
        h('div', { class: 'row wrap' }, s.candidates.map((c) => h('a', { href: '/candidates/' + c.id, 'data-link': '', class: 'chip' + (c.feedback === 'interested' ? ' hit' : ''),
          title: c.feedback ? FEEDBACK[c.feedback][0] + (c.feedback_note ? ': ' + c.feedback_note : '') : 'No answer yet' },
        c.name || '#' + c.id, c.feedback ? ' · ' + FEEDBACK[c.feedback][0] : ''))),
        s.candidates.some((c) => c.feedback_note) ? h('div', { class: 'small' }, s.candidates.filter((c) => c.feedback_note).map((c) => h('div', {}, h('b', {}, (c.name || '#' + c.id) + ': '), c.feedback_note))) : null,
        h('div', { class: 'row wrap' },
          h('a', { class: 'btn sm', href: s.link + '?print=1', target: '_blank', rel: 'noopener' }, icon('download', 'sm'), 'Save as PDF'),
          h('a', { class: 'btn sm', href: s.link, target: '_blank', rel: 'noopener' }, icon('external', 'sm'), 'Preview'),
          !s.revoked && !expired ? h('button', { class: 'btn sm', onclick: () => showResult({ link: s.link, company: s.company, title: s.title, privateHost: r.privateHost }) }, 'Send link') : null,
          h('span', { class: 'spacer' }),
          canEdit ? h('button', { class: 'btn sm ghost', onclick: async () => { await api('/shares/' + s.id, { method: 'POST', body: { extendDays: 30 } }); toast('Extended by 30 days'); load(); } }, 'Extend 30 days') : null,
          canEdit && !s.revoked ? h('button', { class: 'btn sm danger', onclick: async () => {
            if (!await confirmBox('Withdraw this shortlist?', s.company + ' will no longer be able to open the link.', { label: 'Withdraw', kind: 'danger' })) return;
            await api('/shares/' + s.id, { method: 'POST', body: { revoked: true } });
            toast('Withdrawn');
            load();
          } }, 'Withdraw') : null));
    }));
  }
  load().catch((err) => clear(box, h('div', { class: 'banner bad' }, err.message)));
}
