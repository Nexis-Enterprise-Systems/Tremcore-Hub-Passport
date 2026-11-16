// The public clock in / out page. No login: the secret code in the address says which site this is.
(function () {
  'use strict';
  const root = document.getElementById('clock');
  const token = (location.pathname.match(/[0-9a-f]{32}/) || [''])[0];
  const KEY = 'tc_clock_me_' + token.slice(0, 8);
  let info = null, search = '';
  const h = (tag, attrs, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) { if (v == null || v === false) continue; if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v === true ? '' : v); }
    kids.flat(Infinity).forEach((c) => { if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c)); });
    return el;
  };
  const show = (...n) => { root.replaceChildren(h('div', { class: 'brand' }, 'Tremcore'), ...n.flat(Infinity).filter((x) => x != null && x !== false)); window.scrollTo(0, 0); };
  const hhmm = (iso) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }).format(new Date(iso));
  const dayWord = (iso) => { const f = (d) => new Intl.DateTimeFormat('en-GB', { dateStyle: 'short', timeZone: 'Europe/London' }).format(d); return f(new Date(iso)) === f(new Date()) ? 'today' : new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' }).format(new Date(iso)); };
  const length = (a, b) => { const m = Math.max(0, Math.round((new Date(b) - new Date(a)) / 60000)); return Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0') + ' min'; };
  const remembered = () => { try { return localStorage.getItem(KEY); } catch (e) { return null; } };
  const remember = (id) => { try { if (id) localStorage.setItem(KEY, id); else localStorage.removeItem(KEY); } catch (e) { /* ignore */ } };

  async function api(method, body) {
    try {
      const r = await fetch('/api/clock' + (method === 'GET' ? '?t=' + encodeURIComponent(token) : ''), method === 'GET' ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({})); return { ok: r.ok, status: r.status, data: j };
    } catch (e) { return { ok: false, status: 0, data: { error: 'No signal. Please check your connection and try again.' } }; }
  }
  async function load() {
    const r = await api('GET');
    if (!r.ok) return show(h('div', { class: 'card' }, h('h1', {}, 'Clock in is not available'), h('p', { class: 'muted' }, (r.data && r.data.error) || 'Please ask your manager.')));
    info = r.data; const me = remembered();
    if (me && info.people.some((p) => p.id === me)) return person(me); else remember(null);
    list();
  }
  function list() {
    const q = search.trim().toLowerCase();
    const shown = info.people.filter((p) => !q || p.name.toLowerCase().includes(q));
    const box = h('input', { type: 'search', id: 'cl-search', placeholder: 'Find your name', autocomplete: 'off', 'aria-label': 'Find your name', value: search, oninput: (e) => { search = e.target.value; const pos = e.target.selectionStart; list(); const n = document.getElementById('cl-search'); n.focus(); n.setSelectionRange(pos, pos); } });
    show(h('h1', {}, info.site), h('p', { class: 'muted' }, 'Tap your name to clock in or out.'),
      info.people.length ? box : null,
      info.people.length ? h('div', { class: 'people' }, shown.map((p) => h('button', { class: 'person', type: 'button', 'data-person': p.id, onclick: () => person(p.id) }, h('span', {}, p.name), p.in ? h('span', { class: 'tag in' }, 'In') : null)))
        : h('div', { class: 'card' }, h('p', {}, 'Nobody has been added for this site yet. Please ask your manager.')),
      info.people.length && !shown.length ? h('p', { class: 'muted' }, 'No one with that name. Check the spelling, or ask your manager to add you.') : null);
  }
  function person(id, msg) {
    const p = info.people.find((x) => x.id === id); if (!p) return list();
    const btn = h('button', { class: 'big' + (p.in ? ' out' : ''), type: 'button', id: 'cl-go', onclick: async () => {
      btn.disabled = true; const r = await api('POST', { t: token, member: id, action: p.in ? 'out' : 'in' });
      if (!r.ok || !r.data || !r.data.status) { btn.disabled = false; return person(id, (r.data && r.data.error) || 'Sorry, that did not work. Please try again.'); }
      done(r.data, id);
    } }, p.in ? 'Clock out' : 'Clock in');
    show(h('h1', {}, p.name), h('p', { class: 'muted' }, info.site + (p.in ? ' · you are clocked in' : '')), btn,
      msg ? h('div', { class: 'msg err', role: 'alert' }, msg) : null,
      h('button', { class: 'linkbtn', type: 'button', id: 'cl-notme', onclick: () => { remember(null); search = ''; list(); } }, 'Not you? Choose a different name'));
  }
  async function done(r, id) {
    const outc = r.status === 'out' || r.status === 'already_out';
    const line = r.status === 'in' ? 'Clocked in at ' + hhmm(r.at) : r.status === 'out' ? 'Clocked out at ' + hhmm(r.at) + ' · you were in for ' + length(r.since, r.at)
      : r.status === 'already_in' ? 'You were already clocked in since ' + hhmm(r.at) + ' ' + dayWord(r.at) : 'You were already clocked out';
    const head = r.status === 'in' ? 'Clocked in' : r.status === 'out' ? 'Clocked out' : r.status === 'already_in' ? 'Already in' : 'Already out';
    const keep = remembered() === id ? null : h('button', { class: 'linkbtn', type: 'button', id: 'cl-remember', onclick: (e) => { remember(id); e.target.replaceWith(h('p', { class: 'muted small' }, 'Done. On this phone this page will open straight to you.')); } }, 'This is my own phone: remember me');
    show(h('div', { class: 'card done', 'data-result': r.status }, h('div', { class: 'tick' + (outc ? ' outc' : ''), 'aria-hidden': 'true' }, '✓'), h('h1', {}, head), h('p', {}, r.name), h('p', { class: 'muted' }, line)),
      h('div', { class: 'center' }, keep, h('button', { class: 'linkbtn', type: 'button', id: 'cl-done', onclick: async () => { search = ''; const x = await api('GET'); if (x.ok) info = x.data; remembered() ? person(id) : list(); } }, 'Done')));
  }
  if (!token) show(h('div', { class: 'card' }, h('h1', {}, 'Clock in is not available'), h('p', { class: 'muted' }, 'Please scan the QR code at your workplace.')));
  else load();
})();
