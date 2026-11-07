// Tremcore Passport: sign-in, password reset and 2FA (authenticator app codes).
// All security decisions are enforced by the database; these pages only guide the user through the steps.
(function () {
  'use strict';

  const ROLE_LABEL = {
    tremcore_admin: 'Tremcore administrator', tremcore_staff: 'Tremcore staff',
    client_super: 'Head office (all sites)', client_site: 'Site user'
  };
  const MIN_PASSWORD = 12;
  const root = document.getElementById('app');
  let sb = null;
  let recovering = false;   // true while the user is on a password-reset link
  let wantEnroll = false;   // true when an optional user chose "Set up 2FA"

  // ---------- tiny DOM helper (text only: nothing is ever inserted as HTML) ----------
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v == null) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
    return el;
  }
  function show(...nodes) {
    root.replaceChildren(h('img', { class: 'logo', src: '/img/logo-mark.png', alt: 'Tremcore' }), ...nodes);
    const f = root.querySelector('input'); if (f) f.focus();
  }
  function message(box, kind, text) {
    box.replaceChildren(text ? h('div', { class: 'msg ' + kind, role: kind === 'err' ? 'alert' : 'status' }, text) : '');
  }
  async function busy(btn, fn) {
    const label = btn.textContent; btn.disabled = true; btn.textContent = 'Please wait…';
    try { return await fn(); } finally { btn.disabled = false; btn.textContent = label; }
  }

  // ---------- views ----------
  function viewLogin(note) {
    const box = h('div');
    const email = h('input', { id: 'email', type: 'email', autocomplete: 'username', required: true, inputmode: 'email' });
    const pass = h('input', { id: 'password', type: 'password', autocomplete: 'current-password', required: true });
    const btn = h('button', { class: 'btn', type: 'submit' }, 'Sign in');
    const form = h('form', { novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      if (!email.value.trim() || !pass.value) return message(box, 'err', 'Enter your email and password.');
      await busy(btn, async () => {
        const { error } = await sb.auth.signInWithPassword({ email: email.value.trim(), password: pass.value });
        if (error) {
          message(box, 'err', error.status === 429 ? 'Too many attempts. Please wait a few minutes and try again.'
            : 'Email or password not recognised.');
          pass.value = '';
        } else { await route(); }
      });
    } },
      h('label', { for: 'email' }, 'Email'), email,
      h('label', { for: 'password' }, 'Password'), pass,
      btn, box,
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'linkbtn', onclick: () => viewForgot() }, 'Forgotten your password?')));
    if (note) message(box, 'ok', note);
    show(h('div', { class: 'card' }, h('h1', {}, 'Sign in'), h('p', { class: 'muted' }, 'Tremcore Compliance Passport'), form));
  }

  function viewForgot() {
    const box = h('div');
    const email = h('input', { id: 'email', type: 'email', autocomplete: 'username', required: true });
    const btn = h('button', { class: 'btn', type: 'submit' }, 'Send reset link');
    const form = h('form', { novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      if (!email.value.trim()) return message(box, 'err', 'Enter your email address.');
      await busy(btn, async () => {
        await sb.auth.resetPasswordForEmail(email.value.trim(), { redirectTo: location.origin + '/app/' });
        // Same answer whether or not the address has an account, so the page can't be used to find out who is a client.
        message(box, 'ok', 'If that email has an account, a reset link is on its way. Check your inbox and spam folder.');
      });
    } }, h('label', { for: 'email' }, 'Email'), email, btn, box,
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'linkbtn', onclick: () => viewLogin() }, 'Back to sign in')));
    show(h('div', { class: 'card' }, h('h1', {}, 'Reset your password'),
      h('p', { class: 'muted' }, 'We will email you a link to choose a new password.'), form));
  }

  // Set a new password after following the emailed link. Accounts with 2FA must also give a code.
  async function viewReset() {
    const box = h('div');
    const aal = (await sb.auth.mfa.getAuthenticatorAssuranceLevel()).data;
    const needCode = aal && aal.currentLevel !== 'aal2' && aal.nextLevel === 'aal2';
    const factors = needCode ? (await sb.auth.mfa.listFactors()).data : null;
    const p1 = h('input', { id: 'p1', type: 'password', autocomplete: 'new-password', required: true, minlength: String(MIN_PASSWORD) });
    const p2 = h('input', { id: 'p2', type: 'password', autocomplete: 'new-password', required: true });
    const code = needCode ? h('input', { id: 'code', class: 'code', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '6', pattern: '[0-9]*' }) : null;
    const btn = h('button', { class: 'btn', type: 'submit' }, 'Save new password');
    const form = h('form', { novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      if (p1.value.length < MIN_PASSWORD) return message(box, 'err', 'Use at least ' + MIN_PASSWORD + ' characters. A few random words work well.');
      if (p1.value !== p2.value) return message(box, 'err', 'The two passwords do not match.');
      await busy(btn, async () => {
        if (needCode) {
          const f = factors && factors.totp && factors.totp[0];
          if (!f) return message(box, 'err', 'No authenticator is set up on this account. Contact Tremcore.');
          const v = await sb.auth.mfa.challengeAndVerify({ factorId: f.id, code: code.value.trim() });
          if (v.error) return message(box, 'err', 'That code was not right. Check your authenticator app and try again.');
        }
        const { error } = await sb.auth.updateUser({ password: p1.value });
        if (error) return message(box, 'err', error.message || 'Could not save the password. The link may have expired; request a new one.');
        recovering = false;
        await sb.auth.signOut();
        viewLogin('Password changed. Sign in with your new password.');
      });
    } },
      h('label', { for: 'p1' }, 'New password'), p1,
      h('label', { for: 'p2' }, 'Repeat new password'), p2,
      code && h('label', { for: 'code' }, '6-digit code from your authenticator app'), code,
      btn, box);
    show(h('div', { class: 'card' }, h('h1', {}, 'Choose a new password'),
      h('p', { class: 'muted' }, 'At least ' + MIN_PASSWORD + ' characters.'), form));
  }

  // Ask for the 6-digit code after the password.
  function viewVerify(factorId) {
    const box = h('div');
    const code = h('input', { id: 'code', class: 'code', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '6', pattern: '[0-9]*', required: true });
    const btn = h('button', { class: 'btn', type: 'submit' }, 'Verify');
    const form = h('form', { novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      if (!/^\d{6}$/.test(code.value.trim())) return message(box, 'err', 'Enter the 6 digits shown in your authenticator app.');
      await busy(btn, async () => {
        const { error } = await sb.auth.mfa.challengeAndVerify({ factorId, code: code.value.trim() });
        if (error) { message(box, 'err', 'That code was not right. Codes change every 30 seconds, so try the new one.'); code.value = ''; }
        else await route();
      });
    } }, h('label', { for: 'code' }, '6-digit code'), code, btn, box,
      h('p', { class: 'muted', style: null }, 'Lost your phone? Contact Tremcore and we will reset your 2FA once we have confirmed who you are.'),
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'linkbtn', onclick: signOut }, 'Use a different account')));
    show(h('div', { class: 'card' }, h('h1', {}, 'Two-step check'),
      h('p', { class: 'muted' }, 'Open your authenticator app and enter the code for Tremcore.'), form));
  }

  // First-time 2FA set-up: scan the QR code, then prove it works with a code.
  async function viewEnroll(required) {
    const box = h('div');
    // Remove any half-finished set-up so the user never ends up with duplicates.
    const existing = (await sb.auth.mfa.listFactors()).data;
    for (const f of (existing && existing.all) || []) if (f.factor_type === 'totp' && f.status === 'unverified') await sb.auth.mfa.unenroll({ factorId: f.id });
    const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Authenticator ' + new Date().toISOString() });
    if (error) {
      return show(h('div', { class: 'card' }, h('h1', {}, 'Set up 2FA'),
        h('div', { class: 'msg err', role: 'alert' }, 'Could not start 2FA set-up: ' + (error.message || 'unknown error') + '. Check that authenticator-app (TOTP) sign-in is switched on in Supabase.'),
        h('button', { class: 'btn ghost', onclick: signOut }, 'Sign out')));
    }
    const secret = (data.totp.secret || '').replace(/(.{4})/g, '$1 ').trim();
    const code = h('input', { id: 'code', class: 'code', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '6', pattern: '[0-9]*', required: true });
    const btn = h('button', { class: 'btn', type: 'submit' }, 'Turn on 2FA');
    const form = h('form', { novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      if (!/^\d{6}$/.test(code.value.trim())) return message(box, 'err', 'Enter the 6 digits shown in your authenticator app.');
      await busy(btn, async () => {
        const v = await sb.auth.mfa.challengeAndVerify({ factorId: data.id, code: code.value.trim() });
        if (v.error) { message(box, 'err', 'That code was not right. Make sure you scanned the code on this page, then try the new code.'); code.value = ''; }
        else { wantEnroll = false; await route(); }
      });
    } }, h('label', { for: 'code' }, '6-digit code'), code, btn, box);
    show(h('div', { class: 'card' },
      h('h1', {}, 'Set up 2FA'),
      h('p', { class: 'muted' }, required ? '2FA is required on your account for security.' : 'Add a second step to protect your account.'),
      h('ol', { class: 'steps' },
        h('li', {}, 'Install an authenticator app (Microsoft Authenticator, Google Authenticator or similar).'),
        h('li', {}, 'Scan this code with the app.'),
        h('li', {}, 'Type the 6-digit code it shows.')),
      h('img', { class: 'qr', src: data.totp.qr_code, alt: 'QR code to scan with your authenticator app' }),
      h('p', { class: 'muted center' }, 'Cannot scan? Enter this key in the app instead:'),
      h('div', { class: 'secret' }, secret),
      form,
      !required && h('button', { class: 'btn ghost', onclick: () => { wantEnroll = false; route(); } }, 'Not now')));
  }

  function viewHome(req, hasFactor) {
    show(h('div', { class: 'card' },
      h('h1', {}, 'Welcome' + (req.full_name ? ', ' + req.full_name.split(' ')[0] : '')),
      h('p', { class: 'muted' }, 'You are signed in.'),
      h('div', { class: 'kv' }, h('span', {}, 'Access'), h('span', {}, ROLE_LABEL[req.role_name] || req.role_name)),
      h('div', { class: 'kv' }, h('span', {}, '2FA'), h('span', { class: 'badge ' + (hasFactor ? 'on' : 'off') }, hasFactor ? 'On' : 'Off')),
      h('p', { class: 'muted', style: null }, 'The compliance passport and management hub are being built next.'),
      !hasFactor && h('button', { class: 'btn ghost', onclick: () => { wantEnroll = true; route(); } }, 'Set up 2FA'),
      h('button', { class: 'btn ghost', onclick: signOut }, 'Sign out')));
  }

  function viewNoAccount() {
    show(h('div', { class: 'card' }, h('h1', {}, 'No access yet'),
      h('p', { class: 'muted' }, 'You are signed in, but this account has not been set up for the Passport. Please contact Tremcore.'),
      h('button', { class: 'btn ghost', onclick: signOut }, 'Sign out')));
  }

  async function signOut() { wantEnroll = false; recovering = false; await sb.auth.signOut(); viewLogin(); }

  // ---------- routing: decide which screen the current session should see ----------
  async function route() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return viewLogin();
    if (recovering) return viewReset();
    const { data: rows, error } = await sb.rpc('auth_requirements');
    const req = rows && rows[0];
    if (error || !req) return viewNoAccount();
    const aal = (await sb.auth.mfa.getAuthenticatorAssuranceLevel()).data || {};
    const factors = (await sb.auth.mfa.listFactors()).data || {};
    const verified = factors.totp || [];
    if (verified.length && aal.currentLevel !== 'aal2') return viewVerify(verified[0].id);
    if ((req.mfa_required && !verified.length) || wantEnroll) return viewEnroll(req.mfa_required);
    return viewHome(req, verified.length > 0);
  }

  // ---------- start ----------
  async function start() {
    let cfg;
    try { cfg = await (await fetch('/config.json', { cache: 'no-store' })).json(); } catch { cfg = {}; }
    if (!cfg.url || !cfg.anonKey || !window.supabase) {
      return show(h('div', { class: 'card' }, h('h1', {}, 'Not available'),
        h('p', { class: 'muted' }, 'The sign-in service is not configured yet. Please try again later.')));
    }
    sb = window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    // Never call Supabase directly inside this callback (it can deadlock); hand off to the next tick.
    sb.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') { recovering = true; setTimeout(route, 0); }
      else if (event === 'SIGNED_OUT') { setTimeout(viewLogin, 0); }
    });
    await route();
  }

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/app/sw.js').catch(() => {});
  start();
})();
