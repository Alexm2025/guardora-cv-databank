// Job match: paste a client's job description and get the people in the databank who fit it best.

import { h, clear, icon, toast, fmtExp, age, cap } from '../ui.js';
import { api } from '../api.js';

let lastText = '';

export async function render(main) {
  const text = h('textarea', { class: 'input', style: { minHeight: '170px' }, placeholder: 'Paste the job description here.\n\ne.g. "Accounts Executive, 2–4 years, B.Com, Tally Prime, GST returns, TDS, bank reconciliation, Thane/Navi Mumbai"' }, lastText);
  const city = h('input', { class: 'input', placeholder: 'Only these cities (optional, comma separated)' });
  const expMin = h('input', { class: 'input', type: 'number', min: 0, placeholder: 'Min. years' });
  const includeDone = h('input', { type: 'checkbox' });
  const out = h('div', { class: 'stack' });
  const btn = h('button', { class: 'btn primary', onclick: run }, icon('target'), 'Find matches');

  clear(main, h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', { class: 'grow' }, h('h1', {}, 'Job match'),
      h('p', {}, 'Paste a job description. Guardora reads the skills and level it asks for and ranks everyone in the databank against it.'))),
    h('div', { class: 'card pad stack', style: { marginBottom: '18px' } }, text,
      h('div', { class: 'row wrap' }, h('div', { style: { flex: '2 1 240px' } }, city), h('div', { style: { flex: '1 1 120px' } }, expMin),
        h('label', { class: 'check small' }, includeDone, 'Include people marked done'), h('span', { class: 'spacer' }), btn)),
    out));

  async function run() {
    lastText = text.value;
    if (text.value.trim().length < 20) return toast('Paste the job description first.', 'bad');
    btn.disabled = true;
    clear(out, h('div', { class: 'center' }, h('div', { class: 'spinner' })));
    try {
      const filters = { view: includeDone.checked ? 'all' : 'active', city: city.value.split(',').map((c) => c.trim()).filter(Boolean).join(','), expMin: expMin.value };
      const r = await api('/match', { method: 'POST', body: { text: text.value, filters } });
      const w = r.wanted;
      clear(out,
        h('div', { class: 'card pad stack', style: { gap: '8px' } },
          h('b', {}, 'What the job asks for'),
          w.skills.length ? h('div', { class: 'row wrap' }, w.skills.map((s) => h('span', { class: 'chip' }, s))) : h('span', { class: 'muted small' }, 'No known skills found in the text. Add skill names such as "Tally", "GST", "Excel".'),
          h('span', { class: 'small muted' }, [w.minExperience != null ? w.minExperience + '+ years' : '', w.educationLevel ? 'education level ' + w.educationLevel + '+' : ''].filter(Boolean).join(' · '))),
        r.items.length ? h('div', { class: 'card' }, r.items.map((c) => h('a', { href: '/candidates/' + c.id, 'data-link': '', class: 'alert-card', style: { gridTemplateColumns: 'auto 1fr', textDecoration: 'none' } },
          h('div', { class: 'score', style: { '--v': c.score } }, h('span', {}, c.score)),
          h('div', { class: 'stack', style: { gap: '4px' } },
            h('div', { class: 'row wrap' }, h('b', {}, c.name || 'Unnamed'), c.risk >= 3 ? h('span', { class: 'pill bad' }, 'High risk') : null, c.done ? h('span', { class: 'pill ok' }, 'Done') : null),
            h('div', { class: 'small muted' }, [c.current_title, c.city, age(c) ? age(c) + ' yrs' : '', cap(c.gender), fmtExp(c.experience_years), c.notice_period ? 'notice ' + c.notice_period : '', c.expected_ctc ? 'expects ' + c.expected_ctc : ''].filter(Boolean).join(' · ')),
            h('div', { class: 'row wrap' }, c.matched.map((s) => h('span', { class: 'chip hit' }, icon('check', 'sm'), s)), c.missing.slice(0, 6).map((s) => h('span', { class: 'chip miss' }, s)))))))
          : h('div', { class: 'card' }, h('div', { class: 'empty' }, icon('search'), h('h3', {}, 'No matches'), h('p', {}, 'Nobody in the databank has these skills yet, or the filters are too narrow.'))));
    } catch (err) {
      clear(out, h('div', { class: 'banner bad' }, err.message));
    } finally {
      btn.disabled = false;
    }
  }
  if (lastText) run();
}
