// Minimal QR Code encoder (model 2, byte mode, error correction level M, versions 1–10).
// Enough for the report verification links printed on PDFs. Returns a square boolean matrix.

// [total codewords, ec codewords per block, [[blocks, data codewords per block], ...]] for level M
const SPEC = [null,
  [26, 10, [[1, 16]]], [44, 16, [[1, 28]]], [70, 26, [[1, 44]]], [100, 18, [[2, 32]]], [134, 24, [[2, 43]]],
  [172, 16, [[4, 27]]], [196, 18, [[4, 31]]], [242, 22, [[2, 38], [2, 39]]], [292, 22, [[3, 36], [2, 37]]], [346, 26, [[4, 43], [1, 44]]]];
const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

// Galois field GF(256) with polynomial 0x11d
const EXP = new Array(512), LOG = new Array(256);
{ let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; }
const gmul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
function rsGenerator(n) {
  let g = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) { next[j] ^= g[j]; next[j + 1] ^= gmul(g[j], EXP[i]); }
    g = next;
  }
  return g;
}
function rsRemainder(data, n) {
  const gen = rsGenerator(n);
  const res = new Array(n).fill(0);
  for (const b of data) {
    const f = b ^ res.shift();
    res.push(0);
    for (let i = 0; i < n; i++) res[i] ^= gmul(gen[i + 1], f);
  }
  return res;
}

function bchFormat(mask) {
  const data = (0b00 << 3) | mask; // level M = 00
  let v = data << 10;
  for (let i = 14; i >= 10; i--) if (v & (1 << i)) v ^= 0x537 << (i - 10);
  return ((data << 10) | v) ^ 0x5412;
}
function bchVersion(ver) {
  let v = ver << 12;
  for (let i = 17; i >= 12; i--) if (v & (1 << i)) v ^= 0x1f25 << (i - 12);
  return (ver << 12) | v;
}

export function qrMatrix(text) {
  const bytes = [...Buffer.from(String(text), 'utf8')];
  let ver = 1;
  for (; ver <= 10; ver++) {
    const cap = SPEC[ver][2].reduce((s, [b, d]) => s + b * d, 0);
    const bits = 4 + (ver < 10 ? 8 : 16) + bytes.length * 8;
    if (bits <= cap * 8) break;
  }
  if (ver > 10) throw new Error('Text too long for QR code');
  const [total, ecPer, groups] = SPEC[ver];
  const dataCap = groups.reduce((s, [b, d]) => s + b * d, 0);
  // bit stream
  const bits = [];
  const put = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >> i) & 1); };
  put(0b0100, 4); put(bytes.length, ver < 10 ? 8 : 16); for (const b of bytes) put(b, 8);
  put(0, Math.min(4, dataCap * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let pad = 0; data.length < dataCap; pad++) data.push(pad % 2 ? 0x11 : 0xec);
  // blocks + interleave
  const blocks = [];
  let k = 0;
  for (const [count, len] of groups) for (let i = 0; i < count; i++) { const d = data.slice(k, k + len); k += len; blocks.push({ d, e: rsRemainder(d, ecPer) }); }
  const out = [];
  const maxD = Math.max(...blocks.map((b) => b.d.length));
  for (let i = 0; i < maxD; i++) for (const b of blocks) if (i < b.d.length) out.push(b.d[i]);
  for (let i = 0; i < ecPer; i++) for (const b of blocks) out.push(b.e[i]);
  if (out.length !== total) throw new Error('QR internal length error');

  const size = 17 + ver * 4;
  const m = Array.from({ length: size }, () => new Array(size).fill(null)); // null = free
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (r, c, v) => { m[r][c] = v; fn[r][c] = true; };
  const finder = (r0, c0) => {
    for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
      const rr = r0 + r, cc = c0 + c;
      if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
      const on = r >= 0 && r <= 6 && c >= 0 && c <= 6 && (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
      set(rr, cc, on);
    }
  };
  finder(0, 0); finder(0, size - 7); finder(size - 7, 0);
  for (let i = 8; i < size - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const al = ALIGN[ver];
  for (const r of al) for (const c of al) {
    if ((r === 6 && c === 6) || (r === 6 && c === al[al.length - 1]) || (r === al[al.length - 1] && c === 6)) continue;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
  }
  // reserve format areas and dark module
  for (let i = 0; i < 9; i++) { if (!fn[8][i]) set(8, i, false); if (!fn[i][8]) set(i, 8, false); }
  for (let i = 0; i < 8; i++) { set(8, size - 1 - i, false); set(size - 1 - i, 8, false); }
  set(size - 8, 8, true);
  if (ver >= 7) for (let i = 0; i < 18; i++) { const r = Math.floor(i / 3), c = size - 11 + (i % 3); set(r, c, false); set(c, r, false); }

  // place data bits (zig-zag)
  const dataBits = [];
  for (const b of out) for (let i = 7; i >= 0; i--) dataBits.push((b >> i) & 1);
  let bi = 0, up = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col = 5;
    for (let n = 0; n < size; n++) {
      const row = up ? size - 1 - n : n;
      for (const c of [col, col - 1]) if (!fn[row][c]) { m[row][c] = bi < dataBits.length ? dataBits[bi] === 1 : false; bi++; }
    }
    up = !up;
  }

  const MASKS = [(r, c) => (r + c) % 2 === 0, (r) => r % 2 === 0, (r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0, (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0];
  const withMask = (mask) => {
    const g = m.map((row, r) => row.map((v, c) => (fn[r][c] ? v : v !== MASKS[mask](r, c))));
    const f = bchFormat(mask);
    const bit = (i) => ((f >> i) & 1) === 1;
    // format bits: 0..14, with bit 14 most significant
    for (let i = 0; i < 15; i++) {
      const b = bit(14 - i);
      // around top-left finder
      if (i < 6) g[8][i] = b; else if (i === 6) g[8][7] = b; else if (i === 7) g[8][8] = b; else if (i === 8) g[7][8] = b; else g[14 - i][8] = b;
      // split copy
      if (i < 7) g[size - 1 - i][8] = b; else g[8][size - 15 + i] = b;
    }
    g[size - 8][8] = true;
    if (ver >= 7) {
      const v = bchVersion(ver);
      for (let i = 0; i < 18; i++) { const b = ((v >> i) & 1) === 1; const r = Math.floor(i / 3), c = size - 11 + (i % 3); g[r][c] = b; g[c][r] = b; }
    }
    return g;
  };
  const penalty = (g) => {
    let p = 0;
    for (let r = 0; r < size; r++) for (const line of [g[r], g.map((row) => row[r])]) {
      let run = 1;
      for (let i = 1; i < size; i++) { if (line[i] === line[i - 1]) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1; }
      for (let i = 0; i + 10 < size; i++) {
        const s = line.slice(i, i + 11).map((x) => (x ? 1 : 0)).join('');
        if (s === '10111010000' || s === '00001011101') p += 40;
      }
    }
    for (let r = 0; r < size - 1; r++) for (let c = 0; c < size - 1; c++) { const v = g[r][c]; if (v === g[r][c + 1] && v === g[r + 1][c] && v === g[r + 1][c + 1]) p += 3; }
    const dark = g.flat().filter(Boolean).length;
    p += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10;
    return p;
  };
  let best = null;
  for (let mask = 0; mask < 8; mask++) { const g = withMask(mask); const p = penalty(g); if (!best || p < best.p) best = { g, p }; }
  return best.g;
}

/** SVG string (for screens). */
export function qrSvg(text, { scale = 4, margin = 4, dark = '#0A1F4A' } = {}) {
  const g = qrMatrix(text);
  const n = g.length + margin * 2;
  let path = '';
  g.forEach((row, r) => row.forEach((v, c) => { if (v) path += `M${c + margin} ${r + margin}h1v1h-1z`; }));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${n * scale}" height="${n * scale}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#fff"/><path d="${path}" fill="${dark}"/></svg>`;
}
