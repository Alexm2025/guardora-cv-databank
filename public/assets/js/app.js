// Guardora app: sign-in, layout, navigation, and the things that work on every screen
// (live status of the mailbox and website feeds, drag-and-drop upload, files shared from the phone).

import { h, clear, icon, toast, modal, initials } from './ui.js';
import { api, setSignedOutHandler } from './api.js';

const root = document.getElementById('app');
const state = { user: null, counts: {}, cleanup: null, view: null };

const VIEWS = {
  '': () => import('./views/dashboard.js'),
  candidates: () => import('./views/candidates.js'),
  alerts: () => import('./views/alerts.js'),
  duplicates: () => import('./views/duplicates.js'),
  match: () => import('./views/match.js'),
  shares: () => import('./views/shares.js'),
  emails: () => import('./views/emails.js'),
  inbox: () => import('./views/inbox.js'),
  settings: () => import('./views/settings.js')
};

const NAV = [
  { path: '', label: 'Overview', icon: 'home' },
  { path: 'candidates', label: 'Candidates', icon: 'users' },
  { path: 'shares', label: 'Shortlists', icon: 'send' },
  { path: 'emails', label: 'Emails', icon: 'mail' },
  { path: 'alerts', label: 'Fraud alerts', icon: 'alert', count: 'alerts' },
  { path: 'duplicates', label: 'Duplicates', icon: 'copy', count: 'duplicates' },
  { path: 'match', label: 'Job match', icon: 'target' },
  { path: 'inbox', label: 'Sources', icon: 'inbox' },
  { path: 'settings', label: 'Settings', icon: 'settings' }
];
const MOBILE_NAV = ['', 'candidates', 'alerts', 'match', 'settings'];

/* ---------- Navigation ---------- */

export function navigate(url, { replace = false } = {}) {
  if (url === location.pathname + location.search) return;
  history[replace ? 'replaceState' : 'pushState'](null, '', url);
  route();
}
window.addEventListener('popstate', () => route());
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-link]');
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  navigate(a.getAttribute('href'));
});

let routeToken = 0;
async function route() {
  if (!state.user) return;
  const parts = location.pathname.replace(/^\/+|\/+$/g, '').split('/');
  const name = VIEWS[parts[0]] ? parts[0] : '';
  const token = ++routeToken;
  for (const a of document.querySelectorAll('[data-nav]')) a.classList.toggle('active', a.dataset.nav === name);
  const main = document.getElementById('main');
  // Staying on the candidates screen (opening another person) keeps the list where it was.
  if (state.view && state.view.name === name && state.view.update) {
    state.view.update({ parts, query: new URLSearchParams(location.search) });
    return;
  }
  if (state.cleanup) state.cleanup();
  state.cleanup = null;
  state.view = null;
  const mod = await VIEWS[name]();
  if (token !== routeToken) return;
  clear(main);
  const ctx = { user: state.user, parts, query: new URLSearchParams(location.search), navigate, refreshCounts, main };
  const view = (await mod.render(main, ctx)) || {};
  state.view = { name, update: view.update };
  state.cleanup = view.cleanup || null;
  document.title = (NAV.find((n) => n.path === name) || NAV[0]).label + ' · Guardora';
}

/* ---------- Counts and feed status (sidebar) ---------- */

async function refreshCounts() {
  try {
    const c = await api('/counts');
    state.counts = c;
    for (const el of document.querySelectorAll('[data-count]')) {
      const n = c[el.dataset.count] || 0;
      el.textContent = n > 999 ? '999+' : n;
      el.hidden = !n;
    }
    const src = document.getElementById('src-mini');
    if (src) {
      const dot = (s) => ({ watching: 'ok', syncing: 'busy', connecting: 'busy', error: 'bad' })[s] || '';
      clear(src,
        h('div', {}, h('span', { class: 'dot ' + dot(c.mailbox) }), 'Mail import · ' + label(c.mailbox)),
        h('div', {}, h('span', { class: 'dot ' + dot(c.website) }), 'Website · ' + label(c.website)),
        h('div', {}, h('span', { class: 'dot ' + dot(({ connected: 'watching', waiting_qr: 'connecting', starting: 'connecting', reconnecting: 'connecting' })[c.whatsapp] || c.whatsapp) }), 'WhatsApp · ' + label(({ connected: 'watching', waiting_qr: 'connecting', starting: 'connecting', reconnecting: 'connecting' })[c.whatsapp] || c.whatsapp)));
    }
  } catch { /* offline: keep the last values */ }
}
const label = (s) => ({ watching: 'live', syncing: 'importing…', connecting: 'connecting…', error: 'problem', disabled: 'off' })[s] || s || '—';

/* ---------- Layout ---------- */

function layout() {
  const u = state.user;
  const navLink = (n, cls = '') => h('a', { href: '/' + n.path, 'data-link': '', 'data-nav': n.path, class: cls },
    icon(n.icon), h('span', {}, n.label), n.count ? h('span', { class: 'count' + (n.count === 'alerts' ? ' alert' : ''), 'data-count': n.count, hidden: true }) : null);

  const side = h('aside', { class: 'side' },
    h('a', { class: 'brand', href: '/', 'data-link': '' }, h('img', { src: '/icons/icon-192.png', alt: '' }), h('span', {}, h('b', {}, 'Guardora'), h('small', {}, 'CV Databank'))),
    h('nav', { class: 'nav', 'aria-label': 'Main' },
      NAV.slice(0, 4).map((n) => navLink(n)),
      h('div', { class: 'nav-label' }, 'Checks'),
      NAV.slice(4, 7).map((n) => navLink(n)),
      h('div', { class: 'nav-label' }, 'System'),
      NAV.slice(7).map((n) => navLink(n))),
    h('div', { class: 'side-foot' },
      h('div', { class: 'source-mini', id: 'src-mini' }),
      h('div', { class: 'me' },
        h('span', { class: 'avatar' }, initials(u.name)),
        h('div', { class: 'grow' }, h('div', { class: 'ellipsis', style: { fontWeight: 700, fontSize: '14px' } }, u.name), h('div', { class: 'tiny muted' }, u.role)),
        themeButton(),
        h('button', { class: 'btn ghost icon sm', title: 'Sign out', 'aria-label': 'Sign out', onclick: signOut }, icon('logout')))));

  const top = h('header', { class: 'mobile-top' },
    h('a', { class: 'brand', href: '/', 'data-link': '' }, h('img', { src: '/icons/icon-192.png', alt: '' }), h('span', {}, h('b', {}, 'Guardora'))),
    h('span', { class: 'spacer' }), themeButton(),
    h('a', { class: 'btn ghost icon sm', href: '/inbox', 'data-link': '', 'aria-label': 'Sources' }, icon('inbox')));

  const bottom = h('nav', { class: 'bottom-nav', 'aria-label': 'Main' }, MOBILE_NAV.map((p) => {
    const n = NAV.find((x) => x.path === p);
    return h('a', { href: '/' + p, 'data-link': '', 'data-nav': p }, icon(n.icon), h('span', {}, p === 'candidates' ? 'Bank' : p === 'alerts' ? 'Alerts' : n.label),
      n.count ? h('span', { class: 'count alert', 'data-count': n.count, hidden: true }) : null);
  }));

  clear(root, h('div', { class: 'shell' }, side, top, h('main', { class: 'main', id: 'main' }), bottom));
}

function themeButton() {
  const btn = h('button', { class: 'btn ghost icon sm', 'aria-label': 'Switch light / dark' });
  const paint = () => clear(btn, icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon'));
  btn.onclick = () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('gd-theme', next); } catch { /* storage blocked */ }
    window.dispatchEvent(new Event('themechange'));
  };
  paint();
  window.addEventListener('themechange', paint);
  return btn;
}

async function signOut() {
  await api('/logout', { method: 'POST' }).catch(() => {});
  location.href = '/';
}

/* ---------- Sign-in screens ---------- */

function authCard(title, subtitle, form) {
  clear(root, h('div', { class: 'auth' }, h('div', { class: 'card auth-card' },
    h('div', { class: 'brand' }, h('img', { src: '/icons/icon-192.png', alt: '' }), h('span', {}, h('b', {}, 'Guardora'), h('small', {}, 'The Guardians CV Databank'))),
    h('div', {}, h('h1', { style: { fontSize: '24px' } }, title), subtitle ? h('p', { class: 'muted', style: { margin: '6px 0 0' } }, subtitle) : null),
    form,
    h('div', { class: 'auth-note' }, icon('lock', 'sm'), 'Private. Encrypted. Every sign-in is recorded.'))));
  const first = form.querySelector('input');
  if (first) first.focus();
}

function formWith(fields, button, onSubmit) {
  const err = h('div', { class: 'banner bad', hidden: true });
  const btn = h('button', { class: 'btn primary', type: 'submit', style: { width: '100%', minHeight: '44px' } }, button);
  const form = h('form', { class: 'stack', novalidate: true }, err, fields, btn);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    btn.disabled = true;
    try {
      await onSubmit(Object.fromEntries(new FormData(form)), form);
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    } finally {
      btn.disabled = false;
    }
  });
  return form;
}

const field = (label, attrs, hint) => h('label', { class: 'field' }, h('span', {}, label), h('input', { class: 'input', ...attrs }), hint ? h('span', { class: 'hint' }, hint) : null);

function showSetup(needsCode) {
  authCard('Set up Guardora', 'Create the owner account. You can add your team later.', formWith([
    needsCode ? field('Setup code', { name: 'setupCode', autocomplete: 'off', required: true, autocapitalize: 'characters' }, 'Shown in the Guardora server window or log.') : null,
    field('Your name', { name: 'name', autocomplete: 'name', required: true }),
    field('Email', { name: 'email', type: 'email', autocomplete: 'username', required: true }),
    field('Password', { name: 'password', type: 'password', autocomplete: 'new-password', required: true, minlength: 10 }, 'At least 10 characters. A short sentence works well.')
  ], 'Create owner account', async (data) => {
    const r = await api('/setup', { method: 'POST', body: data });
    start(r.user);
  }));
}

function showLogin() {
  authCard('Sign in', null, formWith([
    field('Email', { name: 'email', type: 'email', autocomplete: 'username', required: true }),
    field('Password', { name: 'password', type: 'password', autocomplete: 'current-password', required: true }),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'remember', checked: true }), 'Keep me signed in on this device for 30 days')
  ], 'Sign in', async (data) => {
    const r = await api('/login', { method: 'POST', body: { ...data, remember: Boolean(data.remember) } });
    if (r.twoFactor) showTwoFactor(Boolean(data.remember));
    else start(r.user);
  }));
}

function showTwoFactor(remember) {
  authCard('Two-step sign-in', 'Enter the 6-digit code from your authenticator app.', formWith([
    field('Code', { name: 'code', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, required: true, pattern: '[0-9]*' })
  ], 'Verify', async (data) => {
    const r = await api('/login/2fa', { method: 'POST', body: { code: data.code, remember } });
    start(r.user);
  }));
}

/* ---------- Upload: drag and drop anywhere, and files shared from the phone ---------- */

export async function uploadFiles(files) {
  const list = [...files].filter((f) => f.size);
  if (!list.length) return [];
  toast('Importing ' + list.length + ' file' + (list.length > 1 ? 's' : '') + '…');
  const results = [];
  for (let i = 0; i < list.length; i += 20) {
    const form = new FormData();
    for (const f of list.slice(i, i + 20)) form.append('files', f, f.name);
    const r = await api('/upload', { method: 'POST', form });
    results.push(...r.results);
  }
  const added = results.filter((r) => r.outcome === 'added').length;
  const versions = results.filter((r) => r.outcome === 'new_version').length;
  const dupes = results.filter((r) => r.outcome === 'duplicate').length;
  const failed = results.filter((r) => r.outcome === 'error' || r.outcome === 'skipped');
  toast([added && added + ' new', versions && versions + ' new version' + (versions > 1 ? 's' : ''), dupes && dupes + ' already in the bank'].filter(Boolean).join(' · ') || 'Done');
  if (failed.length) toast(failed.length + ' could not be read: ' + failed.map((f) => f.file).join(', '), 'bad');
  window.dispatchEvent(new Event('bank:changed'));
  refreshCounts();
  return results;
}

function enableDropUpload() {
  let depth = 0;
  let zone = null;
  const canEdit = () => state.user && state.user.role !== 'viewer';
  window.addEventListener('dragenter', (e) => {
    if (!canEdit() || ![...(e.dataTransfer?.types || [])].includes('Files')) return;
    depth++;
    if (!zone) {
      zone = h('div', { class: 'dropzone' }, h('div', {}, 'Drop CVs to add them to the databank'));
      document.body.append(zone);
    }
  });
  window.addEventListener('dragleave', () => {
    if (--depth <= 0 && zone) { zone.remove(); zone = null; depth = 0; }
  });
  window.addEventListener('dragover', (e) => { if (zone) e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    if (!zone) return;
    e.preventDefault();
    zone.remove();
    zone = null;
    depth = 0;
    uploadFiles(e.dataTransfer.files).catch((err) => toast(err.message, 'bad'));
  });
}

async function importSharedFiles() {
  if (!new URLSearchParams(location.search).get('shared') || !('caches' in window)) return;
  const cache = await caches.open('guardora-share');
  const keys = await cache.keys();
  const files = [];
  for (const req of keys) {
    const res = await cache.match(req);
    const blob = await res.blob();
    files.push(new File([blob], decodeURIComponent(res.headers.get('X-Name') || 'shared-cv'), { type: blob.type }));
    await cache.delete(req);
  }
  navigate('/candidates', { replace: true });
  if (files.length) uploadFiles(files).catch((err) => toast(err.message, 'bad'));
}

/* ---------- Keyboard help ---------- */

document.addEventListener('keydown', (e) => {
  if (e.key !== '?' || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || !state.user) return;
  const row = (k, t) => [h('span', {}, ...k.map((x) => h('kbd', {}, x))), h('span', {}, t)];
  modal({
    title: 'Keyboard shortcuts',
    body: h('div', { class: 'kbd-help' },
      row(['/'], 'Search'), row(['j', 'k'], 'Next / previous candidate'), row(['d'], 'Tick done / undo'),
      row(['s'], 'Star'), row(['b'], 'Blacklist'), row(['1', '–', '4'], 'Panel tabs: CV, Profile, Versions, Notes'), row(['Esc'], 'Close the candidate panel'))
  });
});

/* ---------- Start ---------- */

function start(user) {
  state.user = user;
  layout();
  route();
  refreshCounts();
  setInterval(refreshCounts, 20000);
  importSharedFiles();
}

setSignedOutHandler(() => {
  if (state.user) location.href = '/';
});

async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  enableDropUpload();
  try {
    const s = await api('/session');
    if (s.user) start(s.user);
    else if (s.setupNeeded) showSetup(s.setupCodeNeeded);
    else showLogin();
  } catch (err) {
    clear(root, h('div', { class: 'auth' }, h('div', { class: 'card auth-card' }, h('h2', {}, 'Cannot reach Guardora'), h('p', { class: 'muted' }, err.message),
      h('button', { class: 'btn primary', onclick: () => location.reload() }, 'Try again'))));
  }
}

boot();
