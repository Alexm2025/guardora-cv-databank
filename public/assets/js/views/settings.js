// Settings: connect mailboxes and the website, the team, sign-in security, backups and the audit log.

import { h, clear, icon, toast, modal, confirmBox, promptBox, fmtDate, ago, fmtSize } from '../ui.js';
import { api, qs } from '../api.js';

export async function render(main, ctx) {
  const owner = ctx.user.role === 'owner';
  const SECTIONS = owner
    ? [['mailboxes', 'Mailboxes'], ['website', 'Website'], ['team', 'Team'], ['security', 'My security'], ['backups', 'Backups'], ['audit', 'Audit log'], ['general', 'General']]
    : [['security', 'My security']];
  const asked = ctx.parts[1] === 'mailbox' ? 'mailboxes' : ctx.parts[1]; // old links
  let current = SECTIONS.some(([k]) => k === asked) ? asked : SECTIONS[0][0];
  let settingsTimer = null;
  const nav = h('nav', { class: 'settings-nav' });
  const body = h('div', { class: 'stack' });

  clear(main, h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Settings'))),
    h('div', { class: 'settings' }, nav, body)));

  function show(key) {
    current = key;
    history.replaceState(null, '', '/settings/' + key);
    clear(nav, SECTIONS.map(([k, l]) => h('button', { class: k === key ? 'active' : '', onclick: () => show(k) }, l)));
    clear(body, h('div', { class: 'center' }, h('div', { class: 'spinner' })));
    clearTimeout(settingsTimer);
    ({ mailboxes, website, team, security, backups, audit, general })[key]().catch((err) => clear(body, h('div', { class: 'banner bad' }, err.message)));
  }

  const card = (title, intro, ...content) => h('section', { class: 'card section' }, h('div', {}, h('h2', {}, title), intro ? h('p', { class: 'muted', style: { margin: '6px 0 0' } }, intro) : null), ...content);
  const field = (label, input, hint) => h('label', { class: 'field' }, h('span', {}, label), input, hint ? h('span', { class: 'hint' }, hint) : null);

  /* ---------- Mailboxes ---------- */

  const APP_PASSWORD_HELP = {
    gmail: ['Gmail / Google Workspace needs an app password:', 'Sign in to the mailbox at myaccount.google.com → Security → turn on 2-Step Verification.',
      'Open myaccount.google.com/apppasswords, create one named "Guardora" and copy the 16 letters.', 'In Gmail → Settings → Forwarding and POP/IMAP, make sure IMAP is enabled.'],
    outlook: ['Outlook / Microsoft 365:', 'Personal Outlook.com: turn on two-step verification, then create an app password at account.microsoft.com → Security.',
      'Company Microsoft 365 often blocks app passwords; your IT admin must allow IMAP / SMTP AUTH for this mailbox.'],
    zoho: ['Zoho Mail:', 'Zoho → My Account → Security → App passwords → generate one for "Guardora".', 'In Zoho Mail settings, enable IMAP access.'],
    yahoo: ['Yahoo Mail:', 'Yahoo Account security → Generate app password.'],
    hostinger: ['Hostinger email:', 'Use the mailbox password set in hPanel → Emails.'],
    rediff: ['Rediffmail Pro:', 'Use the mailbox password. IMAP must be enabled for the domain.'],
    titan: ['Titan email:', 'Use the mailbox password. IMAP/SMTP must be enabled in the Titan admin panel.'],
    custom: ['Other provider:', 'Use the mailbox password (or an app password if the provider has them) and the IMAP / SMTP servers your provider gives.']
  };

  async function mailboxes() {
    const r = await api('/mail-accounts');
    const st = Object.fromEntries(r.statuses.map((x) => [x.id, x]));
    const tone = (x) => ({ watching: 'ok', syncing: 'busy', connecting: 'busy', error: 'bad' })[x] || '';
    clear(body, card('Mailboxes', 'Every mailbox Guardora reads CVs from, and the ones you can send email from. Add as many as you like: hr@, jobs@, careers@, a personal Gmail…',
      r.items.length ? h('div', { class: 'stack', style: { gap: '10px' } }, r.items.map((a) => {
        const s = st[a.id] || {};
        return h('div', { class: 'card pad', style: { boxShadow: 'none', display: 'grid', gap: '6px' } },
          h('div', { class: 'row wrap' }, h('b', { class: 'grow' }, a.email + (a.label ? ' — ' + a.label : '')),
            a.import_enabled ? h('span', { class: 'pill info' }, icon('inbox', 'sm'), 'Imports CVs') : h('span', { class: 'pill neutral' }, 'Not importing'),
            a.send_enabled ? h('span', { class: 'pill gold' }, icon('send', 'sm'), 'Sends email · ' + a.daily_limit + '/day') : null),
          a.import_enabled ? h('div', { class: 'row small' }, h('span', { class: 'dot ' + tone(s.state) }), h('span', { class: 'grow' }, s.message || ''),
            s.progress ? h('span', { class: 'muted nowrap' }, s.progress.done + ' / ' + s.progress.total) : null) : null,
          a.import_enabled && s.state === 'error' && s.lastError ? h('div', { class: 'tiny', style: { color: 'var(--bad)' } }, s.lastError) : null,
          h('div', { class: 'tiny muted' }, 'Folders: ' + a.folders + (a.since ? ' · mail since ' + fmtDate(a.since) : '') + ' · added ' + fmtDate(a.created_at)),
          h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: () => mailboxForm(a, r.presets) }, icon('edit', 'sm'), 'Edit'),
            h('button', { class: 'btn sm ghost danger', onclick: async () => {
              if (!await confirmBox('Remove ' + a.email + '?', 'Guardora stops reading and sending through this mailbox. CVs already imported stay in the databank.', { label: 'Remove', kind: 'danger' })) return;
              await api('/mail-accounts/' + a.id, { method: 'DELETE' });
              toast('Removed');
              mailboxes();
            } }, 'Remove')));
      })) : h('div', { class: 'empty', style: { padding: '24px' } }, icon('inbox'), h('p', {}, 'No mailbox connected yet.')),
      h('div', {}, h('button', { class: 'btn primary', onclick: () => mailboxForm(null, r.presets) }, icon('plus', 'sm'), 'Add a mailbox'))));
    clearTimeout(settingsTimer);
    if (current === 'mailboxes' && r.statuses.some((x) => ['syncing', 'connecting'].includes(x.state))) settingsTimer = setTimeout(() => current === 'mailboxes' && mailboxes().catch(() => {}), 4000);
  }

  function mailboxForm(a, presets) {
    const v = a || { email: '', provider: '', folders: 'INBOX', import_enabled: 1, send_enabled: 0, daily_limit: 400, imap_port: 993, smtp_port: 465 };
    const f = (name, attrs = {}) => h('input', { class: 'input', name, value: v[name] ?? '', ...attrs });
    const email = f('email', { type: 'email', disabled: Boolean(a), placeholder: 'e.g. jobs@guardiansindia.com' });
    const provider = h('select', { class: 'input', name: 'provider' }, h('option', { value: '' }, 'Detect from the address'), Object.entries(presets).map(([k, p]) => h('option', { value: k, selected: v.provider === k }, p.label)));
    const password = h('input', { class: 'input', name: 'password', type: 'password', autocomplete: 'new-password', placeholder: a ? '•••••••• (saved; leave empty to keep)' : 'App password' });
    const imp = h('input', { type: 'checkbox', checked: Boolean(v.import_enabled) });
    const snd = h('input', { type: 'checkbox', checked: Boolean(v.send_enabled) });
    const imapHost = f('imap_host');
    const imapPort = f('imap_port', { type: 'number' });
    const smtpHost = f('smtp_host');
    const smtpPort = f('smtp_port', { type: 'number' });
    const help = h('div', { class: 'banner info' });
    const result = h('div');
    const guess = (mail) => {
      const d = (mail.split('@')[1] || '').toLowerCase();
      return /gmail|googlemail|guardiansindia/.test(d) ? 'gmail' : /outlook|hotmail|live/.test(d) ? 'outlook' : /zoho/.test(d) ? 'zoho' : /yahoo|ymail/.test(d) ? 'yahoo' : '';
    };
    const applyPreset = () => {
      const key = provider.value || guess(email.value) || 'custom';
      const p = presets[key];
      if (!a || provider.value) {
        imapHost.value = p.imap_host;
        imapPort.value = p.imap_port;
        smtpHost.value = p.smtp_host;
        smtpPort.value = p.smtp_port;
      }
      const lines = APP_PASSWORD_HELP[key] || APP_PASSWORD_HELP.custom;
      clear(help, icon('key'), h('div', {}, h('b', {}, lines[0]), h('ol', { class: 'steps', style: { marginTop: '4px', color: 'inherit' } }, lines.slice(1).map((l) => h('li', {}, l)))));
    };
    provider.onchange = applyPreset;
    email.oninput = applyPreset;
    applyPreset();
    const form = h('form', { class: 'stack' },
      h('div', { class: 'form-grid' }, field('Email address', email), field('Provider', provider), field('App password', password), field('Name (optional)', f('label', { placeholder: 'e.g. Jobs inbox' }))),
      help,
      h('label', { class: 'check' }, imp, h('b', {}, 'Import CVs from this mailbox')),
      h('div', { class: 'form-grid' }, field('Folders to read', f('folders'), 'INBOX, or "[Gmail]/All Mail" to include archived mail.'), field('Only mail since (optional)', f('since', { type: 'date' }), 'Empty = all mail ever received.')),
      h('label', { class: 'check' }, snd, h('b', {}, 'Send email from this mailbox'), h('span', { class: 'hint' }, '(for "Email" to candidates)')),
      h('div', { class: 'form-grid' }, field('Sender name', f('from_name', { placeholder: 'e.g. The Guardians HR' })), field('Daily limit', f('daily_limit', { type: 'number', min: 1, max: 5000 }), 'Gmail allows about 500 a day, Google Workspace about 2,000. Guardora stays under this.')),
      field('Signature (added to every email)', h('textarea', { class: 'input', name: 'signature', style: { minHeight: '70px' } }, a ? v.signature : 'Regards,\nThe Guardians\nhr@guardiansindia.com')),
      h('details', {}, h('summary', { class: 'small', style: { cursor: 'pointer' } }, 'Server settings'),
        h('div', { class: 'form-grid', style: { marginTop: '10px' } }, field('IMAP server (reading)', imapHost), field('IMAP port', imapPort), field('SMTP server (sending)', smtpHost), field('SMTP port', smtpPort))),
      result);
    const payload = () => ({
      email: email.value.trim(), provider: provider.value, password: password.value, label: form.elements.label.value,
      import_enabled: imp.checked, folders: form.elements.folders.value, since: form.elements.since.value,
      send_enabled: snd.checked, from_name: form.elements.from_name.value, signature: form.elements.signature.value, daily_limit: Number(form.elements.daily_limit.value),
      imap_host: imapHost.value, imap_port: Number(imapPort.value), smtp_host: smtpHost.value, smtp_port: Number(smtpPort.value)
    });
    modal({
      title: a ? 'Edit ' + a.email : 'Add a mailbox', wide: true, body: form,
      actions: [
        { label: 'Cancel' },
        { label: 'Test connection', onClick: async () => {
          clear(result, h('div', { class: 'spinner' }));
          try {
            const t = await api('/mail-accounts/test', { method: 'POST', body: { ...payload(), id: a ? a.id : undefined } });
            clear(result,
              t.imap.ok ? h('div', { class: 'banner ok' }, icon('check'), 'Reading works: ' + t.imap.inboxCount + ' messages in INBOX. Folders: ' + t.imap.mailboxes.join(', '))
                : h('div', { class: 'banner bad' }, icon('alert'), 'Reading failed: ' + t.imap.error),
              t.smtp ? (t.smtp.ok ? h('div', { class: 'banner ok', style: { marginTop: '6px' } }, icon('check'), 'Sending works.')
                : h('div', { class: 'banner bad', style: { marginTop: '6px' } }, icon('alert'), 'Sending failed: ' + t.smtp.error)) : null);
          } catch (err) { clear(result, h('div', { class: 'banner bad' }, err.message)); }
          return false;
        } },
        { label: 'Save', kind: 'primary', onClick: async () => {
          clear(result, h('div', { class: 'spinner' }));
          try {
            await api(a ? '/mail-accounts/' + a.id : '/mail-accounts', { method: a ? 'PUT' : 'POST', body: payload() });
            toast(a ? 'Saved' : 'Mailbox connected. Importing starts now.');
            mailboxes();
          } catch (err) {
            clear(result, h('div', { class: 'banner bad' }, icon('alert'), err.message));
            return false;
          }
        } }
      ]
    });
  }

  /* ---------- Website ---------- */

  async function website() {
    const s = (await api('/settings')).website;
    const enabled = h('input', { type: 'checkbox', checked: s.enabled });
    const url = h('input', { class: 'input', value: s.url });
    const email = h('input', { class: 'input', type: 'email', value: s.email, autocomplete: 'off' });
    const pass = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', placeholder: s.hasPassword ? '•••••••• (saved)' : '' });
    const accounts = h('input', { type: 'checkbox', checked: s.accounts });
    const result = h('div');
    const payload = () => ({ enabled: enabled.checked, url: url.value.trim(), email: email.value.trim(), password: pass.value, accounts: accounts.checked });
    clear(body, card('Website', 'Guardora signs in to the Guardians admin panel and imports every job application with its CV and the details the applicant typed (CTC, notice period, job). It only reads; it never changes the website.',
      h('div', { class: 'banner info' }, icon('shield'), 'Tip: create a separate admin user on the website just for Guardora (Admin → Users → Add user), so you can switch it off any time.'),
      h('label', { class: 'check' }, enabled, h('b', {}, 'Import applications from the website')),
      h('div', { class: 'form-grid' }, field('Website address', url), field('Admin email', email), field('Admin password', pass, s.hasPassword ? 'Leave empty to keep the saved one.' : 'Stored encrypted.')),
      h('label', { class: 'check' }, accounts, 'Also import resumes of job seekers registered on the website'),
      result,
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn', onclick: async () => {
          clear(result, h('div', { class: 'spinner' }));
          const r = await api('/settings/website/test', { method: 'POST', body: payload() });
          clear(result, r.ok ? h('div', { class: 'banner ok' }, icon('check'), 'Signed in. ' + r.applications + ' applications on the website.') : h('div', { class: 'banner bad' }, icon('alert'), r.error));
        } }, 'Test connection'),
        h('button', { class: 'btn primary', onclick: async () => {
          try {
            await api('/settings/website', { method: 'PUT', body: payload() });
            toast('Saved.');
            pass.value = '';
          } catch (err) { clear(result, h('div', { class: 'banner bad' }, icon('alert'), err.message)); }
        } }, 'Save'))));
  }

  /* ---------- Team ---------- */

  async function team() {
    const r = await api('/users');
    const ROLE = { owner: 'Owner — everything', recruiter: 'Recruiter — all candidate work', viewer: 'Viewer — read only' };
    clear(body, card('Team', 'Give colleagues their own sign-in. Every action is recorded under their name.',
      h('div', { style: { overflowX: 'auto' } }, h('table', { class: 'log' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Role'), h('th', {}, '2-step'), h('th', {}, 'Last sign-in'), h('th', {}, ''))),
        h('tbody', {}, r.items.map((u) => h('tr', {},
          h('td', {}, h('b', {}, u.name), h('div', { class: 'tiny muted' }, u.email), u.status === 'disabled' ? h('span', { class: 'pill neutral' }, 'Turned off') : null),
          h('td', {}, h('select', { class: 'input', style: { minHeight: '32px', fontSize: '13px' }, disabled: u.id === ctx.user.id, onchange: async (e) => { await api('/users/' + u.id, { method: 'PATCH', body: { role: e.target.value } }); toast('Role changed'); } },
            Object.entries(ROLE).map(([v, l]) => h('option', { value: v, selected: u.role === v }, l)))),
          h('td', {}, u.totp_enabled ? h('span', { class: 'pill ok' }, 'On') : h('span', { class: 'pill neutral' }, 'Off')),
          h('td', { class: 'small muted' }, u.last_login_at ? ago(u.last_login_at) : 'Never'),
          h('td', { class: 'nowrap' }, u.id !== ctx.user.id ? [
            h('button', { class: 'btn sm ghost', onclick: async () => {
              const p = await promptBox('New password for ' + u.name, { label: 'Password (10+ characters)', okLabel: 'Set password' });
              if (p) { await api('/users/' + u.id, { method: 'PATCH', body: { password: p } }).then(() => toast('Password set. They are signed out everywhere.')).catch((err) => toast(err.message, 'bad')); }
            } }, 'Reset password'),
            u.totp_enabled ? h('button', { class: 'btn sm ghost', onclick: async () => { await api('/users/' + u.id, { method: 'PATCH', body: { resetTwoFactor: true } }); toast('2-step sign-in reset'); team(); } }, 'Reset 2-step') : null,
            h('button', { class: 'btn sm ghost', onclick: async () => { await api('/users/' + u.id, { method: 'PATCH', body: { status: u.status === 'active' ? 'disabled' : 'active' } }); team(); } }, u.status === 'active' ? 'Turn off' : 'Turn on')] : h('span', { class: 'tiny muted' }, 'You'))))))),
      h('div', {}, h('button', { class: 'btn primary', onclick: addUser }, icon('plus', 'sm'), 'Add person'))));
  }

  function addUser() {
    const f = h('form', { class: 'form-grid' },
      field('Name', h('input', { class: 'input', name: 'name' })), field('Email', h('input', { class: 'input', name: 'email', type: 'email' })),
      field('Role', h('select', { class: 'input', name: 'role' }, h('option', { value: 'recruiter' }, 'Recruiter'), h('option', { value: 'viewer' }, 'Viewer'), h('option', { value: 'owner' }, 'Owner'))),
      field('First password', h('input', { class: 'input', name: 'password', type: 'text', autocomplete: 'off' }), 'Share it privately; they can change it under My security.'));
    modal({ title: 'Add a team member', body: f, actions: [{ label: 'Cancel' }, { label: 'Add', kind: 'primary', onClick: async () => {
      try {
        await api('/users', { method: 'POST', body: Object.fromEntries(new FormData(f)) });
        toast('Added');
        team();
      } catch (err) { toast(err.message, 'bad'); return false; }
    } }] });
  }

  /* ---------- My security ---------- */

  async function security() {
    const s = await api('/session');
    const sessions = await api('/account/sessions');
    const cur = h('input', { class: 'input', type: 'password', autocomplete: 'current-password' });
    const next = h('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
    clear(body,
      card('Two-step sign-in', 'After your password, Guardora asks for a code from an authenticator app on your phone. Strongly recommended, because this databank holds personal data.',
        s.user.totpEnabled
          ? h('div', { class: 'row wrap' }, h('span', { class: 'pill ok' }, icon('check', 'sm'), 'On'), h('button', { class: 'btn danger sm', onclick: async () => {
            const p = await promptBox('Turn off two-step sign-in', { label: 'Your password', okLabel: 'Turn off' });
            if (p) { await api('/account/2fa/disable', { method: 'POST', body: { password: p } }).then(() => { toast('Turned off'); security(); }).catch((err) => toast(err.message, 'bad')); }
          } }, 'Turn off'))
          : h('div', {}, h('button', { class: 'btn primary', onclick: setup2fa }, icon('shield', 'sm'), 'Turn on two-step sign-in'))),
      card('Password', null,
        h('div', { class: 'form-grid' }, field('Current password', cur), field('New password', next, '10+ characters. Other devices will be signed out.')),
        h('div', {}, h('button', { class: 'btn primary', onclick: async () => {
          try {
            await api('/account/password', { method: 'POST', body: { current: cur.value, next: next.value } });
            toast('Password changed');
            cur.value = next.value = '';
          } catch (err) { toast(err.message, 'bad'); }
        } }, 'Change password'))),
      card('Signed-in devices', null,
        h('div', { class: 'stack', style: { gap: '6px' } }, sessions.items.map((x) => h('div', { class: 'row', style: { padding: '8px 0', borderBottom: '1px dashed var(--line)' } },
          h('div', { class: 'grow' }, h('div', { class: 'small', style: { fontWeight: 600 } }, deviceName(x.agent), x.current ? h('span', { class: 'pill ok', style: { marginLeft: '6px' } }, 'This device') : null),
            h('div', { class: 'tiny muted' }, 'Active ' + ago(x.last_seen_at) + ' · ' + x.ip + ' · since ' + fmtDate(x.created_at))),
          x.current ? null : h('button', { class: 'btn sm ghost', onclick: async () => { await api('/account/sessions/' + x.id, { method: 'DELETE' }); security(); } }, 'Sign out')))),
        sessions.items.length > 1 ? h('div', {}, h('button', { class: 'btn sm', onclick: async () => { await api('/account/sessions/others/delete', { method: 'POST' }); toast('Signed out everywhere else'); security(); } }, 'Sign out all other devices')) : null));
  }

  const deviceName = (ua) => {
    const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone / iPad' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Device';
    const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Firefox\//.test(ua) ? 'Firefox' : 'App';
    return br + ' on ' + os;
  };

  async function setup2fa() {
    const r = await api('/account/2fa/setup', { method: 'POST' });
    const code = h('input', { class: 'input', inputmode: 'numeric', maxlength: 6, placeholder: '6-digit code', autocomplete: 'one-time-code' });
    modal({
      title: 'Turn on two-step sign-in',
      body: [
        h('ol', { class: 'steps' }, h('li', {}, 'Install Google Authenticator or Microsoft Authenticator on your phone.'), h('li', {}, 'In the app, add an account and scan this code.'), h('li', {}, 'Type the 6-digit code it shows.')),
        h('div', { style: { textAlign: 'center' } }, h('img', { src: r.qr, alt: 'QR code for the authenticator app', width: 220, height: 220, style: { background: '#fff', padding: '8px', borderRadius: '10px' } })),
        h('p', { class: 'hint', style: { textAlign: 'center', margin: 0 } }, 'Cannot scan? Enter this key: ', h('span', { class: 'mono' }, r.secret.replace(/(.{4})/g, '$1 ').trim())),
        code],
      actions: [{ label: 'Cancel' }, { label: 'Turn on', kind: 'primary', onClick: async () => {
        try {
          await api('/account/2fa/enable', { method: 'POST', body: { code: code.value } });
          toast('Two-step sign-in is on');
          security();
        } catch (err) { toast(err.message, 'bad'); return false; }
      } }]
    });
  }

  /* ---------- Backups, audit, general ---------- */

  async function backups() {
    const r = await api('/backups');
    clear(body, card('Backups', 'The database is backed up every night, encrypted with your master key. The newest 30 are kept on the server. Download one now and then and keep it somewhere else too.',
      h('div', { class: 'banner warn' }, icon('key'), h('div', {}, h('b', {}, 'Keep a copy of the master key '), '(the MASTER_KEY setting, or data/master.key) in a safe place, such as a password manager. Without it, backups and CV files cannot be opened.')),
      r.items.length ? h('table', { class: 'log' }, h('tbody', {}, r.items.map((b) => h('tr', {},
        h('td', {}, fmtDate(b.created_at, true)), h('td', { class: 'small muted' }, fmtSize(b.size)),
        h('td', {}, h('a', { class: 'btn sm', href: '/api/backups/' + encodeURIComponent(b.name), download: '' }, icon('download', 'sm'), 'Download'))))))
        : h('p', { class: 'muted' }, 'No backups yet.'),
      h('div', {}, h('button', { class: 'btn primary', onclick: async () => { await api('/backups', { method: 'POST' }); toast('Backup made'); backups(); } }, 'Back up now'))));
  }

  async function audit(page = 1) {
    const r = await api('/audit' + qs({ page }));
    clear(body, card('Audit log', 'Every sign-in, change, download and export, with who did it and from where.',
      h('div', { style: { overflowX: 'auto' } }, h('table', { class: 'log' },
        h('thead', {}, h('tr', {}, h('th', {}, 'When'), h('th', {}, 'Who'), h('th', {}, 'What'), h('th', {}, 'Details'), h('th', {}, 'IP'))),
        h('tbody', {}, r.items.map((a) => h('tr', {},
          h('td', { class: 'nowrap small muted' }, fmtDate(a.created_at, true)), h('td', { class: 'small' }, a.user_name || '—'),
          h('td', { class: 'small' }, a.action.replace(/[._]/g, ' ')), h('td', { class: 'small muted' }, [a.target, a.details].filter(Boolean).join(' · ')),
          h('td', { class: 'tiny muted' }, a.ip)))))),
      h('div', { class: 'row' }, page > 1 ? h('button', { class: 'btn sm', onclick: () => audit(page - 1) }, 'Newer') : null, r.total > page * 100 ? h('button', { class: 'btn sm', onclick: () => audit(page + 1) }, 'Older') : null)));
  }

  async function general() {
    const s = (await api('/settings')).general;
    const domains = h('input', { class: 'input', value: s.ownDomains });
    const shareEmail = h('input', { class: 'input', type: 'email', value: s.shareEmail });
    const sharePhone = h('input', { class: 'input', value: s.sharePhone, placeholder: 'e.g. +91 22 1234 5678' });
    clear(body, card('General', null,
      field('Your own email domains', domains, 'Mail from these addresses is never treated as a candidate (e.g. your own forwards). The applicant is taken from Reply-To or the CV instead.'),
      h('div', { class: 'form-grid' }, field('Contact email on shortlists', shareEmail, 'Companies are asked to contact you here, not the candidates.'), field('Contact phone on shortlists', sharePhone)),
      h('div', {}, h('button', { class: 'btn primary', onclick: async () => { await api('/settings/general', { method: 'PUT', body: { ownDomains: domains.value, shareEmail: shareEmail.value, sharePhone: sharePhone.value } }); toast('Saved'); } }, 'Save')),
      h('div', { class: 'banner info' }, icon('phone'), h('div', {}, h('b', {}, 'Install on phones and laptops. '),
        'Open this address in Chrome (Android, Windows, Mac) and choose "Install app", or in Safari on iPhone choose Share → "Add to Home Screen". On Android you can then share a CV file from WhatsApp or Gmail straight to Guardora.'))));
  }

  show(current);
  return { cleanup: () => clearTimeout(settingsTimer) };
}
