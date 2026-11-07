'use strict';

/*
 * Compares a person's new CV with the one they sent before and reports changes that are worth a second look:
 * history that was rewritten (dates, degrees, employers, identity), not normal updates like a new current job.
 * Each finding says exactly what changed. Severity: 3 high, 2 medium, 1 low.
 */

const { nameSimilarity } = require('./match');

const ORG_NOISE = /\b(pvt|private|ltd|limited|llp|inc|corp|corporation|company|co|india|the|and|&|services|solutions|technologies|technology|group|industries|enterprises)\b\.?/g;
const orgTokens = (s) => String(s || '').toLowerCase().replace(ORG_NOISE, ' ').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 1);

function sameOrg(a, b) {
  const ta = orgTokens(a);
  const tb = orgTokens(b);
  if (!ta.length || !tb.length) return false;
  const hits = ta.filter((w) => tb.includes(w)).length;
  return hits / Math.min(ta.length, tb.length) >= 0.6;
}

function sameInstitution(a, b) {
  const clean = (s) => String(s || '').toLowerCase().replace(/\b(university|college|institute|school|of|the|and|&|board|mumbai|pune|delhi)\b/g, ' ').replace(/[^a-z ]+/g, ' ').split(/\s+/).filter((w) => w.length > 2);
  const ta = clean(a);
  const tb = clean(b);
  if (!ta.length || !tb.length) return String(a).toLowerCase().trim() === String(b).toLowerCase().trim();
  return ta.filter((w) => tb.includes(w)).length / Math.min(ta.length, tb.length) >= 0.5;
}

const monthNum = (ym, receivedAt) => {
  if (ym === 'present') {
    const d = new Date(receivedAt);
    return d.getUTCFullYear() * 12 + d.getUTCMonth();
  }
  const m = String(ym || '').match(/^(\d{4})-(\d{2})$/);
  return m ? Number(m[1]) * 12 + Number(m[2]) - 1 : null;
};
const scoreNum = (s) => Number((String(s || '').match(/\d+(\.\d+)?/) || [])[0]);
const yearOf = (iso) => new Date(iso).getUTCFullYear();

function compareVersions(oldCv, newCv) {
  const a = oldCv.parsed;
  const b = newCv.parsed;
  const findings = [];
  const add = (kind, severity, message, details = {}) => findings.push({ kind, severity, message, details });
  const oldDate = oldCv.received_at;
  const newDate = newCv.received_at;
  const elapsedYears = Math.max(0, (Date.parse(newDate) - Date.parse(oldDate)) / (365.25 * 864e5));
  const oldYear = yearOf(oldDate);

  // Identity
  if (a.name && b.name && nameSimilarity(a.name, b.name) < 0.5) {
    add('name_changed', 3, 'Name changed from "' + a.name + '" to "' + b.name + '" (same email or phone).', { from: a.name, to: b.name });
  }
  if (a.dob && b.dob && a.dob !== b.dob) {
    add('dob_changed', 3, 'Date of birth changed from ' + a.dob + ' to ' + b.dob + '.', { from: a.dob, to: b.dob });
  } else if (a.birthYear && b.birthYear && Math.abs(a.birthYear - b.birthYear) > 1) {
    add('age_changed', 2, 'Age does not add up: birth year ' + a.birthYear + ' before, ' + b.birthYear + ' now.', { from: a.birthYear, to: b.birthYear });
  }
  if (a.gender && b.gender && a.gender !== b.gender) {
    add('gender_changed', 3, 'Gender changed from ' + a.gender + ' to ' + b.gender + '.', { from: a.gender, to: b.gender });
  }

  // Education
  const oldEdu = new Map((a.education || []).map((e) => [e.degree, e]));
  const newEdu = new Map((b.education || []).map((e) => [e.degree, e]));
  for (const [degree, e] of newEdu) {
    const before = oldEdu.get(degree);
    if (!before) {
      if (e.level >= 5 && e.year && e.year < oldYear && (a.education || []).length && !e.pursuing) {
        add('degree_backdated', 3, degree + ' (' + e.year + ') now appears, but it was not on the CV sent in ' + oldYear + '.', { degree, year: e.year });
      }
      continue;
    }
    if (before.year && e.year && before.year !== e.year && !before.pursuing) {
      add('degree_year_changed', 3, degree + ' year changed from ' + before.year + ' to ' + e.year + '.', { degree, from: before.year, to: e.year });
    }
    if (before.institution && e.institution && !sameInstitution(before.institution, e.institution)) {
      add('institution_changed', 3, degree + ' institution changed from "' + before.institution + '" to "' + e.institution + '".', { degree, from: before.institution, to: e.institution });
    }
    const s1 = scoreNum(before.score);
    const s2 = scoreNum(e.score);
    if (s1 && s2 && Math.abs(s1 - s2) > (s1 <= 10 ? 0.3 : 2) && !before.pursuing) {
      add('score_changed', 2, degree + ' marks changed from ' + before.score + ' to ' + e.score + '.', { degree, from: before.score, to: e.score });
    }
  }
  for (const [degree, e] of oldEdu) {
    if (!newEdu.has(degree) && e.level >= 5 && (b.education || []).length) {
      add('degree_removed', 2, degree + ' was listed before but is missing now.', { degree });
    }
  }

  // Experience
  if (a.experienceYears != null && b.experienceYears != null) {
    const gain = b.experienceYears - a.experienceYears;
    if (gain > elapsedYears + 1) {
      add('experience_inflated', 3, 'Experience went from ' + a.experienceYears + ' to ' + b.experienceYears + ' years, but only ' +
        elapsedYears.toFixed(1) + ' years passed between the two CVs.', { from: a.experienceYears, to: b.experienceYears, elapsed: Number(elapsedYears.toFixed(1)) });
    } else if (gain < -1.5) {
      add('experience_reduced', 1, 'Experience went down from ' + a.experienceYears + ' to ' + b.experienceYears + ' years.', { from: a.experienceYears, to: b.experienceYears });
    }
  }
  const oldRoles = (a.experience || []).filter((r) => r.company);
  const newRoles = (b.experience || []).filter((r) => r.company);
  const oldMonth = monthNum('present', oldDate);
  for (const r of newRoles) {
    const match = oldRoles.find((o) => sameOrg(o.company, r.company));
    const start = monthNum(r.start, newDate);
    if (!match) {
      if (oldRoles.length && start != null && start < oldMonth - 2) {
        add('employer_backdated', 3, 'Job at ' + r.company + ' (' + r.start + ' to ' + r.end + ') was not on the CV sent in ' + oldYear + ', although it started before then.',
          { company: r.company, start: r.start, end: r.end });
      }
      continue;
    }
    const s0 = monthNum(match.start, oldDate);
    const e0 = match.end === 'present' ? null : monthNum(match.end, oldDate);
    const e1 = r.end === 'present' ? null : monthNum(r.end, newDate);
    const startMoved = s0 != null && start != null && Math.abs(s0 - start) > 2;
    const endMoved = e0 != null && e1 != null && Math.abs(e0 - e1) > 2;
    const endedThenPresent = e0 != null && r.end === 'present';
    if (startMoved || endMoved || endedThenPresent) {
      add('employment_dates_changed', 3, 'Dates at ' + r.company + ' changed from ' + match.start + ' to ' + match.end + ' → ' + r.start + ' to ' + r.end + '.',
        { company: r.company, from: [match.start, match.end], to: [r.start, r.end] });
    } else if (match.title && r.title && match.title.toLowerCase() !== r.title.toLowerCase() && match.end !== 'present') {
      add('title_changed', 2, 'Job title at ' + r.company + ' changed from "' + match.title + '" to "' + r.title + '" for the same period.',
        { company: r.company, from: match.title, to: r.title });
    }
  }
  for (const o of oldRoles) {
    if (newRoles.length && !newRoles.some((r) => sameOrg(o.company, r.company))) {
      add('employer_removed', 1, 'Job at ' + o.company + ' (' + o.start + ' to ' + o.end + ') is no longer listed.', { company: o.company, start: o.start, end: o.end });
    }
  }
  return findings;
}

module.exports = { compareVersions, sameOrg };
