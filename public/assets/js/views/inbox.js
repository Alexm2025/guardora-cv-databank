// Sources: live status of the mailbox and website feeds, and a log of every file they brought in (or skipped).

import { h, clear, icon, toast, fmtDate, ago, fmtNum, sourceLabel } from '../ui.js';
import { api, qs } from '../api.js';

const OUTCOMES = { added: ['New person', 'ok'], new_version: ['New version', 'gold'], duplicate: ['Already had it', 'neutral'], skipped: ['Skipped', 'warn'], error: ['Error', 'bad'] };

export async function render(main, ctx) {
  const cards = h('div', { class: 'stack' });
  const logBox = h('div', { class: 'card' });
  let outcome = '';
  let source = '';
  let page = 1;

  clear(main, h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', { class: 'grow' }, h('h1', {}, 'Sources'),
      h('p', {}, 'Guardora runs day and night: it is told about new mail and WhatsApp messages the moment they arrive, and checks the website every 5 minutes.')),
    ctx.user.role !== 'viewer' ? h('button', { class: 'btn', onclick: async () => { await api('/sources/sync', { method: 'POST' }); toast('Checking now…'); setTimeout(drawStatus, 1500); } }, icon('refresh'), 'Check now') : null),
    cards, h('h2', { style: { margin: '26px 0 12px' } }, 'Import log'), logBox));

  async function drawStatus() {
    const s = await api('/sources');
    const src = (title, ic, st, setupNote) => {
      const tone = { watching: 'ok', syncing: 'busy', connecting: 'busy', error: 'bad' }[st.state] || '';
      return h('div', { class: 'card src' },
        h('span', { class: 'src-icon' }, icon(ic, 'lg')),
        h('div', { class: 'stack', style: { gap: '4px' } },
          h('div', { class: 'row' }, h('h3', {}, title), h('span', { class: 'dot ' + tone })),
          h('div', {}, st.message),
          st.progress ? h('div', {}, h('div', { class: 'small muted' }, 'Going through ' + st.progress.mailbox + ': ' + fmtNum(st.progress.done) + ' of ' + fmtNum(st.progress.total) + ' messages'),
            h('div', { class: 'progress' }, h('div', { style: { width: Math.round((st.progress.done / Math.max(1, st.progress.total)) * 100) + '%' } }))) : null,
          h('div', { class: 'small muted' }, [st.lastSyncAt ? 'Last checked ' + ago(st.lastSyncAt) : '', st.imported ? fmtNum(st.imported) + ' CVs imported since the server started' : ''].filter(Boolean).join(' · ')),
          st.lastError && st.state === 'error' ? h('div', { class: 'tiny', style: { color: 'var(--bad)' } }, st.lastError + ' (' + ago(st.lastErrorAt) + ')') : null,
          st.state === 'disabled' && setupNote ? h('div', { class: 'small' }, setupNote) : null),
        ctx.user.role === 'owner' ? h('a', { class: 'btn sm', href: '/settings', 'data-link': '' }, 'Settings') : null);
    };
    clear(cards,
      s.mailboxes.length ? s.mailboxes.filter((m) => m.import_enabled).map((m) => src(m.email + (m.label ? ' — ' + m.label : ''), 'mail', m, ''))
        : src('Mailboxes', 'mail', s.mailbox, 'Connect hr@guardiansindia.com (and any other mailbox) in Settings → Mailboxes.'),
      src('WhatsApp', 'chat', { ...s.whatsapp, state: ({ connected: 'watching', waiting_qr: 'connecting', starting: 'connecting', reconnecting: 'connecting' })[s.whatsapp.state] || s.whatsapp.state }, 'Link a WhatsApp number in Settings → WhatsApp.'),
      src('Website applications', 'globe', s.website, 'Connect guardiansindia.com in Settings → Website.'),
      h('div', { class: 'card src' }, h('span', { class: 'src-icon' }, icon('shield', 'lg')),
        h('div', { class: 'stack', style: { gap: '4px' } }, h('h3', {}, 'Backups'),
          h('div', {}, s.backup.latest ? 'Latest encrypted backup ' + ago(s.backup.latest.created_at) + ' (' + fmtDate(s.backup.latest.created_at, true) + ')' : 'The first backup runs within a few minutes of start-up, then every night.'),
          s.backup.lastError ? h('div', { class: 'tiny', style: { color: 'var(--bad)' } }, s.backup.lastError) : null)));
  }

  async function drawLog() {
    const r = await api('/ingest-log' + qs({ outcome, source, page }));
    const filterBtn = (label, cur, val, set) => h('button', { class: 'fbtn' + (cur === val ? ' set' : ''), onclick: () => { set(val); page = 1; drawLog(); } }, label);
    clear(logBox,
      h('div', { class: 'card-head', style: { flexWrap: 'wrap' } },
        filterBtn('All', outcome, '', (v) => { outcome = v; }),
        Object.entries(OUTCOMES).map(([k, [l]]) => filterBtn(l, outcome, k, (v) => { outcome = v; })),
        h('span', { class: 'spacer' }),
        h('select', { class: 'input', style: { width: 'auto', minHeight: '32px', fontSize: '13px' }, onchange: (e) => { source = e.target.value; page = 1; drawLog(); } },
          [['', 'All sources'], ['email', 'Email'], ['website', 'Website'], ['whatsapp', 'WhatsApp'], ['upload', 'Upload']].map(([v, l]) => h('option', { value: v, selected: source === v }, l)))),
      r.items.length ? h('div', { style: { overflowX: 'auto' } }, h('table', { class: 'log' },
        h('thead', {}, h('tr', {}, h('th', {}, 'When'), h('th', {}, 'Source'), h('th', {}, 'Result'), h('th', {}, 'Details'))),
        h('tbody', {}, r.items.map((l) => h('tr', {},
          h('td', { class: 'nowrap small muted', title: fmtDate(l.created_at, true) }, ago(l.created_at)),
          h('td', { class: 'small' }, sourceLabel(l.source)),
          h('td', {}, h('span', { class: 'pill ' + (OUTCOMES[l.outcome] || ['', 'neutral'])[1] }, (OUTCOMES[l.outcome] || [l.outcome])[0])),
          h('td', { class: 'small' }, l.candidate_id ? h('a', { href: '/candidates/' + l.candidate_id, 'data-link': '' }, l.message) : l.message))))))
        : h('div', { class: 'empty' }, h('p', {}, 'Nothing here yet.')),
      r.total > page * 100 ? h('div', { class: 'loadmore' }, h('button', { class: 'btn', onclick: () => { page++; drawLog(); } }, 'Older')) : null);
  }

  await Promise.all([drawStatus(), drawLog()]).catch((err) => toast(err.message, 'bad'));
  const timer = setInterval(() => drawStatus().catch(() => {}), 5000);
  return { cleanup: () => clearInterval(timer) };
}
