'use strict';

/* Duplicate detection helpers: document fingerprints (MinHash over word shingles) and name comparison. */

const HASHES = 64;
const SEEDS = Array.from({ length: HASHES }, (_, i) => (Math.imul(i + 1, 0x9e3779b1) >>> 0) || 1);

function fnv(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

// 64 numbers summarising a document; two CVs share about (similarity x 64) of them.
function fingerprint(text) {
  const words = String(text).toLowerCase().replace(/[^a-z0-9@.+ ]+/g, ' ').split(/\s+/).filter((w) => w.length > 1);
  if (words.length < 8) return [];
  const mins = new Array(HASHES).fill(0xffffffff);
  for (let i = 0; i + 3 <= words.length; i++) {
    const h = fnv(words[i] + ' ' + words[i + 1] + ' ' + words[i + 2]);
    for (let k = 0; k < HASHES; k++) {
      const v = (Math.imul(h ^ SEEDS[k], 0x85ebca6b) ^ (h >>> 13)) >>> 0;
      if (v < mins[k]) mins[k] = v;
    }
  }
  return mins;
}

function similarity(a, b) {
  if (!a || !b || !a.length || a.length !== b.length) return 0;
  let same = 0;
  for (let i = 0; i < a.length; i++) if (a[i] === b[i]) same++;
  return same / a.length;
}

const NAME_NOISE = /\b(mr|mrs|ms|miss|dr|er|ca|cs|shri|smt|kumar|kumari|bhai|ben)\b\.?/g;

// "Sharma Priya R." and "Priya R Sharma" give the same key.
function nameKey(name) {
  return String(name || '').toLowerCase().replace(NAME_NOISE, ' ').replace(/[^a-z ]+/g, ' ')
    .split(/\s+/).filter((w) => w.length > 1).sort().join(' ');
}

// 0..1: how alike two names are, tolerant of order, initials and middle names.
function nameSimilarity(a, b) {
  const ta = nameKey(a).split(' ').filter(Boolean);
  const tb = nameKey(b).split(' ').filter(Boolean);
  if (!ta.length || !tb.length) return 0;
  let hits = 0;
  for (const w of ta) {
    if (tb.some((x) => x === w || (x.length > 3 && w.length > 3 && (x.startsWith(w) || w.startsWith(x))) || editDistance(x, w) <= (w.length > 5 ? 1 : 0))) hits++;
  }
  return hits / Math.max(Math.min(ta.length, tb.length), 1) * (Math.min(ta.length, tb.length) / Math.max(ta.length, tb.length) * 0.3 + 0.7);
}

function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 99;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

module.exports = { fingerprint, similarity, nameKey, nameSimilarity };
