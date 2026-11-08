// The databank: instant search, filters, the candidate table, and the CV panel beside it.

import {
  h, clear, icon, toast, popover, closePopover, promptBox, confirmBox, fmtDate, ago, fmtExp, fmtNum, cap, age, debounce, sourceLabel, RISK
} from '../ui.js';
import { api, qs } from '../api.js';
import { openCandidate } from './candidate-panel.js';
import { uploadFiles } from '../app.js';
import { openShareDialog } from './share-dialog.js';
import { openEmailDialog } from './email-dialog.js';

const VIEWS = [
  ['all', 'All'], ['active', 'To do'], ['starred', 'Starred'], ['done', 'Done'], ['returned', 'Came back'],
  ['flagged', 'Flagged'], ['blacklisted', 'Blacklisted'], ['review', 'Needs reading']
];
const SORTS = [
  ['', 'Best match / newest'], ['recent', 'Newest CV first'], ['oldest', 'First seen (oldest)'], ['name', 'Name A–Z'], ['experience', 'Most experience'],
  ['youngest', 'Youngest'], ['oldest_age', 'Oldest'], ['education', 'Highest education'], ['rating', 'Starred & rating'], ['risk', 'Highest risk'], ['versions', 'Most CVs sent']
];
const STATUS_LABELS = { new: 'New', reviewing: 'Reviewing', shortlisted: 'Shortlisted', interview: 'Interview', placed: 'Placed', on_hold: 'On hold', rejected: 'Rejected' };
const STATUS_PILL = { new: 'info', reviewing: 'neutral', shortlisted: 'gold', interview: 'gold', placed: 'ok', on_hold: 'neutral', rejected: 'bad' };
const GENDER = { male: 'M', female: 'F', other: 'O' };
const FILTER_KEYS = ['ageMin', 'ageMax', 'gender', 'city', 'state', 'area', 'line', 'near', 'stops', 'eduMin', 'degree', 'skills', 'expMin', 'expMax', 'status', 'source', 'from', 'to', 'tag', 'applied'];

export async function render(main, ctx) {
  const { user, navigate } = ctx;
  const canEdit = user.role !== 'viewer';
  let meta = { educationLevels: [], statuses: [], cities: [], degrees: [], tags: [] };
  let items = [];
  let total = 0;
  let page = 1;
  let lastQs = null;
  let panel = null;
  let selectedId = null;
  const picked = new Set();
  let loadToken = 0;

  const params = () => new URLSearchParams(location.search);
  const setParams = (changes, { replace = true } = {}) => {
    const p = params();
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) p.delete(k);
      else p.set(k, Array.isArray(v) ? v.join(',') : v);
    }
    const s = p.toString();
    navigate('/candidates' + (selectedId ? '/' + selectedId : '') + (s ? '?' + s : ''), { replace });
  };
  const listParam = (k) => (params().get(k) || '').split(',').filter(Boolean);

  /* ---------- Skeleton ---------- */

  const search = h('input', { type: 'search', placeholder: 'Search name, skill, company, college, phone, email, anything in the CV…', 'aria-label': 'Search candidates', autocomplete: 'off', enterkeyhint: 'search' });
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const filters = h('div', { class: 'filters' });
  const resultLine = h('div', { class: 'resultline' });
  const tbody = h('tbody');
  const more = h('div', { class: 'loadmore' });
  const list = h('div', { class: 'list' },
    h('table', { class: 'grid' }, h('thead', {}, h('tr', {},
      h('th', { class: 'sel' }, canEdit ? h('input', { type: 'checkbox', 'aria-label': 'Select all shown', onchange: (e) => { items.forEach((c) => (e.target.checked ? picked.add(c.id) : picked.delete(c.id))); drawRows(); drawResultLine(); } }) : ''),
      h('th', {}, 'Candidate'), h('th', { class: 'col-mid' }, 'Age'), h('th', { class: 'col-mid' }, 'Location'), h('th', { class: 'col-mid' }, 'Education'), h('th', { class: 'col-wide' }, 'Skills'),
      h('th', { class: 'col-mid' }, 'Exp.'), h('th', { class: 'col-wide' }, 'Status'), h('th', {}, 'Received'), h('th', { title: 'Done' }, 'Done'))), tbody), more);
  const panelBox = h('aside', { class: 'panel', hidden: true, 'aria-label': 'Candidate' });
  const split = h('div', { class: 'split' }, list, panelBox);
  const fileInput = h('input', { type: 'file', multiple: true, accept: '.pdf,.doc,.docx,.rtf,.odt,.txt,.jpg,.jpeg,.png', hidden: true, onchange: (e) => { uploadFiles(e.target.files).catch((err) => toast(err.message, 'bad')); e.target.value = ''; } });

  const sortSel = h('select', { class: 'input', style: { width: 'auto', minHeight: '34px', fontSize: '13.5px' }, 'aria-label': 'Sort', onchange: (e) => setParams({ sort: e.target.value }) },
    SORTS.map(([v, l]) => h('option', { value: v }, l)));

  clear(main, h('div', { class: 'bank' },
    h('div', { class: 'toolbar' },
      h('div', { class: 'row wrap' },
        h('div', { class: 'search' }, icon('search'), search, h('kbd', {}, '/')),
        canEdit ? h('button', { class: 'btn primary', onclick: () => fileInput.click(), title: 'Add CVs by hand (or drag files onto this page)' }, icon('upload'), h('span', {}, 'Add CVs')) : null,
        fileInput),
      tabs, filters, resultLine),
    split));

  search.value = params().get('q') || '';
  search.addEventListener('input', debounce(() => setParams({ q: search.value.trim() }), 220));
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') setParams({ q: search.value.trim() });
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); search.blur(); }
  });

  /* ---------- Tabs and filters ---------- */

  function drawTabs() {
    const v = params().get('view') || 'all';
    clear(tabs, VIEWS.map(([key, label]) => h('button', { class: 'tab' + (v === key ? ' active' : ''), role: 'tab', onclick: () => setParams({ view: key === 'all' ? '' : key }) }, label)));
  }

  function summary(key) {
    const p = params();
    const a = p.get('ageMin');
    const b = p.get('ageMax');
    switch (key) {
      case 'age': return a || b ? 'Age ' + (a || '…') + '–' + (b || '…') : '';
      case 'gender': return listParam('gender').map((g) => cap(g)).join(', ');
      case 'city': {
        const lineLabel = (k) => ((meta.places || { lines: [] }).lines.find((l) => l.key === k) || { label: k }).label;
        const c = [...listParam('line').map(lineLabel), ...(p.get('near') ? ['Near ' + p.get('near') + ' (' + (p.get('stops') || 2) + ')'] : []),
          ...listParam('area'), ...listParam('city'), ...listParam('state')];
        return c.length ? c[0] + (c.length > 1 ? ' +' + (c.length - 1) : '') : '';
      }
      case 'edu': {
        const lvl = (meta.educationLevels.find((l) => String(l.level) === p.get('eduMin')) || {}).label;
        const d = listParam('degree');
        return [lvl ? lvl + '+' : '', d.join(', ')].filter(Boolean).join(' · ');
      }
      case 'skills': {
        const s = listParam('skills');
        return s.length ? s.slice(0, 2).join(', ') + (s.length > 2 ? ' +' + (s.length - 2) : '') : '';
      }
      case 'exp': return p.get('expMin') || p.get('expMax') ? (p.get('expMin') || '0') + '–' + (p.get('expMax') || '…') + ' yrs' : '';
      case 'status': return listParam('status').map((s) => STATUS_LABELS[s]).join(', ');
      case 'source': return listParam('source').map(sourceLabel).join(', ');
      case 'date': return p.get('from') || p.get('to') ? (p.get('from') ? fmtDate(p.get('from')) : '…') + ' – ' + (p.get('to') ? fmtDate(p.get('to')) : 'today') : '';
      case 'tag': return listParam('tag').join(', ');
      default: return '';
    }
  }

  const FILTERS = [
    ['age', 'Age', ['ageMin', 'ageMax'], ageFilter],
    ['gender', 'Gender', ['gender'], genderFilter],
    ['city', 'Location', ['city', 'state', 'area', 'line', 'near', 'stops'], locationFilter],
    ['edu', 'Education', ['eduMin', 'degree'], eduFilter],
    ['skills', 'Skills', ['skills'], skillsFilter],
    ['exp', 'Experience', ['expMin', 'expMax'], expFilter],
    ['status', 'Status', ['status'], statusFilter],
    ['source', 'Source', ['source'], sourceFilter],
    ['date', 'Received', ['from', 'to'], dateFilter],
    ['tag', 'Tag', ['tag'], tagFilter]
  ];

  function drawFilters() {
    const anySet = FILTER_KEYS.some((k) => params().get(k));
    clear(filters,
      h('span', { class: 'muted small row', style: { gap: '5px' } }, icon('filter', 'sm'), 'Filters'),
      FILTERS.map(([key, label, keys, fn]) => {
        const s = summary(key);
        const btn = h('button', { class: 'fbtn' + (s ? ' set' : ''), 'aria-haspopup': 'dialog' }, s || label,
          s ? h('span', { class: 'x', title: 'Clear', onclick: (e) => { e.stopPropagation(); setParams(Object.fromEntries(keys.map((k) => [k, '']))); } }, icon('x', 'sm')) : icon('chevron', 'sm'));
        btn.onclick = () => fn(btn);
        return btn;
      }),
      anySet ? h('button', { class: 'btn ghost sm', onclick: () => setParams(Object.fromEntries(FILTER_KEYS.map((k) => [k, '']))) }, 'Clear all') : null,
      h('span', { class: 'spacer' }),
      sortSel,
      savedMenu());
    sortSel.value = params().get('sort') || '';
  }

  function applyBtn(fn) {
    return h('div', { class: 'row' }, h('span', { class: 'spacer' }), h('button', { class: 'btn primary sm', onclick: () => { fn(); closePopover(); } }, 'Apply'));
  }

  async function facetsFor(keys) {
    const p = Object.fromEntries(params());
    for (const k of keys) delete p[k];
    delete p.page;
    return api('/candidates/facets' + qs(p));
  }

  function ageFilter(btn) {
    const min = h('input', { class: 'input', type: 'number', min: 14, max: 90, placeholder: 'From', value: params().get('ageMin') || '' });
    const max = h('input', { class: 'input', type: 'number', min: 14, max: 90, placeholder: 'To', value: params().get('ageMax') || '' });
    const go = () => setParams({ ageMin: min.value, ageMax: max.value });
    popover(btn, [h('h4', {}, 'Age (years)'),
      h('div', { class: 'range' }, min, h('span', { class: 'muted' }, 'to'), max),
      h('div', { class: 'presets' }, [[18, 25], [25, 30], [30, 35], [35, 45], [45, '']].map(([a, b]) => h('button', { class: 'btn sm', onclick: () => { setParams({ ageMin: a, ageMax: b }); closePopover(); } }, a + (b ? '–' + b : '+')))),
      h('p', { class: 'hint', style: { margin: 0 } }, 'From the date of birth (or stated age) in the CV. People whose age is unknown are left out.'),
      applyBtn(go)]);
  }

  async function checkList(btn, title, key, options, note) {
    const chosen = new Set(listParam(key));
    const box = h('div', { class: 'opt-list' });
    const draw = (opts) => clear(box, opts.map(([value, label, n]) => h('label', { class: 'opt' },
      h('input', { type: 'checkbox', checked: chosen.has(value), onchange: (e) => (e.target.checked ? chosen.add(value) : chosen.delete(value)) }),
      h('span', {}, label), n != null ? h('span', { class: 'n' }, fmtNum(n)) : null)));
    draw(options);
    popover(btn, [h('h4', {}, title), box, note ? h('p', { class: 'hint', style: { margin: 0 } }, note) : null, applyBtn(() => setParams({ [key]: [...chosen] }))]);
    return draw;
  }

  async function genderFilter(btn) {
    const draw = await checkList(btn, 'Gender', 'gender', [['female', 'Female'], ['male', 'Male'], ['other', 'Other'], ['unknown', 'Not stated']]);
    const f = await facetsFor(['gender']);
    const n = (v) => (f.gender.find((x) => x.value === v) || {}).n || 0;
    draw([['female', 'Female', n('female')], ['male', 'Male', n('male')], ['other', 'Other', n('other')], ['unknown', 'Not stated', n('')]]);
  }

  async function locationFilter(btn) {
    const chosen = new Set(listParam('city'));
    const states = new Set(listParam('state'));
    const areas = new Set(listParam('area'));
    const lines = new Set(listParam('line'));
    const places = meta.places || { lines: [], areas: [], regions: [] };

    // Railway lines: one tap each.
    const lineBox = h('div', { class: 'presets' }, places.lines.map((l) => {
      const b = h('button', { class: 'btn sm' + (lines.has(l.key) ? ' on' : ''), title: l.stations.join(' · '), onclick: () => { lines.has(l.key) ? lines.delete(l.key) : lines.add(l.key); b.classList.toggle('on'); } }, l.label);
      return b;
    }));

    // Within N stations of a place.
    const near = h('input', { class: 'input', placeholder: 'e.g. Mulund', value: params().get('near') || '', list: 'gd-places' });
    const stops = h('select', { class: 'input', style: { width: '78px' } }, [1, 2, 3, 4, 5, 6, 8].map((n) => h('option', { value: n, selected: String(n) === (params().get('stops') || '2') }, n)));

    // Areas, with how many candidates live there.
    const findArea = h('input', { class: 'input', placeholder: 'Type an area: Mulund, Bhandup, Vikhroli…' });
    const areaBox = h('div', { class: 'opt-list', style: { maxHeight: '190px' } }, h('div', { class: 'spinner' }));

    const find = h('input', { class: 'input', placeholder: 'Type a city…' });
    const box = h('div', { class: 'opt-list', style: { maxHeight: '170px' } });
    const stateBox = h('div', { class: 'opt-list', style: { maxHeight: '130px' } });
    popover(btn, [
      h('h4', {}, 'Railway line'), lineBox,
      h('h4', {}, 'Near a station'), h('div', { class: 'row' }, h('span', { class: 'small muted' }, 'Within'), stops, h('span', { class: 'small muted nowrap' }, 'stations of'), near),
      h('datalist', { id: 'gd-places' }, places.areas.map((a) => h('option', { value: a }))),
      h('h4', {}, 'Area'), findArea, areaBox,
      h('h4', {}, 'City'), find, box, h('h4', {}, 'State'), stateBox,
      applyBtn(() => setParams({ city: [...chosen], state: [...states], area: [...areas], line: [...lines], near: near.value.trim(), stops: near.value.trim() ? stops.value : '' }))]);
    const f = await facetsFor(['city', 'state', 'area', 'line', 'near', 'stops']);

    const areaCounts = Object.fromEntries(f.area.map((a) => [a.value, a.n]));
    const drawAreas = () => {
      const t = findArea.value.trim().toLowerCase();
      const names = [...new Set([...areas, ...f.area.map((a) => a.value), ...(t ? places.areas.filter((a) => a.toLowerCase().includes(t)) : [])])]
        .filter((a) => !t || a.toLowerCase().includes(t)).slice(0, 80);
      clear(areaBox, names.length ? names.map((a) => h('label', { class: 'opt' }, h('input', { type: 'checkbox', checked: areas.has(a), onchange: (e) => (e.target.checked ? areas.add(a) : areas.delete(a)) }),
        h('span', {}, a), h('span', { class: 'n' }, fmtNum(areaCounts[a] || 0)))) : h('p', { class: 'hint' }, t ? 'No such area in the list.' : 'Areas appear here as CVs with addresses come in.'));
    };
    findArea.oninput = drawAreas;
    drawAreas();

    const counts = Object.fromEntries(f.city.map((c) => [c.value, c.n]));
    const draw = () => {
      const t = find.value.trim().toLowerCase();
      const names = [...new Set([...chosen, ...f.city.map((c) => c.value), ...(t ? meta.cities.filter((c) => c.toLowerCase().startsWith(t)) : [])])]
        .filter((c) => !t || c.toLowerCase().includes(t)).slice(0, 60);
      clear(box, names.length ? names.map((c) => h('label', { class: 'opt' }, h('input', { type: 'checkbox', checked: chosen.has(c), onchange: (e) => (e.target.checked ? chosen.add(c) : chosen.delete(c)) }),
        h('span', {}, c), h('span', { class: 'n' }, fmtNum(counts[c] || 0)))) : h('p', { class: 'hint' }, 'No match.'));
    };
    find.oninput = draw;
    draw();
    clear(stateBox, [...new Set([...states, ...f.state.map((s) => s.value)])].map((s) => h('label', { class: 'opt' },
      h('input', { type: 'checkbox', checked: states.has(s), onchange: (e) => (e.target.checked ? states.add(s) : states.delete(s)) }), h('span', {}, s),
      h('span', { class: 'n' }, fmtNum((f.state.find((x) => x.value === s) || {}).n || 0)))));
  }

  async function eduFilter(btn) {
    const sel = h('select', { class: 'input' }, h('option', { value: '' }, 'Any'), meta.educationLevels.filter((l) => l.level > 0).map((l) => h('option', { value: l.level, selected: params().get('eduMin') === String(l.level) }, l.label + ' or higher')));
    const chosen = new Set(listParam('degree'));
    const degBox = h('div', { class: 'presets' }, meta.degrees.map((d) => {
      const b = h('button', { class: 'btn sm' + (chosen.has(d) ? ' on' : ''), onclick: () => { chosen.has(d) ? chosen.delete(d) : chosen.add(d); b.classList.toggle('on'); } }, d);
      return b;
    }));
    popover(btn, [h('h4', {}, 'Highest education'), sel, h('h4', {}, 'Must have degree'), meta.degrees.length ? degBox : h('p', { class: 'hint' }, 'Degrees appear here as CVs come in.'),
      applyBtn(() => setParams({ eduMin: sel.value, degree: [...chosen] }))]);
  }

  async function skillsFilter(btn) {
    const chosen = listParam('skills');
    const chips = h('div', { class: 'row wrap' });
    const input = h('input', { class: 'input', placeholder: 'Type a skill, e.g. Tally, GST, SAP…' });
    const sugg = h('div', { class: 'opt-list', style: { maxHeight: '200px' } });
    const drawChips = () => clear(chips, chosen.length ? chosen.map((s) => h('span', { class: 'chip hit' }, s, h('button', { 'aria-label': 'Remove ' + s, onclick: () => { chosen.splice(chosen.indexOf(s), 1); drawChips(); } }, icon('x', 'sm')))) : h('span', { class: 'hint' }, 'Candidates must have every skill you add.'));
    const add = (s) => { if (s && !chosen.some((c) => c.toLowerCase() === s.toLowerCase())) chosen.push(s); input.value = ''; drawChips(); suggest(); };
    const suggest = debounce(async () => {
      const r = input.value.trim() ? await api('/skills' + qs({ q: input.value.trim() })) : { items: (await facetsFor(['skills'])).skills.slice(0, 25).map((s) => ({ skill: s.value, n: s.n })) };
      clear(sugg, r.items.filter((x) => !chosen.includes(x.skill)).map((x) => h('button', { class: 'opt', style: { border: 0, background: 'none', width: '100%' }, onclick: () => add(x.skill) }, h('span', {}, x.skill), h('span', { class: 'n' }, x.n ? fmtNum(x.n) : ''))));
    }, 150);
    input.oninput = suggest;
    input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); add(input.value.trim()); } };
    drawChips();
    suggest();
    popover(btn, [h('h4', {}, 'Skills'), chips, input, sugg, applyBtn(() => setParams({ skills: chosen }))]);
  }

  function expFilter(btn) {
    const min = h('input', { class: 'input', type: 'number', min: 0, step: '0.5', placeholder: 'Min', value: params().get('expMin') || '' });
    const max = h('input', { class: 'input', type: 'number', min: 0, step: '0.5', placeholder: 'Max', value: params().get('expMax') || '' });
    popover(btn, [h('h4', {}, 'Total experience (years)'), h('div', { class: 'range' }, min, h('span', { class: 'muted' }, 'to'), max),
      h('div', { class: 'presets' }, [['Fresher', 0, 0], ['0–2', 0, 2], ['2–5', 2, 5], ['5–10', 5, 10], ['10+', 10, '']].map(([l, a, b]) => h('button', { class: 'btn sm', onclick: () => { setParams({ expMin: a, expMax: b }); closePopover(); } }, l))),
      applyBtn(() => setParams({ expMin: min.value, expMax: max.value }))]);
  }

  async function statusFilter(btn) {
    const draw = await checkList(btn, 'Status', 'status', Object.entries(STATUS_LABELS));
    const f = await facetsFor(['status']);
    draw(Object.entries(STATUS_LABELS).map(([v, l]) => [v, l, (f.status.find((x) => x.value === v) || {}).n || 0]));
  }

  function sourceFilter(btn) {
    checkList(btn, 'Came from', 'source', [['email', 'Email (mailboxes)'], ['website', 'Website'], ['upload', 'Added by hand']]);
  }

  function dateFilter(btn) {
    const from = h('input', { class: 'input', type: 'date', value: params().get('from') || '' });
    const to = h('input', { class: 'input', type: 'date', value: params().get('to') || '' });
    const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
    popover(btn, [h('h4', {}, 'Latest CV received'), h('div', { class: 'range' }, from, h('span', { class: 'muted' }, 'to'), to),
      h('div', { class: 'presets' }, [['Today', 0], ['7 days', 7], ['30 days', 30], ['6 months', 182], ['1 year', 365]].map(([l, n]) => h('button', { class: 'btn sm', onclick: () => { setParams({ from: daysAgo(n), to: '' }); closePopover(); } }, l)),
        h('button', { class: 'btn sm', title: 'People who have not sent a CV for over a year', onclick: () => { setParams({ from: '', to: daysAgo(365) }); closePopover(); } }, 'Older than 1 year')),
      applyBtn(() => setParams({ from: from.value, to: to.value }))]);
  }

  function tagFilter(btn) {
    if (!meta.tags.length) {
      popover(btn, [h('h4', {}, 'Tag'), h('p', { class: 'hint' }, 'No tags yet. Open a candidate → More → Tags to add your own groups.')]);
      return;
    }
    checkList(btn, 'Tag', 'tag', meta.tags.map((t) => [t, t]));
  }

  /* ---------- Saved searches ---------- */

  function savedMenu() {
    const btn = h('button', { class: 'btn sm', title: 'Saved searches' }, icon('save', 'sm'), h('span', {}, 'Saved'));
    btn.onclick = async () => {
      const box = h('div', { class: 'stack', style: { gap: '4px' } }, h('div', { class: 'spinner' }));
      popover(btn, [h('h4', {}, 'Saved searches'), box,
        h('button', { class: 'btn sm', onclick: async () => {
          closePopover();
          const name = await promptBox('Save this search', { label: 'Name', placeholder: 'e.g. Accountants in Thane, 2–5 yrs' });
          if (!name) return;
          const q = Object.fromEntries(params());
          await api('/searches', { method: 'POST', body: { name, query: q } });
          toast('Search saved');
        } }, icon('plus', 'sm'), 'Save current search'),
        canEdit ? h('a', { class: 'btn sm', href: '/api/export.csv' + location.search, download: '' }, icon('download', 'sm'), 'Export these to Excel (CSV)') : null]);
      const r = await api('/searches');
      clear(box, r.items.length ? r.items.map((s) => h('div', { class: 'row' },
        h('button', { class: 'opt grow', style: { border: 0, background: 'none' }, onclick: () => { closePopover(); navigate('/candidates' + qs(s.query)); } }, h('span', {}, s.name), h('span', { class: 'n' }, fmtNum(s.count))),
        h('button', { class: 'btn ghost icon sm', 'aria-label': 'Delete', onclick: async () => { await api('/searches/' + s.id, { method: 'DELETE' }); closePopover(); toast('Deleted'); } }, icon('trash', 'sm'))))
        : h('p', { class: 'hint', style: { margin: 0 } }, 'None yet. Set up filters, then save them here to reuse with one tap.'));
    };
    return btn;
  }

  /* ---------- Results ---------- */

  function drawResultLine(tookMs) {
    const parts = [h('span', {}, h('b', {}, fmtNum(total)), ' candidate' + (total === 1 ? '' : 's'), tookMs != null ? ' · ' + tookMs + ' ms' : '')];
    if (picked.size && canEdit) {
      parts.push(h('span', { class: 'pill gold' }, picked.size + ' selected'),
        h('button', { class: 'btn sm', onclick: () => openEmailDialog({ ids: [...picked], label: picked.size + ' candidate' + (picked.size > 1 ? 's' : ''), user, navigate, onDone: () => { picked.clear(); drawRows(); drawResultLine(); } }) }, icon('mail', 'sm'), 'Email'),
        h('button', { class: 'btn primary sm', onclick: () => openShareDialog({ ids: [...picked], label: picked.size + ' candidate' + (picked.size > 1 ? 's' : ''), onDone: () => { picked.clear(); load(true); } }) }, icon('send', 'sm'), 'Share with company'),
        h('button', { class: 'btn sm', onclick: () => bulk('done') }, icon('check', 'sm'), 'Mark done'),
        h('button', { class: 'btn sm', onclick: async () => { const tag = await promptBox('Tag ' + picked.size + ' candidates', { label: 'Tag' }); if (tag) bulk('tag', { tag }); } }, 'Tag'),
        h('button', { class: 'btn sm', onclick: () => bulk('star') }, icon('star', 'sm'), 'Star'),
        h('button', { class: 'btn ghost sm', onclick: () => { picked.clear(); drawRows(); drawResultLine(); } }, 'Clear selection'));
    }
    clear(resultLine, parts);
  }

  async function bulk(action, extra = {}) {
    const ids = [...picked];
    if (action === 'done' && !await confirmBox('Mark ' + ids.length + ' as done?', 'They stay in the databank with a done tick.', { label: 'Mark done' })) return;
    await api('/candidates/bulk', { method: 'POST', body: { ids, action, ...extra } });
    toast('Updated ' + ids.length);
    picked.clear();
    load(true);
  }

  function row(c) {
    const a = age(c);
    const tr = h('tr', { class: [c.id === selectedId ? 'active' : '', c.done ? 'is-done' : '', c.blacklisted ? 'is-black' : ''].join(' '), dataset: { id: c.id },
      onclick: (e) => { if (!e.target.closest('input, button, a')) open(c.id); } },
    h('td', { class: 'sel m-hide' }, canEdit ? h('input', { type: 'checkbox', checked: picked.has(c.id), 'aria-label': 'Select ' + c.name, onchange: (e) => { e.target.checked ? picked.add(c.id) : picked.delete(c.id); drawResultLine(); } }) : ''),
    h('td', { class: 'who' },
      h('b', {}, c.name || 'Unnamed',
        h('span', { class: 'flags' },
          c.starred ? h('span', { title: 'Starred', style: { color: 'var(--accent)' } }, icon('star', 'sm')) : null,
          c.blacklisted ? h('span', { class: 'risk-3', title: 'Blacklisted' }, icon('ban', 'sm')) : null,
          c.risk ? h('span', { class: 'risk-' + c.risk, title: RISK[c.risk] + ' risk: ' + c.open_flags + ' change(s) to check' }, icon('alert', 'sm')) : null,
          c.cv_count > 1 ? h('span', { class: 'count', title: c.cv_count + ' CVs over time' }, c.cv_count) : null,
          c.done && c.last_seen_at > c.done_at ? h('span', { class: 'pill gold', title: 'Sent a new CV after being marked done' }, 'Back') : null,
          c.needs_review ? h('span', { class: 'pill warn', title: 'Scanned CV — details need reading by hand' }, 'Scan') : null)),
      h('div', { class: 'sub ellipsis' }, [c.current_title || c.applied_for, c.email, c.phone].filter(Boolean).join(' · '))),
    h('td', { class: 'nowrap m-hide col-mid' }, a ? a + (GENDER[c.gender] ? ' ' + GENDER[c.gender] : '') : (GENDER[c.gender] || h('span', { class: 'faint' }, '—'))),
    h('td', { class: 'm-hide col-mid' }, [c.area, c.city !== c.area ? c.city : ''].filter(Boolean).join(', ') || c.state || h('span', { class: 'faint' }, '—')),
    h('td', { class: 'm-hide col-mid' }, c.degrees.length ? c.degrees.slice(0, 2).join(', ') : h('span', { class: 'faint' }, '—')),
    h('td', { class: 'col-wide m-hide' }, h('div', { class: 'skills' }, c.skills.slice(0, 3).map((s) => h('span', { class: 'chip' }, s)), c.skills.length > 3 ? h('span', { class: 'chip miss', title: c.skills.slice(3).join(', ') }, '+' + (c.skills.length - 3)) : null)),
    h('td', { class: 'nowrap m-hide col-mid' }, fmtExp(c.experience_years)),
    h('td', { class: 'col-wide m-hide' }, h('span', { class: 'pill ' + STATUS_PILL[c.status] }, STATUS_LABELS[c.status] || c.status)),
    h('td', { class: 'nowrap small muted', title: fmtDate(c.last_seen_at, true) + ' · ' + sourceLabel(c.last_source) }, ago(c.last_seen_at)),
    h('td', {}, h('button', { class: 'done-tick' + (c.done ? ' on' : ''), 'aria-label': c.done ? 'Done. Click to undo' : 'Mark done', title: c.done ? 'Done ' + fmtDate(c.done_at) : 'Mark done', disabled: !canEdit,
      onclick: async () => {
        await api('/candidates/' + c.id + '/done', { method: 'POST', body: { done: !c.done } });
        c.done = c.done ? 0 : 1;
        c.done_at = c.done ? new Date().toISOString() : null;
        tr.replaceWith(row(c));
        if (panel && panel.id === c.id) open(c.id, true);
      } }, c.done ? icon('check') : null)),
    h('td', { class: 'm-full m-only small muted' }));
    // Phone layout: one summary line under the name.
    const mobileLine = tr.lastChild;
    mobileLine.textContent = [a ? a + ' yrs' : '', cap(c.gender), c.area || c.city, c.degrees[0], c.experience_years != null ? fmtExp(c.experience_years) : ''].filter(Boolean).join(' · ');
    return tr;
  }

  function drawRows() {
    clear(tbody, items.map(row));
    if (!items.length) {
      const filtered = [...params().keys()].some((k) => k !== 'sort');
      clear(tbody, h('tr', {}, h('td', { colspan: 10 }, h('div', { class: 'empty' }, icon(filtered ? 'search' : 'inbox'),
        h('h3', {}, filtered ? 'No one matches' : 'The databank is empty'),
        h('p', {}, filtered ? 'Try fewer filters or other words.' : 'Connect the HR mailbox and website in Settings, or drop CV files here.'),
        !filtered && user.role === 'owner' ? h('a', { class: 'btn primary', href: '/settings', 'data-link': '' }, 'Open Settings') : null))));
    }
    clear(more, items.length < total ? h('button', { class: 'btn', onclick: () => { page++; load(false); } }, 'Show more (' + fmtNum(total - items.length) + ' left)') : null);
  }

  async function load(reset) {
    const token = ++loadToken;
    if (reset) page = 1;
    const p = Object.fromEntries(params());
    try {
      const r = await api('/candidates' + qs({ ...p, page, pageSize: 50 }));
      if (token !== loadToken) return;
      items = reset ? r.items : [...items, ...r.items];
      total = r.total;
      drawRows();
      drawResultLine(r.tookMs);
    } catch (err) {
      toast(err.message, 'bad');
    }
  }

  /* ---------- Panel ---------- */

  function open(id, force = false) {
    if (id === selectedId && !force) return;
    selectedId = id;
    const s = location.search;
    navigate('/candidates/' + id + s);
  }

  function showPanel(id) {
    if (panel && panel.id === id) return;
    if (panel) panel.destroy();
    panel = null;
    selectedId = id;
    for (const tr of tbody.querySelectorAll('tr[data-id]')) tr.classList.toggle('active', Number(tr.dataset.id) === id);
    if (!id) {
      panelBox.hidden = true;
      split.classList.remove('open');
      return;
    }
    panelBox.hidden = false;
    split.classList.add('open');
    panel = openCandidate(panelBox, id, {
      user, meta, query: params(), navigate,
      onChange: () => { load(true); ctx.refreshCounts(); },
      onClose: () => { selectedId = null; navigate('/candidates' + location.search); }
    });
    const tr = tbody.querySelector('tr[data-id="' + id + '"]');
    if (tr) tr.scrollIntoView({ block: 'nearest' });
  }

  function move(step) {
    if (!items.length) return;
    const i = items.findIndex((c) => c.id === selectedId);
    const next = items[Math.max(0, Math.min(items.length - 1, i + step))];
    if (next) open(next.id);
  }

  const onKey = (e) => {
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('.overlay')) return;
    if (e.key === '/') { e.preventDefault(); search.focus(); search.select(); }
    else if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Escape' && selectedId) { selectedId = null; navigate('/candidates' + location.search); }
    else if (panel && ['d', 's', 'b'].includes(e.key)) panel.key(e.key);
    else if (panel && /^[1-4]$/.test(e.key)) panel.tab(Number(e.key));
  };
  document.addEventListener('keydown', onKey);
  const onChanged = () => load(true);
  window.addEventListener('bank:changed', onChanged);

  function update({ parts }) {
    const s = params();
    s.delete('shared');
    const key = s.toString();
    if (key !== lastQs) {
      lastQs = key;
      if (document.activeElement !== search) search.value = s.get('q') || '';
      drawTabs();
      drawFilters();
      load(true);
      if (panel) panel.reloadQuery(params());
    }
    showPanel(Number(parts[1]) || null);
  }

  meta = await api('/meta').catch(() => meta);
  update({ parts: ctx.parts });

  return {
    update,
    cleanup() {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('bank:changed', onChanged);
      if (panel) panel.destroy();
      closePopover();
    }
  };
}
