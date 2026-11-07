// Small UI toolkit: element builder, icons, toasts, dialogs, popovers and formatters.
// Text is always set with textContent, never as HTML, so nothing from a CV or an email can run as code.

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

/* ---------- Icons (inline SVG paths) ---------- */

const PATHS = {
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3',
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  users: 'M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM22 19v-1a4 4 0 0 0-3-3.9M16 3.1a3.5 3.5 0 0 1 0 6.8',
  alert: 'M12 3 2 20h20L12 3zM12 10v4M12 17h.01',
  copy: 'M8 8h11v13H8zM5 16H4V3h11v1',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01',
  inbox: 'M3 13h5l2 3h4l2-3h5M5 5h14l2 8v6H3v-6z',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  check: 'M4 12.5 9.5 18 20 6',
  send: 'M22 2 11 13M22 2l-7 20-4-9-9-4z',
  x: 'M6 6l12 12M18 6 6 18',
  plus: 'M12 5v14M5 12h14',
  upload: 'M12 16V4M7 9l5-5 5 5M4 16v4h16v-4',
  download: 'M12 4v12M7 11l5 5 5-5M4 20h16',
  file: 'M14 3H6v18h12V7zM14 3v4h4M9 13h6M9 17h6',
  star: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z',
  ban: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM5.6 5.6l12.8 12.8',
  mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18',
  layers: 'M12 3 2 8l10 5 10-5-10-5zM2 13l10 5 10-5M2 17.5l10 5 10-5',
  filter: 'M3 5h18l-7 8v6l-4 2v-8z',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  logout: 'M9 21H4V3h5M16 17l5-5-5-5M21 12H9',
  back: 'M15 18l-6-6 6-6',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  refresh: 'M21 12a9 9 0 1 1-2.6-6.4L21 8M21 3v5h-5',
  zoomIn: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3M11 8v6M8 11h6',
  zoomOut: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3M8 11h6',
  external: 'M14 3h7v7M10 14 21 3M19 14v7H3V5h7',
  shield: 'M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  key: 'M15 7a4 4 0 1 1-3.9 5H3v3h3v3h3v-3h2.1A4 4 0 0 1 15 7z',
  merge: 'M6 3v6a6 6 0 0 0 6 6h6M15 12l3 3-3 3M6 21v-6',
  split: 'M6 3v18M18 3v6a6 6 0 0 1-6 6M15 6l3-3 3 3',
  trash: 'M4 7h16M10 11v6M14 11v6M5 7l1 14h12l1-14M9 7V4h6v3',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  note: 'M5 3h14v18l-7-4-7 4z',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 3',
  phone: 'M5 3h4l2 5-3 2a11 11 0 0 0 6 6l2-3 5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 5a2 2 0 0 1 2-2z',
  pin: 'M12 21s7-6 7-12a7 7 0 0 0-14 0c0 6 7 12 7 12zM12 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  cap: 'M2 9l10-5 10 5-10 5zM6 11v5c3 2 9 2 12 0v-5',
  briefcase: 'M3 7h18v13H3zM8 7V4h8v3M3 12h18',
  text: 'M4 6h16M4 10h16M4 14h10M4 18h12',
  save: 'M5 3h11l3 3v15H5zM8 3v5h7M8 21v-7h8v7',
  keyboard: 'M2 6h20v12H2zM6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10',
  chevron: 'M6 9l6 6 6-6',
  menu: 'M4 6h16M4 12h16M4 18h16',
  sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4'
};

export function icon(name, cls = '') {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'i ' + cls);
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', PATHS[name] || PATHS.file);
  svg.append(p);
  return svg;
}

/* ---------- Toasts ---------- */

export function toast(message, kind = '') {
  const box = document.getElementById('toasts');
  const t = h('div', { class: 'toast ' + kind, role: 'status' }, icon(kind === 'bad' ? 'alert' : 'check'), h('span', {}, message));
  box.append(t);
  setTimeout(() => t.remove(), kind === 'bad' ? 7000 : 3500);
}

/* ---------- Dialogs ---------- */

export function modal({ title, body, actions = [], wide = false, onClose }) {
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    if (onClose) onClose();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const foot = actions.length ? h('div', { class: 'modal-foot' }, actions.map((a) => h('button', {
    class: 'btn ' + (a.kind || ''), type: a.submit ? 'submit' : 'button',
    onclick: async (e) => {
      if (a.submit) return;
      e.currentTarget.disabled = true;
      try {
        const keep = await (a.onClick ? a.onClick() : null);
        if (keep !== false) close();
      } finally {
        if (e.currentTarget) e.currentTarget.disabled = false;
      }
    }
  }, a.label))) : null;
  const box = h('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'modal-head' }, h('h2', { class: 'grow' }, title), h('button', { class: 'btn ghost icon sm', 'aria-label': 'Close', onclick: close }, icon('x'))),
    h('div', { class: 'modal-body' }, body), foot);
  const overlay = h('div', { class: 'overlay', onmousedown: (e) => { if (e.target === overlay) close(); } }, box);
  document.body.append(overlay);
  document.addEventListener('keydown', onKey);
  const first = box.querySelector('input, textarea, select');
  if (first) setTimeout(() => first.focus(), 30);
  return { close, box };
}

export function confirmBox(title, text, { label = 'Confirm', kind = 'primary' } = {}) {
  return new Promise((resolve) => {
    let done = false;
    modal({
      title, body: h('p', { style: { margin: 0 } }, text),
      actions: [
        { label: 'Cancel', onClick: () => { done = true; resolve(false); } },
        { label, kind, onClick: () => { done = true; resolve(true); } }
      ],
      onClose: () => { if (!done) resolve(false); }
    });
  });
}

export function promptBox(title, { label, value = '', placeholder = '', multiline = false, okLabel = 'Save', hint = '' } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const input = multiline ? h('textarea', { class: 'input', placeholder }, value) : h('input', { class: 'input', value, placeholder });
    modal({
      title,
      body: h('label', { class: 'field' }, h('span', {}, label), input, hint ? h('span', { class: 'hint' }, hint) : null),
      actions: [
        { label: 'Cancel', onClick: () => { done = true; resolve(null); } },
        { label: okLabel, kind: 'primary', onClick: () => { done = true; resolve(input.value.trim()); } }
      ],
      onClose: () => { if (!done) resolve(null); }
    });
  });
}

/* ---------- Popover anchored to a button ---------- */

let openPop = null;
export function popover(anchor, content, { onClose } = {}) {
  closePopover();
  const pop = h('div', { class: 'popover', role: 'dialog' }, content);
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  const left = Math.min(r.left, window.innerWidth - pop.offsetWidth - 12);
  pop.style.left = Math.max(12, left) + 'px';
  const below = r.bottom + 8;
  pop.style.top = (below + pop.offsetHeight > window.innerHeight - 12 ? Math.max(12, r.top - pop.offsetHeight - 8) : below) + 'px';
  const away = (e) => { if (!pop.contains(e.target) && !anchor.contains(e.target)) closePopover(); };
  const esc = (e) => { if (e.key === 'Escape') closePopover(); };
  setTimeout(() => document.addEventListener('mousedown', away), 0);
  document.addEventListener('keydown', esc);
  openPop = { pop, cleanup: () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); if (onClose) onClose(); } };
  const first = pop.querySelector('input');
  if (first && window.innerWidth > 860) first.focus();
  return pop;
}
export function closePopover() {
  if (!openPop) return;
  const p = openPop;
  openPop = null;
  p.pop.remove();
  p.cleanup();
}

/* ---------- Tooltip for charts ---------- */

let tipEl = null;
export function showTip(text, x, y) {
  if (!tipEl) {
    tipEl = h('div', { class: 'tip' });
    document.body.append(tipEl);
  }
  tipEl.textContent = text;
  tipEl.hidden = false;
  tipEl.style.left = Math.min(x + 12, window.innerWidth - tipEl.offsetWidth - 8) + 'px';
  tipEl.style.top = (y - 38) + 'px';
}
export function hideTip() { if (tipEl) tipEl.hidden = true; }

/* ---------- Formatting ---------- */

export const fmtNum = (n) => (n == null ? '—' : Number(n).toLocaleString('en-IN'));
export function fmtDate(iso, withTime = false) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) + (withTime ? ', ' + d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '');
}
export function ago(iso) {
  if (!iso) return '—';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  if (s < 86400 * 30) return Math.floor(s / 86400) + ' d ago';
  return fmtDate(iso);
}
export const age = (c) => (c.birth_year ? new Date().getFullYear() - c.birth_year : null);
export const fmtExp = (y) => (y == null ? '—' : y === 0 ? 'Fresher' : (Math.round(y * 10) / 10) + ' yr' + (y === 1 ? '' : 's'));
export const fmtSize = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
export const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
export const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
export const sourceLabel = (s) => ({ email: 'Email', website: 'Website', upload: 'Upload' })[s] || cap(s);
export const RISK = ['', 'Low', 'Medium', 'High'];

// Wraps every occurrence of the search words in <mark>, safely (text nodes only).
export function highlight(text, query) {
  const words = String(query || '').toLowerCase().match(/[\p{L}\p{N}+#.]{2,}/gu) || [];
  const frag = document.createDocumentFragment();
  if (!words.length) {
    frag.append(text);
    return frag;
  }
  const re = new RegExp('(' + words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi');
  let last = 0;
  for (const m of String(text).matchAll(re)) {
    frag.append(text.slice(last, m.index), h('mark', {}, m[0]));
    last = m.index + m[0].length;
  }
  frag.append(text.slice(last));
  return frag;
}

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
