// Write one email to many candidates. Each person gets their own copy, with their name filled in.

import { h, clear, icon, toast, modal, fmtDate, debounce } from '../ui.js';
import { api } from '../api.js';

const FIELDS = [['first_name', 'First name'], ['name', 'Full name'], ['applied_for', 'Job applied for'], ['city', 'City'], ['area', 'Area'],
  ['current_title', 'Current job title'], ['experience', 'Experience']];

const pad = (n) => String(n).padStart(2, '0');
const localInput = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());

export async function openEmailDialog({ ids, label, user, navigate, onDone }) {
  let senders;
  try {
    senders = (await api('/mail-accounts/senders')).items;
  } catch (err) {
    toast(err.message, 'bad');
    return;
  }
  if (!senders.length) {
    modal({
      title: 'Connect a mailbox for sending first',
      body: [h('p', { style: { margin: 0 } }, 'Emails go out from one of your own mailboxes (for example hr@guardiansindia.com), so replies come back to you.'),
        user.role === 'owner' ? h('p', { class: 'hint', style: { margin: 0 } }, 'Open Settings → Mailboxes, edit the mailbox and tick "Send email from this mailbox".')
          : h('p', { class: 'hint', style: { margin: 0 } }, 'Ask the owner to turn on sending for a mailbox in Settings → Mailboxes.')],
      actions: user.role === 'owner' ? [{ label: 'Cancel' }, { label: 'Open Settings', kind: 'primary', onClick: () => navigate('/settings/mailboxes') }] : [{ label: 'OK', kind: 'primary' }]
    });
    return;
  }

  const from = h('select', { class: 'input' }, senders.map((s) => h('option', { value: s.id }, (s.from_name ? s.from_name + ' <' + s.email + '>' : s.email) + ' · ' + s.sent_today + '/' + s.daily_limit + ' today')));
  const subject = h('input', { class: 'input', placeholder: 'e.g. Interview for {{applied_for}} — The Guardians', maxlength: 250 });
  const body = h('textarea', { class: 'input', style: { minHeight: '190px' } },
    'Dear {{first_name}},\n\nWe have an opening that matches your profile. Please reply to this email or call us to schedule an interview.\n\n');
  const files = h('input', { type: 'file', multiple: true, accept: '.pdf,.doc,.docx,.jpg,.png,.xlsx' });
  const when = h('input', { class: 'input', type: 'datetime-local', min: localInput(new Date()), value: localInput(new Date(Date.now() + 3600e3)) });
  const later = h('input', { type: 'radio', name: 'gd-when', value: 'later' });
  const now = h('input', { type: 'radio', name: 'gd-when', value: 'now', checked: true });
  const preview = h('div', { class: 'paper', style: { width: '100%', padding: '16px 18px', fontSize: '13.5px', boxShadow: 'none', border: '1px solid var(--line)', maxHeight: '260px', overflow: 'auto' } });
  const previewHead = h('div', { class: 'small muted' });

  let lastFocus = body;
  subject.addEventListener('focus', () => { lastFocus = subject; });
  body.addEventListener('focus', () => { lastFocus = body; });
  const insert = (key) => {
    const el = lastFocus;
    const tag = '{{' + key + '}}';
    const at = el.selectionStart ?? el.value.length;
    el.value = el.value.slice(0, at) + tag + el.value.slice(el.selectionEnd ?? at);
    el.focus();
    el.selectionStart = el.selectionEnd = at + tag.length;
    refresh();
  };

  const refresh = debounce(async () => {
    try {
      const p = await api('/campaigns/preview', { method: 'POST', body: { accountId: Number(from.value), candidateId: ids[0], subject: subject.value, body: body.value } });
      clear(previewHead, 'To ', h('b', {}, p.to || '(first person)'), ' · Subject: ', h('b', {}, p.subject || '—'));
      clear(preview, p.text);
    } catch { /* keep the old preview */ }
  }, 300);
  subject.addEventListener('input', refresh);
  body.addEventListener('input', refresh);
  from.addEventListener('change', refresh);
  when.addEventListener('input', () => { later.checked = true; });

  const quick = (labelText, date) => h('button', { class: 'btn sm', type: 'button', onclick: () => { when.value = localInput(date); later.checked = true; } }, labelText);
  const at = (days, hour) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(hour, 0, 0, 0); return d; };
  const nextMonday = () => { const d = at(((8 - new Date().getDay()) % 7) || 7, 10); return d; };

  modal({
    title: 'Email ' + label,
    wide: true,
    body: [
      h('div', { class: 'banner info' }, icon('mail'), h('div', {}, 'Each person gets their own email; nobody sees the others. People with no email address, or on the blacklist, are skipped. Replies come to the mailbox you send from.')),
      h('div', { class: 'form-grid' }, h('label', { class: 'field' }, h('span', {}, 'From'), from)),
      h('label', { class: 'field' }, h('span', {}, 'Subject'), subject),
      h('label', { class: 'field' }, h('span', {}, 'Message'), body),
      h('div', { class: 'row wrap' }, h('span', { class: 'small muted' }, 'Insert:'), FIELDS.map(([k, l]) => h('button', { class: 'chip', type: 'button', style: { cursor: 'pointer' }, onclick: () => insert(k) }, l))),
      h('label', { class: 'field' }, h('span', {}, 'Attachments (optional, up to 5 files, 10 MB)'), files),
      h('div', { class: 'stack', style: { gap: '8px' } },
        h('label', { class: 'check' }, now, 'Send now'),
        h('div', { class: 'row wrap' }, h('label', { class: 'check' }, later, 'Send at'), h('div', { style: { width: '230px' } }, when),
          quick('Tomorrow 10:00', at(1, 10)), quick('Monday 10:00', nextMonday()))),
      h('div', { class: 'stack', style: { gap: '6px' } }, h('b', { class: 'small' }, 'Preview for the first person'), previewHead, preview)
    ],
    actions: [
      { label: 'Cancel' },
      { label: 'Send a test to me', onClick: async () => {
        try {
          const r = await api('/campaigns/test', { method: 'POST', body: { accountId: Number(from.value), candidateId: ids[0], subject: subject.value, body: body.value } });
          toast('Test sent to ' + r.to);
        } catch (err) { toast(err.message, 'bad'); }
        return false;
      } },
      { label: 'Send', kind: 'primary', onClick: async () => {
        if (!subject.value.trim() || !body.value.trim()) { toast('Write a subject and a message.', 'bad'); return false; }
        const sendAt = later.checked ? new Date(when.value) : null;
        if (later.checked && (Number.isNaN(sendAt.getTime()) || sendAt.getTime() < Date.now() - 60e3)) { toast('Choose a time in the future.', 'bad'); return false; }
        const form = new FormData();
        form.append('data', JSON.stringify({ accountId: Number(from.value), subject: subject.value, body: body.value, candidateIds: ids, sendAt: sendAt ? sendAt.toISOString() : null }));
        for (const f of files.files) form.append('files', f, f.name);
        try {
          const r = await api('/campaigns', { method: 'POST', form });
          toast(later.checked ? 'Scheduled: ' + r.total + ' email' + (r.total > 1 ? 's' : '') + ' on ' + fmtDate(r.sendAt, true) : 'Sending ' + r.total + ' email' + (r.total > 1 ? 's' : '') + '…');
          if (onDone) onDone();
          navigate('/emails');
        } catch (err) { toast(err.message, 'bad'); return false; }
      } }
    ]
  });
  refresh();
}
