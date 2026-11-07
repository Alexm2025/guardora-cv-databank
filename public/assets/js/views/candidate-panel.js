// The candidate panel: their CV beside the list, profile, every version with "what changed", notes and history.

import {
  h, clear, icon, toast, modal, confirmBox, promptBox, fmtDate, ago, fmtExp, fmtSize, cap, age, sourceLabel, RISK, highlight
} from '../ui.js';
import { api, fetchBlob, qs } from '../api.js';
import { renderPdf } from '../pdfview.js';
import { openShareDialog } from './share-dialog.js';

const STATUS_LABELS = { new: 'New', reviewing: 'Reviewing', shortlisted: 'Shortlisted', interview: 'Interview', placed: 'Placed', on_hold: 'On hold', rejected: 'Rejected' };
const GENDERS = { male: 'Male', female: 'Female', other: 'Other' };

export function openCandidate(container, id, { user, meta, query, onChange, onClose, navigate }) {
  let data = null;
  let tab = 'cv';
  let cvIndex = 0;
  let viewerHandle = null;
  let zoom = 1;
  let textMode = false;
  let destroyed = false;
  const canEdit = user.role !== 'viewer';
  const levels = Object.fromEntries((meta.educationLevels || []).map((l) => [l.level, l.label]));

  const head = h('div', { class: 'panel-head' });
  const body = h('div', { class: 'panel-body' });
  clear(container, head, body);
  body.append(h('div', { class: 'center' }, h('div', { class: 'spinner' })));

  async function load() {
    try {
      data = await api('/candidates/' + id);
      data.shares = (await api('/candidates/' + id + '/shares')).items;
    } catch (err) {
      clear(body, h('div', { class: 'empty' }, icon('users'), h('h3', {}, 'Not found'), h('p', {}, err.message)));
      clear(head);
      return;
    }
    if (destroyed) return;
    cvIndex = Math.min(cvIndex, data.cvs.length - 1);
    drawHead();
    drawTab();
  }

  async function act(path, payload, message) {
    try {
      await api('/candidates/' + id + path, { method: 'POST', body: payload });
      if (message) toast(message);
      await load();
      onChange();
    } catch (err) {
      toast(err.message, 'bad');
    }
  }

  /* ---------- Header ---------- */

  function drawHead() {
    const c = data.candidate;
    const a = age(c);
    const openFlags = data.flags.filter((f) => !f.resolved);
    const statusSel = h('select', { class: 'input', style: { width: 'auto', minHeight: '32px', padding: '0 8px', fontSize: '13px' }, disabled: !canEdit, 'aria-label': 'Status',
      onchange: (e) => act('/status', { status: e.target.value }, 'Status updated') },
    Object.entries(STATUS_LABELS).map(([v, l]) => h('option', { value: v, selected: c.status === v }, l)));

    const stars = h('span', { class: 'stars', 'aria-label': 'Rating' }, [1, 2, 3, 4, 5].map((n) => h('button', {
      class: n <= c.rating ? 'on' : '', 'aria-label': n + ' stars', disabled: !canEdit,
      onclick: () => act('/star', { rating: c.rating === n ? 0 : n })
    }, icon('star', 'sm'))));

    clear(head,
      h('div', { class: 'panel-title' },
        h('button', { class: 'btn ghost icon sm', 'aria-label': 'Close', title: 'Close (Esc)', onclick: onClose }, icon(window.innerWidth <= 1100 ? 'back' : 'x')),
        h('div', { class: 'grow' },
          h('div', { class: 'row wrap' },
            h('h2', {}, c.name || 'Unnamed candidate'),
            c.done ? h('span', { class: 'pill ok' }, icon('check', 'sm'), 'Done') : null,
            c.blacklisted ? h('span', { class: 'pill bad' }, icon('ban', 'sm'), 'Blacklisted') : null,
            c.risk ? h('span', { class: 'pill ' + (c.risk === 3 ? 'bad' : c.risk === 2 ? 'warn' : 'info') }, icon('alert', 'sm'), RISK[c.risk] + ' risk') : null,
            c.done && c.last_seen_at > c.done_at ? h('span', { class: 'pill gold' }, 'Sent a new CV since done') : null),
          h('div', { class: 'meta' },
            c.current_title ? h('span', {}, c.current_title + (c.current_company ? ' · ' + c.current_company : '')) : null,
            c.city ? h('span', {}, c.city + (c.state ? ', ' + c.state : '')) : null,
            a ? h('span', {}, a + ' yrs') : null,
            c.gender ? h('span', {}, GENDERS[c.gender]) : null,
            h('span', {}, c.cv_count + ' CV' + (c.cv_count > 1 ? 's' : '') + ' · first seen ' + fmtDate(c.first_seen_at))))),
      h('div', { class: 'panel-actions' },
        h('button', {
          class: 'btn sm ' + (c.done ? 'on' : 'primary'), disabled: !canEdit, title: 'Done (d)',
          onclick: () => act('/done', { done: !c.done }, c.done ? 'Done tick removed' : 'Marked as done')
        }, icon('check', 'sm'), c.done ? 'Done' : 'Mark done'),
        h('button', { class: 'btn sm icon' + (c.starred ? ' on' : ''), title: 'Star (s)', 'aria-label': 'Star', disabled: !canEdit, onclick: () => act('/star', { starred: !c.starred }) }, icon('star', 'sm')),
        statusSel, stars,
        h('span', { class: 'spacer' }),
        c.email ? h('a', { class: 'btn sm ghost icon', href: 'mailto:' + c.email, title: 'Email ' + c.email, 'aria-label': 'Email' }, icon('mail', 'sm')) : null,
        c.phone ? h('a', { class: 'btn sm ghost icon', href: 'tel:' + c.phone.replace(/\s/g, ''), title: 'Call ' + c.phone, 'aria-label': 'Call' }, icon('phone', 'sm')) : null,
        c.phone ? h('a', { class: 'btn sm ghost', href: 'https://wa.me/' + c.phone.replace(/\D/g, '').replace(/^(\d{10})$/, '91$1'), target: '_blank', rel: 'noopener noreferrer', title: 'WhatsApp' }, 'WhatsApp') : null,
        h('button', { class: 'btn sm', disabled: !canEdit || c.blacklisted, title: 'Share this profile with a company, without contact details',
          onclick: () => openShareDialog({ ids: [id], label: c.name || 'this candidate', onDone: () => { load(); onChange(); } }) }, icon('send', 'sm'), 'Share'),
        h('button', { class: 'btn sm' + (c.blacklisted ? ' danger' : ''), disabled: !canEdit, onclick: toggleBlacklist, title: 'Blacklist (b)' }, icon('ban', 'sm'), c.blacklisted ? 'Unblacklist' : 'Blacklist'),
        moreMenu()),
      c.blacklisted ? h('div', { class: 'banner bad' }, icon('ban'), h('div', {}, h('b', {}, 'Blacklisted ' + fmtDate(c.blacklisted_at) + '. '), c.blacklist_reason)) : null,
      openFlags.length ? h('div', { class: 'banner ' + (c.risk === 3 ? 'bad' : 'warn') }, icon('alert'),
        h('div', { class: 'grow' }, h('b', {}, openFlags.length + ' change' + (openFlags.length > 1 ? 's' : '') + ' to check: '), openFlags.slice(0, 2).map((f) => f.message).join(' ')),
        h('button', { class: 'btn sm', onclick: () => setTab('versions') }, 'Review')) : null,
      h('div', { class: 'ptabs', role: 'tablist' }, [
        ['cv', 'CV', null], ['profile', 'Profile', null], ['versions', 'Versions & changes', c.cv_count > 1 ? c.cv_count : null],
        ['notes', 'Notes & history', data.notes.length || null]
      ].map(([key, label, n]) => h('button', { class: 'ptab' + (tab === key ? ' active' : ''), role: 'tab', 'aria-selected': String(tab === key), onclick: () => setTab(key) },
        label, n ? h('span', { class: 'count' }, n) : null))));
  }

  function moreMenu() {
    const btn = h('button', { class: 'btn sm icon', 'aria-label': 'More actions', title: 'More' }, icon('more'));
    btn.onclick = async () => {
      const { popover, closePopover } = await import('../ui.js');
      const item = (ic, label, fn, cls = '') => h('button', { class: 'btn ghost sm ' + cls, style: { justifyContent: 'flex-start' }, onclick: () => { closePopover(); fn(); } }, icon(ic, 'sm'), label);
      popover(btn, h('div', { class: 'stack', style: { gap: '2px' } },
        canEdit ? item('edit', 'Edit details', editDetails) : null,
        canEdit ? item('note', 'Tags', editTags) : null,
        canEdit ? item('merge', 'Merge with another record…', mergeWith) : null,
        canEdit ? item('refresh', 'Re-read details from the CVs', () => act('/reparse', {}, 'Details refreshed from the CVs')) : null,
        data.cvs[0] ? item('download', 'Download latest CV', () => { location.href = '/api/cvs/' + data.cvs[0].id + '/file?download=1'; }) : null,
        user.role === 'owner' ? item('trash', 'Delete all data of this person', erase, 'danger') : null));
    };
    return btn;
  }

  /* ---------- Tabs ---------- */

  function setTab(t) {
    tab = t;
    drawHead();
    drawTab();
  }

  function drawTab() {
    if (viewerHandle) { viewerHandle.destroy(); viewerHandle = null; }
    body.scrollTop = 0;
    if (tab === 'cv') drawCv();
    else if (tab === 'profile') drawProfile();
    else if (tab === 'versions') drawVersions();
    else drawNotes();
  }

  async function drawCv() {
    const cv = data.cvs[cvIndex];
    if (!cv) {
      clear(body, h('div', { class: 'empty' }, icon('file'), h('h3', {}, 'No CV file')));
      return;
    }
    const q = query.get('q') || '';
    const pages = h('div', { class: 'pages' }, h('div', { class: 'spinner' }));
    const canText = cv.kind === 'pdf';
    const bar = h('div', { class: 'viewer-bar' },
      data.cvs.length > 1 ? h('select', { class: 'input', style: { width: 'auto', minHeight: '32px', fontSize: '13px' }, 'aria-label': 'Version',
        onchange: (e) => { cvIndex = Number(e.target.value); drawCv(); } },
      data.cvs.map((v, i) => h('option', { value: i, selected: i === cvIndex }, (i === 0 ? 'Latest · ' : 'v' + (data.cvs.length - i) + ' · ') + fmtDate(v.received_at)))) : null,
      h('span', { class: 'small muted ellipsis grow', title: cv.file_name }, cv.file_name + ' · ' + fmtSize(cv.size) + (cv.pages ? ' · ' + cv.pages + ' page' + (cv.pages > 1 ? 's' : '') : '')),
      cv.kind === 'pdf' && !textMode ? [
        h('button', { class: 'btn sm icon', 'aria-label': 'Zoom out', onclick: () => { zoom = Math.max(0.5, zoom - 0.2); viewerHandle && viewerHandle.zoom(zoom); } }, icon('zoomOut', 'sm')),
        h('button', { class: 'btn sm icon', 'aria-label': 'Zoom in', onclick: () => { zoom = Math.min(3, zoom + 0.2); viewerHandle && viewerHandle.zoom(zoom); } }, icon('zoomIn', 'sm'))] : null,
      canText ? h('button', { class: 'btn sm' + (textMode ? ' on' : ''), title: 'Show the text, with your search words highlighted', onclick: () => { textMode = !textMode; drawCv(); } }, icon('text', 'sm'), 'Text') : null,
      h('a', { class: 'btn sm icon', href: '/api/cvs/' + cv.id + '/file', target: '_blank', rel: 'noopener', 'aria-label': 'Open in new tab', title: 'Open in new tab' }, icon('external', 'sm')),
      h('a', { class: 'btn sm icon', href: '/api/cvs/' + cv.id + '/file?download=1', 'aria-label': 'Download', title: 'Download original' }, icon('download', 'sm')));
    const review = cv.needs_review ? h('div', { class: 'banner warn', style: { margin: '12px 18px 0' } }, icon('alert'),
      cv.needs_review === 'image' ? 'This CV is a photo. Details could not be read automatically; use Edit details to fill them in.'
        : 'This CV has no readable text (scanned or protected). Details could not be read automatically; use Edit details to fill them in.') : null;
    clear(body, h('div', { class: 'viewer' }, bar, review, pages));

    try {
      if (cv.kind === 'pdf' && !textMode) {
        const blob = await fetchBlob('/cvs/' + cv.id + '/file');
        if (destroyed || tab !== 'cv') return;
        viewerHandle = await renderPdf(pages, new Uint8Array(await blob.arrayBuffer()), { zoom });
      } else if (cv.kind === 'image') {
        const blob = await fetchBlob('/cvs/' + cv.id + '/file');
        const url = URL.createObjectURL(blob);
        clear(pages, h('img', { class: 'cv-img', src: url, alt: 'CV image' }));
        viewerHandle = { destroy: () => URL.revokeObjectURL(url), zoom: () => {} };
      } else {
        const t = await api('/cvs/' + cv.id + '/text');
        if (destroyed || tab !== 'cv') return;
        clear(pages, h('div', { class: 'paper' }, t.text ? highlight(t.text, q) : h('span', { class: 'muted' }, 'No text could be read from this file. Download it to view.')),
          cv.kind !== 'txt' ? h('p', { class: 'tiny muted' }, 'Word / RTF documents are shown as text. Download the original to see the layout.') : null);
      }
    } catch (err) {
      clear(pages, h('div', { class: 'banner bad' }, icon('alert'), 'Could not show this file: ' + err.message));
    }
  }

  function fact(label, value, field) {
    const edited = (data.candidate.edited_fields || []).includes(field);
    const empty = value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length);
    return h('div', { class: 'fact' }, h('dt', {}, label, edited ? h('span', { class: 'edited' }, ' · edited') : null),
      h('dd', { class: empty ? 'empty-v' : '' }, empty ? '—' : value));
  }

  function drawProfile() {
    const c = data.candidate;
    const a = age(c);
    const sources = [...new Set(data.cvs.flatMap((cv) => cv.sources.map((s) => s.source)))];
    clear(body, h('div', { class: 'panel-pad' },
      h('dl', { class: 'facts', style: { margin: 0 } },
        fact('Email', c.emails.length ? c.emails.join(', ') : '', 'email'),
        fact('Phone', c.phones.length ? c.phones.join(', ') : c.phone, 'phone'),
        fact('Age', a ? a + ' years' + (c.dob ? ' (born ' + fmtDate(c.dob) + ')' : ' (approx.)') : '', 'dob'),
        fact('Gender', GENDERS[c.gender] || '', 'gender'),
        fact('Location', [c.city, c.state].filter(Boolean).join(', '), 'city'),
        fact('Education', c.education_level ? levels[c.education_level] : '', 'education_level'),
        fact('Experience', c.experience_years != null ? fmtExp(c.experience_years) : '', 'experience_years'),
        fact('Current role', [c.current_title, c.current_company].filter(Boolean).join(' at '), 'current_title'),
        fact('Current CTC', c.current_ctc, 'current_ctc'),
        fact('Expected CTC', c.expected_ctc, 'expected_ctc'),
        fact('Notice period', c.notice_period, 'notice_period'),
        fact('Applied for', c.applied_for, 'applied_for'),
        fact('Languages', c.languages.join(', '), 'languages'),
        fact('Came from', sources.map(sourceLabel).join(', '), ''),
        fact('Last CV', fmtDate(c.last_seen_at, true), ''),
        c.address ? fact('Address', c.address, 'address') : null),
      c.tags.length ? h('div', { class: 'row wrap' }, h('b', { class: 'small' }, 'Tags'), c.tags.map((t) => h('span', { class: 'chip' }, t))) : null,
      section('Skills', c.skills.length ? h('div', { class: 'row wrap' }, c.skills.map((s) => h('span', { class: 'chip' }, s))) : h('p', { class: 'muted small' }, 'No skills found in the CV.')),
      section('Education', c.education.length ? c.education.map((e) => h('div', { class: 'edu-row' },
        h('div', {}, h('b', {}, e.degree + (e.field ? ' — ' + e.field : '')), e.pursuing ? h('span', { class: 'pill info', style: { marginLeft: '6px' } }, 'Pursuing') : null,
          h('div', { class: 'small muted' }, [e.institution, e.score].filter(Boolean).join(' · '))),
        h('div', { class: 'small muted nowrap' }, e.year || ''))) : h('p', { class: 'muted small' }, 'Not found in the CV.')),
      section('Work history', c.experience.length ? c.experience.map((r) => h('div', { class: 'job-row' },
        h('div', {}, h('b', {}, r.title || r.company || 'Role'), h('div', { class: 'small muted' }, r.title && r.company ? r.company : r.line)),
        h('div', { class: 'small muted nowrap' }, r.start + ' – ' + (r.end === 'present' ? 'Present' : r.end)))) : h('p', { class: 'muted small' }, 'No dated work history found in the CV.')),
      data.shares.length ? section('Shared with companies', data.shares.map((s) => h('div', { class: 'row wrap', style: { padding: '6px 0', borderBottom: '1px dashed var(--line)' } },
        h('a', { class: 'grow', href: '/shares', 'data-link': '' }, h('b', {}, s.company), s.title ? ' — ' + s.title : '', h('div', { class: 'tiny muted' }, fmtDate(s.created_at) + (s.revoked ? ' · withdrawn' : ''))),
        s.feedback ? h('span', { class: 'pill ' + ({ interested: 'ok', maybe: 'warn', not_suitable: 'bad' })[s.feedback] }, ({ interested: 'Interested', maybe: 'Maybe', not_suitable: 'Not suitable' })[s.feedback]) : h('span', { class: 'tiny muted' }, 'No answer yet'),
        s.feedback_note ? h('div', { class: 'small', style: { width: '100%' } }, '"' + s.feedback_note + '"') : null))) : null,
      data.duplicates.length ? section('Possible duplicates', data.duplicates.map((d) => h('div', { class: 'row wrap', style: { padding: '8px 0', borderBottom: '1px dashed var(--line)' } },
        h('div', { class: 'grow' }, h('a', { href: '/candidates/' + d.other.id + location.search, 'data-link': '' }, h('b', {}, d.other.name || '#' + d.other.id)),
          h('div', { class: 'small muted' }, [d.other.email, d.other.phone, d.other.city].filter(Boolean).join(' · ') + ' — ' + d.reasons.join('; '))),
        canEdit ? h('button', { class: 'btn sm', onclick: () => doMerge(d.other) }, icon('merge', 'sm'), 'Merge') : null,
        canEdit ? h('button', { class: 'btn sm ghost', onclick: async () => { await api('/duplicates/' + d.id + '/dismiss', { method: 'POST' }); load(); } }, 'Not the same') : null))) : null,
      canEdit ? h('div', {}, h('button', { class: 'btn', onclick: editDetails }, icon('edit', 'sm'), 'Edit details')) : null));
  }

  const section = (title, content) => h('section', { class: 'stack', style: { gap: '8px' } }, h('h3', {}, title), content);

  /* ---------- Versions and the change report ---------- */

  let picked = [];
  function drawVersions() {
    const cvs = data.cvs;
    if (picked.length !== 2 || !picked.every((p) => cvs.some((c) => c.id === p))) picked = cvs.length > 1 ? [cvs[1].id, cvs[0].id] : [];
    const flagsList = data.flags;
    const report = h('div', { class: 'stack' });
    clear(body, h('div', { class: 'panel-pad' },
      flagsList.length ? section('Alerts', h('div', { class: 'card' }, flagsList.map((f) => h('div', { class: 'alert-card' },
        h('span', { class: 'sev s' + f.severity }),
        h('div', {}, h('div', { style: { fontWeight: 600, textDecoration: f.resolved ? 'line-through' : '' } }, f.message),
          h('div', { class: 'tiny muted' }, RISK[f.severity] + ' · ' + fmtDate(f.created_at) + (f.resolved ? ' · checked by ' + (f.resolved_by_name || 'someone') + ' ' + ago(f.resolved_at) : ''))),
        canEdit ? h('button', { class: 'btn sm', onclick: async () => { await api('/flags/' + f.id + '/resolve', { method: 'POST', body: { resolved: !f.resolved } }); await load(); onChange(); } },
          f.resolved ? 'Re-open' : 'Checked, OK') : null)))) : null,
      section('Versions (' + cvs.length + ')', h('div', { class: 'versions' }, cvs.map((cv, i) => {
        const on = picked.includes(cv.id);
        return h('div', { class: 'version' + (on ? ' picked' : '') },
          h('span', { class: 'vnum' }, 'v' + (cvs.length - i)),
          h('div', { class: 'grow' },
            h('div', { style: { fontWeight: 700 } }, fmtDate(cv.received_at, true), i === 0 ? h('span', { class: 'pill gold', style: { marginLeft: '8px' } }, 'Latest') : null),
            h('div', { class: 'small muted ellipsis' }, cv.file_name),
            h('div', { class: 'tiny muted' }, cv.sources.map((s) => sourceLabel(s.source) + (s.job_title ? ' — ' + s.job_title : '') + (s.subject && s.source === 'email' ? ' — "' + s.subject + '"' : '')).join(' · '))),
          h('div', { class: 'row' },
            cvs.length > 1 ? h('label', { class: 'check small', title: 'Pick two versions to compare' }, h('input', { type: 'checkbox', checked: on, onchange: (e) => {
              picked = e.target.checked ? [...picked.filter((p) => p !== cv.id), cv.id].slice(-2) : picked.filter((p) => p !== cv.id);
              drawVersions();
            } }), 'Compare') : null,
            h('button', { class: 'btn sm', onclick: () => { cvIndex = i; setTab('cv'); } }, 'View'),
            canEdit && cvs.length > 1 ? h('button', { class: 'btn sm ghost', title: 'This CV belongs to a different person', onclick: () => split(cv) }, icon('split', 'sm')) : null));
      }))),
      cvs.length > 1 ? section('What changed', report) : h('p', { class: 'muted small' }, 'Only one CV so far. When this person sends another, Guardora compares the two and flags anything rewritten.')));
    if (picked.length === 2) drawCompare(report, picked[0], picked[1]);
  }

  async function drawCompare(box, a, b) {
    clear(box, h('div', { class: 'spinner' }));
    let r;
    try {
      r = await api('/cvs/' + a + '/compare/' + b);
    } catch (err) {
      clear(box, h('div', { class: 'banner bad' }, err.message));
      return;
    }
    const o = r.older.parsed;
    const n = r.newer.parsed;
    const fmtEdu = (p) => (p.education || []).map((e) => e.degree + (e.year ? ' ' + e.year : '') + (e.institution ? ' (' + e.institution + ')' : '') + (e.score ? ' ' + e.score : '')).join('\n');
    const fmtJobs = (p) => (p.experience || []).map((e) => [e.title, e.company].filter(Boolean).join(' at ') + ' ' + e.start + '–' + e.end).join('\n');
    const rows = [
      ['Name', o.name, n.name], ['Date of birth', o.dob || (o.birthYear ? '~' + o.birthYear : ''), n.dob || (n.birthYear ? '~' + n.birthYear : '')],
      ['Gender', o.gender, n.gender], ['Email', (o.emails || []).join(', '), (n.emails || []).join(', ')], ['Phone', (o.phones || []).join(', '), (n.phones || []).join(', ')],
      ['City', o.city, n.city], ['Experience', fmtExp(o.experienceYears), fmtExp(n.experienceYears)], ['Education', fmtEdu(o), fmtEdu(n)], ['Jobs', fmtJobs(o), fmtJobs(n)],
      ['Current CTC', o.currentCtc, n.currentCtc], ['Skills', (o.skills || []).length + ' skills', (n.skills || []).length + ' skills']
    ];
    let changesOnly = true;
    const diffBox = h('div', { class: 'diff' });
    const drawDiff = () => {
      const out = [];
      let gap = 0;
      for (const op of r.diff.ops) {
        if (op.op === '=' && changesOnly) { gap++; continue; }
        if (gap) { out.push(h('div', { class: 'gap' }, gap + ' unchanged line' + (gap > 1 ? 's' : ''))); gap = 0; }
        out.push(h('div', { class: op.op === '+' ? 'add' : op.op === '-' ? 'del' : '' }, op.text));
      }
      if (gap) out.push(h('div', { class: 'gap' }, gap + ' unchanged line' + (gap > 1 ? 's' : '')));
      clear(diffBox, out.length ? out : h('div', { class: 'gap' }, 'The text is identical.'));
    };
    drawDiff();
    clear(box,
      r.findings.length ? h('div', { class: 'stack', style: { gap: '6px' } }, r.findings.map((f) => h('div', { class: 'banner ' + (f.severity === 3 ? 'bad' : f.severity === 2 ? 'warn' : 'info') }, icon('alert'), f.message)))
        : h('div', { class: 'banner ok' }, icon('check'), 'No suspicious changes between these two versions.'),
      h('div', { style: { overflowX: 'auto' } }, h('table', { class: 'cmp-table' },
        h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'Older · ' + fmtDate(r.older.received_at)), h('th', {}, 'Newer · ' + fmtDate(r.newer.received_at)))),
        h('tbody', {}, rows.map(([label, x, y]) => h('tr', { class: String(x || '') !== String(y || '') ? 'changed' : '' },
          h('td', { class: 'small', style: { fontWeight: 700 } }, label), h('td', { style: { whiteSpace: 'pre-line' } }, x || '—'), h('td', { style: { whiteSpace: 'pre-line' } }, y || '—')))))),
      h('div', { class: 'row wrap' }, h('h3', { class: 'grow' }, 'Line by line'),
        h('span', { class: 'small muted' }, r.diff.added + ' added · ' + r.diff.removed + ' removed'),
        h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: true, onchange: (e) => { changesOnly = e.target.checked; drawDiff(); } }), 'Changes only')),
      diffBox);
  }

  /* ---------- Notes and history ---------- */

  function drawNotes() {
    const input = h('textarea', { class: 'input', placeholder: 'Write a note: call outcome, interview feedback, client sent to…' });
    clear(body, h('div', { class: 'panel-pad' },
      canEdit ? h('div', { class: 'stack', style: { gap: '8px' } }, input, h('div', {}, h('button', { class: 'btn primary sm', onclick: async () => {
        if (!input.value.trim()) return;
        try {
          await api('/candidates/' + id + '/notes', { method: 'POST', body: { body: input.value } });
          await load();
        } catch (err) { toast(err.message, 'bad'); }
      } }, icon('plus', 'sm'), 'Add note'))) : null,
      data.notes.length ? section('Notes', data.notes.map((n) => h('div', { class: 'card pad', style: { boxShadow: 'none' } },
        h('div', { style: { whiteSpace: 'pre-wrap' } }, n.body),
        h('div', { class: 'row tiny muted', style: { marginTop: '6px' } }, (n.author || 'Someone') + ' · ' + fmtDate(n.created_at, true), h('span', { class: 'spacer' }),
          canEdit && (n.user_id === user.id || user.role === 'owner') ? h('button', { class: 'btn ghost sm', onclick: async () => {
            if (await confirmBox('Delete note?', 'This cannot be undone.', { label: 'Delete', kind: 'danger' })) { await api('/candidates/' + id + '/notes/' + n.id, { method: 'DELETE' }); load(); }
          } }, 'Delete') : null)))) : null,
      section('History', h('div', { class: 'timeline' }, data.events.map((e) => h('div', { class: 'tl' }, h('i'),
        h('div', {}, h('div', { class: 'small' }, e.message), h('div', { class: 'tiny muted' }, fmtDate(e.created_at, true) + (e.author ? ' · ' + e.author : '')))))))));
  }

  /* ---------- Actions ---------- */

  async function toggleBlacklist() {
    const c = data.candidate;
    if (c.blacklisted) {
      if (await confirmBox('Remove from blacklist?', (c.name || 'This person') + ' will be treated normally again.', { label: 'Remove' })) {
        act('/blacklist', { blacklisted: false }, 'Removed from blacklist');
      }
      return;
    }
    const reason = await promptBox('Blacklist ' + (c.name || 'this person'), {
      label: 'Reason', placeholder: 'e.g. Fake experience letter submitted to client', okLabel: 'Blacklist', multiline: true,
      hint: 'If they send a CV again (from any email or number we know), Guardora raises a high alert.'
    });
    if (reason) act('/blacklist', { blacklisted: true, reason }, 'Blacklisted');
  }

  function editDetails() {
    const c = data.candidate;
    const f = (label, name, value, attrs = {}) => h('label', { class: 'field' }, h('span', {}, label), h('input', { class: 'input', name, value: value ?? '', ...attrs }));
    const form = h('form', { class: 'form-grid' },
      f('Name', 'name', c.name), f('Email', 'email', c.email, { type: 'email' }), f('Phone', 'phone', c.phone),
      f('Date of birth', 'dob', c.dob, { type: 'date' }),
      h('label', { class: 'field' }, h('span', {}, 'Gender'), h('select', { class: 'input', name: 'gender' }, [['', 'Unknown'], ['male', 'Male'], ['female', 'Female'], ['other', 'Other']].map(([v, l]) => h('option', { value: v, selected: c.gender === v }, l)))),
      f('City', 'city', c.city, { list: 'gd-cities' }), f('State', 'state', c.state),
      h('label', { class: 'field' }, h('span', {}, 'Education'), h('select', { class: 'input', name: 'education_level' }, (meta.educationLevels || []).map((l) => h('option', { value: l.level, selected: c.education_level === l.level }, l.label)))),
      f('Experience (years)', 'experience_years', c.experience_years, { type: 'number', step: '0.5', min: 0 }),
      f('Current title', 'current_title', c.current_title), f('Current company', 'current_company', c.current_company),
      f('Current CTC', 'current_ctc', c.current_ctc), f('Expected CTC', 'expected_ctc', c.expected_ctc), f('Notice period', 'notice_period', c.notice_period),
      f('Applied for', 'applied_for', c.applied_for),
      h('label', { class: 'field', style: { gridColumn: '1 / -1' } }, h('span', {}, 'Skills (comma separated)'), h('textarea', { class: 'input', name: 'skills' }, c.skills.join(', '))),
      h('datalist', { id: 'gd-cities' }, (meta.cities || []).map((x) => h('option', { value: x }))));
    modal({
      title: 'Edit details', wide: true,
      body: [h('p', { class: 'hint', style: { margin: 0 } }, 'Your corrections are kept: a later CV will not overwrite fields you changed here.'), form],
      actions: [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', onClick: async () => {
        const fd = Object.fromEntries(new FormData(form));
        const changes = {};
        for (const [k, v] of Object.entries(fd)) {
          const before = k === 'skills' ? c.skills.join(', ') : String(c[k] ?? '');
          if (String(v) !== before) changes[k] = v;
        }
        if (!Object.keys(changes).length) return true;
        try {
          await api('/candidates/' + id, { method: 'PATCH', body: changes });
          toast('Saved');
          await load();
          onChange();
        } catch (err) { toast(err.message, 'bad'); return false; }
      } }]
    });
  }

  async function editTags() {
    const v = await promptBox('Tags', { label: 'Tags, separated by commas', value: data.candidate.tags.join(', '), placeholder: 'e.g. Accounts, Thane, Sent to ABC Ltd', hint: 'Use tags for your own groups. You can filter by tag.' });
    if (v === null) return;
    await api('/candidates/' + id, { method: 'PATCH', body: { tags: v.split(',').map((t) => t.trim()).filter(Boolean) } });
    await load();
    onChange();
  }

  function mergeWith() {
    const input = h('input', { class: 'input', placeholder: 'Search by name, email or phone' });
    const results = h('div', { class: 'stack', style: { gap: '4px' } });
    let t;
    input.oninput = () => {
      clearTimeout(t);
      t = setTimeout(async () => {
        if (input.value.trim().length < 2) return clear(results);
        const r = await api('/candidates' + qs({ q: input.value, pageSize: 8 }));
        clear(results, r.items.filter((x) => x.id !== id).map((x) => h('button', { class: 'btn', style: { justifyContent: 'flex-start', height: 'auto', padding: '8px 12px' }, onclick: () => { m.close(); doMerge(x); } },
          h('span', { style: { textAlign: 'left' } }, h('b', {}, x.name || '#' + x.id), h('div', { class: 'tiny muted' }, [x.email, x.phone, x.city].filter(Boolean).join(' · '))))));
      }, 200);
    };
    const m = modal({ title: 'Merge with another record', body: [h('p', { class: 'hint', style: { margin: 0 } }, 'Use this when the same person is in the databank twice. Their CVs, notes and history move into this record.'), input, results] });
  }

  async function doMerge(other) {
    if (!await confirmBox('Merge records?', (other.name || '#' + other.id) + ' will be merged into ' + (data.candidate.name || 'this record') + '. All CVs, notes and history are kept.', { label: 'Merge' })) return;
    try {
      await api('/candidates/' + id + '/merge', { method: 'POST', body: { otherId: other.id } });
      toast('Merged');
      await load();
      onChange();
    } catch (err) { toast(err.message, 'bad'); }
  }

  async function split(cv) {
    if (!await confirmBox('Different person?', '"' + cv.file_name + '" will be moved to a new, separate candidate record.', { label: 'Separate' })) return;
    try {
      const r = await api('/cvs/' + cv.id + '/split', { method: 'POST' });
      toast('Moved to a new record');
      onChange();
      navigate('/candidates/' + r.id + location.search);
    } catch (err) { toast(err.message, 'bad'); }
  }

  async function erase() {
    const c = data.candidate;
    if (!await confirmBox('Delete all data of ' + (c.name || 'this person') + '?', 'Every CV file, note and record of this person is permanently erased. Use this when someone asks you to delete their data. This cannot be undone.', { label: 'Delete permanently', kind: 'danger' })) return;
    await api('/candidates/' + id, { method: 'DELETE' });
    toast('Deleted');
    onChange();
    onClose();
  }

  load();

  return {
    id,
    destroy() {
      destroyed = true;
      if (viewerHandle) viewerHandle.destroy();
    },
    key(k) {
      if (!data || !canEdit) return;
      const c = data.candidate;
      if (k === 'd') act('/done', { done: !c.done }, c.done ? 'Done tick removed' : 'Marked as done');
      else if (k === 's') act('/star', { starred: !c.starred });
      else if (k === 'b') toggleBlacklist();
    },
    tab(n) { setTab(['cv', 'profile', 'versions', 'notes'][n - 1] || 'cv'); },
    reloadQuery(q) { query = q; if (tab === 'cv' && textMode) drawCv(); }
  };
}
