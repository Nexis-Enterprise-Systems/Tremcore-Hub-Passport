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
const server = require('../server.js');
const mockJs = fs.readFileSync(path.join(__dirname, 'mock-supabase.js'), 'utf8');

const results = [];
const check = (name, ok) => { results.push([name, !!ok]); console.log((ok ? 'PASS ' : 'FAIL ') + name); };

const USERS = {
  'staff@t': { password: 'correct-horse-battery', factor: false, profile: { role_name: 'tremcore_admin', full_name: 'Aaron Loveday', mfa_required: true } },
  'staff2fa@t': { password: 'correct-horse-battery', factor: true, profile: { role_name: 'tremcore_admin', full_name: 'Aaron Loveday', mfa_required: true } },
  'site@t': { password: 'correct-horse-battery', factor: false, profile: { role_name: 'client_site', full_name: 'Leah Dunn', mfa_required: false } },
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
  global.fetch = (u, o) => String(u).startsWith(process.env.SUPABASE_URL) ? (sent.push({ u: String(u), o }), Promise.resolve(new Response(null, { status: 201 }))) : realFetch(u, o);
  const post = (body, h) => realFetch(base + '/api/enquiry', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json', Accept: 'application/json' }, h || {}), body: JSON.stringify(body) });
  let r = await post({ name: 'Sam', email: 'sam@example.com', sites: '2-5', package: '1', message: 'Hi' });
  check('enquiry is stored through the public key only', r.status === 200 && sent.length === 1 && sent[0].u.endsWith('/rest/v1/enquiries') && sent[0].o.headers.apikey === 'anon-public-key' && !JSON.stringify(sent[0]).includes('SERVICE-SECRET'));
  check('enquiry fields are mapped', JSON.parse(sent[0].o.body).package_interest === 'self_managed' && JSON.parse(sent[0].o.body).sites === '2-5');
  r = await post({ name: '', email: 'sam@example.com' }); check('enquiry needs a name', r.status === 422);
  r = await post({ name: 'Sam', email: 'nope' }); check('enquiry needs a valid email', r.status === 422);
  const before = sent.length; r = await post({ name: 'Bot', email: 'b@example.com', website: 'http://spam' });
  check('bot field is silently dropped, nothing stored', r.status === 200 && sent.length === before);
  r = await post({ name: 'Sam', email: 'sam@example.com' }, { Origin: 'https://evil.example' }); check('enquiry from another website is refused', r.status === 403);
  r = await realFetch(base + '/api/enquiry', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: '{"name":"' + 'x'.repeat(30000) + '"}' }).catch(() => ({ status: 413 }));
  check('huge enquiry is refused', r.status === 413 || r.status === 429);
  r = await realFetch(base + '/api/enquiry', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'name=Sam&email=sam%40example.com', redirect: 'manual' });
  check('plain form post (no JavaScript) redirects back with a thank-you', r.status === 303 || r.status === 429);
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
  const C1 = '00000000-0000-4000-9000-000000000001', C2 = '00000000-0000-4000-9000-000000000002';
  const P1 = '00000000-0000-4000-a000-000000000001', P2 = '00000000-0000-4000-a000-000000000002', P3 = '00000000-0000-4000-a000-000000000003';
  const seed = () => ({ tables: {
    companies: [
      { id: C1, name: 'Harbour Cafe Group', level: 1, subscription: 'active', monthly_value_pence: 4900, require_mfa: false, contact_email: 'ops@harbour.example', created_at: '2026-10-01' },
      { id: C2, name: 'Quay Offices Ltd', level: 2, subscription: 'trial', monthly_value_pence: 0, require_mfa: true, created_at: '2026-10-02' }],
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
  async function hubPage(seedOverride) {
    const t = await newPage((sd) => { window.__mock.tables = sd.tables; }, seedOverride || seed());
    await login(t.page, 'staff2fa@t'); await t.page.waitForSelector('#code');
    await t.page.fill('#code', '123456'); await t.page.click('button[type=submit]'); await t.page.waitForSelector('.hubbar');
    await t.page.waitForSelector('.tiles');
    return t;
  }
  {
    let t = await hubPage();
    const p = t.page;
    check('hub dashboard shows client, site, revenue and enquiry figures', (await p.locator('.tiles').innerText()).replace(/\s+/g, ' ').includes('2 Active clients') && (await p.locator('.tiles').innerText()).includes('3') && (await p.locator('.tiles').innerText()).includes('£49.00') && (await p.locator('.tiles').innerText()).includes('1'));
    check('dashboard compliance figure counts the missing date against the site (2 of 4 in date = 50%)', (await p.locator('.overall').first().innerText()).includes('50% of 4'));
    check('dashboard lists the site that needs attention', (await p.locator('.list').innerText()).includes('Harbour Cafe Ipswich'));
    check('hub nav is shown', (await p.locator('.hubnav a').allInnerTexts()).join() === 'Dashboard,Clients,Subscriptions,Enquiries');

    // clients list + search
    await p.click('.hubnav >> text=Clients'); await p.waitForSelector('table');
    check('clients list shows both clients with package and site counts', (await p.locator('tbody tr').count()) === 2 && (await p.locator('tbody').innerText()).includes('Managed Service'));
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
    await p.selectOption('select[aria-label="Subscription for Quay Offices Ltd"]', 'active'); await p.fill('input[aria-label="Monthly value for Quay Offices Ltd"]', '25');
    await p.locator('tr:has-text("Quay Offices") button:has-text("Save")').click(); await p.waitForSelector('tr:has-text("Quay Offices") >> text=Saved');
    const su = (await dbCalls(p, "x.table==='companies'&&x.op==='update'&&x.payload.monthly_value_pence===2500"))[0];
    check('subscription status and value are saved in pence', su && su.payload.subscription === 'active');
    await p.fill('input[aria-label="Monthly value for Quay Offices Ltd"]', 'lots'); await p.locator('tr:has-text("Quay Offices") button:has-text("Save")').click();
    check('bad subscription value is refused without saving', (await p.locator('tr:has-text("Quay Offices")').innerText()).includes('Enter pounds'));

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

  // website
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const pg = await ctx.newPage(); const probs = [];
    pg.on('console', (m) => { if (m.type() === 'error') probs.push(m.text()); }); pg.on('pageerror', (e) => probs.push(String(e)));
    for (const [u, h] of [['/', 'Every certificate'], ['/passport/', 'The checks that keep a building safe'], ['/what-you-get/', 'One passport'], ['/how-it-works/', 'Simple to start'], ['/contact/', 'See it around your premises']]) {
      await pg.goto(base + u); check('website page loads: ' + u, (await pg.locator('h1,h2').first().innerText()).toLowerCase().includes(h.toLowerCase()));
    }
    await pg.goto(base + '/');
    check('website shows no passport sign-in', (await pg.locator('text=Sign in').count()) === 0 && (await pg.locator('a[href="/app/"]').count()) >= 1);
    check('website never mentions Level 2 or 3 or jobs', !/Level 2|Level 3|Raise a Job|Managed Compliance/i.test(await pg.locator('body').innerText()));
    check('hero donut is painted', (await pg.locator('[data-donut]').first().evaluate((e) => e.style.background)).includes('conic-gradient'));
    // demo
    await pg.goto(base + '/what-you-get/'); await pg.click('.poster .play');
    await pg.waitForFunction(() => document.querySelector('#d-cap b').textContent !== 'Your dashboard', null, { timeout: 8000 });
    check('demo plays through to the next scene by itself', (await pg.locator('#d-cap b').innerText()) === 'Add a certificate');
    await pg.click('.chap button:nth-child(4)'); check('demo chapter buttons jump', (await pg.locator('#d-cap b').innerText()) === 'There is more to see');
    await pg.click('#d-pop'); check('pop-out opens as a dialog', (await pg.locator('#demo-player').getAttribute('role')) === 'dialog');
    await pg.keyboard.press('Escape'); check('Escape closes the pop-out', (await pg.locator('#demo-player').getAttribute('role')) === null);
    await pg.goto(base + '/what-you-get/?play=1'); await pg.waitForSelector('#demo-player.pop');
    check('Watch preview link opens the pop-out and plays', (await pg.locator('#d-toggle span').innerText()) === 'Pause');
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
