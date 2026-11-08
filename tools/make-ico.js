'use strict';

/* Wraps the app icons into a Windows .ico file (used by the Desktop / Start menu shortcut). Run: node tools/make-ico.js */

const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, '..', 'public', 'icons');
// Modern .ico files can hold PNG images directly.
const images = [['favicon-32.png', 32], ['icon-192.png', 192]].map(([f, size]) => ({ size, data: fs.readFileSync(path.join(dir, f)) }));
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2); // icon
header.writeUInt16LE(images.length, 4);
let offset = 6 + 16 * images.length;
const entries = images.map(({ size, data }) => {
  const e = Buffer.alloc(16);
  e[0] = size >= 256 ? 0 : size;
  e[1] = size >= 256 ? 0 : size;
  e.writeUInt16LE(1, 4); // colour planes
  e.writeUInt16LE(32, 6); // bits per pixel
  e.writeUInt32LE(data.length, 8);
  e.writeUInt32LE(offset, 12);
  offset += data.length;
  return e;
});
fs.writeFileSync(path.join(dir, 'guardora.ico'), Buffer.concat([header, ...entries, ...images.map((i) => i.data)]));
console.log('wrote public/icons/guardora.ico');
