'use strict';

/*
 * Reads a CV's text into structured fields. Rule-based and deterministic: every value can be traced to a
 * line of the CV, and anything it gets wrong can be corrected by hand in the app (corrections are kept).
 */

const { DEGREES, CITIES, CITY_ALIASES, STATES, SKILLS, CV_WORDS, LANGUAGES } = require('./dictionary');

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const MONTH_RE = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const titleCase = (s) => s.toLowerCase().replace(/(^|[\s.'-])([a-z])/g, (m, a, b) => a + b.toUpperCase());

/* ---------- Sections ---------- */

const HEADINGS = {
  education: /^(education(al)?(\s+(qualifications?|details|background|profile))?|academic(s|\s+(qualifications?|details|background|profile|credentials))?|qualifications?|scholastic)\b/i,
  experience: /^((work|professional|employment|career|job)\s+(experience|history|details|profile)|experience|work\s*history|employment|organi[sz]ational experience|internships?)\b/i,
  skills: /^((key|core|technical|it|computer|professional|functional|soft)\s+)?(skills?|competenc(y|ies)|expertise|proficiency)(\s+(set|summary|&\s*\w+))?\b|^(skill\s*set|areas? of expertise|technical proficiency|software(s)? known|computer knowledge)\b/i,
  personal: /^(personal\s+(details|information|profile|data)|personal)\b/i,
  projects: /^(academic\s+)?projects?\b/i,
  other: /^(declaration|hobbies|interests|achievements|certifications?|languages(\s+known)?|references?|strengths|objective|career objective|summary|profile summary|professional summary|extra[- ]curricular)\b/i
};

function findSections(lines) {
  const marks = [];
  lines.forEach((line, i) => {
    const t = line.replace(/[:\-–_•*#|]+\s*$/, '').replace(/^[•*#\s]+/, '').trim();
    if (!t || t.length > 50 || t.split(/\s+/).length > 6) return;
    for (const [name, re] of Object.entries(HEADINGS)) {
      if (re.test(t)) { marks.push({ name, start: i }); return; }
    }
  });
  const sections = {};
  marks.forEach((m, k) => {
    const end = k + 1 < marks.length ? marks[k + 1].start : lines.length;
    (sections[m.name] = sections[m.name] || []).push([m.start + 1, end]);
  });
  return sections;
}

const inRanges = (i, ranges) => (ranges || []).some(([a, b]) => i >= a && i < b);

/* ---------- Contact ---------- */

function findEmails(text) {
  const out = [];
  for (const m of text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g)) {
    const e = m[0].toLowerCase().replace(/^[._-]+|[._-]+$/g, '');
    if (!/(example\.|domain\.com|email\.com$|\.(png|jpg|jpeg|gif)$)/.test(e) && !out.includes(e)) out.push(e);
  }
  return out;
}

// Returns phone numbers in a stable form: 10 digits for Indian numbers, +digits for others.
function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 10 && /^[6-9]/.test(digits)) return digits;
  if (digits.length === 12 && digits.startsWith('91') && /^[6-9]/.test(digits[2])) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0') && /^[6-9]/.test(digits[1])) return digits.slice(1);
  if (digits.length === 13 && digits.startsWith('091')) return digits.slice(3);
  if (String(raw).trim().startsWith('+') && digits.length >= 10 && digits.length <= 15) return '+' + digits;
  return '';
}

function findPhones(text) {
  const out = [];
  for (const m of text.matchAll(/(?:\+\s?\d{1,3}[\s.-]?)?(?:\(?\d{2,5}\)?[\s.-]?)?\d[\d\s.-]{6,13}\d/g)) {
    const raw = m[0];
    // Skip date ranges and years ("2015 - 2019", "01.06.2020").
    if (/^\s*(19|20)\d{2}\s*[-–]\s*(19|20)\d{2}\s*$/.test(raw) || /\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/.test(raw)) continue;
    const p = normalizePhone(raw);
    if (p && !out.includes(p)) out.push(p);
  }
  return out;
}

const formatPhone = (p) => (/^\d{10}$/.test(p) ? '+91 ' + p.slice(0, 5) + ' ' + p.slice(5) : p);

/* ---------- Name ---------- */

const NOT_NAME = /\b(resume|r[ée]sum[ée]|curriculum|vitae|\bcv\b|bio[- ]?data|profile|objective|contact|e-?mail|phone|mobile|address|summary|career|personal|details|page|confidential|application|applying|position|post|dear|sir|madam|respected|subject|cover letter|experience|education|skills|declaration|hobbies|linkedin|github|www|http|india|maharashtra|limited|ltd|pvt|accountant|executive|engineer|manager|developer|fresher)\b/i;
const HONORIFIC = /^(mr|mrs|ms|miss|dr|er|ca|cs|adv|shri|smt|kum|km)\.?\s+/i;

function cleanName(raw) {
  let s = String(raw || '').replace(/[|•,:;]+.*$/, '').replace(/\s+/g, ' ').trim();
  s = s.replace(/\s*\(.*\)\s*$/, '').replace(HONORIFIC, '');
  if (s === s.toUpperCase() || s === s.toLowerCase()) s = titleCase(s);
  return s.slice(0, 80);
}

function looksLikeName(line) {
  const s = line.replace(HONORIFIC, '').replace(/[.]/g, '. ').replace(/\s+/g, ' ').trim();
  if (s.length < 4 || s.length > 45 || NOT_NAME.test(s)) return false;
  const words = s.split(' ').filter(Boolean);
  if (words.length < 1 || words.length > 5) return false;
  if (!/^[A-Za-z.'\s-]+$/.test(s)) return false;
  return words.filter((w) => w.replace(/\./g, '').length > 1).length >= (words.length === 1 ? 1 : 2) && words.length >= 2;
}

function findName(lines) {
  for (const line of lines.slice(0, 60)) {
    const m = line.match(/^\s*(?:full\s+|candidate'?s?\s+|applicant'?s?\s+)?name\s*(?:of\s+(?:the\s+)?(?:candidate|applicant))?\s*[:\-–]\s*(.+)$/i);
    if (m && looksLikeName(m[1].split(/\s{3,}|\t/)[0])) return { name: cleanName(m[1].split(/\s{3,}|\t/)[0]), line };
  }
  for (const raw of lines.slice(0, 12)) {
    for (const part of raw.split(/\s{3,}|\t|\s[|•]\s/)) {
      const line = part.trim();
      if (looksLikeName(line)) return { name: cleanName(line), line: raw };
    }
  }
  return { name: '', line: '' };
}

/* ---------- Dates, DOB, age ---------- */

function parseDate(text) {
  const t = String(text).toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, '$1').replace(/\s+/g, ' ').trim();
  let m;
  let d;
  let mo;
  let y;
  if ((m = t.match(/\b(\d{4})[./-](\d{1,2})[./-](\d{1,2})\b/))) [, y, mo, d] = m;
  else if ((m = t.match(/\b(\d{1,2})[./ -](\d{1,2})[./ -](\d{2,4})\b/))) [, d, mo, y] = m;
  else if ((m = t.match(new RegExp('\\b(\\d{1,2})[ .,/-]*(' + MONTH_RE + ')[a-z]*[ .,/-]*(\\d{2,4})\\b')))) {
    d = m[1]; mo = MONTHS[m[2].slice(0, 3)]; y = m[3];
  } else if ((m = t.match(new RegExp('\\b(' + MONTH_RE + ')[a-z]*[ .,/-]*(\\d{1,2})[ .,/-]+(\\d{4})\\b')))) {
    mo = MONTHS[m[1].slice(0, 3)]; d = m[2]; y = m[3];
  } else return '';
  y = Number(y);
  if (y < 100) y += y > 30 ? 1900 : 2000;
  d = Number(d);
  mo = Number(mo);
  if (mo > 12 && d <= 12) [d, mo] = [mo, d]; // US-style month/day
  if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return '';
  return y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

function findDob(lines, receivedYear) {
  for (const line of lines) {
    const m = line.match(/\b(date\s*of\s*birth|d\.?\s*o\.?\s*b\.?|birth\s*date|born\s*on|birthday)\s*[:\-–]?\s*(.{6,40})/i);
    if (!m) continue;
    const dob = parseDate(m[2]);
    const y = Number(dob.slice(0, 4));
    if (dob && y >= 1940 && y <= receivedYear - 14) return { dob, birthYear: y, line };
  }
  for (const line of lines) {
    const m = line.match(/\bage\s*[:\-–]?\s*(\d{2})\s*(years?|yrs?)?\b/i);
    if (m && Number(m[1]) >= 16 && Number(m[1]) <= 75) return { dob: '', birthYear: receivedYear - Number(m[1]), line, estimated: true };
  }
  return { dob: '', birthYear: null, line: '' };
}

/* ---------- Gender ---------- */

function findGender(lines, nameLine) {
  for (const line of lines) {
    const m = line.match(/\b(gender|sex)\s*[:\-–]?\s*(male|female|m|f|other|transgender)\b/i);
    if (m) {
      const g = m[2].toLowerCase();
      return g.startsWith('f') ? 'female' : g.startsWith('m') ? 'male' : 'other';
    }
  }
  const h = String(nameLine).match(HONORIFIC);
  if (h) {
    const t = h[1].toLowerCase();
    if (t === 'mr' || t === 'shri') return 'male';
    if (['mrs', 'ms', 'miss', 'smt', 'kum', 'km'].includes(t)) return 'female';
  }
  const text = lines.join('\n');
  if (/\b(d\/o|daughter of|w\/o|wife of|husband'?s name)\b/i.test(text)) return 'female';
  if (/\b(s\/o|son of)\b/i.test(text)) return 'male';
  return '';
}

/* ---------- Location ---------- */

const CITY_LIST = Object.keys(CITIES).sort((a, b) => b.length - a.length);
const CITY_RE = new RegExp('(?<![A-Za-z])(' + [...CITY_LIST, 'Bombay', 'Madras', 'Calcutta', 'Poona'].map(escapeRe).join('|') + ')(?![A-Za-z])', 'i');
const STATE_RE = new RegExp('(?<![A-Za-z])(' + STATES.map(escapeRe).join('|') + ')(?![A-Za-z])', 'i');

function canonicalCity(found) {
  const key = CITY_LIST.find((c) => c.toLowerCase() === found.toLowerCase()) ||
    ({ bombay: 'Bombay', madras: 'Madras', calcutta: 'Calcutta', poona: 'Poona' })[found.toLowerCase()];
  const city = CITY_ALIASES[key] || key;
  return { city, state: CITIES[city] || CITIES[key] || '' };
}

function findLocation(lines, sections) {
  const scored = [];
  lines.forEach((line, i) => {
    const m = line.match(/\b(current\s*location|present\s*location|preferred\s*location|location|current\s*address|present\s*address|correspondence\s*address|residential\s*address|permanent\s*address|address|city|residence|based\s*(?:in|at)|resides?\s*(?:in|at))\b\s*[:\-–]?\s*(.*)$/i);
    if (!m) return;
    const label = m[1].toLowerCase();
    if (/preferred/.test(label)) return;
    const text = [m[2], lines[i + 1] || '', lines[i + 2] || ''].join(' ');
    const weight = /current|present|correspondence|residential|location|resid|based/.test(label) ? 3 : /permanent/.test(label) ? 1 : 2;
    scored.push({ text, weight, address: (m[2] + ' ' + (m[2].length < 60 ? lines[i + 1] || '' : '')).trim() });
  });
  scored.push({ text: lines.slice(0, 15).join(' '), weight: 1.5, address: '' });
  for (const [a, b] of sections.personal || []) scored.push({ text: lines.slice(a, b).join(' '), weight: 1, address: '' });
  scored.sort((x, y) => y.weight - x.weight);

  for (const s of scored) {
    const c = s.text.match(CITY_RE);
    if (c) {
      const { city, state } = canonicalCity(c[1]);
      const st = s.text.match(STATE_RE);
      return { city, state: state || (st ? titleCase(st[1]) : ''), address: s.address.slice(0, 200) };
    }
  }
  for (const s of scored) {
    const st = s.text.match(STATE_RE);
    if (st) return { city: '', state: STATES.find((x) => x.toLowerCase() === st[1].toLowerCase()), address: s.address.slice(0, 200) };
  }
  return { city: '', state: '', address: '' };
}

/* ---------- Education ---------- */

const INSTITUTION_RE = /((?:[A-Z][\w.&'()-]*\s+(?:[\w.&'()-]+\s+){0,7})?(?:University|College|Institute|School|Vidyalaya|Vidyapeeth|Vidyapith|Mahavidyalaya|Academy|Polytechnic|IIT|IIM|NIT|Board)(?:\s+of\s+[\w.&' ]{2,40}|[,\s]+[A-Z][a-z]+)?)/;

function findEducation(lines, sections) {
  const entries = [];
  const eduRanges = sections.education || [];
  lines.forEach((line, i) => {
    if (/\b(date\s*of\s*birth|d\.?o\.?b)\b/i.test(line)) return;
    if (/\b(experience|worked|working|company|client|employer)\b/i.test(line) && !inRanges(i, eduRanges)) return;
    for (const [degree, level, re] of DEGREES) {
      if (!re.test(line)) continue;
      if (level <= 3 && !inRanges(i, eduRanges) && !/\b(board|school|passed|percentage|marks|%|cgpa|ssc|hsc)\b/i.test(line + ' ' + (lines[i + 1] || ''))) break;
      // The college is on the same line, or on the next lines only while they do not name another degree.
      const nearby = [line];
      for (const next of [lines[i + 1] || '', lines[i + 2] || '']) {
        if (!next || DEGREES.some(([, , r]) => r.test(next))) break;
        nearby.push(next);
      }
      const instSeg = nearby.flatMap(segments).find((x) => INSTITUTION_RE.test(x) && !re.test(x)) ||
        segments(line).find((x) => !re.test(x) && /[A-Za-z]{3}/.test(x) && !/^\d|%|\b(19|20)\d{2}\b|cgpa|gpa|percentage|marks|pursuing|first class|distinction/i.test(x));
      // Year and marks come from the same nearby lines, never from the next degree's line.
      const years = [...nearby.join(' ').matchAll(/\b(19[6-9]\d|20[0-4]\d)\b/g)].map((m) => Number(m[1]));
      const inst = instSeg ? [instSeg, instSeg.replace(/\s*[-–]?\s*\b(19|20)\d{2}\b.*$/, '')] : nearby.join('  ').match(INSTITUTION_RE);
      const around = nearby.join('  ');
      const score = around.match(/(\d{2}(?:\.\d{1,2})?)\s*%/) || around.match(/\b(?:cgpa|gpa|cpi|sgpa)\s*[:\-–]?\s*(\d{1,2}(?:\.\d{1,2})?)/i);
      const field = (line.match(new RegExp(re.source + '[\\s.]*(?:\\(([^)]{2,40})\\)|in\\s+([A-Za-z &]{3,40}))', 'i')) || []).slice(-2).filter(Boolean)[0] || '';
      entries.push({
        degree,
        level,
        field: field.trim().replace(/\s+(from|at|with|in)\b.*$/i, ''),
        year: years.length ? Math.max(...years) : null,
        institution: inst ? inst[1].replace(/\s+/g, ' ').trim().slice(0, 120) : '',
        score: score ? score[1] + (score[0].includes('%') ? '%' : ' CGPA') : '',
        pursuing: /\b(pursuing|ongoing|appearing|currently|expected)\b/i.test(around),
        line: line.trim().slice(0, 200)
      });
      break;
    }
  });
  // One entry per degree: prefer the one with more detail.
  const best = new Map();
  for (const e of entries) {
    const prev = best.get(e.degree);
    const detail = (x) => (x.year ? 2 : 0) + (x.institution ? 2 : 0) + (x.score ? 1 : 0) + (x.field ? 1 : 0);
    if (!prev || detail(e) > detail(prev)) best.set(e.degree, e);
  }
  const list = [...best.values()].sort((a, b) => b.level - a.level || (b.year || 0) - (a.year || 0));
  const level = list.filter((e) => !e.pursuing).reduce((m, e) => Math.max(m, e.level), 0) || list.reduce((m, e) => Math.max(m, e.level - 1), 0);
  return { education: list, level };
}

/* ---------- Skills ---------- */

const SHORT_SKILLS = new Set(['c', 'r', 'go', 'ai', 'qa', 'qc', 'pf', 'soc', '5s', 'l&d', 'tcs', 'sas', 'ppc', 'brs', 'mis', 'tpm', 'msa', 'spc', 'mep', 'boq', 'nlp', 'etl', 'ios', 'kyc', 'aml', 'gmp', 'sop', 'ehs', 'hse', 'crm', 'seo', 'sem', 'smm', 'bpo', 'kpo', 'pmp', 'git', 'css', 'vba', 'sql', 'busy', 'admin', 'retail', 'training', 'swift', 'ruby', 'spring', 'express', 'oracle', 'assembly', 'billing', 'utility', 'safety', 'boiler', 'driving', 'teaching', 'export', 'import', 'audit', 'sales', 'production', 'construction', 'hardware', 'banking', 'insurance', 'pharmacy', 'textile', 'garment', 'loans', 'erection', 'validation', 'communication', 'leadership', 'coordination', 'mentoring', 'teamwork', 'multitasking', 'shipping', 'purchase', 'collections', 'compliance', 'automobile', 'manufacturing', 'documentation', 'typing', 'reception', 'hospitality', 'counselling', 'translation', 'stenography', 'real estate', 'statistics', 'logistics', 'procurement', 'networking', 'nursing', 'retail sales', 'hotels', 'r']);
const SKILL_RES = SKILLS.map((s) => ({
  name: s,
  short: SHORT_SKILLS.has(s.toLowerCase()),
  re: new RegExp('(?<![A-Za-z0-9])' + escapeRe(s).replace(/\\ /g, '[\\s-]?').replace(/ /g, '[\\s-]?') + '(?![A-Za-z0-9+#])', s.length <= 3 ? '' : 'i')
}));
const SKILL_STOP = /^(and|or|etc|good|basic|knowledge|of|in|the|with|skills?|strong|excellent|working|ability|proficient|familiar|languages?|tools?|software|hardware|others?|operating systems?|platforms?|technologies|frameworks?|databases?)$/i;

function findSkills(text, lines, sections) {
  const skillText = (sections.skills || []).map(([a, b]) => lines.slice(a, b).join('\n')).join('\n');
  const found = new Map();
  for (const s of SKILL_RES) {
    const where = s.short ? skillText : text;
    if (where && s.re.test(where)) found.set(s.name.toLowerCase(), s.name);
  }
  // Items listed in the skills section that are not in the dictionary.
  let extra = 0;
  for (const raw of skillText.split(/[,|•;\n\t]|\s{2,}|\s\/\s/)) {
    const item = raw.replace(/^[\s:\-–*·]+|[\s.:\-–*·]+$/g, '').replace(/^(knowledge|proficient|expertise|skilled|hands[- ]on experience)\s+(of|in|with)\s+/i, '');
    if (item.length < 2 || item.length > 32 || item.split(/\s+/).length > 4 || SKILL_STOP.test(item) || /\d{4}|:|@/.test(item)) continue;
    const key = item.toLowerCase();
    if (!found.has(key) && extra < 25 && /[a-z]/i.test(item)) {
      found.set(key, item === item.toLowerCase() ? titleCase(item) : item);
      extra++;
    }
  }
  return [...found.values()];
}

/* ---------- Experience ---------- */

const DATE_TOKEN = '(?:' + MONTH_RE + "[a-z]*[\\s.,'’-]*(?:\\d{4}|'?\\d{2})|\\d{1,2}[/.-](?:\\d{4}|\\d{2})(?![/.-]\\d)|(?:19|20)\\d{2})";
const END_TOKEN = '(?:' + DATE_TOKEN + '|present|current(?:ly)?|till\\s*(?:date|now)|to\\s*date|now|today|ongoing|date)';
const RANGE_RE = new RegExp('(' + DATE_TOKEN + ')\\s*(?:-|–|—|to|till|until|upto|up to)\\s*(' + END_TOKEN + ')', 'gi');
const ORG_RE = /\b([A-Z][\w.&'-]*(?:\s+[\w.&'()-]+){0,6}?\s+(?:Ltd|Limited|Pvt|Private|LLP|Inc|Corp(?:oration)?|Company|Co\.|Technologies|Technology|Solutions|Services|Industries|Enterprises|Group|Bank|Hospital|Hospitals|Associates|Consultants|Consultancy|Systems|Infotech|Infosystems|Labs|Motors|Pharma|Pharmaceuticals|Foods|Logistics|Exports|Traders|Trading|Agency|Agencies|Finance|Financial|Securities|Capital|Insurance|Realty|Builders|Constructions?|Chemicals|Steel|Textiles|Automobiles|Engineering|Electricals|Hotels?|Resorts?|Retail|Stores|Mart|Bazaar|Firm)\b\.?)/;
const TITLE_RE = /\b((?:senior|sr\.?|junior|jr\.?|assistant|asst\.?|associate|deputy|chief|lead|head|trainee|management trainee|graduate trainee)?\s*(?:[A-Z][a-z&/]+\s+){0,3}(?:executive|manager|assistant|accountant|engineer|developer|analyst|officer|associate|intern|trainee|consultant|lead|head|supervisor|coordinator|co-ordinator|clerk|specialist|representative|administrator|designer|teacher|lecturer|professor|director|president|operator|technician|recruiter|controller|auditor|advisor|adviser|agent|cashier|incharge|in-charge|programmer|architect|tester|scientist|nurse|pharmacist|chemist|surveyor|draughtsman|draftsman|receptionist|secretary|partner|founder|owner|proprietor|telecaller|tele-caller|salesman|merchandiser|planner|buyer|storekeeper|foreman|fitter|electrician|welder|machinist|driver)s?)\b/i;

// Splits a line into its parts: "Title - Company  |  City" -> ["Title", "Company", "City"].
const segments = (line) => String(line).split(/\s[-–—|:]\s|\t|\s{3,}|\s@\s|,\s(?=(?:[A-Z][\w.&'-]*\s+){1,6}(?:Pvt|Ltd|Private|Limited|LLP|Inc)\b)|\s+at\s+(?=[A-Z])/)
  .map((s) => s.replace(/^[\s•*,-]+|[\s•*,-]+$/g, '')).filter((s) => s.length > 1);

function monthIndex(token, isEnd, receivedAt) {
  const t = String(token).toLowerCase().trim();
  if (/present|current|till|to\s*date|now|today|ongoing|^date$/.test(t)) {
    const d = new Date(receivedAt);
    return { idx: d.getUTCFullYear() * 12 + d.getUTCMonth(), current: true };
  }
  let m = t.match(new RegExp('^(' + MONTH_RE + ")[a-z]*[\\s.,'’-]*('?)(\\d{2,4})"));
  if (m) {
    let y = Number(m[3]);
    if (y < 100) y += y > 50 ? 1900 : 2000;
    return { idx: y * 12 + MONTHS[m[1].slice(0, 3)] - 1 };
  }
  m = t.match(/^(\d{1,2})[/.-](\d{2,4})$/);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) {
    let y = Number(m[2]);
    if (y < 100) y += y > 50 ? 1900 : 2000;
    return { idx: y * 12 + Number(m[1]) - 1 };
  }
  m = t.match(/^((?:19|20)\d{2})$/);
  if (m) return { idx: Number(m[1]) * 12 + (isEnd ? 11 : 0), yearOnly: true };
  return null;
}

const fmtMonth = (idx) => (idx == null ? '' : Math.floor(idx / 12) + '-' + String((idx % 12) + 1).padStart(2, '0'));

function findExperience(text, lines, sections, receivedAt) {
  const eduRanges = sections.education || [];
  const expRanges = sections.experience || [];
  const rx = Date.parse(receivedAt) || Date.now();
  const nowIdx = new Date(rx).getUTCFullYear() * 12 + new Date(rx).getUTCMonth();
  const roles = [];
  lines.forEach((line, i) => {
    if (inRanges(i, eduRanges) && !inRanges(i, expRanges)) return;
    if (DEGREES.some(([, , re]) => re.test(line)) && !ORG_RE.test(line)) return;
    for (const m of line.matchAll(RANGE_RE)) {
      const s = monthIndex(m[1], false, rx);
      const e = monthIndex(m[2], true, rx);
      if (!s || !e || e.idx < s.idx || e.idx - s.idx > 45 * 12 || s.idx > nowIdx + 1 || s.idx < 1960 * 12) continue;
      if (s.yearOnly && e.yearOnly && !inRanges(i, expRanges) && !ORG_RE.test(line) && !TITLE_RE.test(line)) continue;
      const context = [line.replace(m[0], ' '), lines[i - 1] || '', lines[i + 1] || ''].flatMap(segments);
      const org = context.find((c) => ORG_RE.test(c));
      const title = context.map((c) => c.match(TITLE_RE)).find(Boolean);
      roles.push({
        company: org ? org.replace(/^(at|with|in)\s+/i, '').replace(/[\s,(]+$/, '').slice(0, 100) : '',
        title: title ? title[1].replace(/\s+/g, ' ').trim().slice(0, 80) : '',
        start: fmtMonth(s.idx),
        end: e.current ? 'present' : fmtMonth(e.idx),
        current: Boolean(e.current),
        months: e.idx - s.idx + 1,
        startIdx: s.idx,
        endIdx: e.idx,
        line: line.trim().slice(0, 200)
      });
    }
  });

  // Total months across roles, counting overlapping periods once.
  const spans = roles.map((r) => [r.startIdx, r.endIdx]).sort((a, b) => a[0] - b[0]);
  let total = 0;
  let cur = null;
  for (const [a, b] of spans) {
    if (!cur || a > cur[1] + 1) {
      if (cur) total += cur[1] - cur[0] + 1;
      cur = [a, b];
    } else cur[1] = Math.max(cur[1], b);
  }
  if (cur) total += cur[1] - cur[0] + 1;

  let stated = null;
  const statedRes = [
    /\b(?:total|overall)\s*(?:work\s*|professional\s*|relevant\s*)?experience\s*[:\-–]?\s*(\d{1,2}(?:\.\d{1,2})?)\s*\+?\s*(?:years?|yrs?)?(?:\s*(?:and|&|,)?\s*(\d{1,2})\s*(?:months?|mos?|mths?))?/i,
    /\b(\d{1,2}(?:\.\d{1,2})?)\s*\+?\s*(?:years?|yrs?)(?:\s*(?:and|&|,)?\s*(\d{1,2})\s*(?:months?|mos?|mths?))?\s*(?:of\s+)?(?:(?:total|overall|rich|professional|work|working|industry|industrial|relevant|hands[- ]on|extensive|progressive)\s+)*(?:experience|exp\b)/i
  ];
  for (const re of statedRes) {
    const m = text.match(re);
    if (m) {
      const v = Number(m[1]) + (m[2] ? Number(m[2]) / 12 : 0);
      if (v < 45) { stated = Math.round(v * 10) / 10; break; }
    }
  }
  const fromRoles = total ? Math.round((total / 12) * 10) / 10 : null;
  let years = stated ?? fromRoles;
  if (years == null && /\bfresher\b/i.test(text)) years = 0;

  const currentRole = roles.find((r) => r.current) || roles.slice().sort((a, b) => b.endIdx - a.endIdx)[0];
  return {
    years,
    statedYears: stated,
    rolesYears: fromRoles,
    roles: roles.map(({ startIdx, endIdx, ...r }) => r).slice(0, 40), // eslint-disable-line no-unused-vars
    currentTitle: currentRole && currentRole.current ? currentRole.title : '',
    currentCompany: currentRole && currentRole.current ? currentRole.company : ''
  };
}

/* ---------- Other fields ---------- */

function labelled(lines, re) {
  for (const line of lines) {
    const m = line.match(re);
    if (m && m[1].trim()) return m[1].split(/\s{3,}|\t/)[0].trim().slice(0, 60);
  }
  return '';
}

function findLanguages(lines) {
  const found = new Set();
  lines.forEach((line, i) => {
    if (!/\blanguages?\s*(known|spoken|proficiency)?\b/i.test(line)) return;
    const around = [line, lines[i + 1] || '', lines[i + 2] || '', lines[i + 3] || ''].join(' ');
    for (const l of LANGUAGES) if (new RegExp('\\b' + l + '\\b', 'i').test(around)) found.add(l);
  });
  return [...found];
}

function cvScore(text, lines, emails, phones) {
  const lower = text.toLowerCase();
  let words = 0;
  for (const w of CV_WORDS) if (lower.includes(w)) words++;
  let score = Math.min(60, words * 6);
  if (emails.length) score += 12;
  if (phones.length) score += 12;
  if (/\b(19|20)\d{2}\b/.test(text)) score += 6;
  if (lines.length > 15) score += 5;
  if (/\b(invoice|gstin|tax invoice|purchase order|quotation|bill to|amount due|bank statement|payslip)\b/i.test(text)) score -= 40;
  return Math.max(0, Math.min(100, score));
}

/* ---------- Entry point ---------- */

function parseCv(text, { receivedAt = new Date().toISOString() } = {}) {
  const source = String(text || '');
  const lines = source.split('\n').map((l) => l.replace(/\s+$/, ''));
  const trimmed = lines.map((l) => l.trim()).filter((l, i, arr) => l || (arr[i - 1] && arr[i - 1].trim()));
  const sections = findSections(trimmed);
  const receivedYear = new Date(receivedAt).getUTCFullYear() || new Date().getUTCFullYear();

  const emails = findEmails(source);
  const phones = findPhones(source);
  const { name, line: nameLine } = findName(trimmed);
  const dob = findDob(trimmed, receivedYear);
  const loc = findLocation(trimmed, sections);
  const edu = findEducation(trimmed, sections);
  const exp = findExperience(source, trimmed, sections, receivedAt);

  return {
    name,
    emails,
    phones,
    dob: dob.dob,
    birthYear: dob.birthYear,
    ageEstimated: Boolean(dob.estimated),
    gender: findGender(trimmed, nameLine),
    city: loc.city,
    state: loc.state,
    address: loc.address,
    education: edu.education,
    educationLevel: edu.level,
    skills: findSkills(source, trimmed, sections),
    experienceYears: exp.years,
    statedExperienceYears: exp.statedYears,
    rolesExperienceYears: exp.rolesYears,
    experience: exp.roles,
    currentTitle: exp.currentTitle,
    currentCompany: exp.currentCompany,
    currentCtc: labelled(trimmed, /\b(?:current|present)\s*(?:ctc|salary|package|ctc\/salary)\s*[:\-–]?\s*(.+)$/i),
    expectedCtc: labelled(trimmed, /\bexpected\s*(?:ctc|salary|package)\s*[:\-–]?\s*(.+)$/i),
    noticePeriod: labelled(trimmed, /\bnotice\s*period\s*[:\-–]?\s*(.+)$/i) || (/\bimmediate(ly)?\s+(joiner|available|joining)\b/i.test(source) ? 'Immediate' : ''),
    languages: findLanguages(trimmed),
    cvScore: cvScore(source, trimmed, emails, phones)
  };
}

module.exports = { parseCv, normalizePhone, formatPhone, parseDate, findEmails, findPhones, cleanName, titleCase };
