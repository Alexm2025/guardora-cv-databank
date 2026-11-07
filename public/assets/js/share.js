// The shortlist page a client company opens from a link (or that the team prints to PDF).
// It only ever receives profiles with contact details removed by the server.

import { h, clear, icon, toast, fmtDate, fmtExp, cap } from './ui.js';

const root = document.getElementById('share');
const token = location.pathname.split('/').pop();
const params = new URLSearchParams(location.search);
const printMode = params.get('print') === '1';
let pin = '';
try { pin = sessionStorage.getItem('gd-share-pin-' + token) || ''; } catch { /* storage blocked */ }

async function request(method, path, body) {
  const headers = { Accept: 'application/json' };
  if (pin) headers['X-Share-Pin'] = pin;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch('/api/public/shares/' + encodeURIComponent(token) + path, { method, headers, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong.'), { status: res.status, pinRequired: data.pinRequired });
  return data;
}

function message(title, text) {
  clear(root, h('div', { class: 'sh-wrap' }, brand(), h('div', { class: 'empty' }, icon('lock'), h('h2', {}, title), h('p', {}, text))));
}

const brand = (meta) => h('div', { class: 'sh-brand' },
  h('div', {}, h('b', {}, 'THE GUARDIANS'), h('small', {}, 'Touch Futurefull Careers')),
  h('span', { class: 'spacer' }), meta || null);

function askPin(error) {
  const input = h('input', { class: 'input', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 8, placeholder: 'PIN', 'aria-label': 'PIN' });
  const form = h('form', { class: 'card pad stack sh-pin' }, brand(), h('h2', {}, 'Enter PIN'),
    h('p', { class: 'muted', style: { margin: 0 } }, 'This shortlist is protected. Enter the PIN you received from The Guardians.'),
    error ? h('div', { class: 'banner bad' }, error) : null, input, h('button', { class: 'btn primary', type: 'submit' }, 'Open shortlist'));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    pin = input.value.trim();
    try { sessionStorage.setItem('gd-share-pin-' + token, pin); } catch { /* storage blocked */ }
    load();
  });
  clear(root, form);
  input.focus();
}

const GENDER = { male: 'Male', female: 'Female', other: 'Other' };
const FEEDBACK = [['interested', 'Interested', 'check'], ['maybe', 'Maybe', 'more'], ['not_suitable', 'Not suitable', 'x']];

function render(d) {
  document.title = 'Shortlist for ' + d.company + ' · The Guardians';
  const a = d.agency;
  const fact = (label, value) => (value || value === 0 ? h('div', {}, h('dt', {}, label), h('dd', {}, value)) : null);

  const card = (c) => {
    const box = h('div', { class: 'sh-feedback' });
    const drawFeedback = () => clear(box,
      h('span', { class: 'small muted' }, 'Your decision:'),
      FEEDBACK.map(([key, label, ic]) => h('button', {
        class: 'btn sm' + (c.feedback === key ? ' on-' + key : ''), disabled: d.preview,
        onclick: async () => {
          const next = c.feedback === key ? '' : key;
          let note = c.feedbackNote || '';
          if (next === 'interested') note = prompt('Anything to add? For example preferred interview times (optional):', note) ?? note;
          try {
            await request('POST', '/feedback', { code: c.code, feedback: next, note });
            c.feedback = next;
            c.feedbackNote = note;
            drawFeedback();
            toast(next ? 'Thank you — The Guardians has been told.' : 'Cleared.');
          } catch (err) { toast(err.message, 'bad'); }
        }
      }, icon(ic, 'sm'), label)),
      d.preview ? h('span', { class: 'tiny muted' }, '(Preview: the company will be able to answer here.)') : null);
    drawFeedback();
    return h('article', { class: 'sh-card', id: c.code },
      h('div', { class: 'sh-head' }, h('span', { class: 'sh-code' }, c.code),
        h('div', { class: 'grow' }, h('h2', {}, c.name), c.headline ? h('div', { class: 'sh-sub' }, c.headline) : null)),
      h('dl', { class: 'sh-facts' },
        fact('Experience', c.experienceYears != null ? fmtExp(c.experienceYears) : ''),
        fact('Education', c.education),
        fact('Location', c.location),
        fact('Age', c.age ? c.age + ' years' : ''),
        fact('Gender', GENDER[c.gender] || ''),
        fact('Notice period', c.notice),
        fact('Current CTC', c.currentCtc),
        fact('Expected CTC', c.expectedCtc),
        c.languages.length ? fact('Languages', c.languages.join(', ')) : null),
      c.skills.length ? h('div', { class: 'sh-section' }, h('h3', {}, 'Skills'), h('div', { class: 'row wrap' }, c.skills.map((s) => h('span', { class: 'chip' }, s)))) : null,
      c.jobs.length ? h('div', { class: 'sh-section' }, h('h3', {}, 'Work history'), h('ul', { class: 'sh-list' }, c.jobs.map((j) => h('li', {},
        h('span', {}, [j.title, j.company].filter(Boolean).join(' — ') || 'Role'), h('span', {}, j.start + ' – ' + (j.end === 'present' ? 'Present' : j.end)))))) : null,
      c.degrees.length ? h('div', { class: 'sh-section' }, h('h3', {}, 'Education'), h('ul', { class: 'sh-list' }, c.degrees.map((e) => h('li', {},
        h('span', {}, [e.degree + (e.field ? ' (' + e.field + ')' : ''), e.institution].filter(Boolean).join(' — ') + (e.pursuing ? ' · pursuing' : '')),
        h('span', {}, [e.year, e.score].filter(Boolean).join(' · ')))))) : null,
      c.cv ? h('details', { class: 'sh-cv', open: printMode }, h('summary', {}, 'CV (contact details removed)'), h('div', { class: 'paper' }, c.cv)) : null,
      box);
  };

  clear(root,
    d.preview ? h('div', { class: 'sh-preview no-print' }, icon('external', 'sm'), 'Preview — this is exactly what ' + d.company + ' sees. Phone numbers, emails and addresses are removed.',
      h('button', { class: 'btn sm', onclick: () => window.print() }, icon('download', 'sm'), 'Save as PDF')) : null,
    h('div', { class: 'sh-watermark', 'aria-hidden': 'true' }, h('span', {}, 'Confidential · prepared for ' + d.company + '\nby The Guardians')),
    h('main', { class: 'sh-wrap' },
      brand(h('div', { class: 'sh-meta' }, 'Prepared ' + fmtDate(d.createdAt), h('br'), 'Valid until ' + fmtDate(d.expiresAt))),
      h('div', { class: 'sh-title' }, h('h1', {}, d.title || 'Candidate shortlist'), h('p', {}, 'For ' + d.company + ' · ' + d.candidates.length + ' candidate' + (d.candidates.length === 1 ? '' : 's'))),
      d.message ? h('div', { class: 'sh-message' }, d.message) : null,
      h('div', { class: 'sh-notice' }, icon('shield', 'sm'), h('span', {}, 'Candidates are presented by The Guardians. To arrange an interview, contact us quoting the candidate code (e.g. ' + (d.candidates[0] ? d.candidates[0].code : 'GD-00001') + '). Please do not contact candidates directly.')),
      h('table', { class: 'sh-summary' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Code'), h('th', {}, 'Candidate'), h('th', {}, 'Experience'), h('th', { class: 'sh-opt' }, 'Location'), h('th', { class: 'sh-opt' }, 'Education'), h('th', { class: 'sh-opt' }, 'Notice'))),
        h('tbody', {}, d.candidates.map((c) => h('tr', {},
          h('td', { class: 'mono' }, c.code), h('td', {}, h('a', { href: '#' + c.code }, c.name)), h('td', {}, c.experienceYears != null ? fmtExp(c.experienceYears) : '—'),
          h('td', { class: 'sh-opt' }, c.location || '—'), h('td', { class: 'sh-opt' }, c.education || '—'), h('td', { class: 'sh-opt' }, c.notice || '—'))))),
      d.candidates.map(card),
      h('footer', { class: 'sh-footer' }, h('b', {}, 'The Guardians'), h('span', {}, 'To interview any of these candidates, contact us with the candidate code:'),
        h('span', {}, h('a', { href: 'mailto:' + a.email + '?subject=' + encodeURIComponent('Shortlist for ' + d.company + (d.title ? ' — ' + d.title : '')) }, a.email), a.phone ? ' · ' + a.phone : ''))));

  if (printMode) setTimeout(() => window.print(), 600);
}

// However the page is printed (button, Ctrl+P, browser menu), include every CV in full.
window.addEventListener('beforeprint', () => document.querySelectorAll('details.sh-cv').forEach((d) => { d.dataset.wasOpen = d.open ? '1' : ''; d.open = true; }));
window.addEventListener('afterprint', () => document.querySelectorAll('details.sh-cv').forEach((d) => { d.open = d.dataset.wasOpen === '1'; }));

async function load() {
  try {
    render(await request('GET', ''));
  } catch (err) {
    if (err.pinRequired) askPin(pin ? err.message : '');
    else if (err.status === 410 || err.status === 404) message(err.status === 410 ? 'This shortlist is no longer available' : 'Link not found', err.message);
    else message('Could not open the shortlist', err.message);
  }
}

load();
