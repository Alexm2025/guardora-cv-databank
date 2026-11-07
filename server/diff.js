'use strict';

/* Line-by-line comparison of two CV texts (longest common subsequence), for the side-by-side "what changed" view. */

const norm = (l) => l.toLowerCase().replace(/\s+/g, ' ').trim();

function lineDiff(oldText, newText) {
  const a = String(oldText).split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 2500);
  const b = String(newText).split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 2500);
  const na = a.map(norm);
  const nb = b.map(norm);
  const n = a.length;
  const m = b.length;
  const width = m + 1;
  const dp = new Uint16Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * width + j] = na[i] === nb[j] ? dp[(i + 1) * width + j + 1] + 1 : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (na[i] === nb[j]) { ops.push({ op: '=', text: b[j] }); i++; j++; }
    else if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) ops.push({ op: '-', text: a[i++] });
    else ops.push({ op: '+', text: b[j++] });
  }
  while (i < n) ops.push({ op: '-', text: a[i++] });
  while (j < m) ops.push({ op: '+', text: b[j++] });
  return {
    ops,
    added: ops.filter((o) => o.op === '+').length,
    removed: ops.filter((o) => o.op === '-').length,
    same: ops.filter((o) => o.op === '=').length
  };
}

module.exports = { lineDiff };
