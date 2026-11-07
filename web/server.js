// Tremcore web server. No packages needed: Node's built-in modules only.
// Serves the app files and hands the browser the PUBLIC Supabase settings.
// The Supabase service-role (secret) key is never sent to the browser.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const PUBLIC_DIR = path.join(__dirname, 'public');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8'
};

function securityHeaders(area) {
  const isApp = area === 'app';
  const connect = ["'self'"];
  if (SUPABASE_URL) { connect.push(SUPABASE_URL); connect.push(SUPABASE_URL.replace(/^http/, 'ws')); }
  return {
    'Content-Security-Policy': [
      "default-src 'self'",
      isApp ? "script-src 'self' https://cdn.jsdelivr.net" : "script-src 'self'",
      "style-src 'self'",
      // The public website uses a few inline style attributes (no scripts); the sign-in app stays fully strict.
      ...(isApp ? [] : ["style-src-attr 'unsafe-inline'"]),
      "img-src 'self' data: blob:" + (SUPABASE_URL ? ' ' + SUPABASE_URL : ''),
      'connect-src ' + connect.join(' '),
      "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'", "object-src 'none'"
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Cross-Origin-Opener-Policy': 'same-origin'
  };
}

function send(res, status, body, headers, area) {
  res.writeHead(status, Object.assign(securityHeaders(area), headers || {}));
  res.end(body);
}

// ---- Website enquiry form: stored in Supabase through the public (anon) key; the database only lets anyone ADD a row.
const hits = new Map(); // ip -> [timestamps]
function limited(ip) {
  const now = Date.now(), recent = (hits.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  recent.push(now); hits.set(ip, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < 600000)) hits.delete(k);
  return recent.length > 5;
}
const clip = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
function readBody(req, max) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > max) { reject(new Error('too big')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
async function handleEnquiry(req, res) {
  const wantsJson = (req.headers.accept || '').includes('application/json');
  const reply = (status, obj) => {
    if (wantsJson) return send(res, status, JSON.stringify(obj), { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' });
    res.writeHead(303, Object.assign(securityHeaders(), { Location: '/contact/?' + (status < 300 ? 'sent=1' : 'error=1') })); res.end();
  };
  const origin = req.headers.origin;
  if (origin) { try { if (new URL(origin).host !== req.headers.host) return reply(403, { error: 'Not allowed.' }); } catch { return reply(403, { error: 'Not allowed.' }); } }
  const ip = String((req.headers['x-forwarded-for'] || '').split(',')[0] || req.socket.remoteAddress || '').trim();
  if (limited(ip)) return reply(429, { error: 'Too many requests. Please try again in a few minutes, or call us.' });
  let raw; try { raw = await readBody(req, 20000); } catch { return reply(413, { error: 'That message is too long.' }); }
  let d; try { d = (req.headers['content-type'] || '').includes('json') ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw)); } catch { return reply(400, { error: 'Sorry, that could not be read.' }); }
  if (!d || typeof d !== 'object') return reply(400, { error: 'Sorry, that could not be read.' });
  if (clip(d.website, 50)) return reply(200, { ok: true }); // hidden field filled in: a bot. Pretend all is well.
  const row = { name: clip(d.name, 120), company: clip(d.company, 160), email: clip(d.email, 200), phone: clip(d.phone, 40),
    sites: ['1', '2-5', '6-20', '20+'].includes(d.sites) ? d.sites : null, package_interest: d.package === '1' ? 'self_managed' : null, message: clip(d.message, 2000) };
  if (!row.name) return reply(422, { error: 'Please tell us your name.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) return reply(422, { error: 'Please check your email address.' });
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return reply(503, { error: 'Sorry, enquiries are not switched on yet. Please call us.' });
  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1/enquiries', { method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(row), signal: AbortSignal.timeout(8000) });
    if (!r.ok) { console.error('enquiry insert failed', r.status); return reply(502, { error: 'Sorry, that did not send. Please try again or call us.' }); }
  } catch (e) { console.error('enquiry insert error', e.message); return reply(502, { error: 'Sorry, that did not send. Please try again or call us.' }); }
  return reply(200, { ok: true });
}

const server = http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { return send(res, 400, 'Bad request'); }
  if (req.method === 'POST' && pathname === '/api/enquiry') return handleEnquiry(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', { Allow: 'GET, HEAD' });

  if (pathname === '/healthz') return send(res, 200, 'ok', { 'Content-Type': 'text/plain' });
  if (pathname === '/config.json') {
    return send(res, 200, JSON.stringify({ url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY }),
      { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' });
  }

  if (pathname === '/app') { res.writeHead(301, { Location: '/app/' }); return res.end(); }
  if (pathname.endsWith('/')) pathname += 'index.html';
  const area = pathname.startsWith('/app/') ? 'app' : 'site';
  const file = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden');
  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) { res.writeHead(301, { Location: pathname + '/' }); return res.end(); }
    if (err || !st.isFile()) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' }, area);
    const ext = path.extname(file).toLowerCase();
    // The shell and service worker must always be fresh; images can be cached.
    const cache = ext === '.png' ? 'public, max-age=86400' : 'no-cache';
    res.writeHead(200, Object.assign(securityHeaders(area), {
      'Content-Type': TYPES[ext] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': cache
    }));
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
});

if (require.main === module) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) console.warn('WARNING: SUPABASE_URL and SUPABASE_ANON_KEY are not set; sign-in will not work.');
  server.listen(PORT, () => console.log('Tremcore web listening on ' + PORT));
}
module.exports = server;
