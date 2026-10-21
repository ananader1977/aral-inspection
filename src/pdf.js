// Dependency-free PDF writer, extended from the Dar Al Bunyan app:
// A4 pages, Helvetica regular/bold (WinAnsi), rectangles, lines, JPEG and PNG images, link areas,
// and a flowing layout helper (FlowDoc) with automatic page breaks, header/footer on every page,
// "Page X of Y", and page numbers that can be read back for a table of contents.
import zlib from 'node:zlib';
import { decodePng } from './png.js';

const W_REG = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const W_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];

export const PAGE_W = 595.28;
export const PAGE_H = 841.89;

// Unicode characters that WinAnsi can print (outside Latin-1) → their byte, with a width.
const WIN = { '‘': [0x91, 222], '’': [0x92, 222], '“': [0x93, 333], '”': [0x94, 333], '•': [0x95, 350], '–': [0x96, 556], '—': [0x97, 1000], '…': [0x85, 1000], '€': [0x80, 556], '™': [0x99, 1000] };
const SUBST = { '→': '->', '←': '<-', '≤': '<=', '≥': '>=', ' ': ' ', ' ': ' ', ' ': ' ', '−': '-', '✓': 'v', '✕': 'x' };

function toWin(str) {
  let out = '';
  for (const ch of String(str ?? '')) {
    if (SUBST[ch]) { out += SUBST[ch]; continue; }
    const c = ch.codePointAt(0);
    if (WIN[ch]) out += String.fromCharCode(WIN[ch][0]);
    else if (c >= 32 && c <= 255) out += ch;
    else if (c === 9 || c === 10) out += ' ';
    else out += '?';
  }
  return out;
}
const WIN_W = Object.fromEntries(Object.values(WIN).map(([b, w]) => [b, w]));
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
const num = (n) => (Math.round(n * 100) / 100).toString();
function color(c) {
  const m = /^#?([0-9a-f]{6})$/i.exec(c || '');
  if (!m) return '0 0 0';
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((x) => num(x / 255)).join(' ');
}

/** Width and height of a JPEG from its SOF marker, or null if it is not a baseline/progressive JPEG. */
export function jpegInfo(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if ([0xc0, 0xc1, 0xc2].includes(marker)) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7), components: buf[i + 9] };
    i += 2 + len;
  }
  return null;
}

/** Turns image bytes (JPEG or PNG) into an object the PDF can embed; null if unsupported. */
export function loadImage(buf) {
  if (!buf) return null;
  const j = jpegInfo(buf);
  if (j) return { kind: 'jpeg', width: j.width, height: j.height, components: j.components, data: buf };
  try { const p = decodePng(buf); return { kind: 'raw', width: p.width, height: p.height, rgb: p.rgb, alpha: p.alpha }; } catch { return null; }
}

export class Pdf {
  constructor({ title = 'Document', author = '' } = {}) {
    this.title = toWin(title);
    this.author = toWin(author);
    this.pages = [];
    this.links = [];
    this.images = [];
    this.newPage();
  }
  newPage() {
    this.cur = [];
    this.pages.push(this.cur);
    this.links.push([]);
    return this;
  }
  get pageIndex() { return this.pages.indexOf(this.cur); }
  textWidth(str, size = 10, bold = false) {
    const w = bold ? W_BOLD : W_REG;
    let total = 0;
    for (const ch of toWin(str)) {
      const c = ch.charCodeAt(0);
      total += c >= 32 && c <= 126 ? w[c - 32] : WIN_W[c] || 556;
    }
    return (total * size) / 1000;
  }
  /** Greedy word-wrap into lines no wider than `width`. Long words are broken. */
  wrap(str, width, size = 10, bold = false) {
    const lines = [];
    for (const para of String(str ?? '').split(/\r?\n/)) {
      let line = '';
      for (let word of para.split(/\s+/).filter(Boolean)) {
        while (this.textWidth(word, size, bold) > width && word.length > 1) {
          let k = word.length - 1;
          while (k > 1 && this.textWidth(word.slice(0, k), size, bold) > width) k--;
          if (line) { lines.push(line); line = ''; }
          lines.push(word.slice(0, k));
          word = word.slice(k);
        }
        const test = line ? `${line} ${word}` : word;
        if (this.textWidth(test, size, bold) <= width || !line) line = test;
        else { lines.push(line); line = word; }
      }
      lines.push(line);
    }
    return lines;
  }
  /** (x, y): anchor point; y is the BASELINE measured from the top of the page. */
  text(str, x, y, { size = 10, bold = false, align = 'left', fill = '#000000', page } = {}) {
    const s = toWin(str);
    const w = this.textWidth(str, size, bold);
    const px = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    (page ?? this.cur).push(`BT ${color(fill)} rg /${bold ? 'F2' : 'F1'} ${num(size)} Tf ${num(px)} ${num(PAGE_H - y)} Td (${esc(s)}) Tj ET`);
    return this;
  }
  rect(x, y, w, h, { fill, stroke, lineWidth = 0.7, page, dash } = {}) {
    const ops = [];
    if (fill) ops.push(`${color(fill)} rg`);
    if (stroke) ops.push(`${color(stroke)} RG ${num(lineWidth)} w`);
    if (dash) ops.push(`[${dash.join(' ')}] 0 d`);
    ops.push(`${num(x)} ${num(PAGE_H - y - h)} ${num(w)} ${num(h)} re ${fill && stroke ? 'B' : fill ? 'f' : 'S'}`);
    if (dash) ops.push('[] 0 d');
    (page ?? this.cur).push(ops.join(' '));
    return this;
  }
  line(x1, y1, x2, y2, { stroke = '#000000', lineWidth = 0.7, page } = {}) {
    (page ?? this.cur).push(`${color(stroke)} RG ${num(lineWidth)} w ${num(x1)} ${num(PAGE_H - y1)} m ${num(x2)} ${num(PAGE_H - y2)} l S`);
    return this;
  }
  /** Draws an image (from loadImage) with its top-left at (x, y), w x h points. */
  image(img, x, y, w, h, { page } = {}) {
    let entry = this.images.find((e) => e.src === img);
    if (!entry) { entry = { src: img, name: `Im${this.images.length + 1}` }; this.images.push(entry); }
    (page ?? this.cur).push(`q ${num(w)} 0 0 ${num(h)} ${num(x)} ${num(PAGE_H - y - h)} cm /${entry.name} Do Q`);
    return this;
  }
  /** Clickable area opening a URL. */
  link(url, x, y, w, h, pageIdx = this.pageIndex) { this.links[pageIdx].push({ url, x, y, w, h }); return this; }
  /** QR code from a boolean matrix (see qr.js), top-left (x, y), side `size` points. */
  qr(matrix, x, y, size, { fill = '#0A1F4A', page } = {}) {
    const n = matrix.length, m = size / n;
    const ops = [`${color(fill)} rg`];
    matrix.forEach((row, r) => row.forEach((v, c) => { if (v) ops.push(`${num(x + c * m)} ${num(PAGE_H - y - (r + 1) * m)} ${num(m + 0.02)} ${num(m + 0.02)} re f`); }));
    (page ?? this.cur).push(ops.join(' '));
    return this;
  }
  toBuffer() {
    const objs = [];
    const add = (buf) => objs.push(Buffer.isBuffer(buf) ? buf : Buffer.from(buf, 'latin1'));
    const nPages = this.pages.length;
    add('<< /Type /Catalog /Pages 2 0 R >>');
    add(`<< /Type /Pages /Kids [${this.pages.map((_, i) => `${6 + i * 2} 0 R`).join(' ')}] /Count ${nPages} >>`);
    add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    add(`<< /Title (${esc(this.title)}) /Author (${esc(this.author)}) /Producer (ARAL Inspection App) >>`);
    let next = 6 + nPages * 2;
    const imgObjs = [];
    for (const e of this.images) {
      const smaskNo = e.src.kind === 'raw' && e.src.alpha ? next++ : null;
      imgObjs.push({ e, smaskNo, imgNo: next++ });
    }
    const linkObjs = this.links.map((ls) => ls.map((l) => ({ ...l, no: next++ })));
    const xobjects = imgObjs.length ? ` /XObject << ${imgObjs.map((o) => `/${o.e.name} ${o.imgNo} 0 R`).join(' ')} >>` : '';
    this.pages.forEach((ops, i) => {
      const annots = linkObjs[i].length ? ` /Annots [${linkObjs[i].map((l) => `${l.no} 0 R`).join(' ')}]` : '';
      add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>${xobjects} >> /Contents ${7 + i * 2} 0 R${annots} >>`);
      const data = zlib.deflateSync(Buffer.from(ops.join('\n'), 'latin1'));
      add(Buffer.concat([Buffer.from(`<< /Length ${data.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'), data, Buffer.from('\nendstream', 'latin1')]));
    });
    const stream = (dict, raw, deflate = true) => {
      const data = deflate ? zlib.deflateSync(raw) : raw;
      add(Buffer.concat([Buffer.from(`<< ${dict} /Length ${data.length}${deflate ? ' /Filter /FlateDecode' : ''} >>\nstream\n`, 'latin1'), data, Buffer.from('\nendstream', 'latin1')]));
    };
    for (const o of imgObjs) {
      const s = o.e.src;
      if (s.kind === 'jpeg') {
        const cs = s.components === 1 ? '/DeviceGray' : s.components === 4 ? '/DeviceCMYK /Decode [1 0 1 0 1 0 1 0]' : '/DeviceRGB';
        add(Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${s.width} /Height ${s.height} /ColorSpace ${cs} /BitsPerComponent 8 /Filter /DCTDecode /Length ${s.data.length} >>\nstream\n`, 'latin1'), s.data, Buffer.from('\nendstream', 'latin1')]));
      } else {
        if (o.smaskNo) stream(`/Type /XObject /Subtype /Image /Width ${s.width} /Height ${s.height} /ColorSpace /DeviceGray /BitsPerComponent 8`, s.alpha);
        stream(`/Type /XObject /Subtype /Image /Width ${s.width} /Height ${s.height} /ColorSpace /DeviceRGB /BitsPerComponent 8${o.smaskNo ? ` /SMask ${o.smaskNo} 0 R` : ''}`, s.rgb);
      }
    }
    for (const ls of linkObjs) for (const l of ls) {
      add(`<< /Type /Annot /Subtype /Link /Rect [${num(l.x)} ${num(PAGE_H - l.y - l.h)} ${num(l.x + l.w)} ${num(PAGE_H - l.y)}] /Border [0 0 0] /A << /S /URI /URI (${esc(toWin(l.url))}) >> >>`);
    }
    const chunks = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
    const offsets = [];
    let pos = chunks[0].length;
    objs.forEach((body, i) => {
      offsets.push(pos);
      const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), body, Buffer.from('\nendobj\n', 'latin1')]);
      chunks.push(b);
      pos += b.length;
    });
    let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
    for (const o of offsets) xref += `${String(o).padStart(10, '0')} 00000 n \n`;
    xref += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${pos}\n%%EOF\n`;
    chunks.push(Buffer.from(xref, 'latin1'));
    return Buffer.concat(chunks);
  }
}

/**
 * Flowing layout on top of Pdf: a cursor `y` moves down the page; `need(h)` starts a new page when
 * h points do not fit. header(doc, pageNo) and footer(doc, pageNo, total) are drawn on every page
 * (footers at the end, once the total is known). Pages listed in `skipChrome` get neither.
 */
export class FlowDoc {
  constructor({ title, author, margin = { top: 72, bottom: 60, left: 46, right: 46 }, header, footer } = {}) {
    this.pdf = new Pdf({ title, author });
    this.m = margin;
    this.header = header;
    this.footer = footer;
    this.skipChrome = new Set();
    this.width = PAGE_W - margin.left - margin.right;
    this.x = margin.left;
    this.y = margin.top;
    this.onNewPage = null;
    this.drawHeader();
  }
  get page() { return this.pdf.pageIndex + 1; }
  get bottom() { return PAGE_H - this.m.bottom; }
  drawHeader() { if (this.header && !this.skipChrome.has(this.page)) this.header(this, this.page); }
  newPage({ chrome = true } = {}) {
    this.pdf.newPage();
    if (!chrome) this.skipChrome.add(this.page);
    this.y = this.m.top;
    this.drawHeader();
    if (this.onNewPage && chrome) this.onNewPage(this);
    return this;
  }
  need(h) { if (this.y + h > this.bottom) this.newPage(); return this; }
  space(h) { this.y += h; return this; }
  /** Wrapped paragraph. Returns its height. */
  para(text, { size = 10, bold = false, fill = '#16213A', indent = 0, lineGap = 1.38, after = 6, width, align = 'left' } = {}) {
    const w = (width ?? this.width) - indent;
    const lines = this.pdf.wrap(text, w, size, bold);
    const lh = size * lineGap;
    for (const ln of lines) {
      this.need(lh);
      const x = align === 'center' ? this.x + indent + w / 2 : this.x + indent;
      this.pdf.text(ln, x, this.y + size, { size, bold, fill, align });
      this.y += lh;
    }
    this.y += after;
    return lines.length * lh + after;
  }
  heightOf(text, { size = 10, bold = false, indent = 0, lineGap = 1.38, width } = {}) {
    return this.pdf.wrap(text, (width ?? this.width) - indent, size, bold).length * size * lineGap;
  }
  /** Simple table: cols [{label, w (share), align}], rows of strings. Header repeats on new pages. */
  table(cols, rows, { size = 9, head = '#0A1F4A', zebra = '#F5F7FA', pad = 5 } = {}) {
    const total = cols.reduce((s, c) => s + (c.w || 1), 0);
    const ws = cols.map((c) => ((c.w || 1) / total) * this.width);
    const drawHead = () => {
      const hh = size + pad * 2 + 2;
      this.need(hh + size * 2);
      this.pdf.rect(this.x, this.y, this.width, hh, { fill: head });
      let x = this.x;
      cols.forEach((c, i) => { this.pdf.text(c.label, c.align === 'right' ? x + ws[i] - pad : x + pad, this.y + pad + size, { size: size - 0.5, bold: true, fill: '#FFFFFF', align: c.align === 'right' ? 'right' : 'left' }); x += ws[i]; });
      this.y += hh;
    };
    drawHead();
    rows.forEach((row, ri) => {
      const cells = row.map((v, i) => this.pdf.wrap(String(v ?? ''), ws[i] - pad * 2, size, !!cols[i].bold));
      const h = Math.max(...cells.map((c) => c.length)) * size * 1.3 + pad * 2;
      if (this.y + h > this.bottom) { this.newPage(); drawHead(); }
      if (ri % 2 && zebra) this.pdf.rect(this.x, this.y, this.width, h, { fill: zebra });
      let x = this.x;
      cells.forEach((lines, i) => {
        lines.forEach((ln, li) => this.pdf.text(ln, cols[i].align === 'right' ? x + ws[i] - pad : x + pad, this.y + pad + size + li * size * 1.3, { size, bold: !!cols[i].bold, align: cols[i].align === 'right' ? 'right' : 'left', fill: row.fill?.[i] || '#16213A' }));
        x += ws[i];
      });
      this.y += h;
      this.pdf.line(this.x, this.y, this.x + this.width, this.y, { stroke: '#DDE3EC', lineWidth: 0.5 });
    });
    this.y += 8;
  }
  /** Draws footers on every page now that the page count is known. */
  finish() {
    const total = this.pdf.pages.length;
    if (this.footer) for (let i = 0; i < total; i++) if (!this.skipChrome.has(i + 1)) this.footer(this, i + 1, total, this.pdf.pages[i]);
    return this.pdf.toBuffer();
  }
}

/** Fits an image into a box keeping its proportions; returns {w,h}. */
export function fit(img, maxW, maxH) {
  const r = Math.min(maxW / img.width, maxH / img.height);
  return { w: img.width * r, h: img.height * r };
}
