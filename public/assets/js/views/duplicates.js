// Possible duplicates: records that may be the same person. Merge them, or say they are different people.

import { h, clear, icon, toast, confirmBox, fmtDate, fmtExp } from '../ui.js';
import { api } from '../api.js';

export async function render(main, ctx) {
  const canEdit = ctx.user.role !== 'viewer';
  const box = h('div', { class: 'stack' });
  clear(main, h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', { class: 'grow' }, h('h1', {}, 'Possible duplicates'),
      h('p', {}, 'The same email, phone, or name with date of birth is merged automatically. These pairs are less certain, so you decide.'))),
    box));

  const card = (c) => h('div', { class: 'side-card' },
    h('a', { href: '/candidates/' + c.id, 'data-link': '' }, h('b', {}, c.name || 'Unnamed #' + c.id)),
    h('span', { class: 'muted' }, [c.email, c.phone].filter(Boolean).join(' · ') || 'No contact details'),
    h('span', { class: 'muted' }, [c.city, c.dob ? 'born ' + fmtDate(c.dob) : '', c.experience_years != null ? fmtExp(c.experience_years) : ''].filter(Boolean).join(' · ') || '—'),
    h('span', { class: 'tiny muted' }, c.cv_count + ' CV' + (c.cv_count > 1 ? 's' : '') + ' · first seen ' + fmtDate(c.first_seen_at) + ' · last ' + fmtDate(c.last_seen_at)),
    c.blacklisted ? h('span', { class: 'pill bad', style: { justifySelf: 'start' } }, 'Blacklisted') : null);

  async function load() {
    clear(box, h('div', { class: 'center' }, h('div', { class: 'spinner' })));
    const r = await api('/duplicates');
    if (!r.items.length) {
      clear(box, h('div', { class: 'card' }, h('div', { class: 'empty' }, icon('copy'), h('h3', {}, 'Nothing to decide'), h('p', {}, 'Possible duplicates show up here as CVs arrive.'))));
      return;
    }
    clear(box, r.items.map((d) => {
      // Keep the record that has been in the bank longest; the other is merged into it.
      const [keep, other] = d.a.first_seen_at <= d.b.first_seen_at ? [d.a, d.b] : [d.b, d.a];
      return h('div', { class: 'card pad stack' },
        h('div', { class: 'row wrap' }, h('div', { class: 'score', style: { '--v': d.score } }, h('span', {}, d.score)),
          h('div', { class: 'grow' }, h('b', {}, 'Likely the same person?'), h('div', { class: 'small muted' }, d.reasons.join(' · ')))),
        h('div', { class: 'pair' }, card(keep), card(other)),
        canEdit ? h('div', { class: 'row wrap' },
          h('button', { class: 'btn primary sm', onclick: async () => {
            if (!await confirmBox('Merge these records?', 'All CVs, notes and history are combined into one record. You can separate a CV again later from Versions.', { label: 'Merge' })) return;
            await api('/candidates/' + keep.id + '/merge', { method: 'POST', body: { otherId: other.id } });
            toast('Merged');
            ctx.refreshCounts();
            load();
          } }, icon('merge', 'sm'), 'Same person — merge'),
          h('button', { class: 'btn sm', onclick: async () => {
            await api('/duplicates/' + d.id + '/dismiss', { method: 'POST' });
            toast('Kept separate');
            ctx.refreshCounts();
            load();
          } }, 'Different people')) : null);
    }));
  }
  load().catch((err) => clear(box, h('div', { class: 'banner bad' }, err.message)));
}
