// "Share with company": choose what the client may see, then send a PDF or a private link.

import { h, icon, toast, modal } from '../ui.js';
import { api } from '../api.js';

export function openShareDialog({ ids, label, onDone }) {
  const company = h('input', { class: 'input', name: 'company', placeholder: 'e.g. ABC Logistics Pvt Ltd', required: true });
  const title = h('input', { class: 'input', placeholder: 'e.g. Accounts Executive — Thane' });
  const msg = h('textarea', { class: 'input', placeholder: 'Message to the company (optional)' }, 'Dear Sir/Madam,\nPlease find the shortlisted candidates for your requirement. Kindly let us know whom you would like to interview.\n\nRegards,\nThe Guardians');
  const nameMode = h('select', { class: 'input' },
    h('option', { value: 'initials' }, 'First name + initial (Priya S.)'),
    h('option', { value: 'code' }, 'Code only (GD-01042)'),
    h('option', { value: 'full' }, 'Full name'));
  const days = h('select', { class: 'input' }, [[7, '7 days'], [14, '14 days'], [30, '30 days'], [90, '90 days']].map(([v, l]) => h('option', { value: v, selected: v === 30 }, l)));
  const pin = h('input', { class: 'input', inputmode: 'numeric', maxlength: 8, placeholder: 'Optional, 4–8 digits' });
  const opt = (key, label, on, hint) => {
    const box = h('input', { type: 'checkbox', checked: on, dataset: { key } });
    return h('label', { class: 'check', title: hint || '' }, box, label);
  };
  const opts = h('div', { class: 'stack', style: { gap: '6px' } },
    opt('showCv', 'CV text (with contact details removed)', true),
    opt('showExpected', 'Expected CTC', true),
    opt('showNotice', 'Notice period', true),
    opt('showAge', 'Age', true),
    opt('showGender', 'Gender', true),
    opt('showLocation', 'City', true),
    opt('showCtc', 'Current CTC', false),
    opt('showEmployer', 'Employer names', false, 'Off by default: with the employer name a company can find the person on LinkedIn.'));

  modal({
    title: 'Share ' + label + ' with a company',
    wide: true,
    body: [
      h('div', { class: 'banner ok' }, icon('shield'), h('div', {}, h('b', {}, 'Always hidden: '),
        'phone numbers, email addresses, home address, LinkedIn and other links, Aadhaar / PAN, date of birth and family names, including inside the CV. The original CV files are never sent.')),
      h('div', { class: 'form-grid' },
        h('label', { class: 'field' }, h('span', {}, 'Company'), company),
        h('label', { class: 'field' }, h('span', {}, 'Title'), title),
        h('label', { class: 'field' }, h('span', {}, 'Show names as'), nameMode),
        h('label', { class: 'field' }, h('span', {}, 'Link works for'), days),
        h('label', { class: 'field' }, h('span', {}, 'PIN for the link'), pin)),
      h('label', { class: 'field' }, h('span', {}, 'Message'), msg),
      h('div', {}, h('div', { class: 'small', style: { fontWeight: 700, marginBottom: '6px' } }, 'The company may also see'), opts)
    ],
    actions: [{ label: 'Cancel' }, { label: 'Create shortlist', kind: 'primary', onClick: async () => {
      if (!company.value.trim()) { toast('Enter the company name.', 'bad'); return false; }
      const options = { nameMode: nameMode.value };
      for (const b of opts.querySelectorAll('input[type=checkbox]')) options[b.dataset.key] = b.checked;
      try {
        const r = await api('/shares', { method: 'POST', body: { company: company.value, title: title.value, message: msg.value, candidateIds: ids, options, expiresDays: Number(days.value), pin: pin.value.trim() } });
        showResult({ ...r, company: company.value.trim(), title: title.value.trim(), pin: pin.value.trim() });
        if (onDone) onDone();
      } catch (err) { toast(err.message, 'bad'); return false; }
    } }]
  });
}

export function showResult({ link, company, title, pin, privateHost }) {
  const text = 'Dear ' + company + ',\nPlease find the shortlisted candidates' + (title ? ' for ' + title : '') + ' here: ' + link + (pin ? '\nPIN: ' + pin : '') + '\n\nRegards,\nThe Guardians';
  modal({
    title: 'Shortlist ready for ' + company,
    body: [
      h('div', { class: 'row wrap' },
        h('a', { class: 'btn primary', href: link + '?print=1', target: '_blank', rel: 'noopener' }, icon('download', 'sm'), 'Save as PDF'),
        h('a', { class: 'btn', href: link, target: '_blank', rel: 'noopener' }, icon('external', 'sm'), 'Preview')),
      h('p', { class: 'hint', style: { margin: 0 } }, 'Save as PDF opens the print window: choose "Save as PDF", then attach the file to your email or WhatsApp. It contains no contact details.'),
      privateHost
        ? h('div', { class: 'banner warn' }, icon('alert'), h('div', {}, h('b', {}, 'The link only works on this computer. '),
          'Guardora is running on this PC, which companies cannot reach over the internet. Send the PDF instead. Links (with Interested / Not suitable buttons for the company) work once Guardora is online on a server.'))
        : h('div', { class: 'stack', style: { gap: '8px' } },
          h('label', { class: 'field' }, h('span', {}, 'Private link'), h('input', { class: 'input', value: link, readonly: true, onfocus: (e) => e.target.select() })),
          h('div', { class: 'row wrap' },
            h('button', { class: 'btn', onclick: async () => { await navigator.clipboard.writeText(link); toast('Link copied'); } }, 'Copy link'),
            h('a', { class: 'btn', href: 'https://wa.me/?text=' + encodeURIComponent(text), target: '_blank', rel: 'noopener noreferrer' }, 'WhatsApp'),
            h('a', { class: 'btn', href: 'mailto:?subject=' + encodeURIComponent('Shortlisted candidates' + (title ? ' — ' + title : '')) + '&body=' + encodeURIComponent(text) }, icon('mail', 'sm'), 'Email')),
          pin ? h('p', { class: 'hint', style: { margin: 0 } }, 'Tip: send the PIN in a separate message from the link.') : null)
    ],
    actions: [{ label: 'Done', kind: 'primary' }]
  });
}
