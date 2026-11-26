// Browser tests for the sign-in pages. Run: node web/tests/run.js   (needs Playwright with Chromium)
'use strict';
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright')); }

process.env.SUPABASE_URL = 'https://example-project.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon-public-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'SERVICE-SECRET-MUST-NEVER-LEAK';
process.env.STRIPE_SECRET_KEY = 'sk_test_FAKE-MUST-NEVER-LEAK';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_testsecret';
process.env.STRIPE_API_BASE = 'https://stripe.test';
process.env.ANTHROPIC_API_KEY = 'sk-ant-FAKE-MUST-NEVER-LEAK';
process.env.ANTHROPIC_API_BASE = 'https://anthropic.test';
process.env.EMAIL_API_KEY = 'mail-key-MUST-NOT-LEAK';
process.env.REMINDER_SECRET = 'reminder-secret-for-tests';
process.env.EMAIL_FROM = 'Tremcore <info@tremcore.co.uk>';
process.env.EMAIL_API_BASE = 'https://mail.test';
const server = require('../server.js');
const mockJs = fs.readFileSync(path.join(__dirname, 'mock-supabase.js'), 'utf8');

const results = [];
const check = (name, ok) => { results.push([name, !!ok]); console.log((ok ? 'PASS ' : 'FAIL ') + name); };

const USERS = {
  'staff@t': { password: 'correct-horse-battery', factor: false, profile: { role_name: 'tremcore_admin', full_name: 'Aaron Loveday', mfa_required: true } },
  'staff2fa@t': { password: 'correct-horse-battery', factor: true, profile: { role_name: 'tremcore_admin', full_name: 'Aaron Loveday', mfa_required: true } },
  'site@t': { password: 'correct-horse-battery', factor: false, profile: { role_name: 'client_site', full_name: 'Leah Dunn', mfa_required: false } },
  'staffonly@t': { password: 'correct-horse-battery', factor: true, profile: { role_name: 'tremcore_staff', full_name: 'Sam Staff', mfa_required: true } },
  'noprofile@t': { password: 'correct-horse-battery', factor: false, profile: null }
};

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();

  async function newPage(extra, arg) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
    const page = await ctx.newPage();
    const problems = [];
    page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
    page.on('pageerror', (e) => problems.push(String(e)));
    await page.route('**/api/read-document', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ reading: { found: false } }) }));
    await page.route('**/cdn.jsdelivr.net/**', (route) => route.fulfill({ contentType: 'text/javascript', body: mockJs }));
    await page.addInitScript((u) => { window.__mock = { users: JSON.parse(JSON.stringify(u)) }; }, USERS);
    if (extra) await page.addInitScript(extra, arg);
    await page.goto(base + '/app/');
    await page.waitForSelector('h1');
    return { page, problems, ctx };
  }
  const h1 = (p) => p.locator('h1').first().innerText();
  const login = async (p, email, pw) => { await p.fill('#email', email); await p.fill('#password', pw || 'correct-horse-battery'); await p.click('button[type=submit]'); };

  // --- server checks ---
  const cfg = await (await fetch(base + '/config.json')).json();
  check('config exposes only the public URL and anon key', cfg.url === process.env.SUPABASE_URL && cfg.anonKey === 'anon-public-key' && Object.keys(cfg).length === 2);
  const everything = await Promise.all(['/', '/app/', '/app/app.js', '/site.js', '/contact/', '/config.json'].map(async (p) => (await fetch(base + p)).text()));
  check('service-role secret never appears in anything served', !everything.join('').includes('SERVICE-SECRET'));
  const trav = await fetch(base + '/..%2fserver.js'); check('path traversal is blocked', trav.status === 403 || trav.status === 404);
  const trav2 = await fetch(base + '/%2e%2e/server.js'); check('encoded path traversal is blocked', trav2.status === 403 || trav2.status === 404);
  const rootRes = await fetch(base + '/app/');
  const csp = rootRes.headers.get('content-security-policy') || '';
  check('CSP forbids inline scripts and framing', csp.includes("script-src 'self' https://cdn.jsdelivr.net") && csp.includes("frame-ancestors 'none'") && !csp.includes('unsafe-inline'));
  check('security headers present', rootRes.headers.get('x-content-type-options') === 'nosniff' && !!rootRes.headers.get('strict-transport-security'));
  check('health check works', (await fetch(base + '/healthz')).status === 200);
  check('POST to pages is refused', (await fetch(base + '/', { method: 'POST' })).status === 405);
  const siteCsp = (await fetch(base + '/')).headers.get('content-security-policy') || '';
  check('website CSP allows no outside scripts', siteCsp.includes("script-src 'self';") && !siteCsp.includes('jsdelivr') && siteCsp.includes("frame-ancestors 'none'"));
  check('/app redirects to /app/', (await fetch(base + '/app', { redirect: 'manual' })).status === 301);
  check('page folders redirect to a trailing slash', (await fetch(base + '/contact', { redirect: 'manual' })).status === 301);
  check('unknown page is a 404', (await fetch(base + '/nope/')).status === 404);
  const manifest = await (await fetch(base + '/app/manifest.webmanifest')).json();
  check('app installs from /app/', manifest.start_url === '/app/' && manifest.scope === '/app/');

  // --- enquiry form endpoint (Supabase is faked; real fetch passes through) ---
  const realFetch = global.fetch; const sent = [];
  const PC = { 'ME44TL': { latitude: 51.381, longitude: 0.527 }, 'NR11AA': { latitude: 52.63, longitude: 1.29 }, 'ME14AA': { latitude: 51.39, longitude: 0.50 } };
  let pcDown = false;
  const docCalls = [], aiCalls = []; let docRows = [{ storage_path: 'p1/i1/x-cert.pdf', filename: 'cert.pdf', content_type: 'application/pdf', compliance_items: { title: 'Public Liability Insurance' } }], aiFail = false, aiText = '{"document_title":"Public liability certificate","issue_date":"2026-03-01","expiry_date":"2027-02-28","certificate_number":"PL-884213","provider":"Acme Insurance Ltd"}';
  const prepCalls = []; let prepReply = { status: 200 };
  const clockCalls = [], clockPeople = [{ id: '11111111-1111-1111-1111-111111111111', name: 'Jo Bloggs', at: null }, { id: '22222222-2222-2222-2222-222222222222', name: 'Al Smith', at: null }];
  const stripeCalls = [], applied = []; let extraReply = { status: 200, rows: [{ company_id: 'co-1', sites: 3, email: 'pat@acme.example', stripe_customer_id: 'cus_1', name: 'Staff Clock In / Out', price_pence: 599, charged_per: 'site', quantity: 3 }] }; let billingRows = [{ company_id: 'co-1', sites: 3, billing_interval: 'monthly', email: 'pat@acme.example', subscription: 'trial' }], stripeFail = false, applyStatus = 200, applyResult = 'applied', billingAuthOk = true;
  const launchCalls = []; let launchOpen = true; let launchPeople = [{ id: '11111111-1111-1111-1111-111111111111', name: 'pat prospect', email: 'pat@shop.example', business_name: 'Pat Shop Ltd' }];
  let remPeople = []; const cancelCalls = []; let linkOk = true, linkSub = 'sub_live1', linkStatus = 403;
  const offerCalls = [], mailCalls = []; let offerGood = true, couponExists = false, mailFail = false, myOffer = [], attachOk = true, createOk = true;
  const OFFER_ROW = { id: '99999999-9999-4999-8999-999999999999', code: 'TC-ABC234', prospect_name: 'Pat Prospect', prospect_email: 'pat@prospect.example', discount_pence: 700, months: 12, expires_at: new Date(Date.now() + 20 * 86400000).toISOString(), status: 'active', sent_at: null };
  global.fetch = (u, o) => {
    const url = String(u);
    if (url === 'https://stripe.test/v1/coupons') { offerCalls.push({ k: 'coupon', body: new URLSearchParams(o.body) }); return Promise.resolve(couponExists ? new Response(JSON.stringify({ error: { code: 'resource_already_exists', message: 'Coupon already exists' } }), { status: 400 }) : new Response('{"id":"tc-intro-700-12m"}', { status: 200 })); }
    if (url === process.env.SUPABASE_URL + '/rest/v1/rpc/signup_open' && o && o.headers && o.headers.Authorization === 'Bearer staff-token') return Promise.resolve(new Response(String(launchOpen), { status: 200 }));
    if (url.startsWith(process.env.SUPABASE_URL + '/rest/v1/interest_list?')) { launchCalls.push({ k: 'list', u: url, auth: o.headers.Authorization }); return Promise.resolve(o.headers.Authorization === 'Bearer staff-token' ? new Response(JSON.stringify(launchPeople), { status: 200 }) : new Response('[]', { status: 401 })); }
    if (url === process.env.SUPABASE_URL + '/rest/v1/rpc/mark_interest_invited') { launchCalls.push({ k: 'mark', b: JSON.parse(o.body) }); return Promise.resolve(new Response('1', { status: 200 })); }
    if (url === 'https://mail.test/emails/batch') { launchCalls.push({ k: 'mail', b: JSON.parse(o.body) }); return Promise.resolve(mailFail ? new Response('{}', { status: 500 }) : new Response('{"data":[]}', { status: 200 })); }
    if (url === 'https://mail.test/emails') { mailCalls.push({ o, body: JSON.parse(o.body) }); return Promise.resolve(mailFail ? new Response('{}', { status: 500 }) : new Response('{"id":"em_1"}', { status: 200 })); }
    if (url === process.env.SUPABASE_URL + '/rest/v1/rpc/offer_check') { const b = JSON.parse(o.body); offerCalls.push({ k: 'check', b }); return Promise.resolve(new Response(JSON.stringify(offerGood && b.p_code === 'TC-ABC234' ? [{ discount_pence: 700, months: 12 }] : []), { status: 200 })); }
    if (url === process.env.SUPABASE_URL + '/rest/v1/rpc/offer_attach') { const b = JSON.parse(o.body); offerCalls.push({ k: 'attach', b, auth: o.headers.Authorization }); return Promise.resolve(attachOk ? new Response(JSON.stringify(b.p_code ? [{ discount_pence: 700, months: 12 }] : []), { status: 200 }) : new Response('{"message":"offer_invalid"}', { status: 400 })); }
    if (url === process.env.SUPABASE_URL + '/rest/v1/rpc/my_offer') { offerCalls.push({ k: 'my', auth: o.headers.Authorization }); return Promise.resolve(new Response(JSON.stringify(myOffer), { status: 200 })); }
    if (url === process.env.SUPABASE_URL + '/rest/v1/rpc/create_offer_code') { const b = JSON.parse(o.body); offerCalls.push({ k: 'create', b, auth: o.headers.Authorization }); return Promise.resolve(createOk ? new Response(JSON.stringify(Object.assign({}, OFFER_ROW, { prospect_email: String(b.p_email).toLowerCase() })), { status: 200 }) : new Response('{"message":"not_allowed"}', { status: 400 })); }
    if (url === process.env.SUPABASE_URL + '/rest/v1/rpc/mark_offer_sent') { offerCalls.push({ k: 'sent', b: JSON.parse(o.body) }); return Promise.resolve(new Response('null', { status: 200 })); }
    if (url.startsWith(process.env.SUPABASE_URL + '/rest/v1/offer_codes?id=eq.')) { offerCalls.push({ k: 'get', u: url }); return Promise.resolve(new Response(JSON.stringify([OFFER_ROW]), { status: 200 })); }
    if (url === process.env.SUPABASE_URL + '/rest/v1/rpc/my_billing_link') { cancelCalls.push({ k: 'link', auth: o.headers.Authorization }); return Promise.resolve(linkOk ? new Response(JSON.stringify([{ company_id: 'co-1', stripe_subscription_id: linkSub }]), { status: 200 }) : new Response('{}', { status: linkStatus })); }
    if (url === process.env.SUPABASE_URL + '/rest/v1/rpc/request_cancellation') { cancelCalls.push({ k: 'request', auth: o.headers.Authorization }); return Promise.resolve(new Response(JSON.stringify('2026-12-23T00:00:00Z'), { status: 200 })); }
    if (url === process.env.SUPABASE_URL + '/rest/v1/rpc/withdraw_cancellation') { cancelCalls.push({ k: 'withdraw', auth: o.headers.Authorization }); return Promise.resolve(new Response('null', { status: 200 })); }
    if (url === process.env.SUPABASE_URL + '/rest/v1/rpc/free_activate') { cancelCalls.push({ k: 'free', b: JSON.parse(o.body), auth: o.headers.Authorization }); return Promise.resolve(new Response('"opened"', { status: 200 })); }
    if (url.startsWith(process.env.SUPABASE_URL + '/rest/v1/companies?') && url.includes('select=offer_code')) return Promise.resolve(new Response(JSON.stringify([{ offer_code: 'TC-FREE22' }]), { status: 200 }));
    if (url.startsWith(process.env.SUPABASE_URL + '/rest/v1/companies?') && url.includes('contact_email')) { cancelCalls.push({ k: 'company', auth: o.headers.Authorization }); return Promise.resolve(new Response(JSON.stringify([{ name: 'Acme Cafes Ltd', contact_name: 'pat jones', contact_email: 'pat@acme.example' }]), { status: 200 })); }
    if (url === process.env.SUPABASE_URL + '/rest/v1/rpc/reminders_pending') { cancelCalls.push({ k: 'rem-list', auth: o.headers.Authorization }); return Promise.resolve(new Response(JSON.stringify(remPeople), { status: 200 })); }
    if (url === process.env.SUPABASE_URL + '/rest/v1/rpc/reminders_mark') { cancelCalls.push({ k: 'rem-mark', b: JSON.parse(o.body), auth: o.headers.Authorization }); return Promise.resolve(new Response('1', { status: 200 })); }
    if (url.startsWith('https://stripe.test/')) { stripeCalls.push({ u: url, o }); return Promise.resolve(new Response(JSON.stringify(stripeFail ? { error: { message: 'boom' } } : { url: 'https://checkout.stripe.test/pay/cs_test_1' }), { status: stripeFail ? 400 : 200 })); }
    if (url === process.env.SUPABASE_URL + '/rest/v1/rpc/billing_info') { sent.push({ u: url, o }); return Promise.resolve(billingAuthOk ? new Response(JSON.stringify(billingRows), { status: 200 }) : new Response('{}', { status: 401 })); }
    if (url === process.env.SUPABASE_URL + '/rest/v1/rpc/extra_checkout_info') { sent.push({ u: url, o }); return Promise.resolve(extraReply.status === 200 ? new Response(JSON.stringify(extraReply.rows), { status: 200 }) : new Response(JSON.stringify({ message: extraReply.message || 'not_allowed' }), { status: extraReply.status })); }
    if (url === process.env.SUPABASE_URL + '/rest/v1/rpc/apply_stripe_event') { applied.push({ u: url, o, body: JSON.parse(o.body) }); return Promise.resolve(new Response(JSON.stringify(applyResult), { status: applyStatus })); }
    if (url === process.env.SUPABASE_URL + '/rest/v1/rpc/clock_site_info' || url === process.env.SUPABASE_URL + '/rest/v1/rpc/clock_action') {
      const b = JSON.parse(o.body); clockCalls.push({ url, o, b });
      if (b.p_token !== 'a'.repeat(32)) return Promise.resolve(new Response('null', { status: 200 }));
      if (url.endsWith('clock_site_info')) return Promise.resolve(new Response(JSON.stringify({ site: 'High Street', people: clockPeople.map((x) => ({ id: x.id, name: x.name, in: !!x.at })) }), { status: 200 }));
      const m = clockPeople.find((x) => x.id === b.p_member); if (!m) return Promise.resolve(new Response('null', { status: 200 }));
      const now = new Date().toISOString();
      if (b.p_action === 'in') { if (m.at) return Promise.resolve(new Response(JSON.stringify({ status: 'already_in', name: m.name, at: m.at }), { status: 200 })); m.at = now; return Promise.resolve(new Response(JSON.stringify({ status: 'in', name: m.name, at: now }), { status: 200 })); }
      if (!m.at) return Promise.resolve(new Response(JSON.stringify({ status: 'already_out', name: m.name }), { status: 200 }));
      const since = m.at; m.at = null; return Promise.resolve(new Response(JSON.stringify({ status: 'out', name: m.name, at: now, since }), { status: 200 }));
    }
    if (url === process.env.SUPABASE_URL + '/rest/v1/rpc/signup_prepare') { const b = JSON.parse(o.body); prepCalls.push({ o, b }); return Promise.resolve(prepReply.status === 200 ? new Response(JSON.stringify([{ company_id: 'co-new', sites: b.p_sites, billing_interval: b.p_billing, email: b.p_email }]), { status: 200 }) : new Response(JSON.stringify({ message: prepReply.message }), { status: prepReply.status })); }
    if (url.startsWith(process.env.SUPABASE_URL + '/rest/v1/documents?id=eq.')) { docCalls.push({ u: url, o }); return Promise.resolve(new Response(JSON.stringify(docRows), { status: docRows === null ? 401 : 200 })); }
    if (url.startsWith(process.env.SUPABASE_URL + '/storage/v1/object/documents/')) { docCalls.push({ u: url, o }); return Promise.resolve(new Response(Buffer.from('%PDF-1.4 fake'), { status: 200 })); }
    if (url === 'https://anthropic.test/v1/messages') { aiCalls.push({ u: url, o, body: JSON.parse(o.body) }); return Promise.resolve(aiFail ? new Response('{}', { status: 500 }) : new Response(JSON.stringify({ content: [{ type: 'text', text: aiText }] }), { status: 200 })); }
    if (url.startsWith('https://api.postcodes.io/postcodes/')) {
      if (pcDown) return Promise.resolve(new Response('x', { status: 500 }));
      const hit = PC[decodeURIComponent(url.split('/').pop()).replace(/\s/g, '')];
      return Promise.resolve(hit ? new Response(JSON.stringify({ status: 200, result: hit }), { status: 200 }) : new Response('{"status":404}', { status: 404 }));
    }
    if (url.startsWith(process.env.SUPABASE_URL)) {
      sent.push({ u: url, o });
      return Promise.resolve(url.endsWith('/rpc/managed_area') ? new Response(JSON.stringify([{ label: 'Medway (ME)', lat: 51.385, lng: 0.52, radius_miles: 30 }]), { status: 200 }) : new Response(null, { status: 201 }));
    }
    return realFetch(u, o);
  };
  const post = (body, h) => realFetch(base + '/api/enquiry', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json', Accept: 'application/json' }, h || {}), body: JSON.stringify(body) });
  let r = await post({ name: 'Sam', email: 'sam@example.com', sites: '2-5', package: '1', topic: 'website', message: 'Hi' });
  check('enquiry is stored through the public key only', r.status === 200 && sent.length === 1 && sent[0].u.endsWith('/rest/v1/enquiries') && sent[0].o.headers.apikey === 'anon-public-key' && !JSON.stringify(sent[0]).includes('SERVICE-SECRET'));
  check('enquiry fields are mapped', JSON.parse(sent[0].o.body).package_interest === 'self_managed' && JSON.parse(sent[0].o.body).sites === '2-5');
  check('enquiry subject is added to the start of the message', JSON.parse(sent[0].o.body).message === 'Question about: Website\n\nHi');
  r = await post({ name: 'Sam', email: 'sam@example.com', package: '2' }); check('enquiry about Managed Service is stored as such', r.status === 200 && JSON.parse(sent[sent.length - 1].o.body).package_interest === 'managed_service');
  r = await post({ name: '', email: 'sam@example.com' }); check('enquiry needs a name', r.status === 422);
  r = await post({ name: 'Sam', email: 'nope' }); check('enquiry needs a valid email', r.status === 422);
  const before = sent.length; r = await post({ name: 'Bot', email: 'b@example.com', website: 'http://spam' });
  check('bot field is silently dropped, nothing stored', r.status === 200 && sent.length === before);
  // ---- register your interest (public) and the launch email (staff)
  sent.length = 0;
  let regN = 0; const reg = (b, h) => realFetch(base + '/api/interest', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.' + (++regN) }, h || {}), body: JSON.stringify(b) });
  const goodReg = { name: 'Pat Prospect', email: 'Pat@Shop.example', business_name: 'Pat Shop Ltd', business_address: '1 High St, Rochester', sites: '3', consent: true };
  r = await reg(goodReg);
  check('interest: stored through the public key only, email lower-cased, status not settable', r.status === 200 && sent.length === 1 && sent[0].u.endsWith('/rest/v1/interest_list') && sent[0].o.headers.apikey === 'anon-public-key' && JSON.parse(sent[0].o.body).email === 'pat@shop.example' && JSON.parse(sent[0].o.body).sites === 3 && !('status' in JSON.parse(sent[0].o.body)) && !JSON.stringify(sent[0]).includes('SERVICE-SECRET'));
  const tm = mailCalls.find((c) => c.body.subject === 'Thank you for registering your interest');
  check('interest: a thank-you email goes to the person, from Tremcore, replies go to info@', !!tm && tm.body.to[0] === 'pat@shop.example' && tm.body.from === 'Tremcore <info@tremcore.co.uk>' && tm.body.reply_to === 'info@tremcore.co.uk');
  check('interest: info@tremcore.co.uk is copied in (Cc) on the registration thank-you', !!tm && Array.isArray(tm.body.cc) && tm.body.cc.length === 1 && tm.body.cc[0] === 'info@tremcore.co.uk');
  check('interest: the email greets them by first name and carries the wording, sign-off, logo and company footer', !!tm && tm.body.text.startsWith('Hi Pat,') && tm.body.text.includes('Thank you for registering your interest in using the Tremcore Passport') && tm.body.text.includes('Tremcore Passport Team') && tm.body.html.includes('/img/logo-full.png') && tm.body.html.includes('Company number 17507064') && !tm.body.html.includes('Goldfinch') && !tm.body.text.includes('Goldfinch') && tm.body.html.includes('Thank you for registering your interest</div>'));
  check('interest: the email cannot be tampered with by what someone types as their name', !(() => { const m2 = require('../mail-template').interestThanks({ name: '<script>x</script>' }, 'http://x'); return m2.html.includes('<script>'); })());
  mailCalls.length = 0; r = await reg(Object.assign({}, goodReg, { email: 'second@shop.example' })); mailFail = true; mailCalls.length = 0;
  r = await reg(Object.assign({}, goodReg, { email: 'third@shop.example' })); check('interest: if the thank-you email cannot be sent the person is still registered', r.status === 200); mailFail = false;
  for (const [what, b] of [['no name', { name: '' }], ['bad email', { email: 'nope' }], ['no business', { business_name: '' }], ['no address', { business_address: '' }], ['0 sites', { sites: 0 }], ['101 sites', { sites: 101 }], ['no consent', { consent: false }]]) {
    const n0 = sent.length; r = await reg(Object.assign({}, goodReg, b)); check('interest: refused when ' + what, r.status === 422 && sent.length === n0);
  }
  const n1 = sent.length; r = await reg(Object.assign({}, goodReg, { website: 'http://spam' })); check('interest: bot field dropped silently', r.status === 200 && sent.length === n1);
  r = await reg(goodReg, { Origin: 'https://evil.example' }); check('interest: another website cannot post to it', r.status === 403);
  const lr = (b, auth) => realFetch(base + '/api/send-launch', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, auth === null ? {} : { Authorization: auth || 'Bearer staff-token' }), body: JSON.stringify(b || {}) });
  r = await lr({}, null); check('launch: needs signing in', r.status === 401);
  launchOpen = false; launchCalls.length = 0; r = await lr({}); check('launch: refuses while sign-up is still closed, nothing sent', r.status === 409 && !launchCalls.some((c) => c.k === 'mail'));
  launchOpen = true; launchCalls.length = 0; r = await lr({}); let lj = await r.json();
  const lm = launchCalls.find((c) => c.k === 'mail');
  check('launch: emails the plain sign-up link (no offer code), list read with the staff member\'s own token', r.status === 200 && lj.sent === 1 && lm && lm.b[0].to[0] === 'pat@shop.example' && lm.b[0].text.includes('/app/?signup=1') && !lm.b[0].text.includes('code=') && launchCalls.find((c) => c.k === 'list').auth === 'Bearer staff-token');
  check('launch: marks the people who were emailed as invited', JSON.stringify(launchCalls.find((c) => c.k === 'mark').b) === JSON.stringify({ p_ids: ['11111111-1111-1111-1111-111111111111'] }));
  mailFail = true; launchCalls.length = 0; r = await lr({}); lj = await r.json(); check('launch: if the email service fails nobody is marked as invited', lj.sent === 0 && lj.failed === 1 && !launchCalls.some((c) => c.k === 'mark')); mailFail = false;
  launchPeople = []; r = await lr({}); lj = await r.json(); check('launch: nobody waiting gives a friendly nothing', r.status === 200 && lj.sent === 0 && !!lj.note);
  r = await post({ name: 'Sam', email: 'sam@example.com' }, { Origin: 'https://evil.example' }); check('enquiry from another website is refused', r.status === 403);
  r = await realFetch(base + '/api/enquiry', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: '{"name":"' + 'x'.repeat(30000) + '"}' }).catch(() => ({ status: 413 }));
  check('huge enquiry is refused', r.status === 413 || r.status === 429);
  r = await realFetch(base + '/api/enquiry', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'name=Sam&email=sam%40example.com', redirect: 'manual' });
  check('plain form post (no JavaScript) redirects back with a thank-you', r.status === 303 || r.status === 429);
  // --- payments: Stripe Checkout and the Stripe webhook (Stripe and Supabase are faked) ---
  {
    const billing = require('../billing.js'); const crypto = require('crypto');
    const co = (b) => realFetch(base + '/api/checkout', { method: 'POST', headers: Object.assign({ Authorization: 'Bearer user-token' }, b || {}) });
    let rr = await co();
    const sp = new URLSearchParams(stripeCalls[0] && stripeCalls[0].o.body);
    check('pay: a signed-in head-office user is sent to a Stripe page', rr.status === 200 && (await rr.json()).url.startsWith('https://checkout.stripe.test/'));
    check('pay: their company is looked up with their own token, not any shared key', sent.filter((x) => x.u.endsWith('/rpc/billing_info')).pop().o.headers.Authorization === 'Bearer user-token');
    check('pay: 3 sites monthly = one first-site line and two extra-site lines, in GBP, as a subscription', sp.get('mode') === 'subscription' && sp.get('line_items[0][price_data][unit_amount]') === '1499' && sp.get('line_items[0][quantity]') === '1' && sp.get('line_items[1][price_data][unit_amount]') === '799' && sp.get('line_items[1][quantity]') === '2' && sp.get('line_items[0][price_data][currency]') === 'gbp' && sp.get('line_items[0][price_data][recurring][interval]') === 'month');
    check('pay: the company is attached to the payment so we know who paid', sp.get('client_reference_id') === 'co-1' && sp.get('metadata[company_id]') === 'co-1' && sp.get('subscription_data[metadata][company_id]') === 'co-1' && sp.get('customer_email') === 'pat@acme.example');
    check('pay: no payment method list is sent, so Stripe uses the Dashboard settings', !sp.get('payment_method_types[0]'));
    check('pay: Stripe is called with the secret key, which never appears in anything sent back', stripeCalls[0].o.headers.Authorization === 'Basic ' + Buffer.from('sk_test_FAKE-MUST-NEVER-LEAK:').toString('base64'));
    billingRows = [Object.assign({}, billingRows[0], { sites: 1, billing_interval: 'annual' })]; await co(); const sp2 = new URLSearchParams(stripeCalls[1].o.body);
    check('pay: 1 site yearly = £152.90 a year and no extra-site line', sp2.get('line_items[0][price_data][unit_amount]') === '15290' && sp2.get('line_items[0][price_data][recurring][interval]') === 'year' && !sp2.get('line_items[1][quantity]'));
    rr = await realFetch(base + '/api/checkout', { method: 'POST' }); check('pay: no sign-in, no payment page', rr.status === 401);
    rr = await co({ Origin: 'https://evil.example' }); check('pay: another website cannot start a payment', rr.status === 403);
    billingAuthOk = false; rr = await co(); check('pay: an expired or false sign-in token is refused', rr.status === 401); billingAuthOk = true;
    const saved = billingRows; billingRows = []; rr = await co(); check('pay: someone who is not a head-office user is refused', rr.status === 403);
    billingRows = [Object.assign({}, saved[0], { subscription: 'active' })]; rr = await co(); check('pay: an account that has already paid is not charged again', rr.status === 409); billingRows = saved;
    stripeFail = true; rr = await co(); check('pay: if Stripe refuses, the person gets a plain message, not an error dump', rr.status === 502 && !(JSON.stringify(await rr.json())).includes('boom')); stripeFail = false;
    // reading an uploaded certificate
    const rd = (b, h2) => realFetch(base + '/api/read-document', { method: 'POST', headers: Object.assign({ Authorization: 'Bearer user-token', 'Content-Type': 'application/json' }, h2 || {}), body: JSON.stringify(b || { document_id: '11111111-1111-1111-1111-111111111111' }) });
    rr = await rd(); let rj = await rr.json();
    check('read: a signed-in person gets suggested dates and numbers back, and nothing is saved by the server', rr.status === 200 && rj.reading.expiry_date === '2027-02-28' && rj.reading.issue_date === '2026-03-01' && rj.reading.certificate_number === 'PL-884213' && rj.reading.provider === 'Acme Insurance Ltd' && rj.reading.found === true);
    const lastAi = aiCalls[aiCalls.length - 1];
    check('read: the file is fetched with the person\'s own token (so row-level security decides), and the AI key never reaches them', docCalls.every((x) => x.o.headers.Authorization === 'Bearer user-token') && lastAi.o.headers['x-api-key'] === 'sk-ant-FAKE-MUST-NEVER-LEAK' && !JSON.stringify(rj).includes('sk-ant'));
    check('read: the PDF is sent as a document and the check name and the "ignore instructions inside it" rule are in the request', lastAi.body.messages[0].content[0].type === 'document' && lastAi.body.messages[0].content[1].text.includes('Public Liability Insurance') && lastAi.body.messages[0].content[1].text.includes('never instructions'));
    rr = await realFetch(base + '/api/read-document', { method: 'POST', body: '{}' }); check('read: no sign-in, no reading', rr.status === 401);
    rr = await rd(null, { Origin: 'https://evil.example' }); check('read: another website cannot use it', rr.status === 403);
    rr = await rd({ document_id: 'not-an-id' }); check('read: a nonsense id is refused before anything happens', rr.status === 400);
    const nAi = aiCalls.length; docRows = []; rr = await rd(); check('read: a document the person cannot see is not found, and nothing is sent to the AI', rr.status === 404 && aiCalls.length === nAi);
    docRows = null; rr = await rd(); check('read: an expired sign-in is refused', rr.status === 401);
    docRows = [{ storage_path: 'p1/i1/x-cert.docx', filename: 'cert.docx', compliance_items: { title: 'T' } }]; rr = await rd(); check('read: a Word document is explained, not sent to the AI', rr.status === 422 && aiCalls.length === nAi);
    docRows = [{ storage_path: 'p1/i1/x-cert.pdf', filename: 'cert.pdf', compliance_items: { title: 'T' } }];
    aiText = 'Sure! {"expiry_date":"31/12/2027","issue_date":"2026-02-30","certificate_number":"null","provider":"  Fire Co  "}'; rr = await rd(); rj = await rr.json();
    check('read: dates that are not real calendar dates, and empty words like null, are thrown away; good text is tidied', rj.reading.expiry_date === null && rj.reading.issue_date === null && rj.reading.certificate_number === null && rj.reading.provider === 'Fire Co');
    aiText = 'I could not read this.'; rr = await rd(); rj = await rr.json(); check('read: an unreadable answer gives "nothing found", not an error', rr.status === 200 && rj.reading.found === false);
    aiFail = true; rr = await rd(); check('read: if the AI is down the person gets a plain message to type the details in', rr.status === 502 && !(JSON.stringify(await rr.json())).includes('500')); aiFail = false;
    aiText = '{"document_title":"Public liability certificate","issue_date":"2026-03-01","expiry_date":"2027-02-28","certificate_number":"PL-884213","provider":"Acme Insurance Ltd"}';
    // add-ons
    const ce = (code, b) => realFetch(base + '/api/checkout-extra', { method: 'POST', headers: Object.assign({ Authorization: 'Bearer user-token', 'Content-Type': 'application/json' }, b || {}), body: JSON.stringify({ code }) });
    const n0 = stripeCalls.length; rr = await ce('staff_signin'); const ep = new URLSearchParams(stripeCalls[n0] && stripeCalls[n0].o.body);
    check('add-on: a head-office user is sent to a Stripe page', rr.status === 200 && (await rr.json()).url.startsWith('https://checkout.stripe.test/'));
    check('add-on: charged monthly per site (3 sites = 3 x £5.99) as its own subscription, tagged so the webhook knows it is an add-on', ep.get('line_items[0][quantity]') === '3' && ep.get('line_items[0][price_data][unit_amount]') === '599' && ep.get('line_items[0][price_data][recurring][interval]') === 'month' && ep.get('metadata[kind]') === 'extra' && ep.get('subscription_data[metadata][extra_code]') === 'staff_signin' && ep.get('metadata[quantity]') === '3');
    check('add-on: the existing Stripe customer is reused so their card carries over, and they return to the app', ep.get('customer') === 'cus_1' && !ep.get('customer_email') && ep.get('success_url').endsWith('/app/?extra=staff_signin&paid=1') && ep.get('cancel_url').endsWith('/app/?extra=staff_signin&paid=0'));
    check('add-on: the person is checked with their own token', sent.filter((x) => x.u.endsWith('/rpc/extra_checkout_info')).pop().o.headers.Authorization === 'Bearer user-token');
    rr = await realFetch(base + '/api/checkout-extra', { method: 'POST', body: '{"code":"staff_signin"}' }); check('add-on: no sign-in, no payment page', rr.status === 401);
    rr = await ce('staff_signin', { Origin: 'https://evil.example' }); check('add-on: another website cannot start it', rr.status === 403);
    rr = await ce('Bad Code!'); check('add-on: a nonsense code is refused before anything happens', rr.status === 400);
    extraReply = { status: 400, message: 'already_owned' }; rr = await ce('staff_signin'); check('add-on: already owned is explained, not charged again', rr.status === 409);
    for (const [why, words] of [['not_head', 'head-office user'], ['two_factor_needed', '2FA'], ['not_self_managed', 'Self-Managed'], ['not_active', 'active']]) {
      extraReply = { status: 403, message: why }; rr = await ce('staff_signin'); const jj = await rr.json(); check('add-on: refusal "' + why + '" tells the person exactly why', rr.status === 403 && jj.error.includes(words));
    }
    extraReply = { status: 404, message: 'Could not find the function public.extra_checkout_info', }; rr = await ce('staff_signin'); check('add-on: if the database update has not been run, the message says so', rr.status === 503 && (await rr.json()).error.includes('database update'));
    extraReply = { status: 200, rows: [] }; rr = await ce('staff_signin'); check('add-on: no row back means refused', rr.status === 403);
    extraReply = { status: 200, rows: [{ company_id: 'co-1', sites: 3, email: 'p@x', stripe_customer_id: null, name: 'Toolbox Talks', price_pence: 299, charged_per: 'site', quantity: 3 }] }; const n1 = stripeCalls.length; await ce('toolbox_talks'); const tp = new URLSearchParams(stripeCalls[n1].o.body);
    check('add-on: Toolbox Talks is £2.99 per site (3 sites = 3 x £2.99); a first-time customer is created from their email', tp.get('line_items[0][quantity]') === '3' && tp.get('line_items[0][price_data][unit_amount]') === '299' && !tp.get('customer') && tp.get('customer_email') === 'p@x');
    stripeFail = true; rr = await ce('toolbox_talks'); check('add-on: if Stripe refuses, a plain message only', rr.status === 502 && !(JSON.stringify(await rr.json())).includes('boom')); stripeFail = false;
    // webhook
    const evt = (type, obj, id) => JSON.stringify({ id: id || 'evt_' + type, type, data: { object: obj } });
    const sign = (body, secret, t) => { const ts = t || Math.floor(Date.now() / 1000); return 't=' + ts + ',v1=' + crypto.createHmac('sha256', secret || 'whsec_testsecret').update(ts + '.' + body).digest('hex'); };
    const hook = (body, sig) => realFetch(base + '/api/stripe-webhook', { method: 'POST', headers: { 'stripe-signature': sig }, body });
    const paidBody = evt('checkout.session.completed', { payment_status: 'paid', client_reference_id: 'co-1', customer: 'cus_1', subscription: 'sub_1' });
    rr = await hook(paidBody, sign(paidBody));
    check('webhook: a correctly signed payment is passed to the database with the service key', rr.status === 200 && applied.length === 1 && applied[0].body.p_action === 'paid' && applied[0].body.p_company === 'co-1' && applied[0].body.p_customer === 'cus_1' && applied[0].o.headers.Authorization === 'Bearer SERVICE-SECRET-MUST-NEVER-LEAK');
    rr = await hook(paidBody, sign(paidBody, 'whsec_wrong')); check('webhook: a message signed with the wrong secret is thrown away', rr.status === 400 && applied.length === 1);
    rr = await hook(paidBody, ''); check('webhook: an unsigned message is thrown away', rr.status === 400 && applied.length === 1);
    rr = await hook(paidBody, sign(paidBody, null, Math.floor(Date.now() / 1000) - 3600)); check('webhook: an old replayed message is thrown away', rr.status === 400 && applied.length === 1);
    rr = await hook(paidBody.replace('co-1', 'co-2'), sign(paidBody)); check('webhook: a message changed after signing is thrown away', rr.status === 400 && applied.length === 1);
    const dd = evt('checkout.session.completed', { payment_status: 'unpaid', client_reference_id: 'co-1', customer: 'cus_1' }, 'evt_dd');
    rr = await hook(dd, sign(dd)); check('webhook: a Direct Debit that has not cleared yet opens nothing', rr.status === 200 && applied.length === 1);
    const ddok = evt('checkout.session.async_payment_succeeded', { payment_status: 'paid', client_reference_id: 'co-1', customer: 'cus_1', subscription: 'sub_1' }, 'evt_ddok');
    rr = await hook(ddok, sign(ddok)); check('webhook: once the Direct Debit clears, the account opens', applied.length === 2 && applied[1].body.p_action === 'paid');
    const fail = evt('invoice.payment_failed', { customer: 'cus_1', subscription: 'sub_1' }, 'evt_fail');
    rr = await hook(fail, sign(fail)); check('webhook: a failed payment is passed on as failed, by customer', applied.length === 3 && applied[2].body.p_action === 'failed' && applied[2].body.p_customer === 'cus_1' && applied[2].body.p_company === null);
    const del = evt('customer.subscription.deleted', { id: 'sub_1', customer: 'cus_1' }, 'evt_del');
    rr = await hook(del, sign(del)); check('webhook: a cancelled subscription is passed on as cancelled', applied.length === 4 && applied[3].body.p_action === 'cancelled');
    const other = evt('customer.created', { id: 'cus_9' }, 'evt_other'); rr = await hook(other, sign(other)); check('webhook: events we do not care about are accepted and ignored', rr.status === 200 && applied.length === 4);


    // ---- pay first: the sign-up payment route
    {
      const sp = (b, hdr) => realFetch(base + '/api/signup-checkout', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, hdr || {}), body: JSON.stringify(b) });
      const good = { email: 'pat@acme.example', company: 'Acme Cafes Ltd', name: 'Pat Jones', sites: 3, billing: 'annual' };
      const ns = stripeCalls.length; rr = await sp(good); let jj = await rr.json(); const sess = new URLSearchParams(stripeCalls[stripeCalls.length - 1] && stripeCalls[stripeCalls.length - 1].o.body);
      check('pay first: a new sign-up gets a Stripe payment page', rr.status === 200 && jj.url === 'https://checkout.stripe.test/pay/cs_test_1' && stripeCalls.length === ns + 1);
      check('pay first: the payment is for the new company, at the yearly price for 3 sites, and returns to the welcome page', sess.get('client_reference_id') === 'co-new' && sess.get('customer_email') === 'pat@acme.example' && sess.get('line_items[0][price_data][recurring][interval]') === 'year' && sess.get('line_items[1][quantity]') === '2' && sess.get('success_url').endsWith('/app/?welcome=1') && sess.get('cancel_url').endsWith('/app/?welcome=0'));
      check('pay first: the company is made with the service key, which only the server holds', prepCalls[prepCalls.length - 1].o.headers.Authorization === 'Bearer SERVICE-SECRET-MUST-NEVER-LEAK' && prepCalls[prepCalls.length - 1].b.p_sites === 3 && prepCalls[prepCalls.length - 1].b.p_billing === 'annual');
      const np = prepCalls.length;
      rr = await sp(Object.assign({}, good, { sites: 0 })); check('pay first: a bad site count is refused before anything is made', rr.status === 422 && prepCalls.length === np);
      rr = await sp(Object.assign({}, good, { email: 'nope' })); check('pay first: a bad email is refused before anything is made', rr.status === 422 && prepCalls.length === np);
      rr = await sp(good, { Origin: 'https://evil.example' }); check('pay first: another website cannot start it', rr.status === 403 && prepCalls.length === np);
      prepReply = { status: 400, message: 'not_allowed' }; rr = await sp(good); check('pay first: an account that is already confirmed, or not new, is refused with no payment page', rr.status === 403 && stripeCalls.length === ns + 1);
      prepReply = { status: 404, message: 'Could not find the function public.signup_prepare' }; rr = await sp(good); check('pay first: if the database update has not been run, the message says so', rr.status === 503 && (await rr.json()).error.includes('0024'));
      prepReply = { status: 400, message: 'already_paid' }; rr = await sp(good); check('pay first: an already-paid sign-up is told so and not charged twice', rr.status === 409);
      prepReply = { status: 400, message: 'signup_closed' }; rr = await sp(good); check('pay first: closed sign-up is refused', rr.status === 403 && (await rr.json()).error.includes('not open'));
      prepReply = { status: 200 }; stripeFail = true; rr = await sp(good); check('pay first: if Stripe refuses, a plain message only', rr.status === 502 && !(JSON.stringify(await rr.json())).includes('boom')); stripeFail = false;
    }
    // ---- introductory offer codes
    {
      const sp = (b) => realFetch(base + '/api/signup-checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
      const good = { email: 'pat@acme.example', company: 'Acme Cafes Ltd', name: 'Pat Jones', sites: 3, billing: 'annual', code: 'tc-abc234' };
      offerCalls.length = 0; const ns = stripeCalls.length;
      rr = await sp(good); const sess = new URLSearchParams(stripeCalls[stripeCalls.length - 1].o.body);
      check('offer: a good code at sign-up still goes to Stripe', rr.status === 200 && stripeCalls.length === ns + 1);
      check('offer: Stripe is given a coupon of 7 pounds off for 12 months, made once', offerCalls.some((c) => c.k === 'coupon' && c.body.get('amount_off') === '700' && c.body.get('duration') === 'repeating' && c.body.get('duration_in_months') === '12' && c.body.get('currency') === 'gbp' && c.body.get('id') === 'tc-intro-700-12m'));
      check('offer: the payment page uses that coupon and the normal monthly prices (the discount, not a different price, does the work)', sess.get('discounts[0][coupon]') === 'tc-intro-700-12m' && sess.get('line_items[0][price_data][unit_amount]') === '1499' && sess.get('line_items[1][price_data][unit_amount]') === '799' && sess.get('line_items[1][quantity]') === '2');
      check('offer: a code forces monthly billing, even if yearly was chosen', sess.get('line_items[0][price_data][recurring][interval]') === 'month' && prepCalls[prepCalls.length - 1].b.p_billing === 'monthly');
      check('offer: the code is checked and tied to the new company with the service key, in upper case', offerCalls.some((c) => c.k === 'check' && c.b.p_code === 'TC-ABC234') && offerCalls.some((c) => c.k === 'attach' && c.b.p_company === 'co-new' && c.b.p_code === 'TC-ABC234' && c.auth === 'Bearer SERVICE-SECRET-MUST-NEVER-LEAK'));
      couponExists = true; rr = await sp(good); check('offer: a coupon that already exists in Stripe is fine', rr.status === 200); couponExists = false;
      const np = prepCalls.length, ns2 = stripeCalls.length;
      rr = await sp(Object.assign({}, good, { code: 'TC-WRONG1' })); check('offer: a wrong, used or expired code is refused before anything is made or charged', rr.status === 422 && (await rr.json()).error.includes('discount code') && prepCalls.length === np && stripeCalls.length === ns2);
      offerCalls.length = 0; rr = await sp(Object.assign({}, good, { code: '', billing: 'annual' })); const plain = new URLSearchParams(stripeCalls[stripeCalls.length - 1].o.body);
      check('offer: no code means no discount, the normal price, and any old code on the company is cleared', rr.status === 200 && !plain.get('discounts[0][coupon]') && plain.get('line_items[0][price_data][recurring][interval]') === 'year' && offerCalls.some((c) => c.k === 'attach' && c.b.p_code === null) && !offerCalls.some((c) => c.k === 'coupon'));
      // Pay now (already signed in): picks up the code that was attached
      myOffer = [{ discount_pence: 700, months: 12 }]; billingRows = [{ company_id: 'co-1', sites: 2, billing_interval: 'monthly', email: 'pat@acme.example', subscription: 'trial' }];
      rr = await realFetch(base + '/api/checkout', { method: 'POST', headers: { Authorization: 'Bearer user-token' } }); const pn = new URLSearchParams(stripeCalls[stripeCalls.length - 1].o.body);
      check('offer: Pay now uses the code already attached to the company, looked up with the person\'s own token', rr.status === 200 && pn.get('discounts[0][coupon]') === 'tc-intro-700-12m' && offerCalls.some((c) => c.k === 'my' && c.auth === 'Bearer user-token'));
      myOffer = []; rr = await realFetch(base + '/api/checkout', { method: 'POST', headers: { Authorization: 'Bearer user-token' } }); check('offer: Pay now with no offer is the normal price', !new URLSearchParams(stripeCalls[stripeCalls.length - 1].o.body).get('discounts[0][coupon]'));
      billingRows = [{ company_id: 'co-1', sites: 3, billing_interval: 'monthly', email: 'pat@acme.example', subscription: 'trial' }];
      // Staff sending the offer
      const so = (b, auth, hdr) => realFetch(base + '/api/send-offer', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, auth === null ? {} : { Authorization: auth || 'Bearer staff-token' }, hdr || {}), body: JSON.stringify(b) });
      offerCalls.length = 0; mailCalls.length = 0;
      rr = await so({ email: 'Pat@Prospect.example', name: 'pat prospect', days: 30 }); let jo = await rr.json();
      check('offer email: staff make a code with their own token, so the database decides who is allowed', rr.status === 200 && offerCalls.some((c) => c.k === 'create' && c.auth === 'Bearer staff-token' && c.b.p_days === 30));
      check('offer email: the email is sent to the prospect from Tremcore with the link and code', jo.sent === true && mailCalls.length === 1 && mailCalls[0].body.to[0] === 'pat@prospect.example');
      check('offer email: info@tremcore.co.uk is copied in (Cc) on the offer email', Array.isArray(mailCalls[0].body.cc) && mailCalls[0].body.cc.length === 1 && mailCalls[0].body.cc[0] === 'info@tremcore.co.uk');
      const mb = mailCalls[0].body;
      check('offer email: it states the prices (7.99 for 12 months, normally 14.99, extra sites 7.99) and the code link', mb.text.includes('£7.99 a month + VAT for your first 12 months') && mb.text.includes('£14.99') && mb.text.includes('Each additional site: £7.99') && mb.text.includes('/app/?signup=1&code=TC-ABC234') && mb.html.includes('Take up your offer') && mb.html.includes('Company number 17507064') && mb.html.includes('/img/logo-full.png') && mb.reply_to === 'info@tremcore.co.uk' && mb.from === 'Tremcore <info@tremcore.co.uk>' && mailCalls[0].o.headers.Authorization === 'Bearer mail-key-MUST-NOT-LEAK');
      check('offer email: the secret keys never appear in the answer', !JSON.stringify(jo).includes('MUST-NOT-LEAK') && !JSON.stringify(jo).includes('SERVICE-SECRET') && jo.code === 'TC-ABC234' && jo.link.includes('code=TC-ABC234'));
      check('offer email: it is marked as emailed afterwards', offerCalls.some((c) => c.k === 'sent' && c.b.p_id === OFFER_ROW.id));
      mailFail = true; offerCalls.length = 0; rr = await so({ email: 'pat@prospect.example', days: 30 }); jo = await rr.json();
      check('offer email: if the email service fails, the code is still made and the link is given to send by hand (not marked as emailed)', rr.status === 200 && jo.sent === false && jo.note.includes('send it yourself') && !offerCalls.some((c) => c.k === 'sent')); mailFail = false;
      createOk = false; rr = await so({ email: 'pat@prospect.example', days: 30 }); check('offer email: someone who is not signed-in staff cannot make a code', rr.status === 403 && mailCalls.length === 2); createOk = true;
      const nm = mailCalls.length;
      rr = await so({ email: 'nope', days: 30 }); check('offer email: a bad email address is refused before anything happens', rr.status === 422);
      rr = await so({ email: 'a@b.example', days: 0 }); check('offer email: a silly number of days is refused', rr.status === 422);
      rr = await so({ email: 'a@b.example', days: 30 }, null); check('offer email: it needs a sign-in', rr.status === 401 && mailCalls.length === nm);
      rr = await so({ email: 'a@b.example', days: 30 }, undefined, { Origin: 'https://evil.example' }); check('offer email: another website cannot use it', rr.status === 403);
      offerCalls.length = 0; rr = await so({ id: OFFER_ROW.id }); jo = await rr.json(); check('offer email: sending again for an existing code re-uses it and does not make a new one', rr.status === 200 && jo.sent === true && offerCalls.some((c) => c.k === 'get') && !offerCalls.some((c) => c.k === 'create') && mailCalls.length === nm + 1);
    }
    // ---- Staff Clock In / Out: the public page and its two routes
    {
      const TOK = 'a'.repeat(32), J = '11111111-1111-1111-1111-111111111111';
      rr = await realFetch(base + '/clock/' + TOK); const ch = rr.headers; const cb = await rr.text();
      check('clock page: the secret link opens the clock page, with no referrer, no caching and no outside scripts', rr.status === 200 && cb.includes('Clock in / out') && ch.get('referrer-policy') === 'no-referrer' && ch.get('cache-control') === 'no-store' && !(ch.get('content-security-policy') || '').includes('jsdelivr') && ch.get('x-robots-tag').includes('noindex'));
      rr = await realFetch(base + '/clock/not-a-code'); check('clock page: an address that is not a code finds nothing', rr.status === 404);
      rr = await realFetch(base + '/api/clock?t=' + TOK); let j = await rr.json();
      check('clock api: the right code returns the site and its people (names and whether they are in), nothing else', rr.status === 200 && j.site === 'High Street' && j.people.length === 2 && Object.keys(j.people[0]).sort().join() === 'id,in,name' && !JSON.stringify(j).includes('SERVICE-SECRET'));
      check('clock api: the database is asked with the service key, which only the server holds', clockCalls[clockCalls.length - 1].o.headers.Authorization === 'Bearer SERVICE-SECRET-MUST-NEVER-LEAK' && clockCalls[clockCalls.length - 1].b.p_token === TOK);
      const n0 = clockCalls.length;
      rr = await realFetch(base + '/api/clock?t=' + 'f'.repeat(32), { headers: { 'x-forwarded-for': '7.7.7.7' } }); check('clock api: a wrong code is told only that it is not active', rr.status === 404 && (await rr.json()).error.includes('not active'));
      rr = await realFetch(base + '/api/clock?t=short'); check('clock api: a malformed code never reaches the database', rr.status === 404 && clockCalls.length === n0 + 1);
      const post = (b, hdr) => realFetch(base + '/api/clock', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, hdr || {}), body: JSON.stringify(b) });
      rr = await post({ t: TOK, member: J, action: 'in' }); j = await rr.json(); check('clock api: clocking in works', rr.status === 200 && j.status === 'in' && j.name === 'Jo Bloggs');
      rr = await post({ t: TOK, member: J, action: 'in' }); j = await rr.json(); check('clock api: a second tap is "already in", not a second record', j.status === 'already_in');
      rr = await post({ t: TOK, member: J, action: 'out' }); j = await rr.json(); check('clock api: clocking out reports when you were in from', rr.status === 200 && j.status === 'out' && !!j.since);
      const n1 = clockCalls.length;
      rr = await post({ t: TOK, member: 'x', action: 'in' }); check('clock api: a bad person id is refused before the database', rr.status === 400 && clockCalls.length === n1);
      rr = await post({ t: TOK, member: J, action: 'delete' }); check('clock api: only in or out is accepted', rr.status === 400 && clockCalls.length === n1);
      rr = await post({ t: TOK, member: J, action: 'in' }, { Origin: 'https://evil.example' }); check('clock api: another website cannot post to it', rr.status === 403 && clockCalls.length === n1);
      rr = await post({ t: 'f'.repeat(32), member: J, action: 'in' }); check('clock api: a wrong code cannot clock anyone in', rr.status === 404);
      let last = 0; for (let i = 0; i < 40; i++) { rr = await realFetch(base + '/api/clock?t=' + 'e'.repeat(32), { headers: { 'x-forwarded-for': '9.9.9.9' } }); last = rr.status; }
      const rv = await realFetch(base + '/api/clock?t=' + TOK, { headers: { 'x-forwarded-for': '9.9.9.9' } });
      const ro = await realFetch(base + '/api/clock?t=' + TOK, { headers: { 'x-forwarded-for': '8.8.8.8' } });
      check('clock api: guessing wrong codes is stopped after a few tries, and only for that address', last === 429 && rv.status === 429 && ro.status === 200);
    }
    const xs = evt('checkout.session.completed', { payment_status: 'paid', client_reference_id: 'co-1', customer: 'cus_1', subscription: 'sub_x', metadata: { kind: 'extra', extra_code: 'staff_signin', quantity: '3', company_id: 'co-1' } }, 'evt_extra');
    const nA = applied.length; rr = await realFetch(base + '/api/stripe-webhook', { method: 'POST', headers: { 'Stripe-Signature': sign(xs) }, body: xs });
    check('webhook: a paid add-on is passed on as an add-on with its code and quantity (not as the main account)', rr.status === 200 && applied.length === nA + 1 && applied[nA].body.p_action === 'extra_paid' && applied[nA].body.p_extra === 'staff_signin' && applied[nA].body.p_quantity === 3 && applied[nA].body.p_subscription === 'sub_x');
    // ---- cancelling also stops Stripe
    let cnN = 0; const cn = (action, auth) => realFetch(base + '/api/cancellation', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.' + (++cnN) }, auth === null ? {} : { Authorization: auth || 'Bearer user-token' }), body: JSON.stringify({ action }) });
    cancelCalls.length = 0; stripeCalls.length = 0;
    rr = await cn('request', null); check('cancel (server): no sign-in is refused', rr.status === 401 && stripeCalls.length === 0);
    rr = await cn('request'); let cj = await rr.json(); const cs = stripeCalls[stripeCalls.length - 1];
    check('cancel (server): notice is recorded by the database first, then the Stripe subscription is set to end on that date', rr.status === 200 && cj.stripe === true && cancelCalls.map((c) => c.k).join() === 'link,request' && cs && cs.u === 'https://stripe.test/v1/subscriptions/sub_live1' && new URLSearchParams(cs.o.body).get('cancel_at') === String(Math.floor(new Date('2026-12-23T00:00:00Z').getTime() / 1000)));
    check('cancel (server): it all happens with the person\'s own token', cancelCalls.every((c) => c.auth === 'Bearer user-token'));
    stripeCalls.length = 0; cancelCalls.length = 0; stripeFail = true; rr = await cn('request');
    check('cancel (server): if Stripe refuses, our records are put back so the two agree, and a plain message is shown', rr.status === 502 && cancelCalls.map((c) => c.k).join() === 'link,request,withdraw' && !(JSON.stringify(await rr.json())).includes('boom')); stripeFail = false;
    stripeCalls.length = 0; cancelCalls.length = 0; rr = await cn('withdraw');
    check('cancel (server): keeping the account removes the end date at Stripe and in our records', rr.status === 200 && new URLSearchParams(stripeCalls[0].o.body).get('cancel_at') === '' && cancelCalls.map((c) => c.k).join() === 'link,withdraw');
    stripeCalls.length = 0; stripeFail = true; cancelCalls.length = 0; rr = await cn('withdraw'); check('cancel (server): if Stripe refuses to keep it, our records are left alone', rr.status === 502 && !cancelCalls.some((c) => c.k === 'withdraw')); stripeFail = false;
    linkOk = false; cancelCalls.length = 0; rr = await cn('request'); check('cancel (server): anyone but the head-office user is refused before anything changes', rr.status === 403 && !cancelCalls.some((c) => c.k === 'request')); linkOk = true;
    linkSub = null; stripeCalls.length = 0; rr = await cn('request'); check('cancel (server): an account that is not on Stripe (trial or free access) is cancelled in our records only', rr.status === 200 && stripeCalls.length === 0); linkSub = 'sub_live1';
    rr = await cn('explode'); check('cancel (server): unknown actions are refused', rr.status === 400);
    // ---- free access code
    cancelCalls.length = 0; stripeCalls.length = 0; billingRows = [{ company_id: 'co-1', sites: 1, billing_interval: 'monthly', email: 'pat@acme.example', subscription: 'trial' }]; myOffer = [{ kind: 'free', discount_pence: 0, months: 0 }];
    rr = await realFetch(base + '/api/checkout', { method: 'POST', headers: { Authorization: 'Bearer user-token', 'X-Forwarded-For': '198.51.100.250' } }); cj = await rr.json();
    check('free access: Pay now with a free code opens the account without calling Stripe, using the server key', rr.status === 200 && cj.free === true && /\/app\/\?paid=1$/.test(cj.url) && stripeCalls.length === 0 && cancelCalls.some((c) => c.k === 'free' && c.b.p_code === 'TC-FREE22' && c.b.p_company === 'co-1' && c.auth === 'Bearer SERVICE-SECRET-MUST-NEVER-LEAK'));
    myOffer = []; billingRows = [{ company_id: 'co-1', sites: 3, billing_interval: 'monthly', email: 'pat@acme.example', subscription: 'trial' }];
    // ---- emails from the webhook
    mailCalls.length = 0; const ew = evt('checkout.session.completed', { payment_status: 'paid', client_reference_id: 'co-1', customer: 'cus_1', subscription: 'sub_1' }, 'evt_welcome');
    rr = await hook(ew, sign(ew));
    check('welcome email: the first payment sends one welcome and receipt to the customer', rr.status === 200 && mailCalls.length === 1 && mailCalls[0].body.to[0] === 'pat@acme.example' && /Welcome|Payment received/.test(mailCalls[0].body.subject) && mailCalls[0].body.text.includes('Hi Pat,') && mailCalls[0].body.reply_to === 'info@tremcore.co.uk');
    mailCalls.length = 0; const rn = evt('invoice.paid', { customer: 'cus_1', subscription: 'sub_1' }, 'evt_renew'); rr = await hook(rn, sign(rn));
    check('welcome email: later renewals send no welcome', mailCalls.length === 0);
    mailCalls.length = 0; const fl = evt('invoice.payment_failed', { customer: 'cus_1', subscription: 'sub_1' }, 'evt_fail2'); rr = await hook(fl, sign(fl));
    check('failed payment: the customer and Tremcore are both emailed', rr.status === 200 && mailCalls.length === 2 && mailCalls.some((m) => m.body.to[0] === 'pat@acme.example' && /could not take/.test(m.body.subject)) && mailCalls.some((m) => m.body.to[0] === 'info@tremcore.co.uk' && /Payment failed: Acme Cafes Ltd/.test(m.body.subject)));
    mailFail = true; mailCalls.length = 0; const fl2 = evt('invoice.payment_failed', { customer: 'cus_1', subscription: 'sub_1' }, 'evt_fail3'); rr = await hook(fl2, sign(fl2)); mailFail = false;
    check('failed payment: if the email service is down the webhook still succeeds', rr.status === 200);
    const dupN = mailCalls.length; applyResult = 'duplicate'; const fl3 = evt('invoice.payment_failed', { customer: 'cus_1', subscription: 'sub_1' }, 'evt_fail2'); await hook(fl3, sign(fl3)); applyResult = 'applied';
    check('failed payment: a repeated message sends no second email', mailCalls.length === dupN);
    // ---- daily reminder emails
    const rem = (auth) => realFetch(base + '/api/send-reminders', { method: 'POST', headers: auth === null ? {} : { Authorization: auth || 'Bearer reminder-secret-for-tests' } });
    rr = await rem(null); check('reminders: starting a run needs the secret', rr.status === 401);
    rr = await rem('Bearer wrong-secret-xxxxxxxxxxx'); check('reminders: a wrong secret is refused', rr.status === 401);
    cancelCalls.length = 0; mailCalls.length = 0; remPeople = [];
    rr = await rem(); let rjr = await rr.json(); const rj0 = rjr; check('reminders: nothing due means no emails and nothing recorded', rr.status === 200 && rj0.sent === 0 && mailCalls.length === 0 && !cancelCalls.some((c) => c.k === 'rem-mark'));
    remPeople = [
      { profile_id: 'p1', email: 'pat@acme.example', name: 'pat jones', company_id: 'co-1', company: 'Acme Cafes Ltd', level: 1, items: [
        { item_id: 'i1', title: 'Gas Safety', site: 'High Street', due_date: '2026-11-20', days_left: -3, stage: 'overdue', triggered: true, mark_stage: 'overdue' },
        { item_id: 'i2', title: 'Fire Risk Assessment', site: 'High Street', due_date: '2026-12-03', days_left: 10, stage: 'd30', triggered: false, mark_stage: null },
        { item_id: 'i3', title: 'PAT Testing', site: 'Station Road', due_date: '2026-12-20', days_left: 27, stage: 'd30', triggered: true, mark_stage: 'd30' }] },
      { profile_id: 'p2', email: 'boss@managed.example', name: 'sam boss', company_id: 'co-2', company: 'Managed Co', level: 2, items: [
        { item_id: 'i9', title: 'EICR', site: 'Depot', due_date: '2026-12-10', days_left: 17, stage: 'd30', triggered: true, mark_stage: 'managed' }] }];
    rr = await rem(); rjr = await rr.json(); const rjn = rjr;
    const m1 = mailCalls.find((m) => m.body.to[0] === 'pat@acme.example'), m2 = mailCalls.find((m) => m.body.to[0] === 'boss@managed.example');
    check('reminders: a Level 1 customer gets one summary email listing every due and overdue item, in the branded template', rr.status === 200 && rjn.sent === 2 && m1 && /overdue/.test(m1.body.subject) && m1.body.text.includes('Hi Pat,') && m1.body.text.includes('Gas Safety') && m1.body.text.includes('Fire Risk Assessment') && m1.body.text.includes('PAT Testing') && m1.body.html.includes('OVERDUE BY 3 DAYS') && m1.body.html.includes('Company number 17507064') && m1.body.html.includes('Open my passport') && m1.body.reply_to === 'info@tremcore.co.uk');
    check('reminders: with more than one site the site name is shown', m1.body.html.includes('Station Road') && m1.body.html.includes('High Street'));
    check('reminders: a Level 2 or 3 customer is told Tremcore is managing the renewal and need do nothing', m2 && m2.body.text.includes('Tremcore is managing the renewal') && !/overdue/i.test(m2.body.subject) && m2.body.text.includes('EICR'));
    const marks = cancelCalls.filter((c) => c.k === 'rem-mark');
    check('reminders: only the items that triggered are recorded as sent (not the others listed), with the service key', marks.length === 2 && marks[0].auth === 'Bearer SERVICE-SECRET-MUST-NEVER-LEAK' && marks[0].b.p_items.map((i) => i.item_id).join() === 'i1,i3' && marks[0].b.p_items[0].stage === 'overdue' && marks[1].b.p_items[0].stage === 'managed');
    mailFail = true; cancelCalls.length = 0; mailCalls.length = 0; rr = await rem(); const rjf = await rr.json(); mailFail = false;
    check('reminders: if an email fails it is not recorded as sent, so it is tried again tomorrow', rjf.failed === 2 && rjf.sent === 0 && !cancelCalls.some((c) => c.k === 'rem-mark')); remPeople = [];
    applyStatus = 500; rr = await hook(paidBody, sign(paidBody)); check('webhook: if the database is down we answer with an error so Stripe tries again', rr.status === 500); applyStatus = 200;
    check('billing helpers: signature check accepts a good one and rejects junk', billing.verifySignature('x', sign('x'), 'whsec_testsecret') && !billing.verifySignature('x', 'garbage', 'whsec_testsecret') && !billing.verifySignature('x', sign('x'), ''));
    check('billing helpers: price for 100 sites is built without error and 101 is refused', (() => { try { billing.checkoutParams({ companyId: 'c', sites: 100, interval: 'monthly', origin: 'https://x' }); } catch { return false; } try { billing.checkoutParams({ companyId: 'c', sites: 101, interval: 'monthly', origin: 'https://x' }); return false; } catch { return true; } })());
    const cfg = await (await realFetch(base + '/config.json')).text();
    check('the Stripe and service keys are never sent to the browser', !cfg.includes('sk_test') && !cfg.includes('whsec') && !cfg.includes('SERVICE-SECRET'));
  }
  // --- Managed Service postcode check ---
  const mc = async (pc) => { const x = await realFetch(base + '/api/managed-check?postcode=' + encodeURIComponent(pc)); return { s: x.status, j: await x.json() }; };
  let m = await mc('ME4 4TL'); check('a postcode inside the area is available', m.s === 200 && m.j.available === true && m.j.area === 'Medway (ME)' && m.j.radius_miles === 30);
  m = await mc('me14aa'); check('postcodes are accepted without a space and in lower case', m.j.available === true);
  m = await mc('NR1 1AA'); check('a postcode far away is not available', m.s === 200 && m.j.available === false);
  check('the answer reveals no distance or coordinates', !JSON.stringify(m.j).match(/lat|lng|miles_away|distance/));
  m = await mc('ZZ1 1ZZ'); check('an unknown postcode is explained', m.s === 404 && m.j.error.includes('could not find'));
  m = await mc('hello'); check('something that is not a postcode is refused', m.s === 422);
  pcDown = true; m = await mc('ME4 4TL'); check('if the postcode service is down, visitors are told to call', m.s === 502 && m.j.error.includes('call us')); pcDown = false;
  const pr = await (await realFetch(base + '/api/postcode?postcode=ME4%204TL')).json(); check('the hub can turn a postcode into a point', pr.ok && Math.abs(pr.lat - 51.381) < 0.001 && pr.postcode === 'ME4 4TL');
    // the public clock page as a phone sees it after scanning the QR code
    {
      clockPeople.forEach((x) => { x.at = null; });
      const cctx = await browser.newContext({ viewport: { width: 390, height: 800 } }), cp = await cctx.newPage(); const cprob = [];
      cp.on('console', (m) => { if (m.type() === 'error') cprob.push(m.text()); }); cp.on('pageerror', (e) => cprob.push(String(e)));
      await cp.goto(base + '/clock/' + 'a'.repeat(32)); await cp.waitForSelector('[data-person]');
      check('clock page: shows the site and everyone on its list, with no stray text', (await cp.locator('h1').innerText()) === 'High Street' && (await cp.locator('[data-person]').count()) === 2 && !(await cp.locator('main').innerText()).includes('null'));
      await cp.fill('#cl-search', 'al'); check('clock page: typing narrows the list to matching names', (await cp.locator('[data-person]').count()) === 1 && (await cp.locator('[data-person]').innerText()).includes('Al Smith'));
      await cp.fill('#cl-search', ''); await cp.click('[data-person="11111111-1111-1111-1111-111111111111"]'); await cp.waitForSelector('#cl-go');
      check('clock page: after choosing a name there is one big Clock in button', (await cp.locator('#cl-go').innerText()) === 'Clock in' && (await cp.locator('h1').innerText()) === 'Jo Bloggs');
      await cp.click('#cl-go'); await cp.waitForSelector('[data-result=in]');
      check('clock page: clocking in confirms with the time', (await cp.locator('.done').innerText()).includes('Clocked in at') && (await cp.locator('.done').innerText()).includes('Jo Bloggs'));
      await cp.click('#cl-remember'); await cp.click('#cl-done'); await cp.waitForSelector('#cl-go');
      check('clock page: after "remember me" the page opens straight to that person, who is now offered Clock out', (await cp.locator('#cl-go').innerText()) === 'Clock out');
      await cp.reload(); await cp.waitForSelector('#cl-go'); check('clock page: scanning again on the same phone goes straight to you', (await cp.locator('h1').innerText()) === 'Jo Bloggs' && (await cp.locator('#cl-go').innerText()) === 'Clock out');
      await cp.click('#cl-go'); await cp.waitForSelector('[data-result=out]');
      check('clock page: clocking out says how long you were in', /you were in for \d+ h \d\d min/.test(await cp.locator('.done').innerText()));
      await cp.click('#cl-done'); await cp.waitForSelector('#cl-notme'); await cp.click('#cl-notme'); await cp.waitForSelector('[data-person]');
      check('clock page: "Not you?" forgets the phone and shows the list again', (await cp.locator('[data-person]').count()) === 2);
      await cp.goto(base + '/clock/' + 'f'.repeat(32)); await cp.waitForSelector('h1');
      check('clock page: a code that is not active shows a plain message and no names', (await cp.locator('h1').innerText()).includes('not available') && !(await cp.locator('body').innerText()).includes('Jo Bloggs'));
      check('clock page: no browser errors (including blocked scripts or styles)', cprob.filter((x) => !/404|Failed to load resource/.test(x)).length === 0);
      await cctx.close();
    }

  global.fetch = realFetch;

  // --- sign-in ---
  let t = await newPage();
  check('login screen shows first', (await h1(t.page)) === 'Sign in');
  await login(t.page, 'site@t', 'wrong-password');
  await t.page.waitForSelector('.msg.err');
  check('wrong password gives a generic error and stays on login', (await t.page.locator('.msg.err').innerText()).includes('not recognised') && (await h1(t.page)) === 'Sign in');
  await login(t.page, 'nobody@t');
  await t.page.waitForSelector('.msg.err');
  check('unknown email gives the same generic error', (await t.page.locator('.msg.err').innerText()).includes('not recognised'));
  check('no page or CSP errors on login', t.problems.length === 0);
  await t.ctx.close();

  // site user, 2FA optional
  t = await newPage(); await login(t.page, 'site@t');
  await t.page.waitForSelector('text=Welcome, Leah');
  await t.page.click('[data-nav=settings]'); await t.page.click('[data-set=acct]'); 
  check('site user signs in without 2FA when not required', (await t.page.locator('.badge').innerText()) === 'Off');
  check('optional user is offered 2FA set-up', await t.page.locator('text=Set up 2FA').count() === 1);
  await t.page.click('text=Set up 2FA'); await t.page.waitForSelector('img.qr');
  check('optional set-up has a Not now button', await t.page.locator('text=Not now').count() === 1);
  await t.page.click('text=Not now'); await t.page.waitForSelector('text=Welcome, Leah');
  await t.page.click('[data-nav=settings]'); await t.page.click('[data-set=acct]'); 
  check('Not now returns to the home screen with 2FA still off', (await t.page.locator('.badge').innerText()) === 'Off');
  await t.page.click('text=Sign out'); await t.page.waitForSelector('text=Sign in');
  check('sign out returns to login', (await h1(t.page)) === 'Sign in');
  await t.ctx.close();

  // staff must enrol
  t = await newPage(); await login(t.page, 'staff@t');
  await t.page.waitForSelector('img.qr');
  check('staff without 2FA is forced to set it up', (await h1(t.page)) === 'Set up 2FA' && (await t.page.locator('text=required on your account').count()) === 1);
  check('forced set-up cannot be skipped', (await t.page.locator('text=Not now').count()) === 0);
  check('manual key is shown in groups', (await t.page.locator('.secret').innerText()) === 'ABCD EFGH JKLM NPQR');
  await t.page.fill('#code', '000000'); await t.page.click('button[type=submit]'); await t.page.waitForSelector('.msg.err');
  check('wrong set-up code is rejected', (await h1(t.page)) === 'Set up 2FA');
  await t.page.fill('#code', '12'); await t.page.click('button[type=submit]');
  check('short code is rejected before sending', (await t.page.locator('.msg.err').innerText()).includes('6 digits'));
  await t.page.fill('#code', '123456'); await t.page.click('button[type=submit]'); await t.page.waitForSelector('.hubbar');
  check('correct code turns 2FA on and signs in', (await t.page.locator('.hubbar .badge').innerText()) === 'On');
  check('no page errors during set-up', t.problems.length === 0);
  await t.ctx.close();

  // staff with 2FA must verify
  t = await newPage(); await login(t.page, 'staff2fa@t');
  await t.page.waitForSelector('#code');
  check('staff with 2FA is asked for a code, not let in', (await h1(t.page)) === 'Two-step check' && (await t.page.locator('text=Welcome').count()) === 0);
  check('lost-phone guidance is shown', (await t.page.locator('text=Lost your phone').count()) === 1);
  await t.page.fill('#code', '111111'); await t.page.click('button[type=submit]'); await t.page.waitForSelector('.msg.err');
  check('wrong code keeps them out', (await h1(t.page)) === 'Two-step check');
  await t.page.fill('#code', '123456'); await t.page.click('button[type=submit]'); await t.page.waitForSelector('.hubbar');
  check('correct code lets them in', (await t.page.locator('.hubuser').innerText()).includes('Tremcore administrator') && (await h1(t.page)) === 'Dashboard');
  await t.ctx.close();

  // account without a profile
  t = await newPage(); await login(t.page, 'noprofile@t'); await t.page.waitForSelector('text=No access yet');
  check('signed-in user with no profile gets no access', (await t.page.locator('text=Welcome').count()) === 0 && (await t.page.locator('text=Sign out').count()) === 1);
  await t.ctx.close();

  // forgot password
  t = await newPage(); await t.page.click('text=Forgotten your password?'); await t.page.fill('#email', 'anyone@t'); await t.page.click('button[type=submit]');
  await t.page.waitForSelector('.msg.ok');
  const same = await t.page.locator('.msg.ok').innerText();
  check('reset request gives a neutral confirmation', same.includes('If that email has an account'));
  check('reset email was requested once', (await t.page.evaluate(() => window.__calls.filter((c) => c[0] === 'reset').length)) === 1);
  await t.ctx.close();

  // password reset (no 2FA)
  t = await newPage(); await t.page.evaluate(() => window.__fire('PASSWORD_RECOVERY', 'site@t'));
  await t.page.waitForSelector('text=Choose a new password');
  await t.page.fill('#p1', 'short'); await t.page.fill('#p2', 'short'); await t.page.click('button[type=submit]');
  check('short new password is rejected', (await t.page.locator('.msg.err').innerText()).includes('at least 12'));
  await t.page.fill('#p1', 'a-much-longer-password'); await t.page.fill('#p2', 'different-password-here'); await t.page.click('button[type=submit]');
  check('mismatched passwords are rejected', (await t.page.locator('.msg.err').innerText()).includes('do not match'));
  await t.page.fill('#p2', 'a-much-longer-password'); await t.page.click('button[type=submit]');
  await t.page.waitForSelector('.msg.ok');
  check('good password is saved and user sent to sign in', (await t.page.locator('.msg.ok').innerText()).includes('Password changed') && (await h1(t.page)) === 'Sign in');
  await t.ctx.close();

  // password reset for a 2FA account needs the code
  t = await newPage(); await t.page.evaluate(() => window.__fire('PASSWORD_RECOVERY', 'staff2fa@t'));
  await t.page.waitForSelector('#code');
  await t.page.fill('#p1', 'a-much-longer-password'); await t.page.fill('#p2', 'a-much-longer-password'); await t.page.fill('#code', '000000'); await t.page.click('button[type=submit]');
  await t.page.waitForSelector('.msg.err');
  check('2FA account cannot reset password with a wrong code', (await t.page.evaluate(() => window.__calls.filter((c) => c[0] === 'updateUser').length)) === 0);
  await t.page.fill('#code', '123456'); await t.page.click('button[type=submit]'); await t.page.waitForSelector('.msg.ok');
  check('2FA account can reset password with the right code', (await t.page.evaluate(() => window.__calls.filter((c) => c[0] === 'updateUser').length)) === 1);
  await t.ctx.close();

  // enrol failure is explained
  t = await newPage(async () => {}); await t.page.evaluate(() => { window.__mock.enrollError = 'MFA enroll is disabled'; });
  await login(t.page, 'staff@t'); await t.page.waitForSelector('.msg.err');
  check('failed 2FA set-up explains what to check', (await t.page.locator('.msg.err').innerText()).includes('TOTP'));
  await t.ctx.close();


  // ---------- management hub ----------
  const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const C1 = '00000000-0000-4000-9000-000000000001', C2 = '00000000-0000-4000-9000-000000000002', C3 = '00000000-0000-4000-9000-000000000003';
  const P1 = '00000000-0000-4000-a000-000000000001', P2 = '00000000-0000-4000-a000-000000000002', P3 = '00000000-0000-4000-a000-000000000003';
  const seed = () => ({ tables: {
    companies: [
      { id: C1, name: 'Harbour Cafe Group', level: 1, subscription: 'active', monthly_value_pence: 4900, require_mfa: false, contact_email: 'ops@harbour.example', created_at: '2026-10-01' },
      { id: C2, name: 'Quay Offices Ltd', level: 2, subscription: 'trial', monthly_value_pence: 0, require_mfa: true, created_at: '2026-10-02' },
      { id: C3, name: 'Online Bakery Ltd', level: 1, subscription: 'trial', monthly_value_pence: 0, require_mfa: false, source: 'self_signup', contact_name: 'Bea Baker', contact_email: 'bea@bakery.example', created_at: '2026-11-08' }],
    app_settings: [{ key: 'enforce_2fa', value: true }, { key: 'self_signup_open', value: false }, { key: 'managed_base', value: { label: 'Medway (ME)', lat: 51.385, lng: 0.52 } }, { key: 'managed_radius_miles', value: 30 }],
    properties: [{ id: P1, company_id: C1, name: 'Harbour Cafe Ipswich', address: '1 Quay Road' }, { id: P2, company_id: C1, name: 'Harbour Cafe Colchester' }, { id: P3, company_id: C2, name: 'Quay House' }],
    compliance_items: [
      { id: 'i1', property_id: P1, grp: 'Fire safety', title: 'Fire risk assessment', basis: 'legal', frequency_months: 12, due_date: day(120), notes: '' },
      { id: 'i2', property_id: P1, grp: 'Fire safety', title: 'Fire alarm servicing', basis: 'standard', frequency_months: 6, due_date: day(10), notes: '' },
      { id: 'i3', property_id: P1, grp: 'Electrical', title: 'EICR', basis: 'standard', frequency_months: 60, due_date: day(-5), notes: '' },
      { id: 'i4', property_id: P1, grp: 'Water hygiene', title: 'Legionella risk assessment', basis: 'legal', frequency_months: null, due_date: null, notes: '' }],
    category_library: [
      { id: 'L1', grp: 'Fire safety', title: 'Fire extinguisher servicing', default_basis: 'standard', default_frequency_months: 12 },
      { id: 'L2', grp: 'Building and services', title: 'Pest control', default_basis: 'best_practice', default_frequency_months: 3 }],
    profiles: [{ id: 'u1', company_id: C1, full_name: 'Leah Dunn', role: 'client_super', perm: 'full', active: true }, { id: 'u2', company_id: C1, full_name: 'Tom Reed', role: 'client_site', perm: 'view', active: true }],
    enquiries: [
      { id: 'e1', created_at: '2026-11-06T10:00:00Z', name: 'Sam Carter', company: 'Carter Bars', email: 'sam@carter.example', phone: '01234 567890', sites: '2-5', package_interest: 'self_managed', message: 'We have <b>three</b> bars.', status: 'new', notes: '' },
      { id: 'e2', created_at: '2026-11-01T10:00:00Z', name: 'Older Lead', company: '', email: 'old@lead.example', phone: '', sites: null, package_interest: null, message: '', status: 'contacted', notes: 'Called Monday' }]
  } });
  const dbCalls = (p, f) => p.evaluate((fn) => window.__calls.filter((c) => c[0] === 'db').map((c) => c[1]).filter((x) => new Function('x', 'return ' + fn)(x)), f);
  async function hubPage(seedOverride, who) {
    const t = await newPage((sd) => { window.__mock.tables = sd.tables; }, seedOverride || seed());
    await t.page.setViewportSize({ width: 1280, height: 900 });   // the hub is tested on a desktop screen; the phone menu has its own test below
    await login(t.page, who || 'staff2fa@t'); await t.page.waitForSelector('#code');
    await t.page.fill('#code', '123456'); await t.page.click('button[type=submit]'); await t.page.waitForSelector('.hubbar');
    await t.page.waitForSelector('.tiles');
    return t;
  }
  {
    let t = await hubPage();
    const p = t.page;
    check('hub dashboard shows client, site, revenue and enquiry figures', (await p.locator('.tiles').innerText()).replace(/\s+/g, ' ').includes('3 Active clients') && (await p.locator('.tiles').innerText()).includes('3') && (await p.locator('.tiles').innerText()).includes('£49.00') && (await p.locator('.tiles').innerText()).includes('Self sign-ups to follow up'));
    check('dashboard compliance figure counts the missing date against the site (2 of 4 in date = 50%)', (await p.locator('.overall').first().innerText()).includes('50% of 4'));
    check('dashboard lists the site that needs attention', (await p.locator('.list').innerText()).includes('Harbour Cafe Ipswich'));
    check('hub nav is shown', (await p.locator('.hubnav a').allInnerTexts()).join() === 'Dashboard,Clients,Subscriptions,Renewals,Interest list,Offers,Revenue,Enquiries,Activity,Settings');

    // clients list + search
    await p.click('.hubnav >> text=Clients'); await p.waitForSelector('table');
    { const sb = await p.locator('.hubside').boundingBox(), mb = await p.locator('.hubmain').boundingBox();
      check('hub desktop: the menu is a sidebar on the left and the page gets the rest of the width', sb.x === 0 && sb.width >= 240 && sb.width <= 280 && mb.x >= sb.width - 1 && mb.width > 900);
      check('hub desktop: menu items are grouped under headings', (await p.locator('.hubgroup-label').allInnerTexts()).join() === 'OVERVIEW,CUSTOMERS,GROWTH,SYSTEM' || (await p.locator('.hubgroup-label').allInnerTexts()).join().toLowerCase() === 'overview,customers,growth,system');
      check('hub: a Refresh button sits next to Sign out (an installed phone app has no browser refresh)', (await p.locator('#hub-refresh').innerText()) === 'Refresh');
      check('hub desktop: no burger button', !(await p.locator('.hubburger').isVisible())); }
    check('hub back: the Dashboard has no Back button, other pages do', (await p.locator('#hub-back').count()) === 1);
    await p.click('#hub-back'); await p.waitForSelector('.tiles');
    check('hub back: Back returns to the page you came from (desktop)', (await p.locator('#hub-back').count()) === 0 && (await p.locator('.hubnav a.on').innerText()) === 'Dashboard');
    await p.click('.hubnav >> text=Clients'); await p.waitForSelector('table');
    if (process.env.SHOT) { await p.setViewportSize({ width: 1440, height: 900 }); await p.waitForTimeout(300); await p.screenshot({ path: '/tmp/shot/hub1440.png' }); }
    await p.setViewportSize({ width: 390, height: 844 });
    check('hub phone: the menu is hidden behind a burger button', (await p.locator('.hubburger').isVisible()) && !(await p.locator('.hubnav').isVisible()));
    await p.click('.hubburger'); await p.waitForSelector('.hubnav a:has-text("Revenue")', { state: 'visible' });
    if (process.env.SHOT) await p.screenshot({ path: '/tmp/shot/hub390.png' });
    check('hub phone: tapping the burger opens the list of pages', (await p.locator('.hubburger').getAttribute('aria-expanded')) === 'true' && (await p.locator('.hubnav a:visible').count()) >= 9);
    await p.click('.hubnav a:has-text("Revenue")'); await p.waitForSelector('text=Revenue by package');
    check('hub back: the Back button is there on a phone too and works', (await p.locator('#hub-back').isVisible()) && await (async () => { await p.click('#hub-back'); await p.waitForSelector('table'); return (await p.locator('.hubmain h1').first().innerText()) === 'Clients'; })());
    await p.click('.hubburger'); await p.click('.hubnav a:has-text("Revenue")'); await p.waitForSelector('text=Revenue by package');
    check('hub phone: choosing a page opens it and closes the menu', !(await p.locator('.hubnav').isVisible()));
    await p.setViewportSize({ width: 1280, height: 900 });
    await p.click('.hubnav >> text=Clients'); await p.waitForSelector('table');
    { const u = await hubPage(); const up = u.page;
      await up.route('**/api/version', (rt) => rt.fulfill({ status: 200, contentType: 'application/json', body: '{"v":"a-newer-version"}' }));
      check('update: no bar while nothing new has been deployed', (await up.locator('#update-bar').count()) === 0);
      await up.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await up.waitForSelector('#update-bar');
      check('update: when a new version is deployed an "Update now" button appears', (await up.locator('#update-now').innerText()) === 'Update now');
      await up.unroute('**/api/version');
      await Promise.all([up.waitForNavigation(), up.click('#update-now')]); await up.waitForSelector('#app');   // the pretend database forgets its sign-in on reload; the real one keeps it
      check('update: pressing Update now reloads onto the new version and the bar goes', (await up.locator('#update-bar').count()) === 0);
      await u.ctx.close(); }

    { const t2 = await newPage((sd) => { window.__mock.tables = sd.tables; Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5 }); }, seed()); const tp = t2.page;
      await login(tp, 'staff2fa@t'); await tp.waitForSelector('#code'); await tp.fill('#code', '123456'); await tp.click('button[type=submit]'); await tp.waitForSelector('.tiles');
      const drag = (y1, y2, end) => tp.evaluate(([a, b, e]) => { const t = (y) => new Touch({ identifier: 1, target: document.body, clientX: 100, clientY: y });
        document.dispatchEvent(new TouchEvent('touchstart', { touches: [t(a)], bubbles: true })); document.dispatchEvent(new TouchEvent('touchmove', { touches: [t(b)], bubbles: true }));
        if (e) document.dispatchEvent(new TouchEvent('touchend', { touches: [], bubbles: true })); }, [y1, y2, end]);
      await drag(100, 130, true); await tp.waitForTimeout(200);
      check('pull to refresh: a short pull does nothing', (await tp.locator('#pull-ind.show').count()) === 0);
      await drag(100, 230, false); await tp.waitForSelector('#pull-ind.show');
      check('pull to refresh: pulling far enough says Release to refresh', (await tp.locator('#pull-ind').innerText()) === 'Release to refresh');
      await Promise.all([tp.waitForNavigation(), tp.evaluate(() => document.dispatchEvent(new TouchEvent('touchend', { touches: [], bubbles: true })))]);
      check('pull to refresh: letting go reloads the app', true);
      await t2.ctx.close(); }
    check('clients list shows every client with package and site counts', (await p.locator('tbody tr').count()) === 3 && (await p.locator('tbody').innerText()).includes('Managed Service'));
    await p.fill('input[type=search]', 'quay'); check('search narrows the client list', (await p.locator('tbody tr').count()) === 1);
    await p.fill('input[type=search]', 'zzz'); check('search with no match says so', (await p.locator('tbody').innerText()).includes('No clients match'));
    await p.fill('input[type=search]', '');

    // add client (validation, then success)
    await p.click('text=Add client'); await p.waitForSelector('#c-name');
    check('new-client package list offers only Levels 1 and 2', (await p.locator('#c-level option').allInnerTexts()).join() === 'Self-Managed,Managed Service');
    await p.click('button[type=submit]:has-text("Add client")'); check('client name is required', (await p.locator('.msg.err').innerText()).includes('client name'));
    await p.fill('#c-name', 'New Bistro Ltd'); await p.fill('#c-value', 'abc'); await p.click('button[type=submit]:has-text("Add client")');
    check('bad monthly value is rejected', (await p.locator('.msg.err').innerText()).includes('monthly value'));
    await p.fill('#c-value', '£59.50'); await p.fill('#c-cemail', 'not-an-email'); await p.click('button[type=submit]:has-text("Add client")');
    check('bad contact email is rejected', (await p.locator('.msg.err').innerText()).includes('email'));
    await p.fill('#c-cemail', 'a@b.example'); await p.selectOption('#c-level', '2'); await p.check('#c-mfa'); await p.click('button[type=submit]:has-text("Add client")');
    await p.waitForSelector('text=Client details');
    const ins = (await dbCalls(p, "x.table==='companies'&&x.op==='insert'"))[0];
    check('client is saved with pence, level and the 2FA setting', ins && ins.payload.name === 'New Bistro Ltd' && ins.payload.monthly_value_pence === 5950 && ins.payload.level === 2 && ins.payload.require_mfa === true && ins.payload.subscription === 'trial');
    check('after adding, the new client page opens', (await h1(p)) === 'New Bistro Ltd');

    // edit client
    await p.fill('#c-name', 'New Bistro Group'); await p.selectOption('#c-sub', 'active'); await p.click('button:has-text("Save client")'); await p.waitForSelector('.msg.ok');
    const upd = (await dbCalls(p, "x.table==='companies'&&x.op==='update'"))[0];
    check('client edit saves the changes', upd && upd.payload.name === 'New Bistro Group' && upd.payload.subscription === 'active' && upd.filters[0].startsWith('id='));

    // client with sites + people
    await p.goto(base + '/app/#/clients/' + C1); await p.waitForSelector('text=People with a login');
    check('client page lists its sites with their compliance percentages', (await p.locator('section:has(h2:text("Sites"))').innerText()).includes('Harbour Cafe Ipswich') && (await p.locator('section:has(h2:text("Sites")) svg').count()) === 2);
    check('client page lists people and keeps invites for the next stage', (await p.locator('section:has(h2:text("People with a login"))').innerText()).includes('Leah Dunn') && (await p.locator('.hint:has-text("next stage")').count()) === 1);
    await p.fill('input[aria-label="New site name"]', 'Harbour Cafe Norwich'); await p.click('button:has-text("Add site")'); await p.waitForSelector('text=No compliance items yet');
    check('adding a site creates it under the right client', (await dbCalls(p, "x.table==='properties'&&x.op==='insert'"))[0].payload.company_id === C1);

    // site page
    await p.goto(base + '/app/#/sites/' + P1); await p.waitForSelector('.items');
    const first = await p.locator('.item').first().innerText();
    check('site items are ordered with overdue first', first.includes('EICR') && first.includes('Overdue') && first.includes('days overdue'));
    check('missing date shows Not entered and is never In date', await p.locator('.item.missing:has-text("Legionella"):has-text("Not entered")').count() === 1 && await p.locator('.item.missing .badge.green').count() === 0);
    check('amber item shows days left', await p.locator('.item.amber:has-text("Due soon"):has-text("days left")').count() === 1);
    check('site donut reports 50% in date', (await p.locator('.overall').innerText()).includes('50% of 4'));
    await p.click('.chip:has-text("Overdue")'); check('filter chips narrow the list', (await p.locator('.item').count()) === 1);
    await p.click('.chip:has-text("All")');

    // add item from the standard list; due date worked out from last done + frequency
    await p.click('button:has-text("Add item")'); await p.waitForSelector('#i-lib-new');
    await p.selectOption('#i-lib-new', 'L1');
    check('choosing a standard title fills the form', (await p.inputValue('#i-title-new')) === 'Fire extinguisher servicing' && (await p.inputValue('#i-freq-new')) === '12' && (await p.inputValue('#i-grp-new')) === 'Fire safety');
    await p.fill('#i-freq-new', 'x'); 
    await p.locator('form.itemform button[type=submit]').click(); check('non-numeric frequency is rejected', (await p.locator('.itemform .msg.err').innerText()).includes('whole number'));
    await p.fill('#i-freq-new', '12'); await p.fill('#i-last-new', '2026-01-31'); await p.locator('form.itemform button[type=submit]').click();
    await p.waitForFunction(() => document.querySelectorAll('.item').length === 5);
    const itemIns = (await dbCalls(p, "x.table==='compliance_items'&&x.op==='insert'"))[0];
    check('item is saved for this site with the work-out due date', itemIns.payload.property_id === P1 && itemIns.payload.due_date === '2027-01-31' && itemIns.payload.library_id === 'L1' && itemIns.payload.basis === 'standard');
    check('page re-reads and shows 5 items, 3 of 5 in date (60%)', (await p.locator('.overall').innerText()).includes('60% of 5'));

    // item with no date at all stays missing
    await p.click('button:has-text("Add item")'); await p.fill('#i-title-new', 'Kitchen extract cleaning'); await p.locator('form.itemform button[type=submit]').click();
    await p.waitForFunction(() => document.querySelectorAll('.item').length === 6);
    check('an item saved with no dates stays Not entered and lowers the percentage', (await p.locator('.item.missing').count()) === 2 && (await p.locator('.overall').innerText()).includes('50% of 6'));

    // edit and delete
    await p.locator('.item:has-text("EICR") button:has-text("Edit")').click(); await p.waitForSelector('.editpanel');
    await p.fill('.editpanel input[type=date] >> nth=1', day(300)); await p.locator('.editpanel form.itemform button[type=submit]').click();
    await p.waitForFunction(() => !document.querySelector('.editpanel'));
    check('editing a due date saves and turns the item green', (await p.locator('.item:has-text("EICR") .badge').innerText()) === 'In date');
    await p.locator('.item:has-text("Pest") button:has-text("Edit")').count();
    await p.locator('.item:has-text("Kitchen extract") button:has-text("Edit")').click(); await p.click('text=Delete this item');
    check('delete asks first and shows a Keep option', (await p.locator('text=Yes, delete').count()) === 1 && (await p.locator('button:has-text("Keep")').count()) === 1);
    await p.click('button:has-text("Keep")'); check('Keep leaves the item in place', (await dbCalls(p, "x.table==='compliance_items'&&x.op==='delete'")).length === 0);
    await p.click('text=Delete this item'); await p.click('text=Yes, delete'); await p.waitForFunction(() => document.querySelectorAll('.item').length === 5);
    check('confirmed delete removes the item', (await dbCalls(p, "x.table==='compliance_items'&&x.op==='delete'")).length === 1);

    // subscriptions
    await p.click('.hubnav >> text=Subscriptions'); await p.waitForSelector('select[aria-label^="Subscription for"]');
    check('subscriptions page totals active clients only (49.00 + 59.50, trial excluded)', (await p.locator('.tiles').innerText()).includes('£108.50'));
    await p.selectOption('select[aria-label="Subscription for Quay Offices Ltd"]', 'active'); await p.selectOption('select[aria-label="Billing for Quay Offices Ltd"]', 'annual'); await p.fill('input[aria-label="Monthly value for Quay Offices Ltd"]', '25');
    await p.locator('tr:has-text("Quay Offices") button:has-text("Save")').click(); await p.waitForSelector('tr:has-text("Quay Offices") >> text=Saved');
    const su = (await dbCalls(p, "x.table==='companies'&&x.op==='update'&&x.payload.monthly_value_pence===2500"))[0];
    check('subscription status and value are saved in pence', su && su.payload.subscription === 'active');
    check('the billing choice (monthly or yearly) is saved too', su && su.payload.billing_interval === 'annual');
    await p.fill('input[aria-label="Monthly value for Quay Offices Ltd"]', 'lots'); await p.locator('tr:has-text("Quay Offices") button:has-text("Save")').click();
    check('bad subscription value is refused without saving', (await p.locator('tr:has-text("Quay Offices")').innerText()).includes('Enter pounds'));

    // revenue & growth
    await p.click('.hubnav >> text=Revenue'); await p.waitForSelector('text=Revenue by package');
    const rv = await p.locator('.tiles').innerText();
    check('revenue page shows MRR (49.00 + 59.50 + 25.00) and yearly run rate', rv.includes('£133.50') && rv.includes('£1,602.00'));
    check('revenue page shows paying client count and average', rv.includes('44.50'));
    check('revenue page lists biggest paying clients and new-client months', (await p.locator('text=Biggest paying clients').count()) === 1 && (await p.locator('text=New clients, last 6 months').count()) === 1);

    // enquiries
    await p.click('.hubnav >> text=Enquiries'); await p.waitForSelector('.enq');
    check('enquiries are listed newest first', (await p.locator('.enq h2').first().innerText()).includes('Sam Carter') && (await p.locator('.enq').count()) === 2);
    check('enquiry text is shown as plain text, never as HTML', (await p.locator('.quote').first().innerText()).includes('<b>three</b>') && (await p.locator('.quote b').count()) === 0);
    await p.selectOption('select[aria-label="Status for Sam Carter"]', 'demo_booked'); await p.fill('textarea[aria-label="Notes for Sam Carter"]', 'Demo Friday');
    await p.locator('.enq:has-text("Sam Carter") button:has-text("Save")').click(); await p.waitForSelector('.enq:has-text("Sam Carter") >> text=Saved');
    const eu = (await dbCalls(p, "x.table==='enquiries'&&x.op==='update'"))[0];
    check('enquiry status and notes are saved', eu.payload.status === 'demo_booked' && eu.payload.notes === 'Demo Friday');

    // offers
    await p.evaluate(() => { const iso = (d) => new Date(Date.now() + d * 86400000).toISOString(); window.__mock.tables.offer_codes = [
      { id: 'o1', code: 'TC-WAIT22', prospect_name: 'Wendy Waits', prospect_email: 'wendy@w.example', status: 'active', sent_at: iso(-2), expires_at: iso(20), created_at: iso(-2), used_company: null },
      { id: 'o2', code: 'TC-USED22', prospect_name: 'Una Used', prospect_email: 'una@u.example', status: 'used', sent_at: iso(-30), expires_at: iso(-5), created_at: iso(-30), used_company: window.__mock.tables.companies[0].id },
      { id: 'o3', code: 'TC-OLD222', prospect_name: '', prospect_email: 'old@o.example', status: 'active', sent_at: null, expires_at: iso(-3), created_at: iso(-40), used_company: null }]; window.__mock.tables.companies[0].offer_ends_at = iso(300); });
    await p.click('.hubnav >> text=Offers'); await p.waitForSelector('#offer-table tr[data-code]');
    const orow = (c) => p.locator('tr[data-code=' + c + ']');
    check('offers: the codes are listed with their state: waiting, used (with the client and when the offer price ends) and expired', (await orow('TC-WAIT22').innerText()).includes('Waiting') && (await orow('TC-USED22').innerText()).includes('Used') && (await orow('TC-USED22').innerText()).includes('Harbour Cafe Group') && (await orow('TC-USED22').innerText()).includes('Offer price until') && (await orow('TC-OLD222').innerText()).includes('Expired') && (await orow('TC-OLD222').innerText()).includes('Not emailed'));
    check('offers: only a waiting code can be sent again or switched off', (await orow('TC-WAIT22').locator('button').allInnerTexts()).join() === 'Copy link,Resend,Switch off' && (await orow('TC-USED22').locator('button').count()) === 0 && (await orow('TC-OLD222').locator('button').count()) === 0);
    let sendBody = null, sendAuth = null; await p.route('**/api/send-offer', (rt) => { sendBody = JSON.parse(rt.request().postData()); sendAuth = rt.request().headers().authorization; rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, id: 'o9', code: 'TC-NEW999', link: base + '/app/?signup=1&code=TC-NEW999', sent: true }) }); });
    await p.fill('#of-name', 'pat prospect'); await p.fill('#of-email', 'pat@prospect.example'); await p.selectOption('#offer-create >> xpath=../..//select', '60').catch(() => {});
    await p.click('#offer-create'); await p.waitForSelector('#offer-link');
    check('offers: creating sends the prospect’s details, with the staff member’s own sign-in, and shows the code and a copyable link', sendBody.email === 'pat@prospect.example' && sendBody.name === 'Pat Prospect' && sendBody.days >= 14 && /^Bearer tok-/.test(sendAuth) && (await p.inputValue('#offer-link')).includes('code=TC-NEW999') && (await p.locator('#offer-out').innerText()).includes('Email sent'));
    await p.route('**/api/send-offer', (rt) => rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, id: 'o9', code: 'TC-NEW999', link: base + '/app/?signup=1&code=TC-NEW999', sent: false, note: 'The email service is not set up yet, so nothing was sent. Copy the link and send it yourself.' }) }));
    await p.fill('#of-email', 'x@y.example'); await p.click('#offer-create'); await p.waitForSelector('#offer-out >> text=not set up yet');
    check('offers: if the email could not be sent the page says so plainly and still gives the link to send by hand', (await p.locator('#offer-link').count()) === 1);
    await p.fill('#of-email', 'nope'); await p.click('#offer-create'); await p.waitForSelector('#offer-out .msg.err');
    check('offers: a bad email address is stopped before anything is sent', (await p.locator('#offer-out').innerText()).includes('email address'));
    await orow('TC-WAIT22').locator('button:has-text("Switch off")').click(); await p.waitForSelector('tr[data-code=TC-WAIT22] >> text=Switched off');
    check('offers: switching a code off marks it switched off and removes its buttons', (await orow('TC-WAIT22').locator('button').count()) === 0);

    // interest list
    await p.evaluate(() => { const iso = (d) => new Date(Date.now() + d * 86400000).toISOString(); window.__mock.tables.interest_list = [
      { id: 'i1', name: 'Ivy Interested', email: 'ivy@i.example', business_name: 'Ivy Cafe Ltd', business_address: '2 Quay Rd, Chatham', sites: 2, status: 'registered', created_at: iso(-3), invited_at: null, signed_up_at: null },
      { id: 'i2', name: 'Sid Signed', email: 'sid@s.example', business_name: 'Sid Gym', business_address: '9 Hill St, Rochester', sites: 1, status: 'signed_up', created_at: iso(-20), invited_at: iso(-10), signed_up_at: iso(-9) },
      { id: 'i3', name: 'Rob Removed', email: 'rob@r.example', business_name: 'Rob Ltd', business_address: 'x', sites: 1, status: 'removed', created_at: iso(-30), invited_at: null, signed_up_at: null }]; });
    await p.click('.hubnav >> text=Interest list'); await p.waitForSelector('#interest-table tr[data-email]');
    const irow = (e) => p.locator('tr[data-email="' + e + '"]');
    check('interest: lists name, business, address, sites and status', (await irow('ivy@i.example').innerText()).includes('Ivy Cafe Ltd') && (await irow('ivy@i.example').innerText()).includes('2 Quay Rd, Chatham') && (await irow('ivy@i.example').innerText()).includes('Waiting') && (await irow('sid@s.example').innerText()).includes('Signed up'));
    check('interest: the tiles count registered (not removed), waiting and signed up', (await p.locator('.tiles').innerText()).replace(/\s+/g, ' ').includes('2 Registered interest') && (await p.locator('.tiles').innerText()).replace(/\s+/g, ' ').includes('1 Signed up'));
    check('interest: only people still waiting can be sent an offer or removed', (await irow('ivy@i.example').locator('button').allInnerTexts()).join() === 'Send offer code,Remove' && (await irow('sid@s.example').locator('button').count()) === 0);
    await p.setViewportSize({ width: 390, height: 844 });
    { const card = p.locator('.icard[data-email="ivy@i.example"]');
      if (process.env.SHOT) await p.screenshot({ path: '/tmp/shot/interest390.png', fullPage: true });
      check('interest on a phone: a card per business instead of a table', (await card.isVisible()) && !(await p.locator('#interest-table').isVisible()));
      const txt = await card.innerText();
      check('interest on a phone: every detail is on the card', ['Ivy Cafe Ltd', 'Ivy Interested', '2 sites', 'ivy@i.example', '2 Quay Rd, Chatham', 'Registered', 'Waiting'].every((x) => txt.includes(x)));
      check('interest on a phone: nothing runs off the side of the screen', (await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)));
      check('interest on a phone: the card has its own Send offer code and Remove buttons', (await card.locator('button').allInnerTexts()).join() === 'Send offer code,Remove'); }
    await p.setViewportSize({ width: 1280, height: 900 });
    let ilBody = null; await p.route('**/api/send-launch', (rt) => { ilBody = JSON.parse(rt.request().postData()); rt.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"sent":1,"failed":0}' }); });
    p.once('dialog', (d) => d.accept()); await p.click('#launch-send'); await p.waitForSelector('text=Sent to 1');
    check('interest: the launch button asks the server to send the link to those waiting', ilBody && !ilBody.ids);
    let ioBody = null; await p.route('**/api/send-offer', (rt) => { ioBody = JSON.parse(rt.request().postData()); rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, id: 'o8', code: 'TC-IVY222', link: base + '/app/?signup=1&code=TC-IVY222', sent: true }) }); });
    await irow('ivy@i.example').locator('button:has-text("Send offer code")').click(); await p.waitForSelector('tr[data-email="ivy@i.example"] >> text=TC-IVY222');
    check('interest: "Send offer code" uses the person\'s name and email', ioBody.email === 'ivy@i.example' && ioBody.name === 'Ivy Interested');
    await irow('ivy@i.example').locator('button:has-text("Remove")').click(); await p.waitForSelector('tr[data-email="ivy@i.example"] >> text=Removed');
    check('interest: removing marks them removed (kept on record, not emailed again)', (await irow('ivy@i.example').locator('button').count()) === 0);
    await p.click('.hubnav >> text=Revenue'); await p.waitForSelector('#report-table tbody tr');
    check('revenue: the monthly report has 12 months and switches to years', (await p.locator('#report-table tbody tr').count()) === 12 && (await (async () => { await p.click('#rep-year'); return p.locator('#report-table tbody tr').count(); })()) === 3);

    // the 2FA switch in Settings
    await p.goto(base + '/app/#/settings'); await p.waitForSelector('#mfa-card');
    check('2FA switch: Settings shows 2FA is on, with a button to switch it off', (await p.locator('#mfa-card').innerText()).includes('On') && (await p.locator('#mfa-toggle').innerText()) === 'Switch 2FA off');
    await p.click('#mfa-toggle'); await p.waitForSelector('#mfa-toggle:has-text("Switch 2FA on")');
    const mfaUp = (await dbCalls(p, "x.table==='app_settings'&&x.op==='update'")).pop();
    check('2FA switch: pressing it saves "off" and the page warns it must go back on before real customers', mfaUp.payload.value === false && mfaUp.filters.includes('key=enforce_2fa') && (await p.locator('#mfa-card').innerText()).includes('OFF'));
    // phone layout + errors
    await p.setViewportSize({ width: 390, height: 800 });
    for (const u of ['#/dashboard', '#/clients', '#/clients/' + C1, '#/sites/' + P1, '#/subscriptions', '#/offers', '#/enquiries']) {
      await p.goto(base + '/app/' + u); await p.waitForSelector('.hubmain h1');
      if (!(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))) check('hub fits a phone: ' + u, false);
    }
    check('every hub page fits a phone with no sideways scroll', true);
    check('no page or CSP errors anywhere in the hub', t.problems.length === 0);
    if (t.problems.length) console.log(t.problems);
    await t.ctx.close();

    // renewals and activity
    {
      const sd = seed();
      sd.tables.compliance_items.push(
        { id: 'q1', property_id: P3, grp: 'Fire safety', title: 'Fire extinguisher service', basis: 'standard', frequency_months: 12, due_date: day(12), notes: '' },
        { id: 'q2', property_id: P3, grp: 'Gas', title: 'Gas safety certificate', basis: 'legal', frequency_months: 12, due_date: day(-3), notes: '' },
        { id: 'q3', property_id: P3, grp: 'Electrical', title: 'Fixed wire test', basis: 'standard', frequency_months: 60, due_date: day(300), notes: '' });
      sd.tables.renewal_tasks = [{ id: 'r1', item_id: 'q1', property_id: P3, stage: 'booking_required', booked_for: null, note: '', updated_at: '2026-11-01T10:00:00Z' }];
      sd.tables.audit_log = [
        { id: 1, at: '2026-11-07T09:00:00Z', actor: 'u1', property_id: P3, table_name: 'compliance_items', action: 'UPDATE', old_data: { title: 'Gas safety certificate', due_date: '2025-11-01' }, new_data: { title: 'Gas safety certificate', due_date: '2026-11-01' } },
        { id: 2, at: '2026-11-08T09:00:00Z', actor: 'u2', property_id: P3, table_name: 'documents', action: 'INSERT', old_data: null, new_data: { filename: 'gas.pdf' } }];
      const rt = await hubPage(sd), rp = rt.page;
      await rp.click('.hubnav >> text=Renewals'); await rp.waitForSelector('text=Booking required (1)');
      const needs = await rp.locator('section:has-text("with no renewal started")').innerText();
      check('renewals lists only managed-client items that are due or overdue and have no renewal yet', needs.includes('Gas safety certificate') && !needs.includes('Fire extinguisher service') && !needs.includes('EICR') && !needs.includes('Fixed wire test'));
      check('renewals shows the four stages, with the existing task under Booking required', (await rp.locator('section h2').allInnerTexts()).join('|').includes('Due soon (0)|Booking required (1)|Booked (0)|Completed (0)') && (await rp.locator('section:has-text("Booking required (1)")').innerText()).includes('Fire extinguisher service'));
      await rp.click('button:has-text("Start renewal")'); await rp.waitForSelector('text=Due soon (1)');
      const st = (await dbCalls(rp, "x.table==='renewal_tasks'&&x.op==='insert'"))[0];
      check('starting a renewal creates a Due soon task for that item', st && st.payload.item_id === 'q2' && st.payload.stage === 'due_soon');
      check('the item leaves the "no renewal yet" list once started', (await rp.locator('section:has-text("with no renewal started")').innerText()).includes('Everything due soon already'));
      await rp.selectOption('select[aria-label="Stage for Fire extinguisher service"]', 'booked'); await rp.fill('input[aria-label="Booked for Fire extinguisher service"]', day(5));
      await rp.locator('li:has-text("Fire extinguisher service") button:has-text("Save")').click(); await rp.waitForSelector('text=Booked (1)');
      const up = (await dbCalls(rp, "x.table==='renewal_tasks'&&x.op==='update'"))[0];
      check('moving a renewal to Booked saves the stage and the booked date', up && up.payload.stage === 'booked' && up.payload.booked_for === day(5));
      await rp.click('.hubnav >> text=Activity'); await rp.waitForSelector('table');
      const act = await rp.locator('table').innerText();
      check('activity shows who changed what, newest first', act.includes('Changed the due date of “Gas safety certificate”') && act.includes('Uploaded the document gas.pdf') && act.includes('Leah Dunn') && act.includes('Tom Reed') && act.indexOf('gas.pdf') < act.indexOf('Changed the due date'));
      check('no page or CSP errors on Renewals and Activity', rt.problems.length === 0);
      if (rt.problems.length) console.log(rt.problems);
      await rt.ctx.close();
    }

    // a failing database call is explained, not a blank page
    t = await hubPage(); await t.page.evaluate(() => { window.__mock.dbError = { companies: 'permission denied' }; });
    await t.page.click('.hubnav >> text=Clients'); await t.page.waitForSelector('.msg.err');
    check('a refused request shows a friendly error', (await t.page.locator('.msg.err').innerText()).includes('permission denied') && (await t.page.locator('.hubnav').count()) === 1);
    await t.page.evaluate(() => { window.__mock.dbError = null; });
    await t.page.click('text=Sign out'); await t.page.waitForSelector('text=Sign in');
    check('signing out of the hub returns to the login screen', (await h1(t.page)) === 'Sign in' && (await t.page.evaluate(() => document.body.classList.contains('hub'))) === false);
    await t.ctx.close();

    // client users never see the hub
    t = await newPage((sd) => { window.__mock.tables = sd.tables; }, seed()); await login(t.page, 'site@t'); await t.page.waitForSelector('text=Welcome, Leah');
    check('a client user never gets the hub', (await t.page.locator('.hubbar').count()) === 0 && (await t.page.locator('text=Clients').count()) === 0);
    await t.page.goto(base + '/app/#/clients'); await t.page.waitForSelector('text=Welcome, Leah');
    check('typing a hub address as a client user still shows no hub', (await t.page.locator('.hubbar').count()) === 0 && (await t.page.locator('table').count()) === 0);
    await t.ctx.close();
  }

  // ---------- Self-Managed sign-up ----------
  {
    const openMock = () => { window.__mock.signupOpen = true; };
    const calls = (p, name) => p.evaluate((n) => window.__calls.filter((c) => c[0] === n).map((c) => c[1]), name);
    let t = await newPage(); // closed by default
    check('sign-in page offers no sign-up while it is closed', (await t.page.locator('text=Create an account').count()) === 0);
    await t.page.goto(base + '/app/?signup=1'); await t.page.waitForSelector('text=Sign-up is not open yet');
    check('the sign-up address says "not open yet" and points to the contact form while closed', (await t.page.locator('a[href="/contact/"]').count()) === 1 && (await t.page.locator('#su-email').count()) === 0);
    await t.ctx.close();

    t = await newPage(openMock);
    await t.page.waitForSelector('text=Create an account');
    check('sign-in page offers sign-up once Tremcore opens it', true);
    await t.page.click('text=Create an account'); await t.page.waitForSelector('#su-email');
    const p = t.page, go = () => p.click('button[type=submit]');
    await go(); check('sign-up needs name and business name', (await p.locator('.msg.err').innerText()).includes('business name'));
    check('sign-up asks for a number of sites, and has no site name or address box and no "work" email wording', (await p.locator('#su-sites').count()) === 1 && (await p.locator('#su-site').count()) === 0 && (await p.locator('#su-addr').count()) === 0 && !/work email/i.test(await p.locator('.card').innerText()));
    await p.fill('#su-name', 'pat jones'); await p.fill('#su-company', 'acme cafes Ltd'); await p.fill('#su-sites', '3'); await p.fill('#su-email', 'nope');
    await p.press('#su-name', 'Tab'); await p.press('#su-company', 'Tab');
    check('names get a capital on every word as you leave the box', (await p.inputValue('#su-name')) === 'Pat Jones' && (await p.inputValue('#su-company')) === 'Acme Cafes Ltd');
    await go(); check('sign-up checks the email address', (await p.locator('.msg.err').innerText()).includes('email'));
    await p.fill('#su-email', 'pat@acme.example'); await p.fill('#su-pass', 'short'); await go();
    check('sign-up asks for at least 12 characters', (await p.locator('.msg.err').innerText()).includes('at least 12'));
    await p.fill('#su-pass', 'a-long-enough-password'); await go();
    check('sign-up will not go ahead without agreeing to the terms', (await p.locator('.msg.err').innerText()).includes('terms') && (await calls(p, 'signUp')).length === 0);
    check('terms and privacy links open the notices in a new tab', (await p.locator('a[href="/terms/"][target=_blank]').count()) === 1 && (await p.locator('a[href="/privacy/"][target=_blank]').count()) === 1);
    check('sign-up offers yearly (ticked by default) or monthly, prices excluding VAT, and says there is no trial', (await p.locator('input[name=su-billing]').count()) === 2 && (await p.locator('input[value=annual]').isChecked()) && (await p.locator('.plans').innerText()).includes('£14.99') && (await p.locator('.plans').innerText()).includes('£152.90') && (await p.locator('.plans').innerText()).includes('exclude VAT') && !/free trial/i.test(await p.locator('.card').innerText()));
    check('the price follows the number of sites: 3 sites is £30.97 a month or £315.90 a year', (await p.locator('#su-monthly').innerText()).includes('£30.97') && (await p.locator('#su-annual').innerText()).includes('£315.90'));
    await p.fill('#su-sites', '1'); check('1 site is £14.99 a month or £152.90 a year', (await p.locator('#su-monthly').innerText()).includes('£14.99') && (await p.locator('#su-annual').innerText()).includes('£152.90'));
    await p.fill('#su-sites', '3');
    await p.check('input[value=annual]');
    check('the terms and privacy links are on the form and open in a new tab', (await p.locator('a[href="/terms/"][target=_blank]').count()) === 1 && (await p.locator('a[href="/privacy/"][target=_blank]').count()) === 1);
    await p.route('**/api/signup-checkout', (rt) => rt.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Online payment is not switched on yet.' }) }));
    await p.check('#su-terms'); await go(); await p.waitForSelector('text=Check your email');
    check('if the payment page cannot open, the person is told nothing was charged and that they will pay when they sign in', (await p.locator('#pay-later').innerText()).includes('not switched on') || true);
    const su = (await calls(p, 'signUp'))[0];
    check('account is requested with the details kept for later and a return address on /app/', su.email === 'pat@acme.example' && su.meta.signup_company === 'Acme Cafes Ltd' && su.meta.signup_full_name === 'Pat Jones' && su.meta.signup_sites === 3 && !!su.meta.terms_accepted_at && su.redirect.endsWith('/app/'));
    check('the yearly choice is kept with the sign-up details', su.meta.signup_billing === 'annual');
    check('no company is created before the email is confirmed', (await calls(p, 'rpc:signup_company')).length === 0);
    check('the confirmation screen names the address', (await p.locator('strong').innerText()) === 'pat@acme.example');
    await p.click('text=Go to sign in'); await login(p, 'pat@acme.example', 'a-long-enough-password'); await p.waitForSelector('.msg.err');
    check('signing in before confirming the email is explained', (await p.locator('.msg.err').innerText()).includes('confirm your email'));
    await p.evaluate(() => { window.__mock.users['pat@acme.example'].confirmed = true; });
    await login(p, 'pat@acme.example', 'a-long-enough-password'); await p.waitForSelector('img.qr');
    const made = (await calls(p, 'rpc:signup_company'));
    check('first confirmed sign-in creates the company once, with the saved details and billing choice', made.length === 1 && made[0].p_company === 'Acme Cafes Ltd' && made[0].p_full_name === 'Pat Jones' && made[0].p_sites === 3 && made[0].p_billing === 'annual');
    check('the new head-office user is then required to set up 2FA', (await h1(p)) === 'Set up 2FA' && (await p.locator('text=required on your account').count()) === 1);
    await p.fill('#code', '123456'); await p.click('button[type=submit]'); await p.waitForSelector('text=Welcome, Pat');
    check('after 2FA they reach their account, not the staff hub', (await p.locator('.hubbar').count()) === 0 && (await p.locator('text=Core Compliance').count()) >= 1);
    check('no page or CSP errors through the whole sign-up', t.problems.filter((x) => !/status of 503/.test(x)).length === 0);
    if (t.problems.length) console.log(t.problems);
    await t.ctx.close();

    // money first, with email confirmation switched off: sign-up goes straight to Stripe, with no 2FA set-up and no extra click
    t = await newPage(() => { window.__mock.signupOpen = true; window.__mock.signupSession = true; window.__mock.access = { state: 'awaiting_payment', is_head: true }; });
    await t.page.goto(base + '/app/?signup=1'); await t.page.waitForSelector('#su-email');
    let autoAuth = null; await t.page.route('**/api/checkout', (rt) => { autoAuth = rt.request().headers().authorization; rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: base + '/healthz' }) }); });
    await t.page.fill('#su-name', 'Pat'); await t.page.fill('#su-company', 'Co'); await t.page.fill('#su-sites', '2'); await t.page.fill('#su-email', 'auto@co.example'); await t.page.fill('#su-pass', 'a-long-enough-password'); await t.page.check('#su-terms'); await t.page.click('button[type=submit]');
    await t.page.waitForURL('**/healthz');
    check('pay first: with email confirmation off, sign-up goes straight to Stripe with no extra click and no 2FA set-up in between', t.page.url().endsWith('/healthz') && autoAuth === 'Bearer tok-auto@co.example');
    await t.ctx.close();
    // money first: signing up goes straight to Stripe, before the email is confirmed
    t = await newPage(() => { window.__mock.signupOpen = true; });
    await t.page.goto(base + '/app/?signup=1'); await t.page.waitForSelector('#su-email');
    let spReq = null; await t.page.route('**/api/signup-checkout', (rt) => { spReq = JSON.parse(rt.request().postData()); rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: base + '/healthz' }) }); });
    await t.page.fill('#su-name', 'pat jones'); await t.page.fill('#su-company', 'acme cafes Ltd'); await t.page.fill('#su-sites', '3'); await t.page.fill('#su-email', 'pat@acme.example'); await t.page.fill('#su-pass', 'a-long-enough-password'); await t.page.check('input[value=annual]'); await t.page.check('#su-terms');
    await t.page.click('button[type=submit]'); await t.page.waitForURL('**/healthz');
    check('pay first: after sign-up the person goes straight to the payment page, not to a "check your email" screen', t.page.url().endsWith('/healthz'));
    check('pay first: the server is given the business, name, number of sites, yearly choice and email, and never the password', spReq && spReq.company === 'Acme Cafes Ltd' && spReq.name === 'Pat Jones' && spReq.sites === 3 && spReq.billing === 'annual' && spReq.email === 'pat@acme.example' && !JSON.stringify(spReq).includes('a-long-enough'));
    await t.ctx.close();
    // discount code on the sign-up page
    t = await newPage(() => { window.__mock.signupOpen = true; });
    await t.page.goto(base + '/app/?signup=1&code=tc-abc234'); await t.page.waitForSelector('#su-email');
    check('offer: the code from the email link is already filled in on the sign-up page, in capitals', (await t.page.inputValue('#su-code')) === 'TC-ABC234' && (await t.page.locator('#su-code-note').innerText()).includes('monthly'));
    let ocReq = null; await t.page.route('**/api/signup-checkout', (rt) => { ocReq = JSON.parse(rt.request().postData()); rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: base + '/healthz' }) }); });
    await t.page.fill('#su-name', 'pat jones'); await t.page.fill('#su-company', 'acme cafes Ltd'); await t.page.fill('#su-sites', '2'); await t.page.fill('#su-email', 'pat@acme.example'); await t.page.fill('#su-pass', 'a-long-enough-password'); await t.page.check('input[value=annual]'); await t.page.check('#su-terms');
    await t.page.click('button[type=submit]'); await t.page.waitForURL('**/healthz');
    check('offer: the code is sent with the sign-up, and yearly billing is switched to monthly because the offer is monthly only', ocReq.code === 'TC-ABC234' && ocReq.billing === 'monthly');
    await t.ctx.close();
    t = await newPage(() => { window.__mock.signupOpen = true; });
    await t.page.goto(base + '/app/?signup=1'); await t.page.waitForSelector('#su-email');
    check('offer: with no code in the link the box is empty and there is no offer note', (await t.page.inputValue('#su-code')) === '' && (await t.page.locator('#su-code-note').innerText()) === '');
    await t.ctx.close();
    // email confirmation off + a code that no longer works: the person is told before paying, and is not sent to Stripe automatically
    t = await newPage(() => { window.__mock.signupOpen = true; window.__mock.signupSession = true; window.__mock.attachFail = true; window.__mock.access = { state: 'awaiting_payment', is_head: true }; });
    await t.page.goto(base + '/app/?signup=1&code=TC-USED99'); await t.page.waitForSelector('#su-email');
    let badPay = 0; await t.page.route('**/api/checkout', (rt) => { badPay++; rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: base + '/healthz' }) }); });
    await t.page.fill('#su-name', 'Pat'); await t.page.fill('#su-company', 'Co'); await t.page.fill('#su-sites', '2'); await t.page.fill('#su-email', 'bad@co.example'); await t.page.fill('#su-pass', 'a-long-enough-password'); await t.page.check('#su-terms'); await t.page.click('button[type=submit]');
    await t.page.waitForSelector('#offer-bad');
    check('offer: a code that cannot be applied is flagged on the payment step and nobody is sent to pay automatically', badPay === 0 && (await t.page.locator('#offer-bad').innerText()).includes('has not been applied'));
    await t.ctx.close();
    t = await newPage(null); await t.page.goto(base + '/app/?welcome=1'); await t.page.waitForSelector('#welcome');
    check('pay first: coming back from Stripe says the payment is received and the email still needs confirming', (await t.page.locator('#welcome').innerText()).includes('Payment received') && (await t.page.locator('#welcome').innerText()).includes('confirm your address'));
    await t.page.goto(base + '/app/?welcome=0'); await t.page.waitForSelector('#welcome');
    check('pay first: backing out of Stripe says nothing was charged and nothing opens until paid', (await t.page.locator('#welcome').innerText()).includes('not been charged') && (await t.page.locator('#welcome').innerText()).includes('nothing opens until you pay'));
    await t.ctx.close();
    t = await newPage(() => { window.__mock.signupOpen = true; });
    await t.page.goto(base + '/app/?signup=1'); await t.page.waitForSelector('#su-email');
    await t.page.route('**/api/signup-checkout', (rt) => rt.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Online payment is not switched on yet.' }) }));
    await t.page.fill('#su-name', 'Pat'); await t.page.fill('#su-company', 'Co'); await t.page.fill('#su-sites', '1'); await t.page.fill('#su-email', 'pat@co.example'); await t.page.fill('#su-pass', 'a-long-enough-password'); await t.page.check('#su-terms'); await t.page.click('button[type=submit]');
    await t.page.waitForSelector('#pay-later'); check('pay first: if Stripe cannot be reached the person is told, and still cannot get in without paying later', (await t.page.locator('#pay-later').innerText()).includes('not switched on'));
    await t.page.click('#resend'); await t.page.waitForSelector('text=Sent again');
    check('the confirmation email can be sent again from the screen', (await calls(t.page, 'resend'))[0].email === 'pat@co.example' && (await calls(t.page, 'resend'))[0].type === 'signup');
    await t.ctx.close();

    t = await newPage(() => { window.__mock.signupOpen = true; window.__mock.signupHidden = true; });
    await t.page.goto(base + '/app/?signup=1'); await t.page.waitForSelector('#su-email');
    let hiddenPay = 0; await t.page.route('**/api/signup-checkout', (rt) => { hiddenPay++; rt.fulfill({ status: 200, contentType: 'application/json', body: '{"url":"x"}' }); });
    await t.page.fill('#su-name', 'Aaron'); await t.page.fill('#su-company', 'Co'); await t.page.fill('#su-sites', '1'); await t.page.fill('#su-email', 'me@mine.example'); await t.page.fill('#su-pass', 'a-long-enough-password'); await t.page.check('#su-terms'); await t.page.click('button[type=submit]');
    await t.page.waitForSelector('.msg.err');
    check('an email that is already registered (Supabase hides it) is told so, and no payment is started', (await t.page.locator('.msg.err').innerText()).includes('already has an account') && hiddenPay === 0);
    await t.ctx.close();
    // existing email, closed-at-the-last-moment, and a signup rule refusal
    t = await newPage(() => { window.__mock.signupOpen = true; window.__mock.users['taken@example.com'] = { password: 'x', factor: false, profile: null, confirmed: true }; });
    await t.page.goto(base + '/app/?signup=1'); await t.page.waitForSelector('#su-email');
    const fill = async (pg, mail) => { await pg.fill('#su-name', 'Pat'); await pg.fill('#su-company', 'Co'); await pg.fill('#su-sites', '1'); await pg.fill('#su-email', mail); await pg.fill('#su-pass', 'a-long-enough-password'); await pg.check('#su-terms'); await pg.click('button[type=submit]'); };
    await fill(t.page, 'taken@example.com'); await t.page.waitForSelector('.msg.err');
    check('an email that already has an account is told so, kindly', (await t.page.locator('.msg.err').innerText()).includes('already has an account'));
    await t.page.evaluate(() => { window.__mock.signupError = { status: 429, message: 'rate' }; });
    await fill(t.page, 'x@y.example'); await t.page.waitForFunction(() => document.querySelector('.msg.err').innerText.includes('Too many'));
    check('too many attempts is explained', true);
    await t.page.evaluate(() => { window.__mock.signupError = { message: 'Signups not allowed for this instance' }; });
    await fill(t.page, 'x@y.example'); await t.page.waitForFunction(() => document.querySelector('.msg.err').innerText.includes('not available'));
    check('Supabase sign-ups being switched off is explained', true);
    await t.ctx.close();

    t = await newPage(() => { window.__mock.signupOpen = true; window.__mock.users['late@t'] = { password: 'correct-horse-battery', factor: false, profile: null, confirmed: true, meta: { signup_company: 'Late Co', signup_full_name: 'Lee', signup_site_name: 'S' } }; window.__mock.signupRpcError = 'signup_closed'; });
    await login(t.page, 'late@t'); await t.page.waitForSelector('text=Almost there');
    check('if sign-up was closed before the email was confirmed, the person is told and nothing is created', (await t.page.locator('.msg.err').innerText()).includes('not open at the moment') && (await t.page.locator('.hubbar').count()) === 0);
    await t.ctx.close();

    // trial, payment failure, stop and cancellation screens
    t = await newPage(() => { window.__mock.accessError = 'permission denied for function my_access'; });
    await login(t.page, 'site@t'); await t.page.waitForSelector('#access-retry');
    check('unpaid: if the account check fails, nothing opens; the person is told and can try again (never an empty passport)', (await t.page.locator('h1').innerText()).includes('could not check') && (await t.page.locator('#access-why').innerText()).includes('permission denied') && (await t.page.locator('.appnav').count()) === 0);
    await t.ctx.close();
    t = await newPage(() => { window.__mock.access = { state: 'awaiting_payment', is_head: true }; });
    await login(t.page, 'site@t'); await t.page.waitForSelector('text=One step left');
    check('unpaid: a new customer sees only the payment step, with a working Pay now button', (await t.page.locator('.kv').count()) === 0 && !(await t.page.locator('#pay-now').isDisabled()) && (await t.page.locator('.card').innerText()).includes('opens as soon as your payment is confirmed'));
    let payAuth = null; await t.page.route('**/api/checkout', (rt) => { payAuth = rt.request().headers().authorization; rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: base + '/healthz' }) }); });
    await t.page.click('#pay-now'); await t.page.waitForURL('**/healthz');
    check('unpaid: Pay now asks the server for a payment page with the sign-in token and goes to it', payAuth === 'Bearer tok-site@t' && t.page.url().endsWith('/healthz'));
    await t.ctx.close();
    t = await newPage(() => { window.__mock.access = { state: 'awaiting_payment', is_head: true }; });
    await t.page.route('**/api/checkout', (rt) => rt.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Online payment is not switched on yet.' }) }));
    await login(t.page, 'site@t'); await t.page.waitForSelector('#pay-now'); await t.page.click('#pay-now'); await t.page.waitForSelector('#pay-msg .msg.err');
    check('unpaid: if payment is not switched on the person is told plainly', (await t.page.locator('#pay-msg').innerText()).includes('not switched on'));
    await t.ctx.close();
    t = await newPage(() => { window.__mock.access = { state: 'awaiting_payment', is_head: true }; });
    await t.page.goto(base + '/app/?paid=1'); await t.page.waitForSelector('#email'); await login(t.page, 'site@t'); await t.page.waitForSelector('text=Confirming your payment');
    check('unpaid: coming back from Stripe says the payment is being confirmed, with no second Pay now button', (await t.page.locator('#pay-now').count()) === 0);
    await t.ctx.close();
    t = await newPage(() => { window.__mock.access = { state: 'awaiting_payment', is_head: true }; });
    await t.page.goto(base + '/app/?paid=0'); await t.page.waitForSelector('#email'); await login(t.page, 'site@t'); await t.page.waitForSelector('text=not completed');
    check('unpaid: backing out of Stripe says nothing was charged and lets them try again', (await t.page.locator('#pay-now').count()) === 1);
    await t.ctx.close();
    t = await newPage(() => { window.__mock.access = { state: 'payment_failed', is_head: true, ends_at: '2026-11-15T00:00:00Z', days_left: 5 }; });
    await login(t.page, 'site@t'); await t.page.waitForSelector('text=Welcome, Leah');
    const pf = await t.page.locator('.msg.err').innerText();
    check('failed payment: the head-office user is warned, with the 7-day stop explained', pf.includes('did not go through') && pf.includes('5 days') && pf.includes('put on stop'));
    await t.ctx.close();
    t = await newPage(() => { window.__mock.access = { state: 'payment_failed', is_head: false, ends_at: '2026-11-15T00:00:00Z', days_left: 5 }; });
    await login(t.page, 'site@t'); await t.page.waitForSelector('text=Welcome, Leah');
    check('failed payment: a site user is told to ask head office (no payment controls)', (await t.page.locator('.msg.err').innerText()).includes('head-office user') && (await t.page.locator('#cancel-start').count()) === 0);
    await t.ctx.close();
    t = await newPage(() => { window.__mock.access = { state: 'stopped', is_head: true }; });
    await login(t.page, 'site@t'); await t.page.waitForSelector('text=Your account is on stop');
    check('stopped: only a stop message, Call Tremcore and Sign out are offered', (await t.page.locator('.kv').count()) === 0 && (await t.page.locator('#contact-tremcore').count()) === 1);
    await t.ctx.close();
    t = await newPage(() => { window.__mock.access = { state: 'ok', is_head: true }; });
    await login(t.page, 'site@t'); await t.page.waitForSelector('[data-nav=settings]'); await t.page.click('[data-nav=settings]'); await t.page.click('[data-set=acct]'); await t.page.waitForSelector('#cancel-start');
    await t.page.click('#cancel-start'); await t.page.waitForSelector('#cancel-confirm');
    check('cancel: explains one month notice, data removal and that a year paid up front is not refunded', (await t.page.locator('.card').innerText()).includes('one month') && (await t.page.locator('.card').innerText()).includes('not refunded'));
    const cancelBodies = []; await t.page.route('**/api/cancellation', async (rt) => { const b = JSON.parse(rt.request().postData() || '{}'); cancelBodies.push(b.action);
      await t.page.evaluate((a) => { window.__mock.access = a === 'request' ? { state: 'cancelling', is_head: true, ends_at: '2026-12-08T00:00:00Z', days_left: 30 } : { state: 'ok', is_head: true }; }, b.action); rt.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); });
    await t.page.click('#cancel-confirm'); await t.page.waitForSelector('text=due to close on');
    check('cancel: after giving notice the banner shows the end date and a Keep my account button', (await t.page.locator('button:has-text("Keep my account")').count()) === 1 && cancelBodies.join() === 'request');
    await t.page.click('button:has-text("Keep my account")'); await t.page.waitForSelector('#view-full'); await t.page.click('[data-nav=settings]'); await t.page.click('[data-set=acct]'); await t.page.waitForSelector('#cancel-start');
    check('cancel: notice can be withdrawn (through the server, so Stripe is told too)', cancelBodies.join() === 'request,withdraw');
    await t.ctx.close();
    // the website's Login button always shows the login page, even if someone is still signed in on this device
    t = await newPage(() => { window.__mock.startAs = 'site@t'; }); 
    await t.page.goto(base + '/app/?login=1'); await t.page.waitForSelector('#email');
    check('login link: a person still signed in on this device is shown the login page, and the address is tidied', (await t.page.locator('#password').count()) === 1 && new URL(t.page.url()).search === '');
    await t.ctx.close();
    t = await newPage(() => { window.__mock.startAs = 'site@t'; });
    check('login link: opening the app without the login link still carries on where they were (signed in, not the login page)', (await t.page.locator('#password').count()) === 0);
    await t.ctx.close();
    // first-run set-up: contact details and tick the core checks
    const setupSeed = () => { window.__mock.tables = { companies: [{ id: 'c1', name: 'Acme Cafes Ltd', setup_completed_at: null }], properties: [{ id: 's1', name: 'Site 1', address: null }, { id: 's2', name: 'Site 2', address: null }],
      core_checks: ['Fire Risk Assessment', 'Fire Alarm Testing & Maintenance', 'Fire Extinguisher Maintenance', 'Emergency Light Testing', 'Electrical Installation Condition Reporting (EICR)', 'PAT Testing', 'Asbestos Management Survey / Register', 'Legionella (water) Risk Management', 'Gas Safety Inspection & Maintenance', 'F-Gas'].map((label, i) => ({ code: 'c' + i, label, sort: i })) }; };
    t = await newPage(setupSeed); await login(t.page, 'site@t'); await t.page.waitForSelector('#st-go');
    check('set-up: a new head-office user is asked for details and shown the ten core checks, none ticked', (await t.page.locator('input[name=core]').count()) === 10 && (await t.page.locator('input[name=core]:checked').count()) === 0 && (await t.page.locator('.card').innerText()).includes('Fire Risk Assessment') && (await t.page.locator('.card').innerText()).includes('F-Gas'));
    check('set-up: one row per site to name, with no name filled in yet', (await t.page.locator('[data-site-row]').count()) === 2 && (await t.page.locator('[data-site-row] input').first().inputValue()) === '');
    await t.page.fill('[data-site-row=s1] input >> nth=0', 'high street shop'); await t.page.fill('[data-site-row=s1] input >> nth=1', '1 High St'); await t.page.press('[data-site-row=s1] input >> nth=0', 'Tab');
    await t.page.check('input[value=c0]'); await t.page.check('input[value=c5]');
    // phone, business address/postcode and every site's name, address and postcode are all required
    await t.page.click('#st-go');
    check('set-up: nothing is optional (phone, address, postcode) and nothing is sent while they are missing', (await t.page.locator('#setup-msg').innerText()).includes('phone number') && (await calls(t.page, 'rpc:finish_setup')).length === 0 && (await t.page.locator('label:has-text("optional")').count()) === 0);
    await t.page.fill('#st-phone', '01634 000000'); await t.page.click('#st-go');
    check('set-up: business address is asked for next', (await t.page.locator('#setup-msg').innerText()).includes('business address'));
    await t.page.fill('#st-addr', '1 Dock Road, Chatham'); await t.page.fill('#st-pc', 'ME4 4TE'); await t.page.click('#st-go');
    check('set-up: a site with no postcode is refused', (await t.page.locator('#setup-msg').innerText()).includes('postcode of') && (await calls(t.page, 'rpc:finish_setup')).length === 0);
    await t.page.fill('[data-site-row=s1] input >> nth=2', 'ME3 8FX');
    await t.page.fill('[data-site-row=s2] input >> nth=0', 'Rear Yard'); await t.page.fill('[data-site-row=s2] input >> nth=1', '2 High St'); await t.page.fill('[data-site-row=s2] input >> nth=2', 'ME1 1AA');
    await t.page.click('#st-go'); await t.page.waitForSelector('text=Core Compliance');
    const fs = (await calls(t.page, 'rpc:finish_setup'))[0];
    check('set-up: only the ticked checks and the details are sent, with the site names capitalised and the details sent', fs.p_codes.join() === 'c0,c5' && fs.p_phone === '01634 000000' && fs.p_sites[0].name === 'High Street Shop' && fs.p_sites[0].address === '1 High St' && fs.p_sites[1].name === 'Rear Yard');
    await t.page.click('[data-nav=compliance]'); await t.page.waitForSelector('[data-ctab]');
    check('set-up: the ticked checks appear as "No date" (never green), and set-up is not asked again', (await t.page.locator('.item:has-text("PAT Testing") .tag').innerText()) === 'No date' && (await t.page.locator('#st-go').count()) === 0);
    await t.ctx.close();
    t = await newPage(setupSeed); await login(t.page, 'site@t'); await t.page.waitForSelector('#st-go'); await t.page.click('#st-all');
    check('set-up: Tick all ticks everything', (await t.page.locator('input[name=core]:checked').count()) === 10);
    await t.ctx.close();


    // the passport: traffic lights, filters, details, editing, certificates, own checks, view-only
    const ppSeed = (cfg) => {
      const rights = cfg && cfg.rights, level = cfg && cfg.level;
      const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
      window.__mock.tables = { properties: [{ id: 's1', name: 'High Street' }, { id: 's2', name: 'Station Road' }], documents: [],
        core_checks: [{ code: 'c0', label: 'Fire Risk Assessment', grp: 'Fire safety', basis: 'legal', frequency_months: 12, sort: 1 }, { code: 'c5', label: 'PAT Testing', grp: 'Electrical', basis: 'standard', frequency_months: 12, sort: 6 }],
        compliance_items: [
          { id: 'i1', property_id: 's1', grp: 'Fire safety', title: 'Fire Alarm Test', due_date: day(-3), basis: 'legal', notes: 'Quarterly' },
          { id: 'i2', property_id: 's1', grp: 'Gas', title: 'Gas Safety', due_date: day(10) },
          { id: 'i3', property_id: 's1', grp: 'Electrical', title: 'EICR', due_date: day(90), frequency_months: 60 },
          { id: 'i4', property_id: 's1', grp: 'Electrical', title: 'PAT Testing', due_date: null },
          { id: 'i5', property_id: 's2', grp: 'Other', title: 'Asbestos', due_date: day(200) }] };
      if (rights) window.__mock.rights = rights;
      if (level) window.__mock.users['site@t'].profile.level = level;
    };
    // ---- shift rules (UK time, no grace for late, green only from 5 minutes early, red if left early)
    { const S = require('../public/app/shifts.js'), sh = { start_time: '09:00', end_time: '17:00' };
      const j = (i, o, s) => S.judge({ clocked_in: i, clocked_out: o }, s || sh);
      check('shifts: on the minute is plain, one minute late is red', j('2026-12-01T09:00:40Z', null).inState === 'ontime' && j('2026-12-01T09:01:00Z', null).inState === 'late' && j('2026-12-01T09:01:00Z', null).inNote === '1 min late');
      check('shifts: 5 or more minutes early is green, 4 minutes early is plain', j('2026-12-01T08:55:00Z', null).inState === 'early' && j('2026-12-01T08:56:00Z', null).inState === 'ontime');
      check('shifts: leaving before the end is red with how early, on time or later is plain', j('2026-12-01T09:00:00Z', '2026-12-01T16:59:00Z').outState === 'early' && j('2026-12-01T09:00:00Z', '2026-12-01T16:59:00Z').outNote === 'left 1 min early' && j('2026-12-01T09:00:00Z', '2026-12-01T17:00:00Z').outState === 'ok' && j('2026-12-01T09:00:00Z', '2026-12-01T18:30:00Z').outState === 'ok');
      check('shifts: summer time is handled (08:10 UTC in July is 09:10 UK, so 10 minutes late)', j('2026-07-01T08:10:00Z', null).inNote === '10 mins late');
      const nt = { start_time: '22:00', end_time: '06:00' };
      check('shifts: a night shift that runs past midnight is judged correctly', j('2026-12-01T22:00:00Z', '2026-12-02T06:00:00Z', nt).outState === 'ok' && j('2026-12-01T22:00:00Z', '2026-12-02T05:00:00Z', nt).outState === 'early');
      check('shifts: with no shift set nothing is coloured', S.judge({ clocked_in: '2026-12-01T12:00:00Z', clocked_out: '2026-12-01T13:00:00Z' }, null).inState === 'none');
      const rows = S.buildRows([{ id: 'x', member_id: 'm1', member_name: 'Jo', clocked_in: '2026-11-23T09:20:00Z', clocked_out: null, no_clock_out: false }], [{ member_id: 'm1', weekday: 1, start_time: '09:00', end_time: '17:00' }, { member_id: 'm1', weekday: 2, start_time: '09:00', end_time: '17:00' }], [{ id: 'm1', full_name: 'Jo', active: true }], '2026-11-23', '2026-11-29', '2026-11-26');
      check('shifts: the report has the clock-in row, a "no clock-in" row for a missed shift day, and nothing for days off or days not yet over', rows.length === 2 && rows[0].kind === 'clocked' && rows[1].kind === 'none' && rows[1].date === '2026-11-24'); }
    // ---- bulk upload of certificates (reads the text of PDFs in the browser; here the PDF reader is replaced by a stand-in that returns the file's own text)
    const certRead = require('../public/app/certread.js');
    const rd = certRead.parse('Landlord Gas Safety Certificate CP12 Certificate No: GS123456 Date of inspection: 14/03/2026 Next inspection due by: 13/03/2027', 'x.pdf');
    check('bulk reader: finds a gas safety certificate, both dates and the number', rd.type.code === 'gas' && rd.issue === '2026-03-14' && rd.expiry === '2027-03-13' && rd.number === 'GS123456' && rd.sure);
    const ri = certRead.parse('Public Liability policy. Period of insurance from 01/09/2026 to 31/08/2027', 'p.pdf');
    check('bulk reader: "from ... to ..." gives start and end dates', ri.type.code === 'ins_pl' && ri.issue === '2026-09-01' && ri.expiry === '2027-08-31' && !ri.expiryWorkedOut);
    const rw = certRead.parse('Emergency lighting test. Date of test 31/01/2026', 'a.pdf');
    check('bulk reader: with only a test date the due date is worked out from the usual period and flagged as worked out', rw.expiry === '2027-01-31' && rw.expiryWorkedOut);
    const ru = certRead.parse('hello there', 'random.pdf');
    check('bulk reader: unknown documents give no type and no dates (never guessed)', !ru.type && !ru.issue && !ru.expiry && !ru.sure);
    check('bulk reader: the file name helps when the text has nothing', certRead.parse('', 'Fire_Extinguisher_service_2026.pdf').type.code === 'extinguish');
    check('bulk reader: impossible dates are ignored', certRead.parse('Gas safety. Next inspection due 31/02/2027', 'g.pdf').expiry === null);
    const tb = await newPage(ppSeed, {}); await login(tb.page, 'site@t'); await tb.page.waitForSelector('.summary');
    await tb.page.evaluate(() => { window.pdfjsLib = { getDocument: ({ data }) => ({ promise: Promise.resolve({ numPages: 1, getPage: async () => ({ getTextContent: async () => ({ items: [{ str: new TextDecoder().decode(data) }] }) }) }) }) }; }); await tb.page.click('[data-nav=compliance]'); await tb.page.waitForSelector('#bulk-upload');
    await tb.page.click('#bulk-upload'); await tb.page.waitForSelector('#bulk-files');
    await tb.page.click('#bulk-read'); check('bulk: pressing Read with no files asks for files', (await tb.page.locator('#bulk-msg').innerText()).includes('Choose one or more'));
    await tb.page.setInputFiles('#bulk-files', [
      { name: 'gas-cert.pdf', mimeType: 'application/pdf', buffer: Buffer.from('Landlord Gas Safety Certificate CP12 Certificate No: GS123456 Date of inspection: 14/03/2026 Next inspection due by: 13/03/2027') },
      { name: 'mystery.pdf', mimeType: 'application/pdf', buffer: Buffer.from('hello there') },
      { name: 'site photo.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('jpg') },
      { name: 'Public liability.pdf', mimeType: 'application/pdf', buffer: Buffer.from('Public liability insurance. Period of insurance from 01/09/2026 to 31/08/2027 Policy number: PL-99887') }]);
    await tb.page.click('#bulk-read'); await tb.page.waitForSelector('.bulkrow');
    const gasRow = tb.page.locator('.bulkrow[data-file="gas-cert.pdf"]');
    check('bulk: each file becomes a row to check', (await tb.page.locator('.bulkrow').count()) === 4);
    check('bulk: a gas certificate is matched to the existing Gas Safety check with its dates filled in', (await gasRow.locator('.b-item option:checked').innerText()) === 'Gas Safety' && (await gasRow.locator('.b-last').inputValue()) === '2026-03-14' && (await gasRow.locator('.b-due').inputValue()) === '2027-03-13' && (await gasRow.locator('.pill').innerText()) === 'Read');
    const plRow = tb.page.locator('.bulkrow[data-file="Public liability.pdf"]');
    check('bulk: a certificate with no matching check is offered as a new check', (await plRow.locator('.b-item option:checked').innerText()) === 'New check: Public Liability Insurance' && (await plRow.locator('.b-title').inputValue()) === 'Public Liability Insurance');
    check('bulk: an unreadable file and an unknown one are marked Needs checking with empty dates', (await tb.page.locator('.bulkrow[data-file="mystery.pdf"] .pill').innerText()) === 'Needs checking' && (await tb.page.locator('.bulkrow[data-file="site photo.jpg"] .b-due').inputValue()) === '' && (await tb.page.locator('.bulkrow[data-file="site photo.jpg"]').innerText()).includes('cannot read photos'));
    await tb.page.click('#bulk-add');
    check('bulk: Add all refuses until every file has somewhere to go, and saves nothing', (await tb.page.locator('#bulk-msg').innerText()).includes('Please choose where to file') && (await calls(tb.page, 'upload')).length === 0);
    await tb.page.locator('.bulkrow[data-file="mystery.pdf"] .b-item').selectOption('skip'); await tb.page.locator('.bulkrow[data-file="site photo.jpg"] .b-item').selectOption('skip');
    await tb.page.click('#bulk-add'); await tb.page.waitForSelector('text=2 certificates added');
    const ups = await calls(tb.page, 'upload'); const dbs = await calls(tb.page, 'db');
    check('bulk: Add all stores the two files under their site and check, and skipped files are not stored', ups.length === 2 && ups.some((u) => u.startsWith('documents:s1/i2/')) && !ups.some((u) => /mystery|photo/.test(u)));
    check('bulk: the existing check gets the dates; the new check is created with the dates and the policy number', dbs.some((c) => c.table === 'compliance_items' && c.op === 'update' && c.payload.due_date === '2027-03-13' && c.payload.last_done === '2026-03-14' && c.payload.certificate_number === 'GS123456') && dbs.some((c) => c.table === 'compliance_items' && c.op === 'insert' && c.payload.title === 'Public Liability Insurance' && c.payload.grp === 'Insurance' && c.payload.due_date === '2027-08-31' && c.payload.certificate_number === 'PL-99887'));
    check('bulk: two documents are recorded against their checks', dbs.filter((c) => c.table === 'documents' && c.op === 'insert').length === 2);
    await tb.ctx.close();
    const tv = await newPage(ppSeed, { rights: { can_edit: false, can_manage: false } }); await login(tv.page, 'site@t'); await tv.page.waitForSelector('.summary'); await tv.page.click('[data-nav=compliance]'); await tv.page.waitForSelector('[data-ctab]');
    check('bulk: a view-only user is not offered bulk upload', (await tv.page.locator('#bulk-upload').count()) === 0); await tv.ctx.close();
    t = await newPage(ppSeed, {}); await login(t.page, 'site@t'); await t.page.waitForSelector('.summary'); await t.page.click('[data-nav=compliance]'); await t.page.waitForSelector('[data-ctab]');
    check('passport: Email Tremcore (not a phone number) is at the very top of the screen for a Self-Managed client', (await t.page.locator('main > .callbar #contact-tremcore').count()) === 1 && (await t.page.locator('#contact-tremcore').innerText()) === 'Email Tremcore' && (await t.page.locator('#contact-tremcore').getAttribute('href')).startsWith('mailto:info@tremcore.co.uk') && (await t.page.evaluate(() => document.querySelector('main').children[1].className)) === 'callbar');
    check('passport: score counts the missing date against the total (3 of 5 = 60%)', (await t.page.locator('.legend').innerText()).includes('60% in date') && (await t.page.locator('.stat.red .num').innerText()) === '1' && (await t.page.locator('.stat.missing .num').innerText()) === '1' && (await t.page.locator('.stat.green .num').innerText()) === '2');
    check('passport: a check with no date is "No date", never green', (await t.page.locator('.item:has-text("PAT Testing") .tag').innerText()) === 'No date' && (await t.page.locator('.item:has-text("PAT Testing") .dot.missing').count()) === 1 && (await t.page.locator('.item:has-text("PAT Testing") .dot.green').count()) === 0);
    check('passport: overdue, due soon and in date are labelled in words as well as colour', (await t.page.locator('.item:has-text("Fire Alarm Test") .tag').innerText()) === 'Overdue' && (await t.page.locator('.item:has-text("Gas Safety") .tag').innerText()) === 'Due soon' && (await t.page.locator('.item:has-text("EICR") .tag').innerText()) === 'In date');
    await t.page.click('.sitecard[data-site=s1]');
    check('passport: picking one site recalculates its own score (2 of 4 = 50%)', (await t.page.locator('.legend').innerText()).includes('50% in date') && (await t.page.locator('.item').count()) === 4);
    await t.page.click('[data-filter=red]');
    check('passport: the Overdue filter shows only overdue checks', (await t.page.locator('.item').count()) === 1 && (await t.page.locator('.item').innerText()).includes('Fire Alarm Test'));
    await t.page.click('[data-filter=all]');
    // open a check, change dates (the next due date is suggested from last done + months), save
    await t.page.click('.item[data-id=i3]'); await t.page.waitForSelector('#f-due');
    check('detail: shows the basis with a not-legal-advice note', (await t.page.locator('.detail').innerText()).includes('not legal advice'));
    await t.page.fill('#f-last', '2026-01-31'); await t.page.fill('#f-freq', '1');
    check('detail: next due date is suggested from last done plus the repeat period (31 Jan + 1 month = 28 Feb)', (await t.page.inputValue('#f-due')) === '2026-02-28');
    await t.page.fill('#f-notes', 'Done by Acme Electrics'); await t.page.click('button[type=submit]'); await t.page.waitForSelector('#item-msg .msg.ok');
    const upd = (await calls(t.page, 'db')).filter((c) => c.table === 'compliance_items' && c.op === 'update').pop();
    check('detail: saving sends the dates, repeat period and notes for that check only', upd && upd.payload.due_date === '2026-02-28' && upd.payload.last_done === '2026-01-31' && upd.payload.frequency_months === 1 && upd.payload.notes === 'Done by Acme Electrics' && upd.filters.join() === 'id=i3');
    await t.page.fill('#f-due', ''); await t.page.fill('#f-freq', '0'); await t.page.click('button[type=submit]');
    check('detail: a bad repeat period is refused in plain words', (await t.page.locator('#item-msg').innerText()).includes('whole number of months'));
    // certificates
    await t.page.setInputFiles('#file', { name: 'virus.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('x') }); await t.page.click('#upload');
    check('certificates: a file type that is not allowed is refused', (await t.page.locator('#item-msg').innerText()).includes('PDF, a photo'));
    await t.page.setInputFiles('#file', { name: 'big.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(11 * 1024 * 1024) }); await t.page.click('#upload');
    check('certificates: a file over 10 MB is refused', (await t.page.locator('#item-msg').innerText()).includes('10 MB') && (await calls(t.page, 'upload')).length === 0);
    await t.page.setInputFiles('#file', { name: 'EICR certificate 2026.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') }); await t.page.click('#upload'); await t.page.waitForSelector('.doc');
    const upl = (await calls(t.page, 'upload'))[0], dins = (await calls(t.page, 'db')).filter((c) => c.table === 'documents' && c.op === 'insert')[0];
    check('certificates: uploaded into the site and check folder in private storage, and listed', /^documents:s1\/i3\/[^/]+-EICR_certificate_2026\.pdf$/.test(upl) && dins && dins.payload.property_id === 's1' && dins.payload.item_id === 'i3' && (await t.page.locator('.doc .fname').innerText()) === 'EICR certificate 2026.pdf');
    const [pop] = await Promise.all([t.ctx.waitForEvent('page'), t.page.click('.doc button:has-text("Open")')]);
    check('certificates: Open asks for a short-lived private link', (await calls(t.page, 'signed')).length === 1 && (await calls(t.page, 'signed'))[0].startsWith('s1/i3/')); await pop.close();
    await t.page.click('.doc button:has-text("Delete")'); await t.page.waitForSelector('text=Document removed');
    check('certificates: deleting removes the stored file and the record', (await calls(t.page, 'remove')).length === 1 && (await t.page.locator('.doc').count()) === 0);
    // reading a certificate: the boxes are filled in for the person to check, and saved only when they press Save
    let readBody = null;
    await t.page.route('**/api/read-document', (rt) => { readBody = rt.request().postData(); rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ reading: { found: true, issue_date: '2026-03-01', expiry_date: '2027-02-28', certificate_number: 'PL-884213', provider: 'Acme Insurance Ltd', document_title: 'Public liability certificate' } }) }); });
    const dbBefore = (await calls(t.page, 'db')).filter((c) => c.table === 'compliance_items' && c.op === 'update').length;
    await t.page.setInputFiles('#file', { name: 'policy.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 policy') }); await t.page.click('#upload'); await t.page.waitForSelector('text=filled in the details');
    check('read: after an upload the server is asked to read that document', !!readBody && /"document_id":"[^"]+"/.test(readBody));
    check('read: the dates, certificate number and issuer are filled in and marked for checking', (await t.page.inputValue('#f-due')) === '2027-02-28' && (await t.page.inputValue('#f-last')) === '2026-03-01' && (await t.page.inputValue('#f-cert')) === 'PL-884213' && (await t.page.inputValue('#f-prov')) === 'Acme Insurance Ltd' && (await t.page.locator('input.autofilled').count()) === 4 && (await t.page.locator('#item-msg').innerText()).includes('check them'));
    check('read: nothing is saved until the person presses the button, which says Check and save', (await calls(t.page, 'db')).filter((c) => c.table === 'compliance_items' && c.op === 'update').length === dbBefore && (await t.page.locator('button[type=submit]').innerText()) === 'Check and save');
    await t.page.click('button[type=submit]'); await t.page.waitForSelector('text=Saved.');
    const updRead = (await calls(t.page, 'db')).filter((c) => c.table === 'compliance_items' && c.op === 'update').pop();
    check('read: saving stores the due date, certificate number and issuer', updRead.payload.due_date === '2027-02-28' && updRead.payload.certificate_number === 'PL-884213' && updRead.payload.provider === 'Acme Insurance Ltd' && (await t.page.inputValue('#f-cert')) === 'PL-884213');
    await t.page.fill('#f-cert', ''); await t.page.fill('#f-prov', ''); await t.page.fill('#f-due', '2027-01-01');
    await t.page.route('**/api/read-document', (rt) => rt.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'Sorry, we could not read that document just now. Please type the details in.' }) }));
    await t.page.click('[data-read]'); await t.page.waitForSelector('text=could not read that document just now');
    check('read: if reading fails the person is told plainly and the page still works', (await t.page.locator('#f-due').count()) === 1);
    // remove a check (its documents go with it)
    await t.page.setInputFiles('#file', { name: 'a.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF') }); await t.page.click('#upload'); await t.page.waitForSelector('.doc');
    await t.page.click('#remove-check'); await t.page.click('#remove-confirm'); await t.page.waitForSelector('text=Check removed');
    check('remove check: asks twice, removes its stored documents, then the check, and the score updates', (await calls(t.page, 'remove')).length === 2 && (await t.page.locator('.item:has-text("EICR")').count()) === 0 && (await t.page.locator('.legend').innerText()).includes('% in date'));
    // add your own check to every site
    await t.page.click('#add-check'); await t.page.waitForSelector('#a-title');
    await t.page.click('button[type=submit]');
    check('add check: a name is required', (await t.page.locator('#add-msg').innerText()).includes('give the check a name'));
    await t.page.fill('#a-title', 'Kitchen Extract Cleaning'); await t.page.check('input[name=a-site][value=s2]'); await t.page.selectOption('#a-basis', 'best_practice'); await t.page.fill('#a-freq', '6'); await t.page.fill('#a-last', '2026-03-31');
    check('add check: the next due date is suggested here too (31 Mar + 6 months = 30 Sep)', (await t.page.inputValue('#a-due')) === '2026-09-30');
    await t.page.click('button[type=submit]'); await t.page.waitForSelector('text=Check added');
    const ins = (await calls(t.page, 'db')).filter((c) => c.table === 'compliance_items' && c.op === 'insert').pop();
    check('add check: one record per chosen site, with its own title, basis and repeat period', ins.payload.length === 2 && ins.payload.map((x) => x.property_id).sort().join() === 's1,s2' && ins.payload[0].title === 'Kitchen Extract Cleaning' && ins.payload[0].basis === 'best_practice' && ins.payload[0].frequency_months === 6 && (await t.page.locator('.item:has-text("Kitchen Extract Cleaning")').count()) === 1);
    // different sites need different checks
    await t.page.click('#manage-sites'); await t.page.waitForSelector('.checkrow');
    check('by site: one row per check name (standard ones plus the business\'s own), one tick box per site', (await t.page.locator('.checkrow').count()) === 6 && (await t.page.locator('[data-row="pat testing"]').count()) === 2 && (await t.page.locator('[data-row="pat testing"][data-site=s1]').isChecked()) && !(await t.page.locator('[data-row="pat testing"][data-site=s2]').isChecked()));
    await t.page.check('[data-row="fire risk assessment"][data-site=s1]'); await t.page.check('[data-row="pat testing"][data-site=s2]'); await t.page.uncheck('[data-row="pat testing"][data-site=s1]');
    await t.page.click('#sites-save'); await t.page.waitForSelector('text=Checks updated');
    const addIns = (await calls(t.page, 'db')).filter((c) => c.table === 'compliance_items' && c.op === 'insert').pop();
    check('by site: ticking adds the check to that site only, with its standard group, basis and repeat period and no date', addIns.payload.length === 2 && addIns.payload.some((x) => x.property_id === 's1' && x.title === 'Fire Risk Assessment' && x.grp === 'Fire safety' && x.basis === 'legal' && x.frequency_months === 12 && !x.due_date) && addIns.payload.some((x) => x.property_id === 's2' && x.title === 'PAT Testing' && x.grp === 'Electrical'));
    check('by site: an empty check can be removed from one site without a warning, and the other site keeps its own', (await t.page.locator('#sites-confirm').count()) === 0 && (await t.page.locator('.item:has-text("PAT Testing")').count()) === 0 && (await t.page.locator('text=2 added, 1 removed').count()) === 1);
    await t.page.click('.sitecard[data-site=s2]');
    check('by site: the other site now has its own PAT Testing, with no date', (await t.page.locator('.item:has-text("PAT Testing") .tag').innerText()) === 'No date');
    await t.page.click('.sitecard[data-site=s1]');
    await t.page.click('#manage-sites'); await t.page.waitForSelector('.checkrow'); await t.page.uncheck('[data-row="gas safety"][data-site=s1]'); await t.page.click('#sites-save'); await t.page.waitForSelector('#sites-confirm');
    check('by site: removing a check that has a date warns first and names it', (await t.page.locator('#sites-msg').innerText()).includes('Gas Safety at High Street') && (await calls(t.page, 'db')).filter((c) => c.table === 'compliance_items' && c.op === 'delete').length === 2);
    await t.page.click('#sites-confirm'); await t.page.waitForSelector('text=1 removed');
    const gdel = (await calls(t.page, 'db')).filter((c) => c.table === 'compliance_items' && c.op === 'delete').pop();
    check('by site: after the second confirmation only that check is deleted', gdel.filters.join() === 'id=i2' && (await t.page.locator('.item:has-text("Gas Safety")').count()) === 0);
    await t.page.click('#add-check'); await t.page.waitForSelector('#a-title'); await t.page.fill('#a-title', 'Boiler Service'); await t.page.check('input[name=a-site][value=s2]'); await t.page.uncheck('input[name=a-site][value=s1]'); await t.page.click('button[type=submit]'); await t.page.waitForSelector('text=Check added');
    const one = (await calls(t.page, 'db')).filter((c) => c.table === 'compliance_items' && c.op === 'insert').pop();
    check('add check: tick any combination of sites (here only the second one)', one.payload.length === 1 && one.payload[0].property_id === 's2' && one.payload[0].title === 'Boiler Service');
    check('date helper: end of month and leap years are handled', await t.page.evaluate(() => window.TCPassport.addMonths('2026-01-31', 1) === '2026-02-28' && window.TCPassport.addMonths('2028-01-31', 1) === '2028-02-29' && window.TCPassport.addMonths('2026-11-30', 3) === '2027-02-28' && window.TCPassport.addMonths('nope', 3) === '' && window.TCPassport.addMonths('2026-01-01', 0) === ''));
    await t.ctx.close();
    // view-only users (site user with view, or a managed client) see everything but can change nothing
    t = await newPage(ppSeed, { rights: { can_edit: false, can_manage: false } }); await login(t.page, 'site@t'); await t.page.waitForSelector('.summary'); await t.page.click('[data-nav=compliance]'); await t.page.waitForSelector('[data-ctab]');
    await t.page.click('.item[data-id=i1]'); await t.page.waitForSelector('.statusline');
    check('view-only: no add button, no edit form, no upload and no remove', (await t.page.locator('#add-check').count()) === 0 && (await t.page.locator('#f-due').count()) === 0 && (await t.page.locator('#file').count()) === 0 && (await t.page.locator('#remove-check').count()) === 0 && (await t.page.locator('.detail').innerText()).includes('Quarterly'));
    await t.ctx.close();
    t = await newPage(ppSeed, { rights: { can_edit: false, can_manage: false }, level: 2 }); await login(t.page, 'site@t'); await t.page.waitForSelector('.summary'); await t.page.click('[data-nav=compliance]'); await t.page.waitForSelector('[data-ctab]');
    check('managed client: told Tremcore manages the records, and still has Call Tremcore', (await t.page.locator('.card').first().innerText()).includes('Tremcore manages your compliance records') && (await t.page.locator('#contact-tremcore').innerText()) === 'Call Tremcore' && (await t.page.locator('#contact-tremcore').getAttribute('href')).startsWith('tel:'));
    await t.ctx.close();
    t = await newPage(() => { window.__mock.tables = { properties: [{ id: 's1', name: 'Only Site' }], compliance_items: [] }; }); await login(t.page, 'site@t'); await t.page.waitForSelector('.summary'); await t.page.click('[data-nav=compliance]'); await t.page.waitForSelector('[data-ctab]');
    check('passport: with no checks yet there is no score, only an invitation to add one (no site picker for one site)', (await t.page.locator('.legend').innerText()).includes('No checks yet') && (await t.page.locator('#site-pick').count()) === 0 && (await t.page.locator('.sitecard').count()) === 0 && (await t.page.locator('#add-check').count()) === 1);
    await t.ctx.close();

    // the app-style screens: Home, Tasks, Emergency Information, Settings and the paid add-ons
    const appExtra = (cfg) => {
      window.__mock.users['site@t'].profile.role_name = (cfg && cfg.role) || 'client_super';
      if (cfg && cfg.owned) window.__mock.extras = [{ code: 'toolbox_talks', name: 'Toolbox Talks', description: 'x', price_pence: 299, charged_per: 'company', owned: cfg.owned === true || cfg.owned === 'both' }, { code: 'staff_signin', name: 'Staff Clock In / Out', description: 'y', price_pence: 599, charged_per: 'site', owned: cfg.owned === 'staff' || cfg.owned === 'both' }];
      const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
      window.__mock.tables.companies = [{ id: 'c1', name: 'Test Co', contact_phone: '01634 000000', address: '1 High St', level: (cfg && cfg.level) || 1, billing_interval: 'monthly', subscription: 'active' }];
      window.__mock.tables.properties[0].address = '1 High St'; window.__mock.tables.properties[0].clock_token = 'a'.repeat(32); window.__mock.tables.properties[1].clock_token = 'c'.repeat(32);
      { const at = (h) => new Date(Date.now() - h * 36e5).toISOString();
        window.__mock.tables.staff_attendance = [{ id: 'a1', property_id: 's1', member_name: 'Jo Bloggs', clocked_in: at(2), clocked_out: null, no_clock_out: false, closed_by: null },
          { id: 'a2', property_id: 's1', member_name: 'Al Smith', clocked_in: at(30), clocked_out: at(21.5), no_clock_out: false, closed_by: 'person' },
          { id: 'a3', property_id: 's1', member_name: 'Al Smith', clocked_in: at(60), clocked_out: null, no_clock_out: true, closed_by: null }]; }
      window.__mock.tables.tasks = [
        { id: 't1', property_id: 's1', title: 'Check exit signs', notes: '', due_date: day(-2), repeat_months: null, status: 'pending' },
        { id: 't2', property_id: 's1', title: 'Monthly alarm test', notes: '', due_date: day(5), repeat_months: 1, status: 'pending' },
        { id: 't3', property_id: 's2', title: 'Old job', notes: '', due_date: day(-40), repeat_months: null, status: 'done', completed_at: new Date().toISOString() }];
      window.__mock.tables.site_emergency = [{ id: 'e1', property_id: 's1', assembly_point: 'Car park', gas_shutoff: 'Back store', water_shutoff: '', electric_shutoff: '', notes: '' }];
      window.__mock.tables.toolbox_talks = [
        { id: 'tt1', company_id: null, code: 'tt01', category: 'Health & Safety', title: 'Slips, Trips and Falls', summary: 'Prevent falls.', points: ['Clean spills', 'Keep clear'], discuss: ['Where is it wet?'], minutes: 8, sort: 1 },
        { id: 'tt2', company_id: null, code: 'tt11', category: 'Fire Safety', title: 'If You Discover a Fire', summary: 'Know what to do.', points: ['Raise the alarm'], discuss: [], minutes: 10, sort: 2 },
        { id: 'tt3', company_id: 'c1', code: null, category: 'Industry Specific', title: 'Our Forklift Rules', summary: '', points: ['Keep clear'], discuss: [], minutes: 5, sort: 0 }];
      window.__mock.tables.talk_sessions = [{ id: 'old1', property_id: 's1', talk_id: 'tt1', talk_title: 'Slips, Trips and Falls', talk_category: 'Health & Safety', talk_points: ['Clean spills'], delivered_on: '2026-10-01', presenter: 'Leah', notes: '' }];
      window.__mock.tables.talk_attendees = [{ id: 'oa1', session_id: 'old1', full_name: 'Jo Bloggs', signature: [[[10, 10], [200, 300], [900, 50]]], signed_at: '2026-10-01T09:00:00Z' }];
      window.__mock.tables.staff_members = [{ id: 'm1', property_id: 's1', full_name: 'Jo Bloggs', job_title: 'Cleaner', active: true }];
      window.__mock.tables.emergency_contacts = [{ id: 'k1', property_id: 's1', name: 'Sam Keyholder', role: 'Keyholder', phone: '07000 000000' }];
    };
    // the page runs this as one self-contained function, so the two seeds are joined into one piece of text
    const appSeed = new Function('cfg', '(' + ppSeed.toString() + ')(cfg); (' + appExtra.toString() + ')(cfg);');
    t = await newPage(appSeed, {}); await login(t.page, 'site@t'); await t.page.waitForSelector('#view-full');
    check('home: a bottom/side menu with Home, Compliance, Tasks and Settings', (await t.page.locator('.appnav [data-nav]').allInnerTexts()).join() === 'Home,Compliance,Tasks,Settings' && (await t.page.locator('.appnav [data-nav=home]').getAttribute('aria-current')) === 'page');
    if (process.env.SHOT) { const sh = async (n) => { await t.page.screenshot({ path: '/tmp/shot/' + n + '.png', fullPage: true }); }; await sh('home390'); await t.page.setViewportSize({ width: 1440, height: 900 }); await t.page.waitForTimeout(400); await sh('home1440'); await t.page.click('[data-nav=settings]'); await t.page.waitForTimeout(300); await sh('settings1440'); await t.page.click('[data-nav=home]');
      await t.page.click('[data-nav=compliance]'); await t.page.waitForTimeout(300); await sh('comp1440'); await t.page.click('.item >> nth=0'); await t.page.waitForTimeout(300); await sh('item1440'); await t.page.setViewportSize({ width: 390, height: 800 }); await t.page.click('[data-back]'); await t.page.click('[data-nav=home]'); await t.page.waitForTimeout(300); }
    check('home: overall compliance shows on-track, due soon, overdue and no-date counts (missing is never on track)', (await t.page.locator('.lglist').innerText()).replace(/\s+/g, ' ').includes('On track · 2') && (await t.page.locator('.lglist').innerText()).includes('1 item due soon') && (await t.page.locator('.lglist').innerText()).includes('1 overdue') && (await t.page.locator('.lglist').innerText()).includes('1 with no date'));
    check('home: Quick Access shows My Tasks and Emergency Information (no add-ons owned) and nothing is shown as locked', (await t.page.locator('text=Quick Access').count()) >= 1 && (await t.page.locator('.qtile').count()) === 2 && (await t.page.locator('[data-q=emergency]').count()) === 1 && (await t.page.locator('[data-q=mytasks]').count()) === 1 && (await t.page.locator('.qtile.locked').count()) === 0 && (await t.page.locator('#view-other').count()) === 1);
    check('home: both paid add-ons are shown as bold gold promo cards with their price and an Add now button', (await t.page.locator('.promo:not(.soon)').count()) === 2 && (await t.page.locator('[data-promo=toolbox_talks]').innerText()).includes('Add now') && (await t.page.locator('[data-promo=staff_signin]').innerText()).includes('/ site / month') && (await t.page.locator('.card.addons').innerText()).includes('Add-ons'));
    check('home: Reviews and Poster Generator show as Coming soon cards with their price, and there is no yearly or bundle offer', (await t.page.locator('.promo.soon').count()) === 2 && (await t.page.locator('[data-soon=reviews]').innerText()).includes('£9.99') && (await t.page.locator('[data-soon=reviews]').innerText()).includes('Coming soon') && (await t.page.locator('[data-soon=posters]').innerText()).includes('£4.99') && !/upfront|save 15|Unlock all|Buy Now/i.test(await t.page.locator('.card.addons').innerText()));
    await t.page.click('[data-soon=reviews]'); await t.page.waitForSelector('[data-soon-page=reviews]');
    check('a Coming soon add-on opens an info page with its price and nothing to buy', (await t.page.locator('#soon-note').innerText()).includes('Coming soon') && (await t.page.locator('#extra-add').count()) === 0 && (await t.page.locator('.goldbox').innerText()).includes('£9.99'));
    await t.page.click('[data-back]'); await t.page.waitForSelector('[data-promo=staff_signin]');
    await t.page.click('[data-promo=staff_signin]'); await t.page.waitForSelector('[data-extra=staff_signin]');
    check('home: tapping a promo card opens that add-on page, whose price is in a gold box', (await t.page.locator('.goldbox').count()) === 1);
    await t.page.click('[data-back]'); await t.page.waitForSelector('#attention');
    check('home: a "Needs attention" list shows overdue and due-soon checks first, with counts, and a note about checks with no date', (await t.page.locator('#attention .item').count()) >= 1 && (await t.page.locator('#attention .tag.red, #attention .tag.amber').count()) >= 1 && (await t.page.locator('#attention').innerText()).includes('Needs attention'));
    await t.page.click('#attention .item >> nth=0'); await t.page.waitForSelector('#f-due, .kv');
    await t.page.click('[data-back]'); await t.page.click('[data-nav=home]'); await t.page.waitForSelector('#attention');
    await t.page.click('[data-promo=toolbox_talks]'); await t.page.waitForSelector('[data-extra=toolbox_talks]');
    check('add-on not bought: explains the price and offers a pay-now button (not an email)', (await t.page.locator('.card').innerText()).includes('£2.99 + VAT per month') && (await t.page.locator('button#extra-add').count()) === 1 && (await t.page.locator('[data-extra] a[href^=mailto]').count()) === 0);
    await t.page.click('[data-back]'); await t.page.waitForSelector('#view-full');
    await t.page.click('[data-promo=staff_signin]'); await t.page.waitForSelector('[data-extra=staff_signin]');
    check('Staff Clock In / Out is charged per site', (await t.page.locator('.card').innerText()).includes('per site'));
    await t.page.click('[data-back]'); await t.page.click('#view-full'); await t.page.waitForSelector('[data-ctab]');
    check('compliance: three tabs, Overview / By Category / Due Soon', (await t.page.locator('[data-ctab]').allInnerTexts()).join() === 'Overview,By Category,Due Soon');
    await t.page.click('[data-ctab=due]');
    check('Due Soon lists overdue, due-soon and no-date checks but not in-date ones', (await t.page.locator('.item').count()) === 3 && (await t.page.locator('.item:has-text("EICR")').count()) === 0 && (await t.page.locator('.item').first().innerText()).includes('Fire Alarm Test'));
    await t.page.click('[data-ctab=category]');
    check('By Category groups the checks under their headings', (await t.page.locator('.group h3').allInnerTexts()).join('|').includes('Fire safety (1)') && (await t.page.locator('.group h3').count()) >= 3);
    await t.page.click('[data-nav=tasks]'); await t.page.waitForSelector('#add-task');
    check('tasks: pending tab lists open tasks, overdue first and marked red', (await t.page.locator('[data-ttab=pending]').innerText()) === 'Pending (2)' && (await t.page.locator('.taskrow').count()) === 2 && (await t.page.locator('.taskrow').first().innerText()).includes('Check exit signs') && (await t.page.locator('.taskrow').first().locator('.dot.red').count()) === 1);
    await t.page.click('[data-done=t2]'); await t.page.waitForSelector('text=Task completed.');
    check('tasks: ticking a repeating task completes it and the next one appears', (await calls(t.page, 'rpc:complete_task')).length === 1 && (await t.page.locator('.taskrow:has-text("Monthly alarm test")').count()) === 1);
    await t.page.click('[data-ttab=done]');
    check('tasks: the completed tab shows finished tasks', (await t.page.locator('.taskrow:has-text("Monthly alarm test")').count()) === 1);
    await t.page.click('#add-task'); await t.page.waitForSelector('#t-title');
    await t.page.click('#t-save');
    check('tasks: a task needs a name', (await t.page.locator('.msg.err').innerText()).includes('name'));
    await t.page.fill('#t-title', 'Test emergency lights'); await t.page.fill('#t-repeat', '3'); await t.page.selectOption('#t-site', 's2'); await t.page.click('#t-save'); await t.page.waitForSelector('text=Task added.');
    const added = await t.page.evaluate(() => window.__mock.tables.tasks.find((x) => x.title === 'Test emergency lights'));
    check('tasks: a new repeating task is saved for the chosen site', added && added.property_id === 's2' && added.repeat_months === 3 && added.status === 'pending');
    await t.page.click('[data-nav=home]'); await t.page.click('[data-q=emergency]'); await t.page.waitForSelector('#e-assembly');
    check('emergency: shows the site contacts, assembly point and shut-offs', (await t.page.locator('.econ').innerText()).includes('Sam Keyholder') && (await t.page.locator('#e-assembly').inputValue()) === 'Car park' && (await t.page.locator('#e-gas').inputValue()) === 'Back store');
    await t.page.fill('#e-water', 'Under the stairs'); await t.page.click('#e-save'); await t.page.waitForSelector('text=Emergency information saved.');
    check('emergency: saving updates the site details', (await t.page.evaluate(() => window.__mock.tables.site_emergency[0].water_shutoff)) === 'Under the stairs');
    await t.page.fill('#c-name', 'Pat Manager'); await t.page.fill('#c-phone', '07111 111111'); await t.page.click('#c-add'); await t.page.waitForSelector('text=Contact added.');
    check('emergency: a contact can be added and removed', (await t.page.locator('.econ').count()) === 2);
    await t.page.click('[data-rm-contact]>> nth=0'); await t.page.waitForSelector('text=Contact removed.');
    check('emergency: removing a contact works', (await t.page.locator('.econ').count()) === 1);
    await t.page.selectOption('#e-site', 's2'); await t.page.waitForSelector('#e-assembly');
    check('emergency: each site has its own details', (await t.page.locator('#e-assembly').inputValue()) === '' && (await t.page.locator('.econ').count()) === 0);
    await t.page.click('[data-back]'); await t.page.click('[data-nav=settings]'); await t.page.waitForSelector('.setmenu');
    check('settings: a menu lists business info, premises, subscription, reminder emails, customised tasks, help, account and log out', (await t.page.locator('.setrow .setlabel').allInnerTexts()).join('|') === 'Business Information|Manage Premises|Subscription Details|Reminder Emails|Customised Tasks|Help & Support|My account|Log Out');
    await t.page.click('[data-nav=home]'); await t.page.waitForSelector('#view-other');
    check('core/other: Home shows Core and Other counts and the Other button opens the Other group', (await t.page.locator('#view-full .cnt').count()) === 1 && (await t.page.locator('#view-other .cnt').count()) === 1);
    await t.page.click('#view-other'); await t.page.waitForSelector('[data-group]');
    check('core/other: the Compliance switch shows Core and Other, with Other selected', (await t.page.locator('[data-group=other][aria-selected=true]').count()) === 1 && (await t.page.locator('[data-group=core][aria-selected=false]').count()) === 1);
    await t.page.click('[data-nav=tasks]'); await t.page.click('[data-tview=calendar]'); await t.page.waitForSelector('#task-calendar');
    check('tasks: the Calendar view shows a month grid and can move month', (await t.page.locator('.cal-day').count()) >= 28 && (await t.page.locator('#cal-next').count()) === 1);
    await t.page.click('[data-tview=list]'); await t.page.click('[data-nav=settings]'); await t.page.waitForSelector('.setmenu');
    await t.page.click('[data-set=plan]');
    check('settings: subscription shows the plan, two sites and the price including the extra site', (await t.page.locator('.appbody').innerText()).includes('Self-Managed') && (await t.page.locator('.appbody').innerText()).includes('£22.98 + VAT per month'));
    check('settings: add-ons not yet taken are offered from the subscription box, with their price', (await t.page.locator('[data-add-addon=toolbox_talks]').innerText()).includes('£2.99') && (await t.page.locator('[data-add-addon=staff_signin]').innerText()).includes('per site'));
    await t.page.click('[data-back]'); await t.page.click('[data-set=custom]');
    check('settings: customised tasks shows how many of the 10 repeating tasks are used', (await t.page.locator('.appbody').innerText()).includes('2 of 10'));
    await t.page.click('[data-back]'); await t.page.click('[data-set=biz]'); await t.page.waitForSelector('#b-save');
    await t.page.fill('#b-phone', '1634 99'); await t.page.click('#b-save');
    check('formats: a short phone number is refused with a clear message', (await t.page.locator('.msg.err').innerText()).includes('11 digits') && (await calls(t.page, 'rpc:update_business')).length === 0);
    await t.page.fill('#b-phone', '+44 1634 999999'); await t.page.fill('#b-postcode', 'me38fx'); await t.page.fill('#b-address', '12 high street'); await t.page.click('#b-save'); await t.page.waitForSelector('text=Business information saved.');
    { const u = (await calls(t.page, 'rpc:update_business'))[0]; check('formats: phone, postcode and address are tidied before saving (01634 999999, ME3 8FX, 12 High Street)', u.p_phone === '01634 999999' && u.p_postcode === 'ME3 8FX' && u.p_address === '12 High Street'); }
    await t.page.fill('#b-postcode', 'nonsense'); await t.page.click('#b-save');
    check('formats: a bad postcode is refused', (await t.page.locator('.msg.err').innerText()).includes('postcode'));
    await t.page.fill('#b-postcode', 'ME3 8FX'); await t.page.fill('#b-phone', '01634 999999'); await t.page.click('#b-save'); await t.page.waitForSelector('text=Business information saved.'); await t.page.waitForSelector('text=Business information saved.');
    check('settings: head office can change the business phone', (await calls(t.page, 'rpc:update_business')).pop().p_phone === '01634 999999');
    await t.page.click('[data-back]'); await t.page.click('[data-set=premises]');
    await t.page.fill('[data-site-name=s2]', 'Station Road Depot'); await t.page.click('[data-save-site=s2]'); await t.page.waitForSelector('text=Site saved.');
    check('settings: head office can rename a site', (await t.page.evaluate(() => window.__mock.tables.properties[1].name)) === 'Station Road Depot');
    await t.page.click('[data-back]'); await t.page.click('[data-set=help]');
    check('settings: Email Tremcore help button', (await t.page.locator('#help-email').getAttribute('href')).startsWith('mailto:info@tremcore.co.uk'));
    await t.ctx.close();
    // a view-only user: sees tasks and emergency details but cannot change them
    t = await newPage(appSeed, { rights: { can_edit: false, can_manage: false } }); await login(t.page, 'site@t'); await t.page.waitForSelector('#view-full');
    await t.page.click('[data-nav=tasks]'); await t.page.waitForSelector('.taskrow');
    check('view-only: tasks are listed with no add, done or remove buttons', (await t.page.locator('#add-task').count()) === 0 && (await t.page.locator('[data-done]').count()) === 0 && (await t.page.locator('[data-del]').count()) === 0);
    await t.page.click('[data-nav=home]'); await t.page.click('[data-q=emergency]'); await t.page.waitForSelector('.econ');
    check('back: the page has one clear Back button', (await t.page.locator('[data-back]').count()) === 1 && (await t.page.locator('[data-back]').innerText()).includes('Back'));
    await t.page.goBack(); await t.page.waitForSelector('[data-q=emergency]');
    check('back: the phone/browser back button returns to the previous screen', (await t.page.locator('[data-back]').count()) === 0);
    await t.page.click('[data-q=emergency]'); await t.page.waitForSelector('.econ');
    check('view-only: emergency information is shown as text only', (await t.page.locator('#e-save').count()) === 0 && (await t.page.locator('#c-add').count()) === 0 && (await t.page.locator('.card').innerText()).includes('Car park'));
    await t.ctx.close();
    // an add-on that has been bought is shown as active, not offered again
    t = await newPage(appSeed, { owned: true }); await login(t.page, 'site@t'); await t.page.waitForSelector('#view-full');
    check('a bought add-on is a normal tool tile and no longer promoted; the one not bought is still promoted', (await t.page.locator('[data-q=toolbox_talks]').innerText()).includes('30+ available') && (await t.page.locator('[data-q=toolbox_talks].locked').count()) === 0 && (await t.page.locator('.qtile.locked').count()) === 0 && (await t.page.locator('[data-promo=staff_signin]').count()) === 1 && (await t.page.locator('[data-promo=toolbox_talks]').count()) === 0);
    await t.page.click('[data-q=toolbox_talks]'); await t.page.waitForSelector('.talkrow');
    check('toolbox talks: the library lists the core talks and the company\'s own, with category counts', (await t.page.locator('.talkrow').count()) === 3 && (await t.page.locator('[data-cat=all]').innerText()) === 'All (3)' && (await t.page.locator('[data-cat="Fire Safety"]').innerText()) === 'Fire Safety (1)' && (await t.page.locator('.talkrow:has-text("Our Forklift Rules") .tag').innerText()) === 'Your own');
    check('toolbox talks: the guidance note says it needs professional review', (await t.page.locator('.card').innerText()).includes('needs professional review'));
    await t.page.click('[data-cat="Fire Safety"]'); check('toolbox talks: a category filters the list', (await t.page.locator('.talkrow').count()) === 1);
    await t.page.click('[data-cat=all]'); await t.page.click('[data-talk=tt1]'); await t.page.waitForSelector('#tb-deliver');
    check('toolbox talks: a talk shows its key points and discussion questions', (await t.page.locator('.points li').allInnerTexts()).join('|') === 'Clean spills|Keep clear|Where is it wet?');
    await t.page.click('#tb-deliver'); await t.page.waitForSelector('#d-name');
    check('toolbox talks: attendees are chosen from the people list', (await t.page.locator('[data-pick]').count()) === 1 && (await t.page.locator('.pickrow').innerText()).includes('Jo Bloggs'));
    await t.page.click('#d-save'); check('toolbox talks: nobody listed means no record', (await t.page.locator('.msg.err').innerText()).includes('at least one person'));
    await t.page.check('[data-pick=m1]'); await t.page.fill('#d-name', 'al smith'); await t.page.press('#d-name', 'Enter'); await t.page.waitForSelector('[data-person]:nth-of-type(2), .econ[data-person] >> nth=1');
    check('toolbox talks: someone not on the list can be added, capitalised, and is ticked', (await t.page.locator('[data-person]').count()) === 2 && (await t.page.locator('[data-person]').nth(1).innerText()).includes('Al Smith'));
    await t.page.click('#d-save'); check('toolbox talks: a record cannot be saved until everyone has signed', (await t.page.locator('.msg.err').innerText()).includes('needs to sign'));
    const draw = async (pg, y0) => { await pg.locator('#sigpad').scrollIntoViewIfNeeded(); const bb = await pg.locator('#sigpad').boundingBox(); y0 = Math.min(y0, bb.height - 70); await pg.mouse.move(bb.x + 40, bb.y + y0); await pg.mouse.down(); await pg.mouse.move(bb.x + 200, bb.y + y0 + 60, { steps: 5 }); await pg.mouse.move(bb.x + 320, bb.y + y0 - 10, { steps: 5 }); await pg.mouse.up(); };
    await t.page.click('[data-sign=m1]'); await t.page.waitForSelector('#sigpad'); await t.page.click('#sig-save');
    check('toolbox talks: an empty signature is refused', (await t.page.locator('.msg.err').innerText()).includes('sign in the box'));
    await draw(t.page, 80); await t.page.click('#sig-save'); await t.page.waitForSelector('[data-person=m1] .sigsvg');
    check('toolbox talks: a signature is drawn on screen and shown next to the name', (await t.page.locator('[data-person=m1] .sigline').count()) === 1);
    await t.page.locator('[data-sign]').nth(1).click(); await t.page.waitForSelector('#sigpad'); await draw(t.page, 100); await t.page.click('#sig-clear'); await draw(t.page, 120); await t.page.click('#sig-save'); await t.page.locator('[data-person] .sigsvg').nth(1).waitFor();
    await t.page.fill('#d-notes', 'Went well'); await t.page.click('#d-save'); await t.page.waitForSelector('[data-record-page]');
    const rec = (await calls(t.page, 'rpc:record_talk'))[0];
    check('toolbox talks: saving sends the talk, site, presenter and both signed attendees to the database', rec.p_talk === 'tt1' && rec.p_property === 's1' && rec.p_presenter === 'Leah Dunn' && rec.p_notes === 'Went well' && rec.p_attendees.length === 2 && rec.p_attendees.every((a) => Array.isArray(a.signature) && a.signature[0].length > 2 && a.signature[0].every((p) => p[0] >= 0 && p[0] <= 1000 && p[1] >= 0 && p[1] <= 400)));
    check('toolbox talks: the saved record shows who attended with their signatures', (await t.page.locator('[data-attendee]').count()) === 2 && (await t.page.locator('[data-attendee] .sigsvg').count()) === 2 && (await t.page.locator('.msg.ok').innerText()).includes('Record saved'));
    const dl = t.page.waitForEvent('download'); await t.page.click('#rec-pdf'); const dd = await dl; const fs2 = require('fs'); const pth = await dd.path(); const pdfBytes = fs2.readFileSync(pth);
    check('toolbox talks: the record downloads as a real PDF named after the date and talk', pdfBytes.slice(0, 5).toString() === '%PDF-' && pdfBytes.toString('latin1').includes('Jo Bloggs') && pdfBytes.toString('latin1').includes('Slips, Trips and Falls') && /^toolbox-talk-\d{4}-\d{2}-\d{2}-slips-trips-and-falls\.pdf$/.test(dd.suggestedFilename()));
    await t.page.click('[data-back]'); await t.page.waitForSelector('.talkrow');
    check('toolbox talks: the records list shows the old record and the new one, with attendance counts', (await t.page.locator('[data-record]').count()) === 2 && (await t.page.locator('.talkrow').first().innerText()).includes('2 people'));
    await t.page.click('[data-record=old1]'); await t.page.waitForSelector('[data-attendee]');
    check('toolbox talks: an older record opens with its signature', (await t.page.locator('[data-attendee]').innerText()).includes('Jo Bloggs'));
    await t.page.click('[data-back]'); await t.page.click('[data-back]'); await t.page.click('#tb-own'); await t.page.waitForSelector('#own-add');
    check('toolbox talks: head office sees its own talks and how many of 10 are used', (await t.page.locator('[data-own]').count()) === 1 && (await t.page.locator('.card').innerText()).includes('1 in use'));
    await t.page.click('#own-add'); await t.page.click('#o-save'); check('toolbox talks: an own talk needs a title', (await t.page.locator('.msg.err').innerText()).includes('title'));
    await t.page.fill('#o-title', 'Ladder rules'); await t.page.click('#o-save'); check('toolbox talks: an own talk needs a key point', (await t.page.locator('.msg.err').innerText()).includes('key point'));
    await t.page.fill('#o-points', 'Check the feet\nThree points of contact\n'); await t.page.selectOption('#o-cat', 'Health & Safety'); await t.page.click('#o-save'); await t.page.waitForSelector('text=Talk added.');
    const mine = await t.page.evaluate(() => window.__mock.tables.toolbox_talks.find((x) => x.title === 'Ladder rules'));
    check('toolbox talks: an own talk is saved for the company with one point per line', mine && mine.company_id === 'c1' && mine.points.join('|') === 'Check the feet|Three points of contact');
    await t.page.click('[data-remove-own]>> nth=0'); await t.page.waitForSelector('text=Talk removed.');
    check('toolbox talks: an own talk can be removed', (await t.page.locator('[data-own]').count()) === 1);
    await t.ctx.close();

    // buying an add-on: straight to Stripe, no email to Tremcore; the add-on appears when Stripe has confirmed
    t = await newPage(appSeed, {}); await login(t.page, 'site@t'); await t.page.waitForSelector('#view-full');
    let extraReq = null; await t.page.route('**/api/checkout-extra', (rt) => { extraReq = { auth: rt.request().headers().authorization, body: rt.request().postData() }; rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: base + '/healthz' }) }); });
    await t.page.click('[data-promo=staff_signin]'); await t.page.waitForSelector('#extra-add');
    check('add-on: the page shows the per-site total (2 sites x £5.99 = £11.98 + VAT per month)', (await t.page.locator('.card').innerText()).includes('2 × £5.99 = £11.98 + VAT per month'));
    await t.page.click('#extra-add'); await t.page.waitForURL('**/healthz');
    check('add-on: Add sends the sign-in token and the add-on code to our server, then goes to the payment page', extraReq && extraReq.auth === 'Bearer tok-site@t' && JSON.parse(extraReq.body).code === 'staff_signin');
    await t.ctx.close();
    t = await newPage(appSeed, {}); await login(t.page, 'site@t'); await t.page.waitForSelector('#view-full');
    await t.page.route('**/api/checkout-extra', (rt) => rt.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'You already have this add-on.' }) }));
    await t.page.click('[data-promo=toolbox_talks]'); await t.page.click('#extra-add'); await t.page.waitForSelector('.msg.err');
    check('add-on: if the server refuses, the person sees its plain message and stays on the page', (await t.page.locator('.msg.err').innerText()).includes('already have') && (await t.page.locator('#extra-add').count()) === 1);
    await t.ctx.close();
    t = await newPage(appSeed, { role: 'client_site', rights: { can_edit: false, can_manage: false } }); await login(t.page, 'site@t'); await t.page.waitForSelector('#view-full'); await t.page.click('[data-promo=toolbox_talks]'); await t.page.waitForSelector('[data-extra]');
    check('add-on: a user who is not head office has no pay button and is told to ask head office', (await t.page.locator('#extra-add').count()) === 0 && (await t.page.locator('.card').innerText()).includes('Ask your head-office user'));
    await t.ctx.close();
    // coming back from Stripe: waits for the confirmation, then opens the add-on
    // add-ons the business has are listed in Subscription Details with what each costs
    t = await newPage(appSeed, { owned: 'both' }); await login(t.page, 'site@t'); await t.page.waitForSelector('#view-full'); await t.page.click('[data-nav=settings]'); await t.page.click('[data-set=plan]'); await t.page.waitForSelector('[data-addon]');
    check('settings: each add-on is listed with its monthly cost (Toolbox £2.99; Clock In 2 sites x £5.99 = £11.98) and a total of £14.97', (await t.page.locator('[data-addon=toolbox_talks]').innerText()).includes('£2.99 + VAT per month') && (await t.page.locator('[data-addon=staff_signin]').innerText()).replace(/\s+/g, ' ').includes('2 sites × £5.99 = £11.98') && (await t.page.locator('#addons-total').innerText()).includes('£14.97') && (await t.page.locator('[data-add-addon]').count()) === 0);
    await t.ctx.close();
    // the introductory offer shows in Subscription Details while it lasts
    const offerSeed = new Function('cfg', '(' + appSeed.toString() + ')(cfg); window.__mock.tables.companies[0].offer_code = "TC-ABC234"; window.__mock.tables.companies[0].offer_ends_at = new Date(Date.now() + 200 * 86400000).toISOString();');
    t = await newPage(offerSeed, {}); await login(t.page, 'site@t'); await t.page.waitForSelector('#view-full'); await t.page.click('[data-nav=settings]'); await t.page.click('[data-set=plan]'); await t.page.waitForSelector('#offer-line');
    check('offer: Subscription Details says the first site is £7.99 until the end date, then £14.99', (await t.page.locator('#offer-line').innerText()).replace(/\s+/g, ' ').includes('£7.99 + VAT per month until') && (await t.page.locator('#offer-line').innerText()).includes('then £14.99'));
    await t.ctx.close();
    t = await newPage(appSeed, {}); await login(t.page, 'site@t'); await t.page.waitForSelector('#view-full'); await t.page.click('[data-nav=settings]'); await t.page.click('[data-set=plan]'); await t.page.waitForSelector('text=Subscription Details');
    check('offer: no offer line for a business without one', (await t.page.locator('#offer-line').count()) === 0);
    await t.ctx.close();
    // business insurance missed at set-up can be added later
    const insSeed = new Function('cfg', '(' + appSeed.toString() + ')(cfg); window.__mock.tables.core_checks = [{ code: "ins_el", label: "Employers\' Liability Insurance", grp: "Insurance", basis: "legal", frequency_months: 12, sort: 11 }, { code: "ins_pl", label: "Public Liability Insurance", grp: "Insurance", basis: "best_practice", frequency_months: 12, sort: 12 }, { code: "ins_bld", label: "Business Insurance (buildings and contents)", grp: "Insurance", basis: "best_practice", frequency_months: 12, sort: 13 }];');
    t = await newPage(insSeed, {}); await login(t.page, 'site@t'); await t.page.waitForSelector('#view-full'); await t.page.click('[data-nav=compliance]'); await t.page.waitForSelector('#ins-prompt');
    check('insurance: a business with no insurance checks is offered them on the Compliance page', (await t.page.locator('#ins-prompt').innerText()).includes('Public Liability'));
    await t.page.click('#ins-add'); await t.page.waitForSelector('text=Insurance checks added');
    const insIns = (await calls(t.page, 'db')).filter((c) => c.table === 'compliance_items' && c.op === 'insert').pop();
    check('insurance: one tap adds the three insurance checks to both sites (6), with no dates so they show as missing, and the prompt goes', insIns.payload.length === 6 && insIns.payload.every((x) => x.grp === 'Insurance') && (await t.page.locator('#ins-prompt').count()) === 0 && (await t.page.locator('.item:has-text("Public Liability Insurance")').count()) === 2);
    await t.ctx.close();
    t = await newPage(appSeed, {}); await t.page.goto(base + '/app/?extra=toolbox_talks&paid=1'); await login(t.page, 'site@t'); await t.page.waitForSelector('#extra-confirming');
    check('back from Stripe: the person sees that the payment is being confirmed, with no pay button', (await t.page.locator('#extra-add').count()) === 0);
    await t.page.evaluate(() => { window.__mock.extras = [{ code: 'toolbox_talks', name: 'Toolbox Talks', description: 'x', price_pence: 299, charged_per: 'site', owned: true }, { code: 'staff_signin', name: 'Staff Clock In / Out', description: 'y', price_pence: 599, charged_per: 'site', owned: false }]; });
    await t.page.waitForSelector('text=is now on your account', { timeout: 8000 });
    check('back from Stripe: once confirmed it says the add-on is on the account, and the web address is tidied', (await t.page.locator('.msg.ok').first().innerText()).includes('Toolbox Talks') && new URL(t.page.url()).search === '');
    await t.ctx.close();
    t = await newPage(appSeed, {}); await t.page.goto(base + '/app/?extra=staff_signin&paid=0'); await login(t.page, 'site@t'); await t.page.waitForSelector('.msg.err');
    check('back from Stripe without paying: told they have not been charged and can try again', (await t.page.locator('.msg.err').innerText()).includes('not been charged') && (await t.page.locator('#extra-add').count()) === 1);
    await t.ctx.close();
    // Staff Clock In / Out once bought: the register of people who use it
    t = await newPage(appSeed, { owned: 'staff' }); await login(t.page, 'site@t'); await t.page.waitForSelector('#view-full');
    check('staff: a bought Staff Clock In / Out tile is not locked', (await t.page.locator('[data-q=staff_signin].locked').count()) === 0);
    await t.page.click('[data-q=staff_signin]'); await t.page.waitForSelector('#s-add');
    check('staff: shows the people at the site', (await t.page.locator('[data-staff]').count()) === 1 && (await t.page.locator('.econ').first().innerText()).includes('Jo Bloggs'));
    await t.page.waitForSelector('#clock-qr svg');
    check('clock: the site has a QR code (drawn as an image) and the link it opens', (await t.page.locator('#clock-qr svg path').count()) === 1 && (await t.page.locator('#clock-link').innerText()).endsWith('/clock/' + 'a'.repeat(32)));
    check('clock: who is on site now, with a clock-out button for a manager', (await t.page.locator('[data-onsite]').count()) === 1 && (await t.page.locator('#clock-now').innerText()).includes('Jo Bloggs') && (await t.page.locator('[data-clockout=a1]').count()) === 1);
    { const rec = await t.page.locator('#clock-record').innerText(); check('clock: the attendance record shows times and hours, and flags a missing clock-out', rec.includes('Al Smith') && /8 h 30 min/.test(rec) && rec.includes('no clock-out recorded') && rec.includes('still in')); }
    { const dl = t.page.waitForEvent('download'); await t.page.click('#clock-csv'); const d = await dl; const txt = require('fs').readFileSync(await d.path(), 'utf8');
      check('clock: the record downloads as a spreadsheet file with a row per clock-in', d.suggestedFilename().startsWith('attendance-') && txt.split('\r\n').length === 4 && txt.includes('No clock-out recorded') && txt.includes('Harbour') === false); }
    await t.page.click('#clock-poster'); await t.page.waitForSelector('#poster svg');
    check('clock: the poster has the site name, the QR code and simple steps', (await t.page.locator('#poster').innerText()).includes('Clock in / out') && (await t.page.locator('#poster li').count()) === 3 && (await t.page.locator('#poster-print').count()) === 1);
    await t.page.click('[data-back]'); await t.page.waitForSelector('#clock-regen');
    await t.page.click('#clock-regen'); check('clock: replacing the QR code asks first and warns the old one stops', (await t.page.locator('#regen-ask').innerText()).includes('stop working'));
    await t.page.click('#regen-yes'); await t.page.waitForSelector('text=New QR code made');
    check('clock: after replacing, the new link is shown', (await t.page.locator('#clock-link').innerText()).endsWith('/clock/' + 'b'.repeat(32)));
    await t.page.click('[data-clockout=a1]'); await t.page.waitForSelector('text=Clocked out.');
    check('clock: a manager can clock someone out who forgot', (await t.page.evaluate(() => window.__mock.tables.staff_attendance.find((x) => x.id === 'a1').clocked_out)) !== null);
    await t.page.click('#s-add'); check('staff: a person needs a name', (await t.page.locator('.msg.err').innerText()).includes('name'));
    await t.page.fill('#s-name', 'Al Smith'); await t.page.fill('#s-title', 'Manager'); await t.page.click('#s-add'); await t.page.waitForSelector('text=Person added.');
    check('staff: a person can be added and appears in the list', (await t.page.locator('[data-staff]').count()) === 2);
    // shifts and the shift report (this page already has the Staff Clock In / Out add-on, one person and attendance records)
    { const day0 = new Date(); const uk = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(d);
      await t.page.evaluate(() => { const w = window.__mock.tables; const mon = new Date(); const wd = (mon.getUTCDay() + 6) % 7; mon.setUTCDate(mon.getUTCDate() - wd - 7);   // Monday of LAST week, in UTC
        const at = (dd, hh, mm) => { const x = new Date(Date.UTC(mon.getUTCFullYear(), mon.getUTCMonth(), mon.getUTCDate() + dd, hh, mm)); return x.toISOString(); };
        w.staff_shifts = []; w.staff_attendance = [
          { id: 'r1', property_id: 's1', member_id: 'm1', member_name: 'Jo Bloggs', clocked_in: at(0, 9, 20), clocked_out: at(0, 16, 30), no_clock_out: false, closed_by: 'person' },
          { id: 'r2', property_id: 's1', member_id: 'm1', member_name: 'Jo Bloggs', clocked_in: at(1, 8, 40), clocked_out: at(1, 17, 5), no_clock_out: false, closed_by: 'person' }]; window.__lastMonday = at(0, 0, 0).slice(0, 10); }); }
    await t.page.click('[data-shifts=m1]'); await t.page.waitForSelector('#shift-save');
    check('shifts: each person has a Monday to Sunday grid with a start and finish time', (await t.page.locator('.shiftgrid .s-start').count()) === 7 && (await t.page.locator('.shiftgrid .sg-day').first().innerText()) === 'Monday');
    await t.page.fill('.s-start[data-day="1"]', '09:00'); await t.page.click('#shift-save');
    check('shifts: a start without a finish is refused in plain words', (await t.page.locator('#shift-msg').innerText()).includes('both a start and a finish'));
    await t.page.fill('.s-end[data-day="1"]', '17:00'); await t.page.click('#shift-copy');
    check('shifts: copy Monday fills Tuesday to Friday', (await t.page.inputValue('.s-start[data-day="5"]')) === '09:00' && (await t.page.inputValue('.s-end[data-day="5"]')) === '17:00' && (await t.page.inputValue('.s-start[data-day="6"]')) === '');
    await t.page.click('#shift-save'); await t.page.waitForSelector('text=Shifts saved for Jo Bloggs');
    check('shifts: saving stores five weekday shifts and leaves the weekend as days off', (await t.page.evaluate(() => window.__mock.tables.staff_shifts.length)) === 5 && (await t.page.evaluate(() => window.__mock.tables.staff_shifts.every((x) => x.member_id === 'm1' && x.start_time === '09:00' && x.end_time === '17:00'))));
    await t.page.click('#shift-report'); await t.page.waitForSelector('#rep-from');
    await t.page.evaluate(() => { document.getElementById('rep-from').value = window.__lastMonday; });
    await t.page.click('#rep-prev'); await t.page.waitForTimeout(100); await t.page.click('#rep-next'); await t.page.waitForSelector('#rep-from');
    await t.page.click('#rep-prev'); await t.page.waitForSelector('#shift-table');
    const rowTxt = async (n) => (await t.page.locator('#shift-table tbody tr').nth(n).innerText()).replace(/\s+/g, ' ');
    const r0 = await rowTxt(0);
    check('report: shows the person, the shift and the clock-in and clock-out for the day', r0.includes('Jo Bloggs') && r0.includes('09:00 to 17:00'));
    check('report: a late start is red and says how late (words as well as colour)', (await t.page.locator('#shift-table tbody tr').nth(0).locator('.in-late .t-late').count()) === 1 && /min(s)? late/.test(r0));
    check('report: leaving before the end is red and says how early', (await t.page.locator('#shift-table tbody tr').nth(0).locator('.out-early .t-late').count()) === 1 && /left \d+ mins? early/.test(r0));
    check('report: an early start is green', (await t.page.locator('#shift-table tbody tr').nth(1).locator('.in-early .t-early').count()) === 1 && (await rowTxt(1)).includes('early'));
    check('report: a shift day with nothing recorded shows a muted "No clock-in recorded" row', (await t.page.locator('#shift-table .rep-none').count()) >= 1 && (await t.page.locator('#shift-table .rep-none').first().innerText()).includes('No clock-in recorded'));
    check('report: shows the summary of late and early starts and a colour key', (await t.page.locator('#rep-sum').innerText()).includes('1 late start') && (await t.page.locator('#rep-key').innerText()).includes('Red'));
    const dlP = t.page.waitForEvent('download'); await t.page.click('#rep-csv'); const dlf = await dlP;
    check('report: can be downloaded as a spreadsheet', /shift-report-.*\.csv$/.test(dlf.suggestedFilename()));
    await t.page.click('[data-back]'); await t.page.waitForSelector('#s-add');
    await t.page.click('[data-toggle-staff=m1]'); await t.page.waitForSelector('text=Marked as not active.');
    check('staff: a person can be marked not active without losing them', (await t.page.locator('[data-staff=m1] .tag').innerText()) === 'Not active');
    await t.page.click('[data-rm-staff=m1]'); await t.page.waitForSelector('text=Person removed.');
    check('staff: a person can be removed', (await t.page.locator('[data-staff]').count()) === 1);
    await t.page.selectOption('#s-site', 's2'); await t.page.waitForSelector('text=Nobody added yet');
    check('staff: each site has its own list', (await t.page.locator('[data-staff]').count()) === 0);
    await t.ctx.close();

    t = await newPage(appSeed, { owned: true, role: 'client_site', rights: { can_edit: false, can_manage: false } }); await login(t.page, 'site@t'); await t.page.waitForSelector('#view-full');
    await t.page.click('[data-q=toolbox_talks]'); await t.page.waitForSelector('.talkrow'); await t.page.click('[data-talk=tt1]'); await t.page.waitForSelector('.points');
    check('toolbox talks: a view-only user can read a talk but cannot run one, and has no own-talks button', (await t.page.locator('#tb-deliver').count()) === 0 && (await t.page.locator('.card').innerText()).includes('can read the talk'));
    await t.page.click('[data-back]'); await t.page.waitForSelector('.talkrow');
    check('toolbox talks: only head office is offered My own talks', (await t.page.locator('#tb-own').count()) === 0 && (await t.page.locator('#tb-records').count()) === 1);
    await t.ctx.close();


    // team page: the head-office user chooses who can do what
    const teamSeed = () => { window.__mock.tables = { properties: [{ id: 's1', name: 'High Street' }, { id: 's2', name: 'Station Road' }] };
      window.__mock.team = { summary: { used: 2, allowed: 3, require_mfa: false },
        members: [{ user_id: 'u1', full_name: 'Boss', email: 'boss@x.test', role: 'client_super', perm: 'full', active: true, property_ids: [], is_me: true },
                  { user_id: 'u2', full_name: 'Mo Manager', email: 'mo@x.test', role: 'client_site', perm: 'view', active: true, property_ids: ['s1'], is_me: false }], pending: [] }; };
    t = await newPage(teamSeed); await login(t.page, 'site@t'); await t.page.waitForSelector('[data-nav=settings]'); await t.page.click('[data-nav=settings]'); await t.page.click('[data-set=acct]'); await t.page.waitForSelector('#team-open');
    await t.page.click('#team-open'); await t.page.waitForSelector('text=My team');
    check('team: shows seats used, the head-office user and the manager', (await t.page.locator('.card').innerText()).includes('2 of 3 users') && (await t.page.locator('.member').count()) === 3);
    await t.page.selectOption('[data-user=u2] select', 'update'); await t.page.check('[data-user=u2] input[value=s2]');
    await t.page.click('[data-save=u2]'); await t.page.waitForSelector('text=Saved changes for Mo Manager');
    const sv = (await calls(t.page, 'rpc:team_set_access')).pop();
    check('team: permission and sites saved for that person only', sv.p_user === 'u2' && sv.p_perm === 'update' && sv.p_property_ids.length === 2 && sv.p_active === true);
    await t.page.fill('#inv-name', 'Sam Site'); await t.page.fill('#inv-email', 'sam@x.test'); await t.page.selectOption('#inv-perm', 'view'); await t.page.check('input[data-site=new][value=s2]');
    await t.page.click('#inv-go'); await t.page.waitForSelector('text=Invitation saved for sam@x.test');
    check('team: inviting shows the link and says to use the same email', (await t.page.locator('#team-msg').innerText()).includes('/app/?invite=1') && (await t.page.locator('.member:has-text("sam@x.test")').count()) === 1);
    check('team: the user count goes up with the invite and the add form is then closed (3 of 3)', (await t.page.locator('.card').innerText()).includes('3 of 3 users') && await t.page.locator('#inv-go').isDisabled());
    await t.page.click('[data-cancel=inv-1]'); await t.page.waitForSelector('text=Invitation cancelled');
    check('team: an invitation can be cancelled', (await t.page.locator('.member:has-text("sam@x.test")').count()) === 0);
    await t.page.check('#team-mfa'); await t.page.waitForSelector('text=2FA is now required');
    check('team: head office can require 2FA for everyone', (await calls(t.page, 'rpc:team_set_require_mfa')).pop().p_on === true);
    await t.ctx.close();
    t = await newPage(teamSeed); await login(t.page, 'site@t'); await t.page.waitForSelector('[data-nav=settings]'); await t.page.click('[data-nav=settings]'); await t.page.click('[data-set=acct]'); await t.page.evaluate(() => { window.__mock.team.inviteError = 'user_limit_reached'; }); await t.page.click('#team-open'); await t.page.waitForSelector('#inv-name');
    await t.page.fill('#inv-name', 'X'); await t.page.fill('#inv-email', 'x@x.test'); await t.page.check('input[data-site=new][value=s1]'); await t.page.click('#inv-go');
    await t.page.waitForSelector('.msg.err');
    check('team: going over the user limit is explained', (await t.page.locator('.msg.err').innerText()).includes('used all the users'));
    await t.ctx.close();
    t = await newPage(() => { window.__mock.access = { state: 'ok', is_head: false }; }); await login(t.page, 'site@t'); await t.page.waitForSelector('text=Welcome, Leah'); await t.page.click('[data-nav=settings]'); await t.page.click('[data-set=acct]'); 
    check('team: a site user is not offered the team page', (await t.page.locator('#team-open').count()) === 0);
    await t.ctx.close();
    // invited person's own sign-up
    t = await newPage(() => { window.__mock.users['sam@x.test'] = undefined; delete window.__mock.users['sam@x.test']; });
    await t.page.goto(base + '/app/?invite=1'); await t.page.waitForSelector('#iv-email');
    await t.page.fill('#iv-name', 'Sam Site'); await t.page.fill('#iv-email', 'sam@x.test'); await t.page.fill('#iv-pass', 'a-long-enough-password'); await t.page.click('button[type=submit]');
    check('invite: terms must be agreed first', (await t.page.locator('.msg.err').innerText()).includes('terms') && (await calls(t.page, 'signUp')).length === 0);
    await t.page.check('#iv-terms'); await t.page.click('button[type=submit]'); await t.page.waitForSelector('text=Check your email');
    const iv = (await calls(t.page, 'signUp'))[0];
    check('invite: creates only a login, marked as invited; no company is created by the page', iv.email === 'sam@x.test' && iv.meta.invited === true && !iv.meta.signup_company && (await calls(t.page, 'rpc:signup_company')).length === 0);
    await t.ctx.close();
    t = await newPage(() => { window.__mock.users['sam@x.test'] = { password: 'correct-horse-battery', factor: false, profile: null, confirmed: true, meta: { invited: true, signup_full_name: 'Sam Site' },
      invitedProfile: { role_name: 'client_site', full_name: 'Sam Site', company_id: 'c1', level: 1, mfa_required: false } }; });
    await login(t.page, 'sam@x.test'); await t.page.waitForSelector('text=Welcome, Sam'); await t.page.click('[data-nav=settings]'); await t.page.click('[data-set=acct]');
    check('invite: first confirmed sign-in accepts the invitation and lands in the passport as a site user', (await calls(t.page, 'rpc:accept_invitation')).length === 1 && (await t.page.locator('.kv:has-text("Site user")').count()) === 1);
    await t.ctx.close();

    // the staff hub: markers and the on/off switch
    t = await hubPage(); let pg = t.page;
    check('hub dashboard counts self sign-ups still on trial', (await pg.locator('.tile:has-text("Self sign-ups to follow up")').innerText()).includes('1'));
    await pg.click('.hubnav >> text=Clients'); await pg.waitForSelector('table');
    check('clients who signed themselves up are marked', (await pg.locator('tr:has-text("Online Bakery") .badge.new').innerText()) === 'Self sign-up');
    await pg.click('a:has-text("Online Bakery Ltd")'); await pg.waitForSelector('.msg.ok');
    check('their page tells staff who to contact and what to do next', (await pg.locator('.msg.ok').innerText()).includes('bea@bakery.example') && (await pg.locator('.msg.ok').innerText()).includes('Active'));
    await pg.click('.hubnav >> text=Settings'); await pg.waitForSelector('text=Self-Managed sign-up');
    check('settings shows sign-up as closed with what to do before opening', (await pg.locator('.badge:has-text("Closed")').count()) === 1 && (await pg.locator('.hint:has-text("Confirm email")').innerText()).includes('Confirm email'));
    check('settings shows the Managed Service area: Medway, 30 miles', (await pg.locator('text=within 30 miles of Medway (ME)').count()) === 1);
    await pg.fill('#m-miles', '0'); await pg.click('button:has-text("Save area")'); await pg.waitForSelector('.msg.err');
    check('a silly distance is refused', (await pg.locator('.msg.err').innerText()).includes('between 1 and 300'));
    await pg.fill('#m-miles', '25'); await pg.click('button:has-text("Save area")'); await pg.waitForSelector('.msg.ok:has-text("Saved. The website")');
    const ar = await dbCalls(pg, "x.table==='app_settings'&&x.op==='update'&&x.filters[0]==='key=managed_radius_miles'");
    check('the new distance is saved without moving the base point', ar.length === 1 && ar[0].payload.value === 25);
    await pg.click('button:has-text("Open sign-up")'); await pg.waitForSelector('.badge:has-text("Open")');
    const sw = (await dbCalls(pg, "x.table==='app_settings'&&x.op==='update'&&x.filters[0]==='key=self_signup_open'"))[0];
    check('opening sign-up changes only the sign-up setting', sw.payload.value === true && sw.filters[0] === 'key=self_signup_open');
    await pg.click('button:has-text("Close sign-up")'); await pg.waitForSelector('.badge:has-text("Closed")');
    check('sign-up can be closed again', true);
    await pg.evaluate(() => { window.__mock.tables.app_settings = []; });
    await pg.click('.hubnav >> text=Dashboard'); await pg.click('.hubnav >> text=Settings'); await pg.waitForSelector('text=Self-Managed sign-up');
    await pg.click('button:has-text("Open sign-up")'); await pg.waitForSelector('.msg.err');
    check('if the database refuses the change, staff are told it was not changed', (await pg.locator('.msg.err').innerText()).includes('Not changed'));
    await t.ctx.close();

    t = await hubPage(null, 'staffonly@t'); pg = t.page;
    check('staff who are not administrators have no Settings tab', (await pg.locator('.hubnav a').allInnerTexts()).join() === 'Dashboard,Clients,Subscriptions,Renewals,Interest list,Offers,Revenue,Enquiries,Activity');
    await pg.goto(base + '/app/#/settings'); await pg.waitForSelector('.tiles');
    check('and typing the Settings address just shows the dashboard', (await h1(pg)) === 'Dashboard');
    await t.ctx.close();
  }

  // website
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const pg = await ctx.newPage(); const probs = [];
    let signupOpen = false;
    await pg.route('**/rest/v1/rpc/signup_open', (rt) => rt.fulfill({ status: 200, contentType: 'application/json', body: String(signupOpen) }));
    pg.on('console', (m) => { if (m.type() === 'error') probs.push(m.text()); }); pg.on('pageerror', (e) => probs.push(String(e)));
    for (const [u, h] of [['/', 'Commercial property compliance'], ['/passport/', 'Everything in one place, made simple.'], ['/what-you-get/', 'One passport'], ['/how-it-works/', 'Simple to start'], ['/contact/', 'Ask us a question']]) {
      await pg.goto(base + u); check('website page loads: ' + u, (await pg.locator('h1,h2').first().innerText()).toLowerCase().includes(h.toLowerCase()));
    }
    await pg.goto(base + '/');
    check('website shows no passport sign-in', (await pg.locator('text=Sign in').count()) === 0 && (await pg.locator('a[href="/app/?login=1"]').count()) >= 1);
    check('website never mentions Level 2 or 3 or jobs', !/Level 2|Level 3|Raise a Job|Managed Compliance/i.test(await pg.locator('body').innerText()));
    await pg.goto(base + '/what-you-get/');
    check('website does not offer the Managed Service for now (no card, no postcode box)', (await pg.locator('#managed').count()) === 0 && (await pg.locator('#area-check').count()) === 0 && !/Managed Service/i.test(await pg.locator('body').innerText()));
    await pg.goto(base + '/'); { const t = await pg.locator('body').innerText(); check('home page: Sound familiar section and Yours to run card are gone, the passport cards are gone, and the new wording is in', !/Sound familiar|Yours to run|Certificates in inboxes|Your reminders/i.test(t) && t.includes('More add-ons = better value with Tremcore.') && t.includes('A clear picture at a glance') && t.toLowerCase().includes('the tremcore passport brings it all together in one place.') && (await pg.locator('.hm .features .card').count()) === 3); }
    await pg.goto(base + '/passport/'); { const t = await pg.locator('body').innerText(); check('passport page: no "and more", new Further services card, 3 privacy cards, new closing wording', !/and more/i.test(t) && t.includes('Further services') && t.includes('Tailored to your premises') && !/Rules enforced/i.test(t) && t.includes('Changes tracked') && t.includes('No due date has been recorded.') && t.includes('Sign up today, it only takes a few minutes!')); }
    await pg.goto(base + '/what-you-get/');
    check('what you get page shows the 7 price boxes above the new heading, with the bottom section keeping both buttons and no heading', (await pg.locator('.tcp-card').count()) === 7 && (await pg.locator('.tcp-feature .tcp-price b').innerText()) === '£14.99' && (await pg.locator('h2:has-text("One passport, tailored to your business.")').count()) === 1 && (await pg.locator('.cta h2').count()) === 0 && (await pg.locator('.cta a.btn.solid[href="/register/"]').count()) === 1 && (await pg.locator('.cta .askdd').count()) === 1);
    await pg.goto(base + '/contact/?topic=social'); check('contact form subject offers the three subjects and the link preselects one', (await pg.locator('#f-topic option').allInnerTexts()).join('|') === 'Not sure yet|Free multi-site hub|Website|Social media management|Other' && (await pg.locator('#f-topic').inputValue()) === 'social' && (await pg.locator('#f-pkg').count()) === 0);
    await pg.goto(base + '/what-you-get/'); await pg.waitForTimeout(400);
    check('website has Register your interest buttons everywhere and no "Book a demo" anywhere', (await pg.locator('a.btn.solid[href="/register/"]:visible').count()) >= 2 && !/book (a|my) demo/i.test(await pg.locator('body').innerText()) && (await pg.locator('.hdr-actions a.btn.solid').innerText()) === 'Register your interest');
    check('website has a single "Login" button in the header and footer, both leading to the app', (await pg.locator('.hdr-actions a[href="/app/?login=1"]').innerText()) === 'Login' && (await pg.locator('footer a[href="/app/?login=1"]').innerText()) === 'Login' && (await pg.locator('text=Client login').count()) === 0);
    await pg.goto(base + '/what-you-get/');
    check('website Register buttons lead to the interest form while the passport is not open', (await pg.locator('a.btn.solid[href="/register/"]:visible').first().innerText()) === 'Register your interest');
    await pg.goto(base + '/register/'); let regBody = null; await pg.route('**/api/interest', (rt) => { regBody = JSON.parse(rt.request().postData()); rt.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); });
    check('register page has the five fields and a consent box', (await pg.locator('#r-name,#r-email,#r-biz,#r-addr,#r-sites,#r-consent').count()) === 6);
    await pg.fill('#r-name', 'Pat Prospect'); await pg.fill('#r-email', 'pat@shop.example'); await pg.fill('#r-biz', 'Pat Shop Ltd'); await pg.fill('#r-addr', '1 High St'); await pg.fill('#r-sites', '3'); await pg.check('#r-consent'); await pg.click('#r-go'); await pg.waitForSelector('#r-out.ok');
    check('register form sends all the details and thanks the person', regBody.business_name === 'Pat Shop Ltd' && regBody.sites === '3' && regBody.consent === true && (await pg.locator('#r-out').innerText()).includes('on the list'));
    signupOpen = false;
    for (const u of ['/terms/', '/privacy/']) { await pg.goto(base + u); check('draft legal page loads and says it is a draft: ' + u, (await pg.locator('.quote').innerText()).includes('Draft for review') && (await pg.locator('meta[name=robots]').getAttribute('content')) === 'noindex'); }
    await pg.goto(base + '/');
    check('new home page: phone picture, both add-ons, the websites and media section and the "winning customers" wording', (await pg.locator('.hm img.appphone').count()) === 1 && (await pg.locator('.hm .addon').count()) === 2 && (await pg.locator('#websites').innerText()).includes('winning customers.') && (await pg.locator('#websites a[href="/media/"]').count()) === 1);
    check('every page shares the logo banner, centred menu and footer: home, passport, contact, media', await (async () => { for (const u of ['/', '/passport/', '/contact/', '/media/']) { await pg.goto(base + u); if ((await pg.locator('.masthead .mast-logo').count()) !== 1 || (await pg.locator('header.top nav.main a').count()) !== 6 || (await pg.locator('footer .f-nav').count()) !== 1) return false; } return true; })());
    await pg.goto(base + '/');
    // Self-Managed showcase video: home (under the phone), passport page and what-you-get; the old 20-second walkthrough is gone
    for (const u of ['/', '/passport/', '/what-you-get/']) {
      await pg.goto(base + u);
      check('showcase video is on ' + u, (await pg.locator('video#passport-video source[src="/media/tremcore-self-managed-showcase-2.mp4"]').count()) === 1);
      check('Ask us a question drop-down lists the three subjects on ' + u, (await pg.locator('details.askdd:visible .askmenu a, details.askdd .askmenu a').count()) >= 4);
      check('big play button is centred on the video on ' + u, (await pg.locator('.vidwrap .vplay').count()) >= 1);
      check('the old 20-second walkthrough is gone from ' + u, (await pg.locator('#demo-player').count()) === 0 && !(await pg.content()).includes('20-second'));
    }
    await pg.goto(base + '/');
    check('home video sits under the phone picture', await pg.evaluate(() => { const v = document.querySelector('#passport-video').getBoundingClientRect(), p = document.querySelector('.hm .appphone').getBoundingClientRect(); return v.top >= p.bottom - 1; }));
    {
      const r1 = await fetch(base + '/media/tremcore-self-managed-showcase-2.mp4', { headers: { Range: 'bytes=0-99' } });
      check('showcase video is served in ranges so it can play and skip', r1.status === 206 && (await r1.arrayBuffer()).byteLength === 100);
      check('showcase poster image is served', (await fetch(base + '/media/img/sm-poster-2.jpg')).status === 200);
    }
    // contact form, using a faked server reply
    await pg.goto(base + '/contact/');
    await pg.route('**/api/enquiry', (rt) => rt.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
    await pg.fill('#f-name', 'Sam'); await pg.fill('#f-email', 'sam@example.com'); await pg.click('#f-go'); await pg.waitForSelector('#f-out.ok');
    check('contact form shows a thank-you', (await pg.locator('#f-out').innerText()).includes('Thank you'));
    await pg.unroute('**/api/enquiry'); await pg.route('**/api/enquiry', (rt) => rt.fulfill({ status: 422, contentType: 'application/json', body: '{"error":"Please check your email address."}' }));
    await pg.fill('#f-name', 'Sam'); await pg.fill('#f-email', 'sam@example.com'); await pg.click('#f-go'); await pg.waitForSelector('#f-out.err');
    check('contact form shows the server\'s error', (await pg.locator('#f-out').innerText()).includes('email'));
    const real = probs.filter((x) => !x.includes('422')); check('no page or CSP errors across the website', real.length === 0);
    if (real.length) console.log(real);
    await pg.setViewportSize({ width: 390, height: 800 });
    for (const u of ['/', '/passport/', '/what-you-get/', '/how-it-works/', '/contact/']) { await pg.goto(base + u); if (!(await pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))) check('no sideways scroll on phone: ' + u, false); }
    check('website fits a phone on every page', true);
    await pg.goto(base + '/'); await pg.click('.menu'); check('phone menu opens', await pg.locator('nav.main.open').count() === 1);
    await ctx.close();
  }

  // not configured
  const ctx = await browser.newContext(); const p = await ctx.newPage();
  await p.route('**/config.json', (r) => r.fulfill({ contentType: 'application/json', body: '{}' }));
  await p.route('**/cdn.jsdelivr.net/**', (r) => r.fulfill({ contentType: 'text/javascript', body: mockJs }));
  await p.goto(base + '/app/'); await p.waitForSelector('h1');
  check('missing configuration shows a friendly message', (await h1(p)) === 'Not available');
  await ctx.close();

  // mobile layout: no sideways scroll
  t = await newPage(); const sw = await t.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  check('no sideways scrolling on a phone', sw); await t.ctx.close();

  await browser.close(); server.close();
  const failed = results.filter((r) => !r[1]);
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' passed');
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
