'use strict';

/*
 * Plain text from a CV file. Supports PDF, DOCX, DOC (Word 97-2003), RTF, ODT and TXT.
 * Images and scanned PDFs have no text layer: they are kept, and marked for a person to read.
 */

const zlib = require('node:zlib');

const KINDS = {
  pdf: 'pdf', docx: 'docx', doc: 'doc', rtf: 'rtf', odt: 'odt', txt: 'txt',
  jpg: 'image', jpeg: 'image', png: 'image', webp: 'image'
};
const MIMES = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  rtf: 'application/rtf',
  odt: 'application/vnd.oasis.opendocument.text',
  txt: 'text/plain; charset=utf-8',
  image: 'image/*'
};

// Decide the format from the bytes first (names and mime types in email are often wrong), then the extension.
function detectKind(buffer, fileName = '') {
  const head = buffer.subarray(0, 8);
  if (head.toString('latin1', 0, 5) === '%PDF-') return 'pdf';
  if (head.toString('latin1', 0, 5) === '{\\rtf') return 'rtf';
  if (head.readUInt32BE(0) === 0xd0cf11e0) return 'doc';
  if (head[0] === 0xff && head[1] === 0xd8) return 'image';
  if (head.toString('latin1', 1, 4) === 'PNG') return 'image';
  if (head.toString('latin1', 0, 4) === 'RIFF' && buffer.toString('latin1', 8, 12) === 'WEBP') return 'image';
  const ext = String(fileName).toLowerCase().split('.').pop();
  if (head[0] === 0x50 && head[1] === 0x4b) {
    const names = zipNames(buffer);
    if (names.includes('word/document.xml')) return 'docx';
    if (names.includes('content.xml')) return 'odt';
    return '';
  }
  if (ext === 'txt' && !buffer.subarray(0, 4000).includes(0)) return 'txt';
  return '';
}

/* ---------- ZIP (DOCX, ODT) ---------- */

function zipEntries(buffer) {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 66000); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error('Damaged zip file');
  const entries = [];
  const count = buffer.readUInt16LE(eocd + 10);
  let p = buffer.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && p + 46 <= buffer.length; n++) {
    if (buffer.readUInt32LE(p) !== 0x02014b50) break;
    const nameLength = buffer.readUInt16LE(p + 28);
    entries.push({
      name: buffer.toString('utf8', p + 46, p + 46 + nameLength),
      method: buffer.readUInt16LE(p + 10),
      size: buffer.readUInt32LE(p + 20),
      offset: buffer.readUInt32LE(p + 42)
    });
    p += 46 + nameLength + buffer.readUInt16LE(p + 30) + buffer.readUInt16LE(p + 32);
  }
  return entries;
}

function zipNames(buffer) {
  try {
    return zipEntries(buffer).map((e) => e.name);
  } catch {
    return [];
  }
}

function zipRead(buffer, wanted) {
  const out = new Map();
  for (const e of zipEntries(buffer)) {
    if (!wanted(e.name) || e.size > 2e7) continue;
    const start = e.offset + 30 + buffer.readUInt16LE(e.offset + 26) + buffer.readUInt16LE(e.offset + 28);
    const raw = buffer.subarray(start, start + e.size);
    out.set(e.name, (e.method === 0 ? raw : zlib.inflateRawSync(raw, { maxOutputLength: 5e7 })).toString('utf8'));
  }
  return out;
}

function decodeXml(text) {
  return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

function wordXmlText(xml) {
  return decodeXml(xml
    .replace(/<w:tab\b[^>]*\/>/g, '\t')
    .replace(/<w:(br|cr)\b[^>]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<\/w:tc>/g, '\t')
    .replace(/<w:t\b[^>]*>([^<]*)<\/w:t>/g, '\u0001$1\u0002')
    .replace(/<w:instrText\b[^>]*>[^<]*<\/w:instrText>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/[\u0001\u0002]/g, ''));
}

function docxText(buffer) {
  const parts = zipRead(buffer, (n) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(n));
  if (!parts.get('word/document.xml')) throw new Error('Not a valid DOCX file');
  const headers = [...parts.keys()].filter((n) => /header/.test(n)).map((n) => wordXmlText(parts.get(n)));
  const footers = [...parts.keys()].filter((n) => /footer/.test(n)).map((n) => wordXmlText(parts.get(n)));
  return [...headers, wordXmlText(parts.get('word/document.xml')), ...footers].join('\n');
}

function odtText(buffer) {
  const xml = zipRead(buffer, (n) => n === 'content.xml').get('content.xml') || '';
  return decodeXml(xml
    .replace(/<text:tab\/>/g, '\t').replace(/<text:line-break\/>/g, '\n')
    .replace(/<text:s(?: text:c="(\d+)")?\/>/g, (m, c) => ' '.repeat(Number(c) || 1))
    .replace(/<\/text:(p|h)>/g, '\n').replace(/<\/table:table-cell>/g, '\t')
    .replace(/<[^>]+>/g, ''));
}

/* ---------- DOC (Word 97-2003): compound file + piece table ---------- */

function cfbStreams(buf) {
  const sectorSize = 1 << buf.readUInt16LE(0x1e);
  const miniSize = 1 << buf.readUInt16LE(0x20);
  const cutoff = buf.readUInt32LE(0x38);
  const sector = (i) => buf.subarray(512 + i * sectorSize, 512 + (i + 1) * sectorSize);

  const fatSectors = [];
  for (let i = 0; i < 109; i++) {
    const s = buf.readUInt32LE(0x4c + i * 4);
    if (s < 0xfffffffa) fatSectors.push(s);
  }
  let difat = buf.readUInt32LE(0x44);
  for (let guard = 0; difat < 0xfffffffa && guard < 10000; guard++) {
    const sec = sector(difat);
    for (let i = 0; i < sectorSize / 4 - 1; i++) {
      const s = sec.readUInt32LE(i * 4);
      if (s < 0xfffffffa) fatSectors.push(s);
    }
    difat = sec.readUInt32LE(sectorSize - 4);
  }
  const fat = [];
  for (const s of fatSectors) {
    const sec = sector(s);
    for (let i = 0; i < sectorSize / 4; i++) fat.push(sec.readUInt32LE(i * 4));
  }
  const chain = (start, table, read) => {
    const parts = [];
    for (let s = start, guard = 0; s < 0xfffffffa && guard < 1e6; s = table[s], guard++) parts.push(read(s));
    return Buffer.concat(parts);
  };

  const dir = chain(buf.readUInt32LE(0x30), fat, sector);
  const entries = [];
  for (let off = 0; off + 128 <= dir.length; off += 128) {
    const nameLen = dir.readUInt16LE(off + 0x40);
    entries.push({
      name: dir.toString('utf16le', off, off + Math.max(0, nameLen - 2)),
      type: dir[off + 0x42],
      start: dir.readUInt32LE(off + 0x74),
      size: dir.readUInt32LE(off + 0x78)
    });
  }
  const root = entries.find((e) => e.type === 5);
  const miniFat = [];
  const miniFatData = chain(buf.readUInt32LE(0x3c), fat, sector);
  for (let i = 0; i + 4 <= miniFatData.length; i += 4) miniFat.push(miniFatData.readUInt32LE(i));
  const miniStream = root ? chain(root.start, fat, sector) : Buffer.alloc(0);

  const streams = new Map();
  for (const e of entries) {
    if (e.type !== 2) continue;
    const data = e.size < cutoff
      ? chain(e.start, miniFat, (s) => miniStream.subarray(s * miniSize, (s + 1) * miniSize))
      : chain(e.start, fat, sector);
    streams.set(e.name, data.subarray(0, e.size));
  }
  return streams;
}

function docText(buffer) {
  const streams = cfbStreams(buffer);
  const word = streams.get('WordDocument');
  if (!word || word.readUInt16LE(0) !== 0xa5ec) throw new Error('Not a Word document');
  const table = streams.get(word.readUInt16LE(0x0a) & 0x0200 ? '1Table' : '0Table');
  const fcClx = word.readUInt32LE(0x1a2);
  const lcbClx = word.readUInt32LE(0x1a6);
  if (!table || !lcbClx) throw new Error('No text table');

  let p = fcClx;
  const end = fcClx + lcbClx;
  while (p < end && table[p] === 0x01) p += 3 + table.readInt16LE(p + 1); // skip formatting (Prc) blocks
  if (table[p] !== 0x02) throw new Error('No piece table');
  const lcb = table.readUInt32LE(p + 1);
  const plc = table.subarray(p + 5, p + 5 + lcb);
  const n = (lcb - 4) / 12;
  let text = '';
  for (let i = 0; i < n; i++) {
    const cpStart = plc.readUInt32LE(i * 4);
    const cpEnd = plc.readUInt32LE((i + 1) * 4);
    const fcRaw = plc.readUInt32LE((n + 1) * 4 + i * 8 + 2);
    const count = cpEnd - cpStart;
    if (fcRaw & 0x40000000) {
      const fc = (fcRaw & 0x3fffffff) / 2;
      text += word.subarray(fc, fc + count).toString('latin1');
    } else {
      text += word.subarray(fcRaw, fcRaw + count * 2).toString('utf16le');
    }
  }
  // Drop field codes (\x13 code \x14 result \x15 keeps the result) and Word's control characters.
  return text.replace(/\x13[^\x13\x14\x15]*\x14/g, '').replace(/\x13[^\x13\x15]*\x15/g, '')
    .replace(/[\r\x0b]/g, '\n').replace(/\x07/g, '\t').replace(/[\x00-\x08\x0c\x0e-\x1f]/g, '');
}

// Last resort for damaged .doc files: readable runs of characters.
function printableRuns(buffer) {
  const runs = [];
  const utf16 = buffer.toString('utf16le').match(/[\x20-\x7e -ɏ\r\n\t]{6,}/g) || [];
  const ascii = buffer.toString('latin1').match(/[\x20-\x7e\r\n\t]{6,}/g) || [];
  for (const r of (utf16.join('').length > ascii.join('').length ? utf16 : ascii)) runs.push(r);
  return runs.join('\n');
}

/* ---------- RTF ---------- */

function rtfText(buffer) {
  let s = buffer.toString('latin1');
  // Remove destinations that are not body text (fonts, colours, styles, pictures, metadata).
  for (const dest of ['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object', 'themedata', 'colorschememapping', 'datastore', 'latentstyles', 'listtable', 'listoverridetable', 'rsidtbl', 'generator', 'xmlnstbl', 'mmathPr']) {
    for (let i = s.indexOf('{\\' + dest); i !== -1; i = s.indexOf('{\\' + dest)) s = removeGroup(s, i);
  }
  for (let i = s.indexOf('{\\*'); i !== -1; i = s.indexOf('{\\*')) s = removeGroup(s, i);
  return s
    .replace(/\\u(-?\d+)\??/g, (m, n) => String.fromCharCode(Number(n) < 0 ? Number(n) + 65536 : Number(n)))
    .replace(/\\'([0-9a-f]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\(par|line|row)\b ?/g, '\n').replace(/\\(tab|cell)\b ?/g, '\t')
    .replace(/\\[a-z]+-?\d* ?/gi, '').replace(/\\([{}\\])/g, '$1').replace(/[{}]/g, '');
}

function removeGroup(s, start) {
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === '\\') { i++; continue; }
    if (s[i] === '{') depth++;
    else if (s[i] === '}' && --depth === 0) return s.slice(0, start) + s.slice(i + 1);
  }
  return s.slice(0, start);
}

/* ---------- PDF ---------- */

let pdfjsPromise = null;
const loadPdfjs = () => (pdfjsPromise = pdfjsPromise || import('pdfjs-dist/legacy/build/pdf.mjs'));

async function pdfText(buffer) {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({
    data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: true, verbosity: 0, disableFontFace: true
  });
  const doc = await task.promise;
  const pages = Math.min(doc.numPages, 40);
  const out = [];
  for (let n = 1; n <= pages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    // Group fragments into visual lines by vertical position, then order left to right.
    const rows = [];
    for (const item of content.items) {
      if (!item.str) continue;
      const y = item.transform[5];
      const x = item.transform[4];
      let row = rows.find((r) => Math.abs(r.y - y) < 2.5);
      if (!row) rows.push(row = { y, items: [] });
      row.items.push({ x, str: item.str, w: item.width || 0 });
    }
    rows.sort((a, b) => b.y - a.y);
    for (const row of rows) {
      row.items.sort((a, b) => a.x - b.x);
      let line = '';
      let lastEnd = null;
      for (const it of row.items) {
        if (lastEnd !== null && it.x - lastEnd > 12) line += '   ';
        else if (lastEnd !== null && it.x - lastEnd > 1 && !line.endsWith(' ') && !it.str.startsWith(' ')) line += ' ';
        line += it.str;
        lastEnd = it.x + it.w;
      }
      out.push(line);
    }
    out.push('');
    page.cleanup();
  }
  const pageCount = doc.numPages;
  await task.destroy();
  return { text: out.join('\n'), pages: pageCount };
}

/* ---------- Entry point ---------- */

function tidy(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[  -​ ]/g, ' ')
    .replace(/[‐-―]/g, '-')
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[-■-◿•‣⁃➢✓✔·]/g, '• ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function extractText(buffer, fileName) {
  const kind = detectKind(buffer, fileName);
  let text = '';
  let pages = null;
  if (kind === 'pdf') ({ text, pages } = await pdfText(buffer));
  else if (kind === 'docx') text = docxText(buffer);
  else if (kind === 'odt') text = odtText(buffer);
  else if (kind === 'rtf') text = rtfText(buffer);
  else if (kind === 'txt') text = buffer.toString('utf8');
  else if (kind === 'doc') {
    try {
      text = docText(buffer);
    } catch {
      text = printableRuns(buffer);
    }
  }
  return { kind, text: tidy(text).slice(0, 400000), pages };
}

module.exports = { extractText, detectKind, MIMES, KINDS };
