// A small QR code maker (no packages). Byte mode, error correction level M, versions 1 to 15 (up to 400 characters).
// TCQr.matrix(text) gives rows of true/false; TCQr.svg(text) gives an <svg> element, black on white with the required quiet border.
(function () {
  'use strict';
  // For each version 1..15 at level M: error-correction codewords per block, then the blocks as [count, data codewords each].
  const M = [null,
    [10, [[1, 16]]], [16, [[1, 28]]], [26, [[1, 44]]], [18, [[2, 32]]], [24, [[2, 43]]], [16, [[4, 27]]], [18, [[4, 31]]],
    [22, [[2, 38], [2, 39]]], [22, [[3, 36], [2, 37]]], [26, [[4, 43], [1, 44]]], [30, [[1, 50], [4, 51]]], [22, [[6, 36], [2, 37]]],
    [22, [[8, 37], [1, 38]]], [24, [[4, 40], [5, 41]]], [24, [[5, 41], [5, 42]]]];
  const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50], [6, 30, 54], [6, 32, 58], [6, 34, 62], [6, 26, 46, 66], [6, 26, 48, 70]];
  const dataWords = (v) => M[v][1].reduce((a, b) => a + b[0] * b[1], 0);

  function gmul(x, y) { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; } return z; }
  function divisor(deg) {
    const r = new Array(deg).fill(0); r[deg - 1] = 1; let root = 1;
    for (let i = 0; i < deg; i++) { for (let j = 0; j < deg; j++) { r[j] = gmul(r[j], root); if (j + 1 < deg) r[j] ^= r[j + 1]; } root = gmul(root, 2); }
    return r;
  }
  function remainder(data, div) {
    const r = new Array(div.length).fill(0);
    for (const b of data) { const f = b ^ r.shift(); r.push(0); div.forEach((c, i) => { r[i] ^= gmul(c, f); }); }
    return r;
  }
  function utf8(t) { return Array.from(unescape(encodeURIComponent(t)), (c) => c.charCodeAt(0)); }

  function codewords(bytes, v) {
    const bits = []; const put = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    put(4, 4); put(bytes.length, v < 10 ? 8 : 16); bytes.forEach((b) => put(b, 8));
    const cap = dataWords(v) * 8; put(0, Math.min(4, cap - bits.length)); while (bits.length % 8) bits.push(0);
    const out = []; for (let i = 0; i < bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8).join(''), 2));
    for (let pad = 0xEC; out.length < dataWords(v); pad ^= 0xEC ^ 0x11) out.push(pad);
    // split into blocks, add error correction, interleave
    const ecLen = M[v][0], blocks = []; let at = 0;
    M[v][1].forEach(([n, len]) => { for (let i = 0; i < n; i++) { const d = out.slice(at, at + len); at += len; blocks.push({ d, e: remainder(d, divisor(ecLen)) }); } });
    const res = []; const maxLen = Math.max(...blocks.map((b) => b.d.length));
    for (let i = 0; i < maxLen; i++) blocks.forEach((b) => { if (i < b.d.length) res.push(b.d[i]); });
    for (let i = 0; i < ecLen; i++) blocks.forEach((b) => res.push(b.e[i]));
    return res;
  }

  function build(text) {
    const bytes = utf8(text); let v = 1;
    const need = (ver) => Math.ceil((4 + (ver < 10 ? 8 : 16) + 8 * bytes.length) / 8);
    while (v <= 15 && need(v) > dataWords(v)) v++;
    if (v > 15) throw new Error('too long for a QR code here');
    const size = 17 + 4 * v;
    const mod = Array.from({ length: size }, () => new Array(size).fill(false)), fn = Array.from({ length: size }, () => new Array(size).fill(false));
    const set = (x, y, dark) => { if (x >= 0 && x < size && y >= 0 && y < size) { mod[y][x] = dark; fn[y][x] = true; } };
    for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    [[3, 3], [size - 4, 3], [3, size - 4]].forEach(([cx, cy]) => { for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const d = Math.max(Math.abs(dx), Math.abs(dy)); set(cx + dx, cy + dy, d !== 2 && d !== 4); } });
    const al = ALIGN[v];
    al.forEach((cx, i) => al.forEach((cy, j) => { if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1); }));
    const formatBits = (mask) => { const data = mask; let r = data; for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537); return ((data << 10) | r) ^ 0x5412; };   // level M = 00
    const drawFormat = (mask) => {
      const b = formatBits(mask), bit = (i) => ((b >>> i) & 1) !== 0;
      for (let i = 0; i <= 5; i++) set(8, i, bit(i)); set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8)); for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
      for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i)); for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i)); set(8, size - 8, true);
    };
    drawFormat(0);
    if (v >= 7) { let r = v; for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1F25); const b = (v << 12) | r;
      for (let i = 0; i < 18; i++) { const d = ((b >>> i) & 1) !== 0, a = size - 11 + (i % 3), c = Math.floor(i / 3); set(a, c, d); set(c, a, d); } }
    const data = codewords(bytes, v); let k = 0;
    for (let right = size - 1; right >= 1; right -= 2) { if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) { const x = right - j, y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
        if (!fn[y][x] && k < data.length * 8) { mod[y][x] = ((data[k >>> 3] >>> (7 - (k & 7))) & 1) !== 0; k++; } } }
    const cond = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0, (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
      (x, y) => x * y % 2 + x * y % 3 === 0, (x, y) => (x * y % 2 + x * y % 3) % 2 === 0, (x, y) => ((x + y) % 2 + x * y % 3) % 2 === 0];
    const flip = (m) => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && cond[m](x, y)) mod[y][x] = !mod[y][x]; };
    const penalty = () => {
      let p = 0; const lines = [];
      for (let y = 0; y < size; y++) lines.push(mod[y].map((d) => (d ? '1' : '0')).join(''));
      for (let x = 0; x < size; x++) lines.push(mod.map((row) => (row[x] ? '1' : '0')).join(''));
      lines.forEach((s) => { (s.match(/0{5,}|1{5,}/g) || []).forEach((r) => { p += 3 + r.length - 5; }); [/(?=10111010000)/g, /(?=00001011101)/g].forEach((re) => { p += 40 * (s.match(re) || []).length; }); });
      for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) { const c = mod[y][x]; if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) p += 3; }
      let dark = 0; mod.forEach((row) => row.forEach((d) => { if (d) dark++; })); p += (Math.ceil(Math.abs(dark * 20 - size * size * 10) / (size * size)) - 1) * 10;
      return p;
    };
    let best = 0, bestP = Infinity;
    for (let m = 0; m < 8; m++) { flip(m); drawFormat(m); const p = penalty(); if (p < bestP) { bestP = p; best = m; } flip(m); }
    flip(best); drawFormat(best);
    return mod;
  }

  function svg(text, opts) {
    const m = build(text), n = m.length, q = 4, NS = 'http://www.w3.org/2000/svg';
    let d = ''; m.forEach((row, y) => { let x = 0; while (x < n) { if (!row[x]) { x++; continue; } let e = x; while (e < n && row[e]) e++; d += 'M' + (x + q) + ' ' + (y + q) + 'h' + (e - x) + 'v1h-' + (e - x) + 'z'; x = e; } });
    const s = document.createElementNS(NS, 'svg'); s.setAttribute('viewBox', '0 0 ' + (n + 2 * q) + ' ' + (n + 2 * q)); s.setAttribute('shape-rendering', 'crispEdges'); s.setAttribute('role', 'img');
    s.setAttribute('aria-label', (opts && opts.label) || 'QR code');
    const bg = document.createElementNS(NS, 'rect'); bg.setAttribute('width', n + 2 * q); bg.setAttribute('height', n + 2 * q); bg.setAttribute('fill', '#fff');
    const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); p.setAttribute('fill', '#000'); s.append(bg, p); return s;
  }
  const api = { matrix: build, svg };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else window.TCQr = api;
})();
