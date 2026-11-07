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

  async function newPage(extra) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
    const page = await ctx.newPage();
    const problems = [];
    page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
    page.on('pageerror', (e) => problems.push(String(e)));
    await page.route('**/cdn.jsdelivr.net/**', (route) => route.fulfill({ contentType: 'text/javascript', body: mockJs }));
    await page.addInitScript((u) => { window.__mock = { users: JSON.parse(JSON.stringify(u)) }; }, USERS);
    if (extra) await page.addInitScript(extra);
    await page.goto(base + '/');
    await page.waitForSelector('h1');
    return { page, problems, ctx };
  }
  const h1 = (p) => p.locator('h1').first().innerText();
  const login = async (p, email, pw) => { await p.fill('#email', email); await p.fill('#password', pw || 'correct-horse-battery'); await p.click('button[type=submit]'); };

  // --- server checks ---
  const cfg = await (await fetch(base + '/config.json')).json();
  check('config exposes only the public URL and anon key', cfg.url === process.env.SUPABASE_URL && cfg.anonKey === 'anon-public-key' && Object.keys(cfg).length === 2);
  const everything = await Promise.all(['/', '/app.js', '/config.json', '/index.html'].map(async (p) => (await fetch(base + p)).text()));
  check('service-role secret never appears in anything served', !everything.join('').includes('SERVICE-SECRET'));
  const trav = await fetch(base + '/..%2fserver.js'); check('path traversal is blocked', trav.status === 403 || trav.status === 404);
  const trav2 = await fetch(base + '/%2e%2e/server.js'); check('encoded path traversal is blocked', trav2.status === 403 || trav2.status === 404);
  const rootRes = await fetch(base + '/');
  const csp = rootRes.headers.get('content-security-policy') || '';
  check('CSP forbids inline scripts and framing', csp.includes("script-src 'self' https://cdn.jsdelivr.net") && csp.includes("frame-ancestors 'none'") && !csp.includes('unsafe-inline'));
  check('security headers present', rootRes.headers.get('x-content-type-options') === 'nosniff' && !!rootRes.headers.get('strict-transport-security'));
  check('health check works', (await fetch(base + '/healthz')).status === 200);
  check('POST is refused', (await fetch(base + '/', { method: 'POST' })).status === 405);

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
  await t.page.fill('#code', '123456'); await t.page.click('button[type=submit]'); await t.page.waitForSelector('text=Welcome, Aaron');
  check('correct code turns 2FA on and signs in', (await t.page.locator('.badge').innerText()) === 'On');
  check('no page errors during set-up', t.problems.length === 0);
  await t.ctx.close();

  // staff with 2FA must verify
  t = await newPage(); await login(t.page, 'staff2fa@t');
  await t.page.waitForSelector('#code');
  check('staff with 2FA is asked for a code, not let in', (await h1(t.page)) === 'Two-step check' && (await t.page.locator('text=Welcome').count()) === 0);
  check('lost-phone guidance is shown', (await t.page.locator('text=Lost your phone').count()) === 1);
  await t.page.fill('#code', '111111'); await t.page.click('button[type=submit]'); await t.page.waitForSelector('.msg.err');
  check('wrong code keeps them out', (await h1(t.page)) === 'Two-step check');
  await t.page.fill('#code', '123456'); await t.page.click('button[type=submit]'); await t.page.waitForSelector('text=Welcome, Aaron');
  check('correct code lets them in', (await t.page.locator('.kv').first().innerText()).includes('Tremcore administrator'));
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

  // not configured
  const ctx = await browser.newContext(); const p = await ctx.newPage();
  await p.route('**/config.json', (r) => r.fulfill({ contentType: 'application/json', body: '{}' }));
  await p.route('**/cdn.jsdelivr.net/**', (r) => r.fulfill({ contentType: 'text/javascript', body: mockJs }));
  await p.goto(base + '/'); await p.waitForSelector('h1');
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
