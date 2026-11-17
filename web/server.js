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
const billing = require('./billing');
// Payments. The Stripe secret key, the webhook secret and the Supabase service role key live ONLY in Railway settings; they never reach the browser.
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const STRIPE_API = (process.env.STRIPE_API_BASE || 'https://api.stripe.com').replace(/\/+$/, '');
const STRIPE_METHODS = (process.env.STRIPE_PAYMENT_METHODS || '').split(',').map((x) => x.trim()).filter(Boolean);   // normally empty: Stripe uses the methods switched on in its Dashboard
const PUBLIC_DIR = path.join(__dirname, 'public');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8'
};

function securityHeaders(area) {
  const isApp = area === 'app', isClock = area === 'clock';
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
      'connect-src ' + (isClock ? "'self'" : connect.join(' ')),
      "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'", "object-src 'none'"
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': isClock ? 'no-referrer' : 'strict-origin-when-cross-origin',   // the clock page's address is a secret
    ...(isClock ? { 'X-Robots-Tag': 'noindex, nofollow' } : {}),
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
    sites: ['1', '2-5', '6-20', '20+'].includes(d.sites) ? d.sites : null, package_interest: d.package === '1' ? 'self_managed' : d.package === '2' ? 'managed_service' : null, message: clip(d.message, 2000) };
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

// ---- Managed Service postcode check. Two small lookups that return only what the page needs; nothing is stored.
// The postcode service (postcodes.io) is free and public. The area itself (base point and miles) is read from the database's public managed_area().
const lookups = new Map();
function lookupLimited(ip) {
  const now = Date.now(), recent = (lookups.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  recent.push(now); lookups.set(ip, recent);
  if (lookups.size > 5000) for (const [k, v] of lookups) if (!v.some((t) => now - t < 600000)) lookups.delete(k);
  return recent.length > 30;
}
function cleanPostcode(v) {
  const t = String(v == null ? '' : v).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^[A-Z]{1,2}[0-9][A-Z0-9]?[0-9][A-Z]{2}$/.test(t) ? t.slice(0, -3) + ' ' + t.slice(-3) : null;
}
async function geocode(postcode) {
  const r = await fetch('https://api.postcodes.io/postcodes/' + encodeURIComponent(postcode), { signal: AbortSignal.timeout(6000) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('postcode service ' + r.status);
  const j = await r.json();
  return j && j.result && typeof j.result.latitude === 'number' && typeof j.result.longitude === 'number' ? { lat: j.result.latitude, lng: j.result.longitude } : null;
}
function miles(a, b) {
  const rad = (d) => d * Math.PI / 180, dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(x));
}
async function handleLookup(req, res, pathname, query) {
  const reply = (status, obj) => send(res, status, JSON.stringify(obj), { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' });
  const ip = String((req.headers['x-forwarded-for'] || '').split(',')[0] || req.socket.remoteAddress || '').trim();
  if (lookupLimited(ip)) return reply(429, { error: 'Too many checks. Please try again in a few minutes, or call us.' });
  const pc = cleanPostcode(query.get('postcode') || query.get('pc'));
  if (!pc) return reply(422, { error: 'Please enter a full UK postcode, for example ME4 4TL.' });
  try {
    const here = await geocode(pc);
    if (!here) return reply(404, { error: 'We could not find that postcode. Please check it and try again.' });
    if (pathname === '/api/postcode') return reply(200, { ok: true, postcode: pc, lat: here.lat, lng: here.lng });
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return reply(503, { error: 'This check is not switched on yet. Please call us.' });
    const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/managed_area', { method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(6000) });
    const rows = r.ok ? await r.json() : null;
    const a = rows && rows[0];
    if (!a) { console.error('managed_area lookup failed: status ' + r.status + (r.ok ? ' (no area row: has migration 0006 been run?)' : ' (has migration 0006 been run in Supabase?)')); return reply(502, { error: 'Sorry, we could not check that just now. Please call us.' }); }
    return reply(200, { ok: true, available: miles({ lat: a.lat, lng: a.lng }, here) <= a.radius_miles, area: a.label, radius_miles: a.radius_miles });
  } catch (e) { console.error('lookup error', e.message); return reply(502, { error: 'Sorry, we could not check that just now. Please call us.' }); }
}


// ---------- payments ----------
const checkoutHits = new Map();
function checkoutLimited(ip) { const now = Date.now(), a = (checkoutHits.get(ip) || []).filter((t) => now - t < 600000); a.push(now); checkoutHits.set(ip, a); return a.length > 40; }

// The signed-in head-office user presses "Pay now". We look up THEIR company with THEIR OWN token (so they can only ever pay for their own company),
// then ask Stripe for a payment page.
async function handleCheckout(req, res) {
  const out = (status, obj) => send(res, status, JSON.stringify(obj), { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' });
  const origin = req.headers.origin;
  if (origin) { try { if (new URL(origin).host !== req.headers.host) return out(403, { error: 'Not allowed.' }); } catch { return out(403, { error: 'Not allowed.' }); } }
  if (!STRIPE_SECRET_KEY || !SUPABASE_URL || !SUPABASE_ANON_KEY) return out(503, { error: 'Online payment is not switched on yet.' });
  const ip = String((req.headers['x-forwarded-for'] || '').split(',')[0] || req.socket.remoteAddress || '').trim();
  if (checkoutLimited(ip)) return out(429, { error: 'Too many attempts. Please wait a few minutes.' });
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!m) return out(401, { error: 'Please sign in again.' });
  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/billing_info', { method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + m[1], 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(8000) });
    if (!r.ok) return out(401, { error: 'Please sign in again.' });
    const info = (await r.json())[0];
    if (!info) return out(403, { error: 'Only the head-office user can pay.' });
    if (info.subscription !== 'trial') return out(409, { error: 'This account is already set up for payment.' });
    const proto = (req.headers['x-forwarded-proto'] || 'http').split(',')[0];
    const params = billing.checkoutParams({ companyId: info.company_id, sites: info.sites, interval: info.billing_interval, email: info.email, origin: proto + '://' + req.headers.host, methods: STRIPE_METHODS });
    const sr = await fetch(STRIPE_API + '/v1/checkout/sessions', { method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from(STRIPE_SECRET_KEY + ':').toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString(), signal: AbortSignal.timeout(10000) });
    const sj = await sr.json().catch(() => ({}));
    if (!sr.ok || !sj.url) { console.error('stripe checkout failed', sr.status, sj && sj.error && sj.error.message); return out(502, { error: 'Sorry, we could not start the payment. Please try again, or contact Tremcore.' }); }
    return out(200, { url: sj.url });
  } catch (e) { console.error('checkout error', e.message); return out(502, { error: 'Sorry, we could not start the payment. Please try again, or contact Tremcore.' }); }
}

// A brand-new sign-up pays FIRST. The sign-up page has just made the login (not yet confirmed); here, with the service key, we make the unpaid
// company for it and send the person straight to Stripe. Nothing opens until Stripe confirms the payment (the webhook), and the login cannot be
// used until the email is confirmed, so it takes both to get in.
async function handleSignupCheckout(req, res) {
  const out = (status, obj) => send(res, status, JSON.stringify(obj), { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' });
  const origin = req.headers.origin;
  if (origin) { try { if (new URL(origin).host !== req.headers.host) return out(403, { error: 'Not allowed.' }); } catch { return out(403, { error: 'Not allowed.' }); } }
  if (!STRIPE_SECRET_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return out(503, { error: 'Online payment is not switched on yet.' });
  const ip = String((req.headers['x-forwarded-for'] || '').split(',')[0] || req.socket.remoteAddress || '').trim();
  if (checkoutLimited(ip)) return out(429, { error: 'Too many attempts. Please wait a few minutes.' });
  let d; try { d = JSON.parse(await readBody(req, 4000)); } catch { return out(400, { error: 'Sorry, that could not be read.' }); }
  const email = clip(d && d.email, 200), company = clip(d && d.company, 160), name = clip(d && d.name, 120), sites = Math.floor(Number(d && d.sites)), billingInterval = d && d.billing === 'annual' ? 'annual' : 'monthly';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !company || !name || !(sites >= 1 && sites <= 100)) return out(422, { error: 'Some of the details were not accepted.' });
  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/signup_prepare', { method: 'POST',
      headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_email: email, p_company: company, p_full_name: name, p_sites: sites, p_billing: billingInterval }), signal: AbortSignal.timeout(8000) });
    if (!r.ok) {
      const e = await r.json().catch(() => ({})), m = String(e.message || '');
      console.error('signup_prepare refused', r.status, m.slice(0, 120));
      if (/already_paid/.test(m)) return out(409, { error: 'This sign-up has already been paid for. Please confirm your email and sign in.' });
      if (/signup_closed/.test(m)) return out(403, { error: 'Sign-up is not open at the moment.' });
      if (/invalid_details/.test(m)) return out(422, { error: 'Some of the details were not accepted.' });
      return out(403, { error: 'We could not start your payment. Please contact Tremcore and we will help.' });
    }
    const info = (await r.json())[0];
    if (!info) return out(403, { error: 'We could not start your payment. Please contact Tremcore and we will help.' });
    const proto = (req.headers['x-forwarded-proto'] || 'http').split(',')[0];
    const params = billing.checkoutParams({ companyId: info.company_id, sites: info.sites, interval: info.billing_interval, email: info.email, origin: proto + '://' + req.headers.host, methods: STRIPE_METHODS, welcome: true });
    const sr = await fetch(STRIPE_API + '/v1/checkout/sessions', { method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from(STRIPE_SECRET_KEY + ':').toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString(), signal: AbortSignal.timeout(10000) });
    const sj = await sr.json().catch(() => ({}));
    if (!sr.ok || !sj.url) { console.error('stripe signup checkout failed', sr.status, sj && sj.error && sj.error.message); return out(502, { error: 'Sorry, we could not start the payment. Please try again, or contact Tremcore.' }); }
    return out(200, { url: sj.url });
  } catch (e) { console.error('signup checkout error', e.message); return out(502, { error: 'Sorry, we could not start the payment. Please try again, or contact Tremcore.' }); }
}

// Add-ons (Toolbox Talks, Staff Clock In / Out): the signed-in head-office user is sent to Stripe to pay. The database decides who may buy what.
async function handleCheckoutExtra(req, res) {
  const out = (status, obj) => send(res, status, JSON.stringify(obj), { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' });
  const origin = req.headers.origin;
  if (origin) { try { if (new URL(origin).host !== req.headers.host) return out(403, { error: 'Not allowed.' }); } catch { return out(403, { error: 'Not allowed.' }); } }
  if (!STRIPE_SECRET_KEY || !SUPABASE_URL || !SUPABASE_ANON_KEY) return out(503, { error: 'Online payment is not switched on yet.' });
  const ip = String((req.headers['x-forwarded-for'] || '').split(',')[0] || req.socket.remoteAddress || '').trim();
  if (checkoutLimited(ip)) return out(429, { error: 'Too many attempts. Please wait a few minutes.' });
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!m) return out(401, { error: 'Please sign in again.' });
  let code; try { code = String(JSON.parse(await readBody(req, 2000)).code || ''); } catch { return out(400, { error: 'Bad request.' }); }
  if (!/^[a-z_]{1,40}$/.test(code)) return out(400, { error: 'Bad request.' });
  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/extra_checkout_info', { method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + m[1], 'Content-Type': 'application/json' }, body: JSON.stringify({ p_code: code }), signal: AbortSignal.timeout(8000) });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      if (/already_owned/.test(j.message || '')) return out(409, { error: 'You already have this add-on.' });
      if (r.status === 401) return out(401, { error: 'Please sign in again.' });
      const why = j.message || '';
      console.error('extra checkout refused', r.status, why);
      if (r.status === 404 || /PGRST202|could not find the function/i.test(why + (j.code || ''))) return out(503, { error: 'Add-ons are not switched on yet. Tremcore needs to finish a database update.' });
      if (/not_head/.test(why)) return out(403, { error: 'Only the head-office user can add this.' });
      if (/two_factor_needed/.test(why)) return out(403, { error: 'Please finish signing in with your 2FA code first, then try again.' });
      if (/not_self_managed/.test(why)) return out(403, { error: 'Add-ons are only for Self-Managed accounts.' });
      if (/not_active/.test(why)) return out(403, { error: 'Your subscription needs to be active before you can add this.' });
      return out(403, { error: /not_allowed/.test(why) ? 'Add-ons are not fully switched on yet. Tremcore needs to finish a database update (migration 0018).' : 'Sorry, this cannot be added to your account right now. Please contact Tremcore. (Reason: ' + String(why || r.status).replace(/[^\w .:-]/g, '').slice(0, 80) + ')' });
    }
    const info = (await r.json())[0];
    if (!info) return out(403, { error: 'Sorry, this cannot be added to your account right now. Please contact Tremcore. (Reason: no details returned)' });
    const proto = (req.headers['x-forwarded-proto'] || 'http').split(',')[0];
    const params = billing.extraCheckoutParams({ companyId: info.company_id, code, name: info.name + (info.charged_per === 'site' ? ' (per site)' : ''), unitPence: info.price_pence, quantity: info.quantity,
      customerId: info.stripe_customer_id, email: info.email, origin: proto + '://' + req.headers.host });
    const sr = await fetch(STRIPE_API + '/v1/checkout/sessions', { method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from(STRIPE_SECRET_KEY + ':').toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString(), signal: AbortSignal.timeout(10000) });
    const sj = await sr.json().catch(() => ({}));
    if (!sr.ok || !sj.url) { console.error('stripe extra checkout failed', sr.status, sj && sj.error && sj.error.message); return out(502, { error: 'Sorry, we could not start the payment. Please try again, or contact Tremcore.' }); }
    return out(200, { url: sj.url });
  } catch (e) { console.error('extra checkout error', e.message); return out(502, { error: 'Sorry, we could not start the payment. Please try again, or contact Tremcore.' }); }
}

// Stripe tells us a payment happened. We only believe a message that carries Stripe's signature.
async function handleWebhook(req, res) {
  const out = (status, obj) => send(res, status, JSON.stringify(obj), { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' });
  if (!STRIPE_WEBHOOK_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return out(503, { error: 'not configured' });
  let raw; try { raw = await readBody(req, 1000000); } catch { return out(413, { error: 'too big' }); }
  if (!billing.verifySignature(raw, req.headers['stripe-signature'], STRIPE_WEBHOOK_SECRET)) return out(400, { error: 'bad signature' });
  let ev; try { ev = JSON.parse(raw); } catch { return out(400, { error: 'bad json' }); }
  const act = billing.eventToAction(ev);
  if (!act) return out(200, { ignored: true });
  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/apply_stripe_event', { method: 'POST',
      headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_event_id: act.eventId, p_event_type: act.type, p_company: act.company, p_customer: act.customer, p_subscription: act.subscription, p_action: act.action, p_extra: act.extra || null, p_quantity: act.quantity || 1 }), signal: AbortSignal.timeout(8000) });
    if (!r.ok) { console.error('apply_stripe_event failed', r.status); return out(500, { error: 'try again' }); }   // Stripe will retry
    const result = await r.json();
    if (result === 'unknown_company') console.error('stripe event for an unknown company', act.eventId, act.type);
    return out(200, { result });
  } catch (e) { console.error('webhook error', e.message); return out(500, { error: 'try again' }); }
}

// ---- Staff Clock In / Out. The QR code on a site's poster is a secret link, /clock/<token>. The page has no login; it can only show the
// people of that one site and clock one of them in or out. It never talks to the database itself: these two routes call the clock functions
// with the service key (the functions are closed to everyone else), and each one is rate-limited.
const clockHits = new Map();   // key -> [timestamps]
function clockLimited(key, max, windowMs) {
  const now = Date.now(), recent = (clockHits.get(key) || []).filter((t) => now - t < windowMs);
  recent.push(now); clockHits.set(key, recent);
  if (clockHits.size > 20000) for (const [k, v] of clockHits) if (!v.some((t) => now - t < windowMs)) clockHits.delete(k);
  return recent.length > max;
}
const CLOCK_TOKEN = /^[0-9a-f]{32}$/;
async function handleClock(req, res, searchParams) {
  const out = (status, obj) => send(res, status, JSON.stringify(obj), { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' }, 'clock');
  const ip = String((req.headers['x-forwarded-for'] || '').split(',')[0] || req.socket.remoteAddress || '').trim();
  const inactive = () => { clockLimited('bad:' + ip, 1e9, 10 * 60 * 1000); return out(404, { error: 'This QR code is not active. Please ask your manager.' }); };
  // A site's whole team can share one Wi-Fi address, so the general limit is generous; wrong codes are limited much harder.
  if ((clockHits.get('bad:' + ip) || []).filter((t) => Date.now() - t < 10 * 60 * 1000).length >= 30) return out(429, { error: 'Too many tries. Please wait a few minutes.' });
  if (clockLimited('all:' + ip, 300, 10 * 60 * 1000)) return out(429, { error: 'Too many requests. Please wait a few minutes.' });
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return out(503, { error: 'Clock in is not switched on yet.' });
  let token, rpc, body;
  if (req.method === 'GET') {
    token = clip(searchParams.get('t'), 40); rpc = 'clock_site_info'; body = { p_token: token };
  } else {
    const origin = req.headers.origin;
    if (origin) { try { if (new URL(origin).host !== req.headers.host) return out(403, { error: 'Not allowed.' }); } catch { return out(403, { error: 'Not allowed.' }); } }
    let raw; try { raw = await readBody(req, 2000); } catch { return out(413, { error: 'Too big.' }); }
    let d; try { d = JSON.parse(raw); } catch { return out(400, { error: 'Sorry, that could not be read.' }); }
    token = clip(d && d.t, 40); rpc = 'clock_action';
    const member = clip(d && d.member, 40), action = d && d.action;
    if (!/^[0-9a-f-]{36}$/.test(member) || (action !== 'in' && action !== 'out')) return out(400, { error: 'Sorry, that could not be read.' });
    body = { p_token: token, p_member: member, p_action: action };
  }
  if (!CLOCK_TOKEN.test(token)) return inactive();
  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/' + rpc, { method: 'POST',
      headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
    if (!r.ok) { console.error('clock rpc failed', rpc, r.status); return out(502, { error: 'Sorry, something went wrong. Please try again.' }); }
    const result = await r.json();
    if (!result) return inactive();
    return out(200, result);
  } catch (e) { console.error('clock error', e.message); return out(502, { error: 'Sorry, something went wrong. Please try again.' }); }
}

const server = http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { return send(res, 400, 'Bad request'); }
  if (req.method === 'POST' && pathname === '/api/enquiry') return handleEnquiry(req, res);
  if (req.method === 'POST' && pathname === '/api/checkout') return handleCheckout(req, res);
  if (req.method === 'POST' && pathname === '/api/signup-checkout') return handleSignupCheckout(req, res);
  if (req.method === 'POST' && pathname === '/api/checkout-extra') return handleCheckoutExtra(req, res);
  if (req.method === 'POST' && pathname === '/api/stripe-webhook') return handleWebhook(req, res);
  if (pathname === '/api/clock' && (req.method === 'GET' || req.method === 'POST')) return handleClock(req, res, new URL(req.url, 'http://x').searchParams);
  if (req.method === 'GET' && (pathname === '/api/managed-check' || pathname === '/api/postcode')) return handleLookup(req, res, pathname, new URL(req.url, 'http://x').searchParams);
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', { Allow: 'GET, HEAD' });

  if (pathname === '/healthz') return send(res, 200, 'ok', { 'Content-Type': 'text/plain' });
  if (pathname === '/config.json') {
    return send(res, 200, JSON.stringify({ url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY }),
      { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' });
  }

  if (pathname === '/app') { res.writeHead(301, { Location: '/app/' }); return res.end(); }
  if (/^\/clock\/[0-9a-f]{32}\/?$/.test(pathname)) pathname = '/clock/index.html';   // every site's QR link opens the same page; the code in the address picks the site
  if (pathname.endsWith('/')) pathname += 'index.html';
  const area = pathname.startsWith('/app/') ? 'app' : pathname.startsWith('/clock/') ? 'clock' : 'site';
  const file = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden');
  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) { res.writeHead(301, { Location: pathname + '/' }); return res.end(); }
    if (err || !st.isFile()) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' }, area);
    const ext = path.extname(file).toLowerCase();
    // The shell and service worker must always be fresh; images can be cached.
    const cache = ext === '.png' ? 'public, max-age=86400' : area === 'clock' ? 'no-store' : 'no-cache';
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
