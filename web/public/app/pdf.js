// A very small PDF writer (text, bullet points and hand-drawn signatures), so a Toolbox Talk record can be downloaded as a PDF
// without any outside library. Signatures are stored as strokes, so they are drawn here as lines.
(function () {
  'use strict';
  const W = 595, H = 842, M = 50;
  const MAP = { '‘': "'", '’': "'", '“': '"', '”': '"', '–': '-', '—': '-', '…': '...', '×': 'x', '•': '-', ' ': ' ' };
  const clean = (s) => String(s == null ? '' : s).replace(/[‘’“”–—…×• ]/g, (c) => MAP[c]).replace(/[^\x20-\x7e\xa3]/g, '?');
  const esc = (s) => clean(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const num = (n) => (Math.round(n * 100) / 100).toString();

  // blocks: { h: 'Heading' } { p: 'text' } { li: 'bullet' } { kv: ['Label', 'Value'] } { sig: { name, when, strokes } } { gap: n } { small: 'text' }
  function build(doc) {
    const pages = []; let cur = null, y = 0;
    const newPage = () => { cur = []; pages.push(cur); y = H - M; };
    const need = (h) => { if (!cur || y - h < M) newPage(); };
    const wrap = (text, size, width, bold) => {
      const cw = size * (bold ? 0.56 : 0.5), max = Math.max(8, Math.floor(width / cw)), out = [];
      for (const para of clean(text).split('\n')) {
        let line = '';
        for (const word of para.split(' ')) {
          if ((line + ' ' + word).trim().length > max) { if (line) out.push(line); line = word; while (line.length > max) { out.push(line.slice(0, max)); line = line.slice(max); } }
          else line = (line + ' ' + word).trim();
        }
        out.push(line);
      }
      return out;
    };
    const text = (x, yy, size, str, bold) => cur.push('BT /' + (bold ? 'F2' : 'F1') + ' ' + size + ' Tf ' + num(x) + ' ' + num(yy) + ' Td (' + esc(str) + ') Tj ET');
    const para = (str, size, opts) => {
      opts = opts || {}; const x = M + (opts.indent || 0), lines = wrap(str, size, W - 2 * M - (opts.indent || 0), opts.bold), lh = size * 1.35;
      lines.forEach((ln, i) => { need(lh); y -= lh; if (opts.bullet && i === 0) text(M + 6, y, size, '-', false); text(x, y, size, ln, opts.bold); });
    };
    newPage();
    if (doc.title) para(doc.title, 18, { bold: true });
    if (doc.subtitle) para(doc.subtitle, 10);
    y -= 8;
    for (const b of doc.blocks || []) {
      if (b.gap) y -= b.gap;
      else if (b.h) { need(30); y -= 6; para(b.h, 12, { bold: true }); cur.push('0.8 w ' + M + ' ' + num(y - 3) + ' m ' + (W - M) + ' ' + num(y - 3) + ' l S'); y -= 4; }
      else if (b.p) para(b.p, 10);
      else if (b.small) para(b.small, 8);
      else if (b.li) para(b.li, 10, { bullet: true, indent: 16 });
      else if (b.kv) { const lines = wrap(b.kv[1], 10, W - 2 * M - 110, false); need(14 * lines.length); y -= 14; text(M, y, 10, b.kv[0], true); lines.forEach((ln, i) => { if (i) y -= 13.5; text(M + 110, y, 10, ln, false); }); }
      else if (b.sig) {
        const bh = 44, bw = 150; need(bh + 12); const top = y - 4, base = top - bh;
        text(M, top - 14, 10, b.sig.name, true); if (b.sig.when) text(M, top - 28, 8, b.sig.when, false);
        const x0 = M + 230;
        cur.push('0.5 w ' + x0 + ' ' + num(base) + ' ' + bw + ' ' + bh + ' re S');
        cur.push('1.2 w 1 J 1 j');
        for (const st of b.sig.strokes || []) {
          if (!Array.isArray(st) || !st.length) continue;
          const pt = (p) => num(x0 + 4 + (bw - 8) * Math.min(Math.max(+p[0] || 0, 0), 1000) / 1000) + ' ' + num(base + bh - 4 - (bh - 8) * Math.min(Math.max(+p[1] || 0, 0), 400) / 400);
          if (st.length === 1) { cur.push(pt(st[0]) + ' m ' + pt(st[0]) + ' l S'); continue; }
          cur.push(pt(st[0]) + ' m ' + st.slice(1).map((p) => pt(p) + ' l').join(' ') + ' S');
        }
        cur.push('0.8 w'); y = base - 10;
      }
    }
    // assemble: 1 catalog, 2 pages, 3 and 4 fonts, then a content stream and a page object per page
    const objs = []; const add = (s) => { objs.push(s); return objs.length; };
    add('<< /Type /Catalog /Pages 2 0 R >>');
    add(''); // pages, filled below
    add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const kids = [];
    pages.forEach((p, i) => {
      const body = p.join('\n') + '\nBT /F1 8 Tf ' + M + ' 30 Td (' + esc((doc.footer || '') + '   Page ' + (i + 1) + ' of ' + pages.length) + ') Tj ET';
      const c = add('<< /Length ' + body.length + ' >>\nstream\n' + body + '\nendstream');
      const pg = add('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + W + ' ' + H + '] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ' + c + ' 0 R >>');
      kids.push(pg + ' 0 R');
    });
    objs[1] = '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + kids.length + ' >>';
    let out = '%PDF-1.4\n'; const offs = [];
    objs.forEach((o, i) => { offs.push(out.length); out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
    const xref = out.length;
    out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('') +
      'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
    const bytes = new Uint8Array(out.length); for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 255;
    return bytes;
  }
  window.TCPdf = { build };
})();
