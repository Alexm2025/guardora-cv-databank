'use strict';

/* Draws the Guardora app icon (a gold shield with a check mark on forest green) at every size the
   phone and desktop installs need, with no image libraries. Run: node tools/make-icons.js */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const OUT = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(OUT, { recursive: true });

const BG = [16, 52, 41];
const GOLD = [214, 176, 92];
const CREAM = [250, 246, 236];

// Shield outline in a 0..1 box: straight top, straight sides, then curves meeting at the point.
const SHIELD = [];
for (let i = 0; i <= 30; i++) SHIELD.push([0.24 + 0.52 * (i / 30), 0.2 + 0.03 * Math.sin(Math.PI * (i / 30))]);
SHIELD.push([0.76, 0.48]);
for (let i = 1; i <= 40; i++) { // right side curves in to the bottom point
  const a = (Math.PI / 2) * (i / 40);
  SHIELD.push([0.5 + 0.26 * Math.cos(a), 0.48 + 0.36 * Math.sin(a)]);
}
for (let i = 1; i <= 40; i++) {
  const a = Math.PI / 2 + (Math.PI / 2) * (i / 40);
  SHIELD.push([0.5 + 0.26 * Math.cos(a), 0.48 + 0.36 * Math.sin(a)]);
}
SHIELD.push([0.24, 0.2]);

function inPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function distToSegment(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

const scalePoly = (poly, s, cx = 0.5, cy = 0.5) => poly.map(([x, y]) => [cx + (x - cx) * s, cy + (y - cy) * s]);

const outer = scalePoly(SHIELD, 1.08, 0.5, 0.52);
const inner = scalePoly(SHIELD, 0.9, 0.5, 0.51);

function colorAt(x, y, { maskable, rounded }) {
  // Maskable icons keep everything inside the central 80% "safe zone".
  const s = maskable ? 0.78 : 1;
  const u = 0.5 + (x - 0.5) / s;
  const v = 0.5 + (y - 0.5) / s;
  if (rounded) {
    const r = 0.22;
    const qx = Math.max(Math.abs(x - 0.5) - (0.5 - r), 0);
    const qy = Math.max(Math.abs(y - 0.5) - (0.5 - r), 0);
    if (Math.hypot(qx, qy) > r) return null;
  }
  let c = BG;
  if (inPoly(u, v, outer)) c = GOLD;
  if (inPoly(u, v, inner)) c = CREAM;
  const check = [[0.38, 0.5], [0.47, 0.59], [0.63, 0.41]];
  const d = Math.min(distToSegment(u, v, check[0], check[1]), distToSegment(u, v, check[1], check[2]));
  if (inPoly(u, v, inner) && d < 0.045) c = BG;
  return c;
}

function render(size, opts) {
  const px = Buffer.alloc(size * size * 4);
  const ss = 4; // 16 samples per pixel for smooth edges
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0; let g = 0; let b = 0; let a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = colorAt((x + (sx + 0.5) / ss) / size, (y + (sy + 0.5) / ss) / size, opts);
          if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
        }
      }
      const i = (y * size + x) * 4;
      px[i] = a ? r / a : 0; px[i + 1] = a ? g / a : 0; px[i + 2] = a ? b / a : 0; px[i + 3] = Math.round((a / (ss * ss)) * 255);
    }
  }
  return png(size, size, px);
}

function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const jobs = [
  ['icon-192.png', 192, { rounded: true }],
  ['icon-512.png', 512, { rounded: true }],
  ['maskable-512.png', 512, { maskable: true }],
  ['maskable-192.png', 192, { maskable: true }],
  ['apple-touch-icon.png', 180, { maskable: true }],
  ['favicon-32.png', 32, { rounded: true }]
];
for (const [name, size, opts] of jobs) {
  fs.writeFileSync(path.join(OUT, name), render(size, opts));
  console.log('wrote', name);
}
