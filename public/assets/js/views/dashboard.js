// Overview: the numbers that matter today, CV flow over the last 30 days, and what needs attention.

import { h, clear, icon, fmtNum, fmtDate, ago, showTip, hideTip, sourceLabel, RISK } from '../ui.js';
import { api, qs } from '../api.js';

export async function render(main, ctx) {
  const page = h('div', { class: 'page' }, h('div', { class: 'center' }, h('div', { class: 'spinner' })));
  clear(main, page);
  let d;
  try {
    d = await api('/dashboard');
  } catch (err) {
    clear(page, h('div', { class: 'banner bad' }, err.message));
    return;
  }
  const t = d.totals;
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const kpi = (label, value, note, href, ic, tone) => h('a', { class: 'card kpi', href, 'data-link': '' },
    h('span', { class: 'label' }, icon(ic, 'sm'), label),
    h('span', { class: 'value', style: tone ? { color: 'var(--' + tone + ')' } : null }, fmtNum(value)),
    note ? h('span', { class: 'note' }, note) : null);

  const levelLabel = Object.fromEntries([[0, 'Unknown'], [1, 'Below 10th'], [2, '10th'], [3, '12th'], [4, 'Diploma / ITI'], [5, 'Graduate'], [6, 'CA / CS / CMA'], [7, 'Post-graduate'], [8, 'Doctorate']]);

  clear(page,
    h('div', { class: 'page-head' }, h('div', { class: 'grow' }, h('h1', {}, greet + ', ' + ctx.user.name.split(' ')[0]),
      h('p', {}, fmtNum(t.candidates) + ' people and ' + fmtNum(t.cvs) + ' CVs in the databank.')),
    h('a', { class: 'btn primary', href: '/candidates', 'data-link': '' }, icon('search'), 'Search the databank')),
    sourceStrip(d.sources, ctx.user.role === 'owner'),
    h('div', { class: 'kpis' },
      kpi('New people this week', t.new7, fmtNum(t.new30) + ' in 30 days', '/candidates?from=' + daysAgo(7), 'users'),
      kpi('CVs this week', t.cvs7, 'including new versions', '/candidates?from=' + daysAgo(7), 'file'),
      kpi('To do', t.active, 'not done, not blacklisted', '/candidates?view=active', 'check'),
      kpi('High-risk changes', t.highRisk, fmtNum(t.flagged) + ' people flagged in total', '/alerts', 'alert', t.highRisk ? 'bad' : null),
      kpi('Came back after done', t.returned, 'sent a new CV later', '/candidates?view=returned', 'refresh'),
      kpi('Possible duplicates', t.duplicates, 'waiting for a decision', '/duplicates', 'copy'),
      kpi('Blacklisted', t.blacklisted, null, '/candidates?view=blacklisted', 'ban'),
      kpi('Need reading by hand', t.review, 'scanned or photo CVs', '/candidates?view=review', 'text')),
    h('div', { class: 'dash' },
      h('section', { class: 'card span-8' }, h('div', { class: 'card-head' }, h('h3', { class: 'grow' }, 'CVs received per day'), h('span', { class: 'small muted' }, 'Last 30 days')),
        barChart(d.byDay)),
      h('section', { class: 'card span-4' }, h('div', { class: 'card-head' }, h('h3', { class: 'grow' }, 'Needs a look'), h('a', { class: 'small', href: '/alerts', 'data-link': '' }, 'All alerts')),
        d.recentAlerts.length ? h('div', { class: 'list-plain' }, d.recentAlerts.map((a) => h('a', { href: '/candidates/' + a.candidate_id, 'data-link': '' },
          h('span', { class: 'sev s' + a.severity, style: { width: '4px', height: '32px', borderRadius: '2px', flex: 'none' } }),
          h('span', { class: 'grow' }, h('b', { class: 'small' }, a.name || 'Unnamed'), h('div', { class: 'tiny muted', style: { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' } }, a.message)))))
          : h('div', { class: 'empty', style: { padding: '30px 16px' } }, icon('shield'), h('p', { style: { margin: 0 } }, 'Nothing suspicious right now.'))),
      h('section', { class: 'card span-6' }, h('div', { class: 'card-head' }, h('h3', {}, 'Most common skills')),
        hbars(d.topSkills, (s) => '/candidates' + qs({ skills: s.label }))),
      h('section', { class: 'card span-6' }, h('div', { class: 'card-head' }, h('h3', {}, 'Where candidates live')),
        hbars(d.topCities, (s) => '/candidates' + qs({ city: s.label }))),
      h('section', { class: 'card span-6' }, h('div', { class: 'card-head' }, h('h3', {}, 'Highest education')),
        hbars(d.education.filter((e) => e.level > 0).map((e) => ({ label: levelLabel[e.level], n: e.n, level: e.level })), (s) => '/candidates' + qs({ eduMin: s.level }))),
      h('section', { class: 'card span-6' }, h('div', { class: 'card-head' }, h('h3', { class: 'grow' }, 'Latest arrivals'), h('a', { class: 'small', href: '/candidates', 'data-link': '' }, 'Open databank')),
        d.recent.length ? h('div', { class: 'list-plain' }, d.recent.map((c) => h('a', { href: '/candidates/' + c.id, 'data-link': '' },
          h('span', { class: 'grow' }, h('b', { class: 'small' }, c.name || 'Unnamed'), h('div', { class: 'tiny muted' }, [c.applied_for, c.city, sourceLabel(c.last_source)].filter(Boolean).join(' · '))),
          c.risk ? h('span', { class: 'risk-' + c.risk, title: RISK[c.risk] + ' risk' }, icon('alert', 'sm')) : null,
          c.cv_count > 1 ? h('span', { class: 'count', title: c.cv_count + ' CVs' }, c.cv_count) : null,
          h('span', { class: 'tiny muted nowrap' }, ago(c.last_seen_at)))))
          : h('div', { class: 'empty' }, h('p', {}, 'No CVs yet.')))));
}

const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

function sourceStrip(s, owner) {
  const item = (name, st, ic, settingsPage) => {
    const tone = { watching: 'ok', syncing: 'busy', connecting: 'busy', error: 'bad' }[st.state] || '';
    // Not connected yet, or a sign-in problem: take the owner straight to the page that fixes it.
    const fix = owner && (st.state === 'disabled' || (st.state === 'error' && /sign-in/i.test(st.message)));
    return h('a', { class: 'card', href: fix ? '/settings/' + settingsPage : '/inbox', 'data-link': '', style: { display: 'flex', gap: '12px', alignItems: 'center', padding: '12px 16px', textDecoration: 'none', flex: '1', minWidth: '260px' } },
      h('span', { class: 'src-icon', style: { width: '36px', height: '36px' } }, icon(ic)),
      h('span', { class: 'grow' }, h('b', { class: 'small' }, name), h('div', { class: 'tiny muted ellipsis' }, st.message)),
      fix ? h('span', { class: 'btn sm primary' }, st.state === 'disabled' ? 'Connect' : 'Fix') : h('span', { class: 'dot ' + tone }));
  };
  return h('div', { class: 'row wrap', style: { marginBottom: '16px', gap: '12px' } },
    item('Mailboxes', s.mailbox, 'mail', 'mailboxes'), item('Website applications', s.website, 'globe', 'website'));
}

// Single-series bar chart: one hue, bars anchored to the baseline with 4px rounded tops, hover tooltip per bar.
function barChart(days) {
  const W = 720;
  const H = 210;
  const pad = { l: 34, r: 6, t: 10, b: 26 };
  const max = Math.max(4, ...days.map((d) => d.n));
  const nice = Math.ceil(max / 4) * 4;
  const bw = (W - pad.l - pad.r) / days.length;
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / nice);
  const ns = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs) => {
    const e = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    return e;
  };
  const svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'CVs received per day for the last 30 days' });
  for (let i = 0; i <= 4; i++) {
    const v = (nice / 4) * i;
    svg.append(el('line', { class: 'gridline', x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v) }));
    const label = el('text', { class: 'axis', x: pad.l - 6, y: y(v) + 4, 'text-anchor': 'end' });
    label.textContent = v;
    svg.append(label);
  }
  days.forEach((d, i) => {
    const x = pad.l + i * bw + 1;
    const w = Math.max(2, bw - 2);
    const top = y(d.n);
    const hgt = H - pad.b - top;
    const r = Math.min(4, w / 2, hgt);
    if (d.n > 0) {
      const path = el('path', {
        class: 'bar',
        d: 'M' + x + ',' + (H - pad.b) + 'V' + (top + r) + 'Q' + x + ',' + top + ' ' + (x + r) + ',' + top + 'H' + (x + w - r) + 'Q' + (x + w) + ',' + top + ' ' + (x + w) + ',' + (top + r) + 'V' + (H - pad.b) + 'Z'
      });
      svg.append(path);
    }
    // Hit area larger than the bar, so thin bars and zero days are easy to hover.
    const hit = el('rect', { x: pad.l + i * bw, y: pad.t, width: bw, height: H - pad.t - pad.b, fill: 'transparent' });
    const label = new Date(d.day).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + ': ' + d.n + ' CV' + (d.n === 1 ? '' : 's');
    hit.addEventListener('mousemove', (e) => showTip(label, e.clientX, e.clientY));
    hit.addEventListener('mouseleave', hideTip);
    hit.addEventListener('touchstart', (e) => showTip(label, e.touches[0].clientX, e.touches[0].clientY), { passive: true });
    svg.append(hit);
    if ((days.length - 1 - i) % 7 === 0) { // weekly ticks, ending on today
      const t = el('text', { class: 'axis', x: x + w / 2, y: H - 8, 'text-anchor': 'middle' });
      t.textContent = new Date(d.day).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
      svg.append(t);
    }
  });
  const total = days.reduce((s, d) => s + d.n, 0);
  return h('div', { class: 'chart' }, svg, h('p', { class: 'tiny muted', style: { margin: '6px 0 0' } }, fmtNum(total) + ' CVs in 30 days · busiest day: ' +
    (total ? fmtDate(days.reduce((a, b) => (b.n > a.n ? b : a)).day) : '—')));
}

function hbars(rows, link) {
  if (!rows.length) return h('div', { class: 'empty', style: { padding: '30px' } }, h('p', { style: { margin: 0 } }, 'Appears once CVs arrive.'));
  const max = Math.max(...rows.map((r) => r.n));
  return h('div', { class: 'hbars' }, rows.map((r) => h('a', { class: 'hbar', href: link(r), 'data-link': '', title: r.label + ': ' + fmtNum(r.n) },
    h('span', { class: 'ellipsis' }, r.label),
    h('span', { class: 'track' }, h('span', { class: 'fill', style: { width: Math.max(1.5, (r.n / max) * 100) + '%', display: 'block' } })),
    h('span', { class: 'n' }, fmtNum(r.n)))));
}
