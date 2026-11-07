'use strict';

/*
 * Removes everything a company could use to reach a candidate directly: phone numbers, email addresses,
 * home address, web links and profiles, ID numbers, PIN codes, date of birth, family names — and, if asked,
 * the person's surname or whole name. Used for shortlists shared with client companies.
 */

const HIDDEN = '[hidden]';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Whole lines that are personal contact details.
const PRIVATE_LINE = /^\s*[•*\-–]?\s*(address|permanent\s+address|current\s+address|present\s+address|residential\s+address|correspondence\s+address|postal\s+address|residence|contact(\s+(no|number|details|info))?|mobile|phone|tel(ephone)?|cell|whats\s?app|e-?mail|linkedin|github|portfolio|website|skype|date\s+of\s+birth|d\.?\s*o\.?\s*b\.?|birth\s*date|father'?s?\s+name|mother'?s?\s+name|husband'?s?\s+name|spouse(\s+name)?|guardian'?s?\s+name|aadhaa?r|pan(\s+(no|number|card))?|passport(\s+(no|number))?|driving\s+licen[cs]e|voter\s+id|uan|pf\s+no|bank\s+(a\/c|account)|ifsc)\b.*$/i;

const PATTERNS = [
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, // email
  /\b(?:https?:\/\/|www\.)\S+/gi, // web links
  /\b(?:linkedin|github|facebook|instagram|twitter|x)\.com\/\S*/gi, // profiles without http
  /\b\d{4}\s?\d{4}\s?\d{4}\b/g, // Aadhaar
  /\b[A-Z]{5}\d{4}[A-Z]\b/g, // PAN
  /\b[A-Z]\d{7}\b/g, // passport
  /(?:\+\s?\d{1,3}[\s.-]?)?(?:\(?\d{2,5}\)?[\s.-]?)?\d{3,5}[\s.-]?\d{3,5}(?:[\s.-]?\d{2,4})?/g, // phone-like digit runs, checked below
  /\b[1-8]\d{2}\s?\d{3}\b/g // Indian PIN code
];

// A digit run is hidden when it has 8+ digits (phones, accounts) and does not look like a year range.
function hideDigits(match) {
  const digits = match.replace(/\D/g, '');
  if (digits.length < 8) return match;
  if (/^\s*(19|20)\d{2}\s*[-–]\s*(19|20)\d{2}\s*$/.test(match)) return match;
  return HIDDEN;
}

/**
 * @param {string} text   CV text
 * @param {object} person { name, emails, phones, address, dob }
 * @param {object} opts   { nameMode: 'full' | 'initials' | 'code', code, hideCompanies: string[] }
 */
function redactText(text, person = {}, opts = {}) {
  let out = String(text || '').split('\n').map((line) => (PRIVATE_LINE.test(line) ? '' : line)).join('\n');

  // Exact known values first (they may be formatted unusually in this CV).
  for (const e of person.emails || []) if (e) out = out.replace(new RegExp(escapeRe(e), 'gi'), HIDDEN);
  for (const p of person.phones || []) {
    const d = String(p).replace(/\D/g, '').slice(-10);
    if (d.length === 10) out = out.replace(new RegExp('(?:(?:\\+|00)?\\s?91[\\s.-]*|0)?' + d.split('').join('[\\s.()-]*'), 'g'), HIDDEN);
  }
  if (person.address && person.address.length > 8) {
    for (const part of person.address.split(/,\s*/).filter((p) => p.length > 6 && /\d|road|nagar|chs|society|flat|bldg|building|wing|plot|sector|lane|marg|chawl|apartment|tower/i.test(p))) {
      out = out.replace(new RegExp(escapeRe(part), 'gi'), HIDDEN);
    }
  }

  out = out.replace(PATTERNS[0], HIDDEN).replace(PATTERNS[1], HIDDEN).replace(PATTERNS[2], HIDDEN)
    .replace(PATTERNS[3], HIDDEN).replace(PATTERNS[4], HIDDEN).replace(PATTERNS[5], HIDDEN)
    .replace(PATTERNS[6], hideDigits).replace(PATTERNS[7], HIDDEN);

  // The person's name.
  const words = String(person.name || '').split(/\s+/).filter((w) => w.length > 1);
  if (words.length && opts.nameMode !== 'full') {
    const shown = displayName(person.name, opts.nameMode, opts.code);
    out = out.replace(new RegExp('\\b' + words.map(escapeRe).join('\\s+') + '\\b', 'gi'), shown);
    // Surname (and, in code mode, every part of the name) on its own.
    const parts = opts.nameMode === 'code' ? words : words.slice(1);
    for (const w of parts) if (w.length > 2) out = out.replace(new RegExp('\\b' + escapeRe(w) + '\\b', 'gi'), opts.nameMode === 'code' ? '' : w[0].toUpperCase() + '.');
  }
  for (const c of opts.hideCompanies || []) if (c && c.length > 3) out = out.replace(new RegExp(escapeRe(c), 'gi'), '[employer hidden]');

  return out.replace(/\+\s?\d{1,3}[\s.-]*\[hidden\]/g, HIDDEN).replace(/(\[hidden\][ \t,|/:;-]*){2,}/g, HIDDEN + ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function displayName(name, mode, code) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (mode === 'full') return words.join(' ') || code;
  if (mode === 'code' || !words.length) return 'Candidate ' + code;
  return words[0] + (words.length > 1 ? ' ' + words[words.length - 1][0].toUpperCase() + '.' : '');
}

module.exports = { redactText, displayName, HIDDEN };
