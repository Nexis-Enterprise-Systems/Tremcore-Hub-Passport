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
  const stripeCalls = [], applied = []; let billingRows = [{ company_id: 'co-1', sites: 3, billing_interval: 'monthly', email: 'pat@acme.example', subscription: 'trial' }], stripeFail = false, applyStatus = 200, applyResult = 'applied', billingAuthOk = true;
  global.fetch = (u, o) => {
    const url = String(u);
    if (url.startsWith('https://stripe.test/')) { stripeCalls.push({ u: url, o }); return Promise.resolve(new Response(JSON.stringify(stripeFail ? { error: { message: 'boom' } } : { url: 'https://checkout.stripe.test/pay/cs_test_1' }), { status: stripeFail ? 400 : 200 })); }
    if (url === process.env.SUPABASE_URL + '/rest/v1/rpc/billing_info') { sent.push({ u: url, o }); return Promise.resolve(billingAuthOk ? new Response(JSON.stringify(billingRows), { status: 200 }) : new Response('{}', { status: 401 })); }
    if (url === process.env.SUPABASE_URL + '/rest/v1/rpc/apply_stripe_event') { applied.push({ u: url, o, body: JSON.parse(o.body) }); return Promise.resolve(new Response(JSON.stringify(applyResult), { status: applyStatus })); }
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
  let r = await post({ name: 'Sam', email: 'sam@example.com', sites: '2-5', package: '1', message: 'Hi' });
  check('enquiry is stored through the public key only', r.status === 200 && sent.length === 1 && sent[0].u.endsWith('/rest/v1/enquiries') && sent[0].o.headers.apikey === 'anon-public-key' && !JSON.stringify(sent[0]).includes('SERVICE-SECRET'));
  check('enquiry fields are mapped', JSON.parse(sent[0].o.body).package_interest === 'self_managed' && JSON.parse(sent[0].o.body).sites === '2-5');
  r = await post({ name: 'Sam', email: 'sam@example.com', package: '2' }); check('enquiry about Managed Service is stored as such', r.status === 200 && JSON.parse(sent[sent.length - 1].o.body).package_interest === 'managed_service');
  r = await post({ name: '', email: 'sam@example.com' }); check('enquiry needs a name', r.status === 422);
  r = await post({ name: 'Sam', email: 'nope' }); check('enquiry needs a valid email', r.status === 422);
  const before = sent.length; r = await post({ name: 'Bot', email: 'b@example.com', website: 'http://spam' });
  check('bot field is silently dropped, nothing stored', r.status === 200 && sent.length === before);
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
  check('site user signs in without 2FA when not required', (await t.page.locator('.badge').innerText()) === 'Off');
  check('optional user is offered 2FA set-up', await t.page.locator('text=Set up 2FA').count() === 1);
  await t.page.click('text=Set up 2FA'); await t.page.waitForSelector('img.qr');
  check('optional set-up has a Not now button', await t.page.locator('text=Not now').count() === 1);
  await t.page.click('text=Not now'); await t.page.waitForSelector('text=Welcome, Leah');
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
    app_settings: [{ key: 'self_signup_open', value: false }, { key: 'managed_base', value: { label: 'Medway (ME)', lat: 51.385, lng: 0.52 } }, { key: 'managed_radius_miles', value: 30 }],
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
    check('hub nav is shown', (await p.locator('.hubnav a').allInnerTexts()).join() === 'Dashboard,Clients,Renewals,Subscriptions,Revenue,Enquiries,Activity,Settings');

    // clients list + search
    await p.click('.hubnav >> text=Clients'); await p.waitForSelector('table');
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

    // phone layout + errors
    await p.setViewportSize({ width: 390, height: 800 });
    for (const u of ['#/dashboard', '#/clients', '#/clients/' + C1, '#/sites/' + P1, '#/subscriptions', '#/enquiries']) {
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
    check('sign-up offers monthly (ticked) or yearly, prices excluding VAT, and says there is no trial', (await p.locator('input[name=su-billing]').count()) === 2 && (await p.locator('input[value=monthly]').isChecked()) && (await p.locator('.plans').innerText()).includes('£14.99') && (await p.locator('.plans').innerText()).includes('£152.90') && (await p.locator('.plans').innerText()).includes('exclude VAT') && !/free trial/i.test(await p.locator('.card').innerText()));
    check('the price follows the number of sites: 3 sites is £30.97 a month or £315.90 a year', (await p.locator('#su-monthly').innerText()).includes('£30.97') && (await p.locator('#su-annual').innerText()).includes('£315.90'));
    await p.fill('#su-sites', '1'); check('1 site is £14.99 a month or £152.90 a year', (await p.locator('#su-monthly').innerText()).includes('£14.99') && (await p.locator('#su-annual').innerText()).includes('£152.90'));
    await p.fill('#su-sites', '3');
    await p.check('input[value=annual]');
    check('the terms and privacy links are on the form and open in a new tab', (await p.locator('a[href="/terms/"][target=_blank]').count()) === 1 && (await p.locator('a[href="/privacy/"][target=_blank]').count()) === 1);
    await p.check('#su-terms'); await go(); await p.waitForSelector('text=Check your email');
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
    check('after 2FA they reach their account, not the staff hub', (await p.locator('.hubbar').count()) === 0 && (await p.locator('text=Your account is ready').count()) === 1);
    check('no page or CSP errors through the whole sign-up', t.problems.length === 0);
    if (t.problems.length) console.log(t.problems);
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
    check('stopped: only a stop message, Call Tremcore and Sign out are offered', (await t.page.locator('.kv').count()) === 0 && (await t.page.locator('#call-tremcore').count()) === 1);
    await t.ctx.close();
    t = await newPage(() => { window.__mock.access = { state: 'ok', is_head: true }; });
    await login(t.page, 'site@t'); await t.page.waitForSelector('#cancel-start');
    await t.page.click('#cancel-start'); await t.page.waitForSelector('#cancel-confirm');
    check('cancel: explains one month notice, data removal and that a year paid up front is not refunded', (await t.page.locator('.card').innerText()).includes('one month') && (await t.page.locator('.card').innerText()).includes('not refunded'));
    await t.page.click('#cancel-confirm'); await t.page.waitForSelector('text=due to close on');
    check('cancel: after giving notice the banner shows the end date and a Keep my account button', (await t.page.locator('button:has-text("Keep my account")').count()) === 1 && (await calls(t.page, 'rpc:request_cancellation')).length === 1);
    await t.page.click('button:has-text("Keep my account")'); await t.page.waitForSelector('#cancel-start');
    check('cancel: notice can be withdrawn', (await calls(t.page, 'rpc:withdraw_cancellation')).length === 1);
    await t.ctx.close();
    // first-run set-up: contact details and tick the core checks
    const setupSeed = () => { window.__mock.tables = { companies: [{ id: 'c1', name: 'Acme Cafes Ltd', setup_completed_at: null }], properties: [{ id: 's1', name: 'Site 1', address: null }, { id: 's2', name: 'Site 2', address: null }],
      core_checks: ['Fire Risk Assessment', 'Fire Alarm Testing & Maintenance', 'Fire Extinguisher Maintenance', 'Emergency Light Testing', 'Electrical Installation Condition Reporting (EICR)', 'PAT Testing', 'Asbestos Management Survey / Register', 'Legionella (water) Risk Management', 'Gas Safety Inspection & Maintenance', 'F-Gas'].map((label, i) => ({ code: 'c' + i, label, sort: i })) }; };
    t = await newPage(setupSeed); await login(t.page, 'site@t'); await t.page.waitForSelector('#st-go');
    check('set-up: a new head-office user is asked for details and shown the ten core checks, none ticked', (await t.page.locator('input[name=core]').count()) === 10 && (await t.page.locator('input[name=core]:checked').count()) === 0 && (await t.page.locator('.card').innerText()).includes('Fire Risk Assessment') && (await t.page.locator('.card').innerText()).includes('F-Gas'));
    check('set-up: one row per site to name, with no name filled in yet', (await t.page.locator('[data-site-row]').count()) === 2 && (await t.page.locator('[data-site-row] input').first().inputValue()) === '');
    await t.page.fill('[data-site-row=s1] input >> nth=0', 'high street shop'); await t.page.fill('[data-site-row=s1] input >> nth=1', '1 High St'); await t.page.press('[data-site-row=s1] input >> nth=0', 'Tab');
    await t.page.fill('#st-phone', '01634 000000'); await t.page.check('input[value=c0]'); await t.page.check('input[value=c5]');
    await t.page.click('#st-go'); await t.page.waitForSelector('text=Your checks');
    const fs = (await calls(t.page, 'rpc:finish_setup'))[0];
    check('set-up: only the ticked checks and the details are sent, with the site names capitalised and the unnamed one left as it was', fs.p_codes.join() === 'c0,c5' && fs.p_phone === '01634 000000' && fs.p_sites[0].name === 'High Street Shop' && fs.p_sites[0].address === '1 High St' && fs.p_sites[1].name === 'Site 2');
    check('set-up: the ticked checks appear as "Not entered yet" (never green), and set-up is not asked again', (await t.page.locator('.kv:has-text("PAT Testing") .badge').innerText()) === 'Not entered yet' && (await t.page.locator('#st-go').count()) === 0);
    await t.ctx.close();
    t = await newPage(setupSeed); await login(t.page, 'site@t'); await t.page.waitForSelector('#st-go'); await t.page.click('#st-all');
    check('set-up: Tick all ticks everything', (await t.page.locator('input[name=core]:checked').count()) === 10);
    await t.ctx.close();

    // team page: the head-office user chooses who can do what
    const teamSeed = () => { window.__mock.tables = { properties: [{ id: 's1', name: 'High Street' }, { id: 's2', name: 'Station Road' }] };
      window.__mock.team = { summary: { used: 2, allowed: 3, require_mfa: false },
        members: [{ user_id: 'u1', full_name: 'Boss', email: 'boss@x.test', role: 'client_super', perm: 'full', active: true, property_ids: [], is_me: true },
                  { user_id: 'u2', full_name: 'Mo Manager', email: 'mo@x.test', role: 'client_site', perm: 'view', active: true, property_ids: ['s1'], is_me: false }], pending: [] }; };
    t = await newPage(teamSeed); await login(t.page, 'site@t'); await t.page.waitForSelector('#team-open');
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
    t = await newPage(teamSeed); await login(t.page, 'site@t'); await t.page.evaluate(() => { window.__mock.team.inviteError = 'user_limit_reached'; }); await t.page.click('#team-open'); await t.page.waitForSelector('#inv-name');
    await t.page.fill('#inv-name', 'X'); await t.page.fill('#inv-email', 'x@x.test'); await t.page.check('input[data-site=new][value=s1]'); await t.page.click('#inv-go');
    await t.page.waitForSelector('.msg.err');
    check('team: going over the user limit is explained', (await t.page.locator('.msg.err').innerText()).includes('used all the users'));
    await t.ctx.close();
    t = await newPage(() => { window.__mock.access = { state: 'ok', is_head: false }; }); await login(t.page, 'site@t'); await t.page.waitForSelector('text=Welcome, Leah');
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
    await login(t.page, 'sam@x.test'); await t.page.waitForSelector('text=Welcome, Sam');
    check('invite: first confirmed sign-in accepts the invitation and lands in the passport as a site user', (await calls(t.page, 'rpc:accept_invitation')).length === 1 && (await t.page.locator('.kv').first().innerText()).includes('Site user'));
    await t.ctx.close();

    // the staff hub: markers and the on/off switch
    t = await hubPage(); let pg = t.page;
    check('hub dashboard counts self sign-ups still on trial', (await pg.locator('.tile:has-text("Self sign-ups to follow up")').innerText()).includes('1'));
    await pg.click('.hubnav >> text=Clients'); await pg.waitForSelector('table');
    check('clients who signed themselves up are marked', (await pg.locator('tr:has-text("Online Bakery") .badge.new').innerText()) === 'Self sign-up');
    await pg.click('a:has-text("Online Bakery Ltd")'); await pg.waitForSelector('.msg.ok');
    check('their page tells staff who to contact and what to do next', (await pg.locator('.msg.ok').innerText()).includes('bea@bakery.example') && (await pg.locator('.msg.ok').innerText()).includes('Active'));
    await pg.click('.hubnav >> text=Settings'); await pg.waitForSelector('text=Self-Managed sign-up');
    check('settings shows sign-up as closed with what to do before opening', (await pg.locator('.badge:has-text("Closed")').count()) === 1 && (await pg.locator('.hint').innerText()).includes('Confirm email'));
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
    check('staff who are not administrators have no Settings tab', (await pg.locator('.hubnav a').allInnerTexts()).join() === 'Dashboard,Clients,Renewals,Subscriptions,Revenue,Enquiries,Activity');
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
    for (const [u, h] of [['/', 'Every certificate'], ['/passport/', 'The checks that keep a building safe'], ['/what-you-get/', 'One passport'], ['/how-it-works/', 'Simple to start'], ['/contact/', 'Ask us a question']]) {
      await pg.goto(base + u); check('website page loads: ' + u, (await pg.locator('h1,h2').first().innerText()).toLowerCase().includes(h.toLowerCase()));
    }
    await pg.goto(base + '/');
    check('website shows no passport sign-in', (await pg.locator('text=Sign in').count()) === 0 && (await pg.locator('a[href="/app/"]').count()) >= 1);
    check('website never mentions Level 2 or 3 or jobs', !/Level 2|Level 3|Raise a Job|Managed Compliance/i.test(await pg.locator('body').innerText()));
    await pg.goto(base + '/what-you-get/');
    check('website does not offer the Managed Service for now (no card, no postcode box)', (await pg.locator('#managed').count()) === 0 && (await pg.locator('#area-check').count()) === 0 && !/Managed Service/i.test(await pg.locator('body').innerText()));
    await pg.goto(base + '/contact/'); check('contact form offers only Self-Managed as a package', (await pg.locator('#f-pkg option').allInnerTexts()).join('|') === 'Not sure yet|Self-Managed');
    await pg.goto(base + '/what-you-get/'); await pg.waitForTimeout(400);
    check('website has Sign up buttons everywhere and no "Book a demo" anywhere', (await pg.locator('[data-signup]:visible').count()) >= 2 && !/book (a|my) demo/i.test(await pg.locator('body').innerText()) && (await pg.locator('.hdr-actions [data-signup]').innerText()) === 'Sign up');
    check('website has a single "Login" button in the header and footer, both leading to the app', (await pg.locator('.hdr-actions a[href="/app/"]').innerText()) === 'Login' && (await pg.locator('footer a[href="/app/"]').innerText()) === 'Login' && (await pg.locator('text=Client login').count()) === 0);
    await pg.goto(base + '/what-you-get/');
    check('website Sign up buttons lead to the sign-up page', (await pg.locator('[data-signup]:visible').first().getAttribute('href')) === '/app/?signup=1');
    signupOpen = false;
    for (const u of ['/terms/', '/privacy/']) { await pg.goto(base + u); check('draft legal page loads and says it is a draft: ' + u, (await pg.locator('.quote').innerText()).includes('Draft for review') && (await pg.locator('meta[name=robots]').getAttribute('content')) === 'noindex'); }
    await pg.goto(base + '/');
    check('hero donut is painted', (await pg.locator('[data-donut]').first().evaluate((e) => e.style.background)).includes('conic-gradient'));
    // demo
    await pg.goto(base + '/what-you-get/');
    check('demo dashboard is complete before play: donut painted and 80%', (await pg.locator('#d-donut').evaluate((e) => e.style.background)).includes('conic-gradient') && (await pg.locator('#d-pct').innerText()) === '80');
    await pg.click('.poster .play'); await pg.waitForTimeout(700);
    check('demo dashboard does not build up while playing: still 80% and the same full ring', (await pg.locator('#d-pct').innerText()) === '80' && (await pg.locator('#d-donut').evaluate((e) => e.style.background)).includes('55%'));
    await pg.waitForFunction(() => document.querySelector('#d-cap b').textContent !== 'Your dashboard', null, { timeout: 8000 });
    check('demo plays through to the next scene by itself', (await pg.locator('#d-cap b').innerText()) === 'Add a certificate');
    await pg.click('.chap button:nth-child(4)'); check('demo chapter buttons jump', (await pg.locator('#d-cap b').innerText()) === 'There is more to see');
    await pg.click('#d-pop'); check('pop-out opens as a dialog', (await pg.locator('#demo-player').getAttribute('role')) === 'dialog');
    await pg.keyboard.press('Escape'); check('Escape closes the pop-out', (await pg.locator('#demo-player').getAttribute('role')) === null);
    await pg.goto(base + '/what-you-get/?play=1'); await pg.waitForSelector('#demo-player.pop');
    check('Watch preview link opens the pop-out and plays', (await pg.locator('#d-toggle span').innerText()) === 'Pause');

    // phone: the walkthrough opens full screen by itself when play is pressed
    {
      const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); const mp = await mctx.newPage();
      await mp.route('**/rest/v1/rpc/signup_open', (rt) => rt.fulfill({ status: 200, contentType: 'application/json', body: 'false' }));
      await mp.goto(base + '/what-you-get/');
      check('on a phone the walkthrough starts in the page, not popped out', (await mp.locator('#demo-player').getAttribute('role')) === null);
      check('demo chapter buttons are at least 44px tall to tap', (await mp.locator('.chap button').first().boundingBox()).height >= 44);
      await mp.tap('.poster .play'); await mp.waitForSelector('#demo-player.pop');
      const bx = await mp.locator('#demo-player').boundingBox();
      check('pressing play on a phone opens the walkthrough as a full-screen dialog', (await mp.locator('#demo-player').getAttribute('role')) === 'dialog' && Math.round(bx.width) === 390 && Math.round(bx.height) === 844);
      check('it plays straight away and the page behind cannot scroll', (await mp.locator('#d-toggle span').innerText()) === 'Pause' && (await mp.evaluate(() => document.documentElement.classList.contains('lock'))));
      check('the full-screen walkthrough has a close button big enough to tap', (await mp.locator('#d-close').boundingBox()).height >= 44);
      await mp.tap('#d-close'); await mp.waitForFunction(() => !document.querySelector('#demo-player.pop'));
      check('closing it returns to the page and frees scrolling', (await mp.evaluate(() => !document.documentElement.classList.contains('lock'))));
      await mp.tap('.chap button:nth-child(3)'); await mp.waitForSelector('#demo-player.pop');
      check('choosing a chapter on a phone also opens it full screen', (await mp.locator('#d-cap b').innerText()) === 'Reminders');
      await mp.tap('#d-close');
      await mp.setViewportSize({ width: 844, height: 390 }); await mp.tap('.chap button:nth-child(1)'); await mp.waitForSelector('#demo-player.pop');
      const lb = await mp.locator('#demo-player').boundingBox();
      check('a phone turned sideways also gets the full-screen walkthrough', Math.round(lb.width) === 844 && Math.round(lb.height) === 390);
      await mctx.close();
    }
    // a computer keeps the walkthrough in the page until Pop out is pressed
    {
      const dctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const dp = await dctx.newPage();
      await dp.route('**/rest/v1/rpc/signup_open', (rt) => rt.fulfill({ status: 200, contentType: 'application/json', body: 'false' }));
      await dp.goto(base + '/what-you-get/'); await dp.click('.poster .play'); await dp.waitForTimeout(300);
      check('on a computer, pressing play does not pop the walkthrough out', (await dp.locator('#demo-player').getAttribute('role')) === null);
      await dctx.close();
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
