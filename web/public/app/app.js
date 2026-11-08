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
  let finishingSignup = false;   // stops the sign-up step running twice at once
  let suppressSignedOut = false; // true while we sign out on purpose and show our own message afterwards
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
    document.body.classList.remove('hub');
    if (window.TCHub) window.TCHub.unmount();
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
    const newRow = h('div', { class: 'row' });
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
            : (error.code === 'email_not_confirmed' || /not confirmed/i.test(error.message || '')) ? 'Please confirm your email first. Open the link we sent you, then sign in.'
            : 'Email or password not recognised.');
          pass.value = '';
        } else { await route(); }
      });
    } },
      h('label', { for: 'email' }, 'Email'), email,
      h('label', { for: 'password' }, 'Password'), pass,
      btn, box,
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'linkbtn', onclick: () => viewForgot() }, 'Forgotten your password?')),
      newRow);
    // The "create an account" link appears only while Tremcore has Self-Managed sign-up switched on.
    Promise.resolve(sb.rpc('signup_open')).then((r) => {
      if (r && r.data === true) newRow.append(h('span', { class: 'muted' }, 'New to Tremcore?'), h('button', { type: 'button', class: 'linkbtn', onclick: () => viewSignup() }, 'Create an account'));
    }).catch(() => {});
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
        suppressSignedOut = true;
        try { await sb.auth.signOut(); } finally { suppressSignedOut = false; }
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

  const fmtDate = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const daysWord = (n) => n === 1 ? '1 day' : n + ' days';

  async function viewHome(req, hasFactor) {
    // Tremcore staff land in the management hub (hub.js). Everyone else sees the holding page until their passport is built.
    if ((req.role_name === 'tremcore_admin' || req.role_name === 'tremcore_staff') && window.TCHub) {
      return window.TCHub.mount({ sb, root, req, hasFactor, signOut });
    }
    let a = { state: 'ok' };
    try { const r = await sb.rpc('my_access'); if (r.data && r.data[0]) a = r.data[0]; } catch { /* treated as ok; the database still decides what is visible */ }
    if (a.state === 'awaiting_payment') return viewAwaitingPayment(a);
    if (a.state === 'stopped') return viewStopped(a);
    let banner = null;
    if (a.state === 'payment_failed') {
      banner = a.is_head
        ? h('div', { class: 'msg err', role: 'alert' }, h('strong', {}, 'Your latest payment did not go through. '), 'Please update your payment details. If it is not paid within ' + daysWord(a.days_left) + ' (by ' + fmtDate(a.ends_at) + '), your account will be put on stop and nobody at your company will be able to access anything.')
        : h('div', { class: 'msg err', role: 'alert' }, 'A payment for this account has failed. Please ask your head-office user to fix it, or the account will be put on stop by ' + fmtDate(a.ends_at) + '.');
    } else if (a.state === 'cancelling') {
      banner = h('div', { class: 'msg err', role: 'status' }, 'Your account is due to close on ' + fmtDate(a.ends_at) + '. After that you will not be able to sign in and your data will be removed.',
        a.is_head && h('div', {}, h('button', { class: 'btn ghost', onclick: async () => { await sb.rpc('withdraw_cancellation'); route(); } }, 'Keep my account')));
    }
    show(h('div', { class: 'card' },
      h('h1', {}, 'Welcome' + (req.full_name ? ', ' + req.full_name.split(' ')[0] : '')),
      banner,
      h('p', { class: 'muted' }, 'You are signed in.'),
      h('div', { class: 'kv' }, h('span', {}, 'Access'), h('span', {}, ROLE_LABEL[req.role_name] || req.role_name)),
      h('div', { class: 'kv' }, h('span', {}, '2FA'), h('span', { class: 'badge ' + (hasFactor ? 'on' : 'off') }, hasFactor ? 'On' : 'Off')),
      h('p', { class: 'muted', style: null }, 'Your account is ready. Your compliance passport will appear here as soon as it is switched on.'),
      !hasFactor && h('button', { class: 'btn ghost', onclick: () => { wantEnroll = true; route(); } }, 'Set up 2FA'),
      a.is_head && h('button', { class: 'btn', id: 'team-open', onclick: () => viewTeam() }, 'Manage my team'),
      a.is_head && a.state !== 'cancelling' && h('button', { class: 'btn ghost', id: 'cancel-start', onclick: () => viewCancel() }, 'Cancel my subscription'),
      h('button', { class: 'btn ghost', onclick: signOut }, 'Sign out')));
  }

  // Stripe payment is built later; until then this page only explains. The account stays closed until the payment is confirmed.
  function viewAwaitingPayment(a) {
    show(h('div', { class: 'card' }, h('h1', {}, 'One step left: payment'),
      h('p', {}, a.is_head ? 'Your account has been created. It opens as soon as your payment is confirmed.' : 'This account is waiting for its first payment. Please ask your head-office user.'),
      a.is_head && h('button', { class: 'btn', id: 'pay-now', disabled: true }, 'Pay now (coming soon)'),
      h('a', { class: 'btn ghost', href: 'tel:+440000000000', id: 'call-tremcore' }, 'Call Tremcore'),
      h('button', { class: 'btn ghost', onclick: signOut }, 'Sign out')));
  }

  function viewStopped(a) {
    show(h('div', { class: 'card' }, h('h1', {}, 'Your account is on stop'),
      h('p', { class: 'muted' }, 'You cannot open anything in this account at the moment.'),
      h('p', {}, a.is_head ? 'If a payment failed, please contact Tremcore. If your notice period has ended, the account is closed and your data is being removed.'
        : 'Please ask your head-office user, or contact Tremcore.'),
      h('a', { class: 'btn', href: 'tel:+440000000000', id: 'call-tremcore' }, 'Call Tremcore'),
      h('button', { class: 'btn ghost', onclick: signOut }, 'Sign out')));
  }

  function viewCancel() {
    const msg = h('div', { id: 'cancel-msg' });
    show(h('div', { class: 'card' }, h('h1', {}, 'Cancel my subscription'),
      h('p', {}, 'We need one month\u2019s notice. You keep full access until the notice ends. After that you will not be able to sign in and all your data will be removed.'),
      h('p', { class: 'muted' }, 'If you have paid for a year up front, you keep access to the end of the year you paid for and that payment is not refunded (see the Terms). Please download or save anything you need before the end date.'),
      msg,
      h('button', { class: 'btn', id: 'cancel-confirm', onclick: async () => {
        const r = await sb.rpc('request_cancellation');
        if (r.error) { msg.replaceChildren(h('div', { class: 'msg err', role: 'alert' }, 'We could not record your notice. Please contact Tremcore.')); return; }
        route();
      } }, 'Give my notice'),
      h('button', { class: 'btn ghost', onclick: () => route() }, 'Go back')));
  }


  // ---------- Team: the head-office user decides who can do what ----------
  const PERM_LABEL = { view: 'View only', update: 'Can update records', full: 'Full control of their sites' };
  const TEAM_ERR = (e) => { const m = (e && e.message) || '';
    return /user_limit_reached/.test(m) ? 'You have used all the users in your plan. Add another site to include one more user, or contact Tremcore.'
      : /already_member/.test(m) ? 'That person is already in your team.'
      : /invalid_details/.test(m) ? 'Please check the name, email, access level and that at least one site is ticked.'
      : /mfa_required|not_allowed/.test(m) ? 'You are not allowed to do that.' : 'Sorry, that did not work. Please try again.'; };

  async function viewTeam(note) {
    show(h('div', { class: 'card wide' }, h('p', { class: 'muted center' }, 'Loading…')));
    const [m, pend, sum, sites] = await Promise.all([sb.rpc('team_members'), sb.rpc('team_pending'), sb.rpc('team_summary'), sb.from('properties').select('id,name').order('name')]);
    if (m.error || !m.data) return viewHomeAgain();
    const members = m.data, pending = pend.data || [], s = (sum.data && sum.data[0]) || { used: members.length, allowed: members.length, require_mfa: false };
    const siteList = sites.data || [];
    const box = h('div', { id: 'team-msg' });
    if (note) message(box, 'ok', note);
    const siteChecks = (selected, idp) => h('div', { class: 'sites' }, siteList.map((x) => h('label', { class: 'check' }, h('input', { type: 'checkbox', value: x.id, 'data-site': idp, checked: selected.includes(x.id) }), h('span', {}, x.name))));
    const picked = (root_) => [...root_.querySelectorAll('input[data-site]:checked')].map((i) => i.value);
    const permSelect = (val, id) => h('select', { id }, Object.keys(PERM_LABEL).map((k) => h('option', { value: k, selected: k === val }, PERM_LABEL[k])));

    const rows = members.map((u) => {
      if (u.role === 'client_super') return h('div', { class: 'member' }, h('strong', {}, u.full_name), ' ', h('span', { class: 'muted' }, u.email + ' · Head office, sees all sites'));
      const permSel = permSelect(u.perm, 'perm-' + u.user_id), active = h('input', { type: 'checkbox', checked: u.active });
      const card = h('div', { class: 'member', 'data-user': u.user_id }, h('strong', {}, u.full_name), ' ', h('span', { class: 'muted' }, u.email),
        h('div', {}, h('label', { for: 'perm-' + u.user_id }, 'Access'), permSel), siteChecks(u.property_ids || [], u.user_id),
        h('label', { class: 'check' }, active, h('span', {}, 'Can sign in')),
        h('button', { class: 'btn ghost', 'data-save': u.user_id, onclick: async (e) => {
          const ids = picked(card); if (!ids.length) return message(box, 'err', 'Tick at least one site for ' + u.full_name + '.');
          await busy(e.target, async () => { const r = await sb.rpc('team_set_access', { p_user: u.user_id, p_perm: permSel.value, p_property_ids: ids, p_active: active.checked });
            if (r.error) return message(box, 'err', TEAM_ERR(r.error)); viewTeam('Saved changes for ' + u.full_name + '.'); }); } }, 'Save'));
      return card;
    });

    const iname = h('input', { id: 'inv-name', maxlength: '120' }), imail = h('input', { id: 'inv-email', type: 'email', inputmode: 'email', maxlength: '200' });
    const iperm = permSelect('update', 'inv-perm'), isites = siteChecks([], 'new');
    const full = s.used >= s.allowed;
    const invite = h('form', { class: 'member', novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      const ids = picked(isites); if (!iname.value.trim() || !imail.value.trim() || !ids.length) return message(box, 'err', 'Please add their name, email and at least one site.');
      const r = await sb.rpc('team_invite', { p_email: imail.value.trim(), p_full_name: iname.value.trim(), p_perm: iperm.value, p_property_ids: ids });
      if (r.error) return message(box, 'err', TEAM_ERR(r.error));
      viewTeam('Invitation saved for ' + imail.value.trim() + '. Send them this link: ' + location.origin + '/app/?invite=1 . They must sign up with that same email address.');
    } }, h('h3', {}, 'Add a person'), full && h('p', { class: 'muted' }, 'All ' + s.allowed + ' users in your plan are in use. Each extra site includes one more user.'),
      h('label', { for: 'inv-name' }, 'Their name'), iname, h('label', { for: 'inv-email' }, 'Their work email'), imail,
      h('label', { for: 'inv-perm' }, 'What they can do'), iperm, h('p', { class: 'muted small' }, 'Which sites can they see?'), isites,
      h('button', { class: 'btn', type: 'submit', id: 'inv-go', disabled: full }, 'Save invitation'));

    const pendRows = pending.map((i) => h('div', { class: 'member' }, h('strong', {}, i.full_name), ' ', h('span', { class: 'muted' }, i.email + ' · waiting to sign up · ' + PERM_LABEL[i.perm]),
      h('button', { class: 'btn ghost', 'data-cancel': i.id, onclick: async () => { await sb.rpc('team_cancel_invite', { p_id: i.id }); viewTeam('Invitation cancelled.'); } }, 'Cancel')));

    const mfa = h('input', { type: 'checkbox', id: 'team-mfa', checked: s.require_mfa, onchange: async (e) => { const r = await sb.rpc('team_set_require_mfa', { p_on: e.target.checked }); viewTeam(r.error ? null : (e.target.checked ? '2FA is now required for everyone in your company.' : '2FA is now optional for your site users.')); } });
    show(h('div', { class: 'card wide' }, h('h1', {}, 'My team'),
      h('p', { class: 'muted' }, s.used + ' of ' + s.allowed + ' users in use. Your price includes one user for your first site and one more for each extra site.'),
      box, ...rows, pendRows.length ? h('h3', {}, 'Waiting to sign up') : null, ...pendRows, invite,
      h('label', { class: 'check' }, mfa, h('span', {}, 'Require 2FA (authenticator app) for everyone in my company. It is always required for head-office users.')),
      h('button', { class: 'btn ghost', onclick: () => route() }, 'Back')));
  }
  function viewHomeAgain() { route(); }

  // The invited person creates their own login here. Nothing is created in the company until they confirm their email and sign in.
  async function viewInviteSignup() {
    const box = h('div');
    const name = h('input', { id: 'iv-name', autocomplete: 'name', required: true, maxlength: '120' });
    const email = h('input', { id: 'iv-email', type: 'email', autocomplete: 'username', required: true, inputmode: 'email' });
    const pass = h('input', { id: 'iv-pass', type: 'password', autocomplete: 'new-password', required: true, minlength: String(MIN_PASSWORD) });
    const terms = h('input', { id: 'iv-terms', type: 'checkbox' });
    const btn = h('button', { class: 'btn', type: 'submit' }, 'Create my login');
    const form = h('form', { novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      if (!name.value.trim()) return message(box, 'err', 'Please enter your name.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) return message(box, 'err', 'Please check your email address.');
      if (pass.value.length < MIN_PASSWORD) return message(box, 'err', 'Use at least ' + MIN_PASSWORD + ' characters for your password.');
      if (!terms.checked) return message(box, 'err', 'Please tick the box to agree to the terms and privacy notice.');
      await busy(btn, async () => {
        const { data, error } = await sb.auth.signUp({ email: email.value.trim(), password: pass.value, options: { emailRedirectTo: location.origin + '/app/', data: { invited: true, signup_full_name: name.value.trim(), terms_accepted_at: new Date().toISOString() } } });
        if (error) return message(box, 'err', /already/i.test(error.message || '') ? 'That email already has a login. Try signing in.' : 'Sorry, we could not create the login: ' + error.message);
        pass.value = '';
        if (data && data.session) return route();
        viewCheckEmail(email.value.trim());
      });
    } }, h('label', { for: 'iv-name' }, 'Your name'), name, h('label', { for: 'iv-email' }, 'Your work email (the address you were invited on)'), email,
      h('label', { for: 'iv-pass' }, 'Choose a password'), pass,
      h('label', { class: 'check' }, terms, h('span', {}, 'I agree to the ', h('a', { href: '/terms/', target: '_blank', rel: 'noopener' }, 'terms and conditions'), ' and have read the ', h('a', { href: '/privacy/', target: '_blank', rel: 'noopener' }, 'privacy notice'), '.')),
      btn, box, h('div', { class: 'row' }, h('button', { type: 'button', class: 'linkbtn', onclick: () => viewLogin() }, 'I already have a login')));
    show(h('div', { class: 'card' }, h('h1', {}, 'Join your team'), h('p', { class: 'muted' }, 'Your head-office user has invited you. Sign up with the same email address they used.'), form));
  }

  // ---------- Self-Managed sign-up ----------
  // The details typed here are kept with the new login (as account details) until the emailed link is opened;
  // the first confirmed sign-in then creates the company through signup_company(), which only ever makes a Level 1 trial.
  async function viewSignup() {
    show(h('div', { class: 'card' }, h('p', { class: 'muted center' }, 'Loading…')));
    let open = false;
    try { open = (await sb.rpc('signup_open')).data === true; } catch { open = false; }
    if (!open) {
      return show(h('div', { class: 'card' }, h('h1', {}, 'Sign-up is not open yet'),
        h('p', { class: 'muted' }, 'We are not taking new accounts online just yet. Book a demo and we will get you started.'),
        h('a', { class: 'btn', href: '/contact/' }, 'Book a demo'),
        h('button', { class: 'btn ghost', onclick: () => viewLogin() }, 'Back to sign in')));
    }
    const box = h('div');
    const name = h('input', { id: 'su-name', autocomplete: 'name', required: true, maxlength: '120' });
    const company = h('input', { id: 'su-company', autocomplete: 'organization', required: true, maxlength: '160' });
    const site = h('input', { id: 'su-site', required: true, maxlength: '160' });
    const addr = h('input', { id: 'su-addr', autocomplete: 'street-address', maxlength: '300' });
    const email = h('input', { id: 'su-email', type: 'email', autocomplete: 'username', required: true, inputmode: 'email' });
    const pass = h('input', { id: 'su-pass', type: 'password', autocomplete: 'new-password', required: true, minlength: String(MIN_PASSWORD) });
    const terms = h('input', { id: 'su-terms', type: 'checkbox' });
    const bill = (val, checked, title, detail) => h('label', { class: 'check plan' }, h('input', { type: 'radio', name: 'su-billing', value: val, checked }), h('span', {}, h('strong', {}, title), ' ', detail));
    const billing = h('fieldset', { class: 'plans' }, h('legend', {}, 'How would you like to pay?'),
      bill('monthly', true, 'Monthly', '\u00a314.99 a month for your first site, \u00a37.99 a month for each extra site'),
      bill('annual', false, 'Yearly, save 15%', '\u00a3152.90 a year for your first site, \u00a381.50 a year for each extra site'),
      h('p', { class: 'muted small' }, 'Prices exclude VAT. Your first site includes a head-office user and one manager; each extra site includes one more user. Payment is taken when you sign up and your account opens as soon as it is confirmed.'));
    const btn = h('button', { class: 'btn', type: 'submit' }, 'Sign up and pay');
    const form = h('form', { novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      const v = { name: name.value.trim(), company: company.value.trim(), site: site.value.trim(), addr: addr.value.trim(), email: email.value.trim() };
      if (!v.name || !v.company || !v.site) return message(box, 'err', 'Please fill in your name, your business name and your first site.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) return message(box, 'err', 'Please check your email address.');
      if (pass.value.length < MIN_PASSWORD) return message(box, 'err', 'Use at least ' + MIN_PASSWORD + ' characters for your password. A few random words work well.');
      if (!terms.checked) return message(box, 'err', 'Please tick the box to agree to the terms and privacy notice.');
      await busy(btn, async () => {
        const { data, error } = await sb.auth.signUp({ email: v.email, password: pass.value, options: {
          emailRedirectTo: location.origin + '/app/',
          data: { signup_company: v.company, signup_full_name: v.name, signup_site_name: v.site, signup_site_address: v.addr, terms_accepted_at: new Date().toISOString(), signup_billing: (form.querySelector('input[name=su-billing]:checked') || {}).value === 'annual' ? 'annual' : 'monthly' } } });
        if (error) {
          const m = error.message || '';
          return message(box, 'err', error.status === 429 ? 'Too many attempts. Please wait a few minutes and try again.'
            : /already/i.test(m) ? 'That email already has an account. Try signing in, or reset your password.'
            : /signups? .*(not allowed|disabled)/i.test(m) ? 'Sign-up is not available right now. Please book a demo and we will help.'
            : /password/i.test(m) ? m : 'Sorry, we could not create the account: ' + m);
        }
        pass.value = '';
        if (data && data.session) return route();     // email confirmation is off (testing only): carry straight on
        viewCheckEmail(v.email);
      });
    } },
      h('label', { for: 'su-name' }, 'Your name'), name,
      h('label', { for: 'su-company' }, 'Business name'), company,
      h('label', { for: 'su-site' }, 'Your first site'), site,
      h('label', { for: 'su-addr' }, 'Site address (optional)'), addr,
      h('label', { for: 'su-email' }, 'Work email'), email,
      h('label', { for: 'su-pass' }, 'Password'), pass,
      billing,
      h('label', { class: 'check' }, terms, h('span', {}, 'I am signing up for a business and agree to the ', h('a', { href: '/terms/', target: '_blank', rel: 'noopener' }, 'terms and conditions'), '. I have read the ', h('a', { href: '/privacy/', target: '_blank', rel: 'noopener' }, 'privacy notice'), '. (Both open in a new tab.)')),
      btn, box,
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'linkbtn', onclick: () => viewLogin() }, 'I already have an account')));
    show(h('div', { class: 'card' }, h('h1', {}, 'Sign up'),
      h('p', { class: 'muted' }, 'Self-Managed Compliance Passport, for businesses. You can add more sites and people after you sign in.'), form));
  }

  function viewCheckEmail(email) {
    show(h('div', { class: 'card' }, h('h1', {}, 'Check your email'),
      h('p', {}, 'We have sent a link to ', h('strong', {}, email), '. Open it to confirm your address, then sign in.'),
      h('p', { class: 'muted' }, 'You will be asked to set up 2FA with an authenticator app the first time you sign in. It keeps your records safe. Nothing arrived? Check your spam folder.'),
      h('button', { class: 'btn ghost', onclick: () => viewLogin() }, 'Go to sign in')));
  }

  function viewSignupProblem(err) {
    const m = (err && err.message) || '';
    const text = /signup_closed/.test(m) ? 'Sign-up is not open at the moment. Please book a demo and we will get you started.'
      : /email_not_confirmed/.test(m) ? 'Your email address has not been confirmed yet. Open the link we emailed you, then sign in again.'
      : /invalid_details/.test(m) ? 'Some of the details were not accepted. Please contact Tremcore and we will set you up.'
      : 'We could not finish setting up your account. Please contact Tremcore.';
    show(h('div', { class: 'card' }, h('h1', {}, 'Almost there'), h('div', { class: 'msg err', role: 'alert' }, text),
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
    if (!session) { const q = new URLSearchParams(location.search); return q.has('invite') ? viewInviteSignup() : q.has('signup') ? viewSignup() : viewLogin(); }
    if (recovering) return viewReset();
    let { data: rows, error } = await sb.rpc('auth_requirements');
    let req = rows && rows[0];
    const meta = (session.user && session.user.user_metadata) || {};
    if (!error && !req && meta.signup_company && !finishingSignup) {
      finishingSignup = true;
      try {
        const made = await sb.rpc('signup_company', { p_company: meta.signup_company, p_full_name: meta.signup_full_name, p_site_name: meta.signup_site_name, p_site_address: meta.signup_site_address || null, p_billing: meta.signup_billing === 'annual' ? 'annual' : 'monthly' });
        if (made.error) return viewSignupProblem(made.error);
        ({ data: rows, error } = await sb.rpc('auth_requirements'));
        req = rows && rows[0];
      } finally { finishingSignup = false; }
    }
    if (!error && !req && meta.invited && !finishingSignup) {
      finishingSignup = true;
      try {
        const got = await sb.rpc('accept_invitation', { p_full_name: meta.signup_full_name || null });
        if (got.error) return viewSignupProblem(got.error);
        if (got.data) { ({ data: rows, error } = await sb.rpc('auth_requirements')); req = rows && rows[0]; }
      } finally { finishingSignup = false; }
    }
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
      else if (event === 'SIGNED_OUT' && !suppressSignedOut) { setTimeout(viewLogin, 0); }
    });
    await route();
  }

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/app/sw.js').catch(() => {});
  start();
})();
