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

function securityHeaders() {
  const connect = ["'self'"];
  if (SUPABASE_URL) { connect.push(SUPABASE_URL); connect.push(SUPABASE_URL.replace(/^http/, 'ws')); }
  return {
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self' https://cdn.jsdelivr.net",
      "style-src 'self'",
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

function send(res, status, body, headers) {
  res.writeHead(status, Object.assign(securityHeaders(), headers || {}));
  res.end(body);
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', { Allow: 'GET, HEAD' });
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { return send(res, 400, 'Bad request'); }

  if (pathname === '/healthz') return send(res, 200, 'ok', { 'Content-Type': 'text/plain' });
  if (pathname === '/config.json') {
    return send(res, 200, JSON.stringify({ url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY }),
      { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' });
  }

  if (pathname === '/') pathname = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
    const ext = path.extname(file).toLowerCase();
    // The shell and service worker must always be fresh; images can be cached.
    const cache = ext === '.png' ? 'public, max-age=86400' : 'no-cache';
    res.writeHead(200, Object.assign(securityHeaders(), {
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
