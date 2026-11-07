// Fraud alerts: changes between a person's CVs that are worth a second look, and blacklisted people who came back.

import { h, clear, icon, toast, fmtDate, fmtNum, RISK } from '../ui.js';
import { api, qs } from '../api.js';

const KIND_LABELS = {
  blacklisted_reapplied: 'Blacklisted person came back', name_changed: 'Name changed', dob_changed: 'Date of birth changed',
  age_changed: 'Age does not add up', gender_changed: 'Gender changed', degree_backdated: 'Old degree newly added',
  degree_year_changed: 'Degree year changed', institution_changed: 'College changed', score_changed: 'Marks changed',
  degree_removed: 'Degree removed', experience_inflated: 'Experience inflated', experience_reduced: 'Experience reduced',
  employer_backdated: 'Old job newly added', employment_dates_changed: 'Job dates changed', title_changed: 'Job title changed',
  employer_removed: 'Job removed'
};

export async function render(main, ctx) {
  const canEdit = ctx.user.role !== 'viewer';
  let resolved = false;
  let severity = '';
  let kind = '';
  let page = 1;
  const listBox = h('div', { class: 'card' });
  const kinds = h('div', { class: 'filters' });
  const head = h('div', { class: 'tabs' });

  clear(main, h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', { class: 'grow' }, h('h1', {}, 'Fraud alerts'),
      h('p', {}, 'When someone sends a new CV, Guardora compares it with their earlier one and flags history that was rewritten: dates, degrees, employers, identity.'))),
    h('div', { class: 'stack' }, head, kinds, listBox)));

  async function load() {
    clear(listBox, h('div', { class: 'center' }, h('div', { class: 'spinner' })));
    const r = await api('/alerts' + qs({ resolved: resolved ? 1 : '', severity, kind, page }));
    clear(head, [['Open', false], ['Checked', true]].map(([l, v]) => h('button', { class: 'tab' + (resolved === v ? ' active' : ''), onclick: () => { resolved = v; page = 1; kind = ''; load(); } }, l)));
    clear(kinds,
      h('select', { class: 'input', style: { width: 'auto', minHeight: '34px', fontSize: '13.5px' }, onchange: (e) => { severity = e.target.value; page = 1; load(); } },
        [['', 'All levels'], ['3', 'High only'], ['2', 'Medium and high']].map(([v, l]) => h('option', { value: v, selected: severity === v }, l))),
      r.kinds.map((k) => h('button', { class: 'fbtn' + (kind === k.kind ? ' set' : ''), onclick: () => { kind = kind === k.kind ? '' : k.kind; page = 1; load(); } },
        (KIND_LABELS[k.kind] || k.kind) + ' · ' + k.n)));
    if (!r.items.length) {
      clear(listBox, h('div', { class: 'empty' }, icon('shield'), h('h3', {}, resolved ? 'Nothing checked yet' : 'All clear'),
        h('p', {}, resolved ? 'Alerts you mark as checked appear here.' : 'No open alerts. New CVs are checked automatically as they arrive.')));
      return;
    }
    clear(listBox, r.items.map((f) => h('div', { class: 'alert-card' },
      h('span', { class: 'sev s' + f.severity }),
      h('div', { class: 'stack', style: { gap: '4px' } },
        h('div', { class: 'row wrap' },
          h('a', { href: '/candidates/' + f.candidate_id, 'data-link': '' }, h('b', {}, f.name || 'Unnamed')),
          h('span', { class: 'pill ' + (f.severity === 3 ? 'bad' : f.severity === 2 ? 'warn' : 'info') }, RISK[f.severity]),
          h('span', { class: 'pill neutral' }, KIND_LABELS[f.kind] || f.kind),
          f.blacklisted ? h('span', { class: 'pill bad' }, 'Blacklisted') : null),
        h('div', {}, f.message),
        h('div', { class: 'tiny muted' }, [f.email, f.phone, f.city].filter(Boolean).join(' · ') + ' · ' + fmtDate(f.created_at) +
          (f.previous_file_name ? ' · "' + f.previous_file_name + '" → "' + f.file_name + '"' : '') +
          (f.resolved ? ' · checked by ' + (f.resolved_by_name || 'someone') : ''))),
      h('div', { class: 'row' },
        h('a', { class: 'btn sm', href: '/candidates/' + f.candidate_id, 'data-link': '' }, 'Open'),
        canEdit ? h('button', { class: 'btn sm', onclick: async () => {
          await api('/flags/' + f.id + '/resolve', { method: 'POST', body: { resolved: !f.resolved } });
          toast(f.resolved ? 'Re-opened' : 'Marked as checked');
          ctx.refreshCounts();
          load();
        } }, f.resolved ? 'Re-open' : h('span', { class: 'row', style: { gap: '4px' } }, icon('check', 'sm'), 'Checked')) : null))),
    r.total > page * 50 ? h('div', { class: 'loadmore' }, h('button', { class: 'btn', onclick: () => { page++; load(); } }, 'Next page (' + fmtNum(r.total - page * 50) + ' more)')) : null);
  }
  load().catch((err) => clear(listBox, h('div', { class: 'banner bad' }, err.message)));
}
