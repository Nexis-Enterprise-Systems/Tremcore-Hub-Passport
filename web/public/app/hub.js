// Tremcore management hub (staff only). Stage 1: dashboard, clients, sites, compliance items, subscriptions, enquiries.
// Every read and write goes straight to Supabase as the signed-in staff member, so the database (row-level security)
// decides what is allowed; nothing here is trusted. Text is only ever inserted as text, never as HTML.
(function () {
  'use strict';

  const LEVELS = { 1: 'Self-Managed', 2: 'Managed Service', 3: 'Property & Compliance Managed' };
  const SUBS = { trial: 'Trial', active: 'Active', past_due: 'Past due', cancelled: 'Cancelled' };
  const BASIS = { legal: 'Legal', standard: 'Standard', best_practice: 'Best practice' };
  const STATUS = { green: 'In date', amber: 'Due soon', red: 'Overdue', missing: 'Not entered' };
  const ENQ = { new: 'New', contacted: 'Contacted', demo_booked: 'Demo booked', won: 'Won', lost: 'Lost' };
  const SITES = { '1': '1 site', '2-5': '2 to 5 sites', '6-20': '6 to 20 sites', '20+': 'More than 20 sites' };
  const ROLE = { client_super: 'Head office', client_site: 'Site user', tremcore_admin: 'Tremcore administrator', tremcore_staff: 'Tremcore staff' };
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const NAV = [['dashboard', 'Dashboard'], ['clients', 'Clients'], ['subscriptions', 'Subscriptions'], ['revenue', 'Revenue'], ['enquiries', 'Enquiries'], ['settings', 'Settings']];
  const navFor = () => NAV.filter((n) => n[0] !== 'settings' || (ctx && ctx.req.role_name === 'tremcore_admin'));

  let ctx = null, token = 0;

  // ---------- tiny DOM helpers ----------
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
  function s(tag, attrs, ...kids) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
    for (const kid of kids) el.append(kid.nodeType ? kid : document.createTextNode(kid));
    return el;
  }
  const money = (pence) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format((pence || 0) / 100);
  function parsePounds(text) {
    const t = String(text || '').replace(/[£,\s]/g, '');
    if (t === '') return 0;
    return /^\d{1,7}(\.\d{1,2})?$/.test(t) ? Math.round(parseFloat(t) * 100) : null;
  }
  function fmtDate(iso) {
    if (!iso) return 'Not entered';
    const d = new Date(iso + 'T00:00:00');
    return isNaN(d) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function addMonths(iso, n) {
    const [y, m, d] = iso.split('-').map(Number);
    const target = new Date(Date.UTC(y, m - 1 + n, 1));
    const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    target.setUTCDate(Math.min(d, last));
    return target.toISOString().slice(0, 10);
  }
  const validDate = (v) => v === '' || (/^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(new Date(v + 'T00:00:00')));
  async function q(promise) {
    const r = await promise;
    if (r.error) throw new Error(r.error.message || 'The request failed.');
    return r.data;
  }
  const loading = () => h('p', { class: 'muted' }, 'Loading…');
  const errorBox = (e) => h('div', { class: 'msg err', role: 'alert' }, 'Sorry, that did not work: ' + (e && e.message ? e.message : 'unknown error') + '. Check you are online and try again.');
  function note(box, kind, text) { box.replaceChildren(text ? h('div', { class: 'msg ' + kind, role: kind === 'err' ? 'alert' : 'status' }, text) : ''); }
  async function busy(btn, fn) {
    const label = btn.textContent; btn.disabled = true; btn.textContent = 'Please wait…';
    try { return await fn(); } finally { btn.disabled = false; btn.textContent = label; }
  }
  function field(id, label, el, hint) {
    el.id = id;
    return h('div', { class: 'f' }, h('label', { for: id }, label), el, hint && h('p', { class: 'hint' }, hint));
  }
  const text = (v, extra) => h('input', Object.assign({ type: 'text', value: v == null ? '' : v }, extra || {}));
  const area = (v) => h('textarea', { rows: '3' }, v == null ? '' : v);
  function select(options, current) {
    return h('select', {}, Object.entries(options).map(([k, label]) => h('option', { value: k, selected: String(k) === String(current) }, label)));
  }
  const badge = (kind, label) => h('span', { class: 'badge ' + kind }, label);

  // ---------- page frame ----------
  function chrome(active, ...content) {
    const r = ctx.req;
    document.body.classList.add('hub');
    ctx.root.replaceChildren(
      h('header', { class: 'hubbar' },
        h('img', { class: 'hublogo', src: '/img/logo-mark.png', alt: 'Tremcore' }),
        h('nav', { class: 'hubnav', 'aria-label': 'Hub sections' },
          navFor().map(([k, label]) => h('a', { href: '#/' + k, class: active === k ? 'on' : null, 'aria-current': active === k ? 'page' : null }, label))),
        h('div', { class: 'hubuser' },
          h('span', { class: 'muted' }, (r.full_name || 'Staff') + ' · ' + (ROLE[r.role_name] || r.role_name)),
          h('span', { class: 'badge ' + (ctx.hasFactor ? 'on' : 'off'), title: '2FA' }, ctx.hasFactor ? 'On' : 'Off'),
          h('button', { class: 'linkbtn', onclick: ctx.signOut }, 'Sign out'))),
      h('div', { class: 'hubmain' }, ...content));
  }

  function donut(sum, size) {
    const R = 40, C = 2 * Math.PI * R, total = Number(sum.total) || 0, pct = Number(sum.pct_in_date) || 0;
    const svg = s('svg', { viewBox: '0 0 100 100', width: size, height: size, role: 'img',
      'aria-label': total ? pct + '% in date, out of ' + total + ' items' : 'No compliance items yet' });
    svg.append(s('circle', { cx: 50, cy: 50, r: R, fill: 'none', stroke: '#2a2a2a', 'stroke-width': 12 }));
    let off = 0;
    for (const [k, col] of [['green', '#6ff0a8'], ['amber', '#ffc766'], ['red', '#ff8a80'], ['missing', '#8a8577']]) {
      const n = Number(sum[k]) || 0;
      if (!n || !total) continue;
      const len = C * n / total;
      svg.append(s('circle', { cx: 50, cy: 50, r: R, fill: 'none', stroke: col, 'stroke-width': 12,
        'stroke-dasharray': len + ' ' + (C - len), 'stroke-dashoffset': -off, transform: 'rotate(-90 50 50)' }));
      off += len;
    }
    svg.append(s('text', { x: 50, y: total ? 56 : 54, 'text-anchor': 'middle', 'font-size': total ? 20 : 16, fill: '#f4efe2' }, total ? pct + '%' : '–'));
    return svg;
  }
  const tile = (label, value, href) => h(href ? 'a' : 'div', { class: 'tile', href: href || null }, h('span', { class: 'tv' }, value), h('span', { class: 'tl' }, label));
  const counts = (sm) => h('span', { class: 'counts' },
    ['green', 'amber', 'red', 'missing'].map((k) => (Number(sm[k]) ? badge(k, sm[k] + ' ' + STATUS[k].toLowerCase()) : null)));

  // ---------- Dashboard ----------
  async function pageDashboard(my) {
    chrome('dashboard', h('h1', {}, 'Dashboard'), loading());
    const [companies, props, sums, enqs] = await Promise.all([
      q(ctx.sb.from('companies').select('id,name,level,subscription,monthly_value_pence,source')),
      q(ctx.sb.from('properties').select('id,company_id,name')),
      q(ctx.sb.from('property_summary').select('*')),
      q(ctx.sb.from('enquiries').select('id,status'))]);
    if (my !== token) return;
    const live = companies.filter((c) => c.subscription !== 'cancelled');
    const mrr = companies.filter((c) => c.subscription === 'active').reduce((t, c) => t + (c.monthly_value_pence || 0), 0);
    const tot = { green: 0, amber: 0, red: 0, missing: 0, total: 0 };
    for (const r of sums) for (const k of Object.keys(tot)) tot[k] += Number(r[k]) || 0;
    tot.pct_in_date = tot.total ? Math.round(100 * (tot.green + tot.amber) / tot.total) : null;
    const byLevel = (l) => live.filter((c) => c.level === l).length;
    const nameOf = Object.fromEntries(companies.map((c) => [c.id, c.name]));
    const needy = sums.filter((r) => Number(r.total) > 0 && (Number(r.red) + Number(r.amber) + Number(r.missing)) > 0)
      .sort((a, b) => (Number(a.pct_in_date) - Number(b.pct_in_date)) || String(a.name).localeCompare(b.name)).slice(0, 12);
    chrome('dashboard',
      h('h1', {}, 'Dashboard'),
      h('div', { class: 'tiles' },
        tile('Active clients', String(live.length), '#/clients'),
        tile('Sites', String(props.length), '#/clients'),
        tile('Monthly recurring revenue', money(mrr), '#/subscriptions'),
        tile('New enquiries', String(enqs.filter((e) => e.status === 'new').length), '#/enquiries'),
        tile('Self sign-ups to follow up', String(companies.filter((c) => c.source === 'self_signup' && c.subscription === 'trial').length), '#/clients')),
      h('section', { class: 'card' },
        h('h2', {}, 'Compliance across every site'),
        tot.total
          ? h('div', { class: 'overall' }, donut(tot, 120),
              h('div', {}, h('p', {}, tot.pct_in_date + '% of ' + tot.total + ' recorded items are in date.'), counts(tot),
                h('p', { class: 'hint' }, 'Items with no date entered count against the figure, never for it.')))
          : h('p', { class: 'muted' }, 'No compliance items have been added yet. Open a client, then a site, to add some.')),
      h('section', { class: 'card' },
        h('h2', {}, 'Packages'),
        h('p', {}, byLevel(1) + ' Self-Managed · ' + byLevel(2) + ' Managed Service' + (byLevel(3) ? ' · ' + byLevel(3) + ' Property & Compliance Managed' : ''))),
      h('section', { class: 'card' },
        h('h2', {}, 'Sites that need attention'),
        needy.length
          ? h('ul', { class: 'list' }, needy.map((r) => h('li', {},
              h('a', { class: 'rowlink', href: '#/sites/' + r.property_id }, donut(r, 44),
                h('span', { class: 'grow' }, h('strong', {}, r.name), h('span', { class: 'muted block' }, nameOf[r.company_id] || '')), counts(r)))))
          : h('p', { class: 'muted' }, 'Nothing needs attention right now.')));
  }

  // ---------- Clients ----------
  function clientForm(c, onSave) {
    const box = h('div');
    const f = {
      name: text(c.name, { required: true, autocomplete: 'off' }),
      level: select({ 1: LEVELS[1], 2: LEVELS[2] }, c.level),
      subscription: select(SUBS, c.subscription || 'trial'),
      value: text(((c.monthly_value_pence || 0) / 100).toFixed(2), { inputmode: 'decimal' }),
      contact_name: text(c.contact_name), contact_email: text(c.contact_email, { type: 'email' }), contact_phone: text(c.contact_phone, { type: 'tel' }),
      address: area(c.address), notes: area(c.notes),
      mfa: h('input', { type: 'checkbox', checked: !!c.require_mfa })
    };
    if (c.level === 3) f.level = select(LEVELS, 3);   // keep an existing Level 3 client editable
    const btn = h('button', { class: 'btn', type: 'submit' }, c.id ? 'Save client' : 'Add client');
    const form = h('form', { novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      const name = f.name.value.trim(), pence = parsePounds(f.value.value), email = f.contact_email.value.trim();
      if (!name) return note(box, 'err', 'Enter the client name.');
      if (pence === null) return note(box, 'err', 'Enter the monthly value as pounds, for example 49 or 49.50.');
      if (email && !EMAIL.test(email)) return note(box, 'err', 'Check the contact email address.');
      await busy(btn, async () => {
        try {
          await onSave({ name, level: Number(f.level.value), subscription: f.subscription.value, monthly_value_pence: pence,
            contact_name: f.contact_name.value.trim() || null, contact_email: email || null, contact_phone: f.contact_phone.value.trim() || null,
            address: f.address.value.trim() || null, notes: f.notes.value.trim() || null, require_mfa: f.mfa.checked }, box);
        } catch (err) { note(box, 'err', 'Could not save: ' + err.message); }
      });
    } },
      h('div', { class: 'grid2' },
        field('c-name', 'Client name', f.name),
        field('c-level', 'Package', f.level, 'Level 3 is not being offered yet.'),
        field('c-sub', 'Subscription', f.subscription),
        field('c-value', 'Monthly value (£)', f.value),
        field('c-cname', 'Contact name', f.contact_name),
        field('c-cemail', 'Contact email', f.contact_email),
        field('c-cphone', 'Contact phone', f.contact_phone)),
      field('c-address', 'Address', f.address),
      field('c-notes', 'Private notes (clients never see these)', f.notes),
      h('label', { class: 'check' }, f.mfa, ' Ask this client’s site users for 2FA too (head-office users always need it)'),
      btn, box);
    f.mfa.id = 'c-mfa';
    return form;
  }

  async function pageClients(my) {
    chrome('clients', h('h1', {}, 'Clients'), loading());
    const [companies, props] = await Promise.all([
      q(ctx.sb.from('companies').select('*').order('name', { ascending: true })),
      q(ctx.sb.from('properties').select('id,company_id'))]);
    if (my !== token) return;
    const siteCount = {}; for (const p of props) siteCount[p.company_id] = (siteCount[p.company_id] || 0) + 1;
    const body = h('tbody');
    const draw = (term) => {
      const t = term.trim().toLowerCase();
      const rows = companies.filter((c) => !t || c.name.toLowerCase().includes(t) || (c.contact_email || '').toLowerCase().includes(t));
      body.replaceChildren(...(rows.length ? rows.map((c) => h('tr', {},
        h('td', {}, h('a', { href: '#/clients/' + c.id }, c.name), c.source === 'self_signup' ? [' ', badge('new', 'Self sign-up')] : null), h('td', {}, LEVELS[c.level]),
        h('td', {}, badge('sub-' + c.subscription, SUBS[c.subscription])), h('td', { class: 'num' }, String(siteCount[c.id] || 0)),
        h('td', { class: 'num' }, money(c.monthly_value_pence))))
        : [h('tr', {}, h('td', { colspan: '5', class: 'muted' }, companies.length ? 'No clients match that search.' : 'No clients yet. Add your first one.'))]));
    };
    const search = h('input', { type: 'search', placeholder: 'Search clients', 'aria-label': 'Search clients', oninput: (e) => draw(e.target.value) });
    const addBox = h('section', { class: 'card', hidden: true });
    const addBtn = h('button', { class: 'btn small', onclick: () => {
      addBox.hidden = !addBox.hidden;
      if (!addBox.hidden) { addBox.replaceChildren(h('h2', {}, 'New client'), clientForm({ level: 1, subscription: 'trial' }, async (row) => {
        const made = await q(ctx.sb.from('companies').insert(row).select().single());
        location.hash = '#/clients/' + made.id;
      })); const first = addBox.querySelector('input'); if (first) first.focus(); }
    } }, 'Add client');
    draw('');
    chrome('clients', h('div', { class: 'titlerow' }, h('h1', {}, 'Clients'), addBtn), addBox,
      h('div', { class: 'toolbar' }, search),
      h('div', { class: 'tablewrap' }, h('table', {},
        h('thead', {}, h('tr', {}, ['Client', 'Package', 'Subscription', 'Sites', 'Monthly'].map((x, i) => h('th', { class: i > 2 ? 'num' : null }, x)))), body)));
  }

  async function pageClient(my, id) {
    chrome('clients', loading());
    const [c, props, sums, users] = await Promise.all([
      q(ctx.sb.from('companies').select('*').eq('id', id).maybeSingle()),
      q(ctx.sb.from('properties').select('*').eq('company_id', id).order('name', { ascending: true })),
      q(ctx.sb.from('property_summary').select('*').eq('company_id', id)),
      q(ctx.sb.from('profiles').select('id,full_name,role,perm,active').eq('company_id', id))]);
    if (my !== token) return;
    if (!c) return chrome('clients', h('p', {}, h('a', { href: '#/clients' }, '← All clients')), h('div', { class: 'msg err' }, 'That client could not be found.'));
    const sumOf = Object.fromEntries(sums.map((r) => [r.property_id, r]));
    const siteBox = h('div');
    const addSite = h('form', { class: 'inline', novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      const name = sn.value.trim();
      if (!name) return note(siteBox, 'err', 'Enter the site name.');
      try { const made = await q(ctx.sb.from('properties').insert({ company_id: id, name, address: sa.value.trim() || null }).select().single());
        location.hash = '#/sites/' + made.id; } catch (err) { note(siteBox, 'err', 'Could not add the site: ' + err.message); }
    } });
    const sn = text('', { placeholder: 'Site name', 'aria-label': 'New site name' }), sa = text('', { placeholder: 'Address (optional)', 'aria-label': 'New site address' });
    addSite.append(sn, sa, h('button', { class: 'btn small', type: 'submit' }, 'Add site'));
    const saved = h('div');
    chrome('clients',
      h('p', {}, h('a', { href: '#/clients' }, '← All clients')),
      h('div', { class: 'titlerow' }, h('h1', {}, c.name), badge('sub-' + c.subscription, SUBS[c.subscription])),
      c.source === 'self_signup' ? h('div', { class: 'msg ok' }, 'This client signed themselves up online. They are on a trial: contact ' + (c.contact_name || 'them') + (c.contact_email ? ' at ' + c.contact_email : '') + ' to agree the plan, then set the subscription to Active.') : null,
      h('section', { class: 'card' }, h('h2', {}, 'Client details'), clientForm(c, async (row, box) => {
        await q(ctx.sb.from('companies').update(row).eq('id', id)); Object.assign(c, row); note(box, 'ok', 'Saved.');
      })),
      h('section', { class: 'card' }, h('h2', {}, 'Sites'),
        props.length ? h('ul', { class: 'list' }, props.map((p) => h('li', {}, h('a', { class: 'rowlink', href: '#/sites/' + p.id },
          donut(sumOf[p.id] || {}, 44), h('span', { class: 'grow' }, h('strong', {}, p.name), h('span', { class: 'muted block' }, p.address || '')), counts(sumOf[p.id] || {})))))
          : h('p', { class: 'muted' }, 'No sites yet. Add the first one below.'),
        addSite, siteBox, saved),
      h('section', { class: 'card' }, h('h2', {}, 'People with a login'),
        users.length ? h('ul', { class: 'list' }, users.map((u) => h('li', { class: 'person' },
          h('strong', {}, u.full_name || 'Unnamed'), h('span', { class: 'muted' }, ROLE[u.role] + (u.role === 'client_site' && c.level === 1 ? ' · ' + u.perm : '')), u.active ? null : badge('missing', 'Switched off'))))
          : h('p', { class: 'muted' }, 'No one has a login for this client yet.'),
        h('p', { class: 'hint' }, 'Inviting people and resetting their 2FA needs Tremcore’s secret server key, so it comes in the next stage.')));
  }

  // ---------- Site: compliance items ----------
  function itemForm(item, libs, propertyId, onDone, onCancel) {
    const box = h('div'), isNew = !item.id;
    const f = {
      lib: h('select', {}, h('option', { value: '' }, 'Custom title…'), ...[...new Set(libs.map((l) => l.grp))].map((g) =>
        h('optgroup', { label: g }, libs.filter((l) => l.grp === g).map((l) => h('option', { value: l.id }, l.title))))),
      grp: text(item.grp || 'Other'), title: text(item.title, { required: true }), basis: select(BASIS, item.basis || 'standard'),
      freq: text(item.frequency_months, { inputmode: 'numeric' }), last: text(item.last_done, { type: 'date' }), due: text(item.due_date, { type: 'date' }), notes: area(item.notes)
    };
    f.lib.addEventListener('change', () => {
      const l = libs.find((x) => x.id === f.lib.value); if (!l) return;
      f.grp.value = l.grp; f.title.value = l.title; f.basis.value = l.default_basis; f.freq.value = l.default_frequency_months || '';
    });
    const btn = h('button', { class: 'btn small', type: 'submit' }, isNew ? 'Add item' : 'Save item');
    const form = h('form', { class: 'itemform', novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      const title = f.title.value.trim(), freqText = f.freq.value.trim(), last = f.last.value, due = f.due.value;
      if (!title) return note(box, 'err', 'Enter a title.');
      if (freqText && !/^[1-9]\d{0,2}$/.test(freqText)) return note(box, 'err', 'Frequency is a whole number of months, for example 12.');
      if (!validDate(last) || !validDate(due)) return note(box, 'err', 'Check the dates.');
      const freq = freqText ? Number(freqText) : null;
      // If only "last done" and a frequency are known, work out the next due date. Otherwise leave it exactly as entered
      // (empty stays empty, so it shows as "Not entered" and never as green).
      const finalDue = due || (last && freq ? addMonths(last, freq) : null);
      const row = { grp: f.grp.value.trim() || 'Other', title, basis: f.basis.value, frequency_months: freq, last_done: last || null, due_date: finalDue, notes: f.notes.value.trim() };
      await busy(btn, async () => {
        try {
          if (isNew) await q(ctx.sb.from('compliance_items').insert(Object.assign({ property_id: propertyId, library_id: f.lib.value || null, created_by: ctx.userId }, row)));
          else await q(ctx.sb.from('compliance_items').update(row).eq('id', item.id));
          onDone();
        } catch (err) { note(box, 'err', 'Could not save: ' + err.message); }
      });
    } },
      isNew && field('i-lib-' + (item.id || 'new'), 'Start from the standard list', f.lib),
      h('div', { class: 'grid2' },
        field('i-title-' + (item.id || 'new'), 'Title', f.title), field('i-grp-' + (item.id || 'new'), 'Group', f.grp),
        field('i-basis-' + (item.id || 'new'), 'Basis', f.basis), field('i-freq-' + (item.id || 'new'), 'Repeats every (months)', f.freq),
        field('i-last-' + (item.id || 'new'), 'Last done', f.last), field('i-due-' + (item.id || 'new'), 'Due date', f.due, 'Leave empty to work it out from last done and the frequency.')),
      field('i-notes-' + (item.id || 'new'), 'Notes', f.notes),
      h('div', { class: 'actions' }, btn, h('button', { class: 'btn ghost small', type: 'button', onclick: onCancel }, 'Cancel')), box);
    return form;
  }

  async function pageSite(my, id) {
    chrome('clients', loading());
    const [p, rows, libs] = await Promise.all([
      q(ctx.sb.from('properties').select('*').eq('id', id).maybeSingle()),
      q(ctx.sb.from('compliance_status').select('*').eq('property_id', id)),
      q(ctx.sb.from('category_library').select('*').order('grp', { ascending: true }))]);
    if (my !== token) return;
    if (!p) return chrome('clients', h('p', {}, h('a', { href: '#/clients' }, '← All clients')), h('div', { class: 'msg err' }, 'That site could not be found.'));
    const c = await q(ctx.sb.from('companies').select('id,name,level').eq('id', p.company_id).maybeSingle());
    if (my !== token) return;
    const sum = { green: 0, amber: 0, red: 0, missing: 0, total: rows.length };
    for (const r of rows) sum[r.status]++;
    sum.pct_in_date = sum.total ? Math.round(100 * (sum.green + sum.amber) / sum.total) : null;
    const ORDER = { red: 0, amber: 1, missing: 2, green: 3 };
    rows.sort((a, b) => ORDER[a.status] - ORDER[b.status] || String(a.due_date).localeCompare(String(b.due_date)) || a.title.localeCompare(b.title));
    let filter = 'all', openId = null, adding = false, confirmId = null;
    const holder = h('div');
    const redraw = () => {
      const shown = rows.filter((r) => filter === 'all' || r.status === filter);
      holder.replaceChildren(
        h('div', { class: 'chips', role: 'group', 'aria-label': 'Filter items' },
          [['all', 'All (' + rows.length + ')']].concat(Object.keys(STATUS).map((k) => [k, STATUS[k] + ' (' + sum[k] + ')'])).map(([k, label]) =>
            h('button', { class: 'chip' + (filter === k ? ' on' : ''), 'aria-pressed': String(filter === k), onclick: () => { filter = k; redraw(); } }, label))),
        shown.length ? h('ul', { class: 'items' }, shown.map((r) => h('li', { class: 'item ' + r.status },
          h('div', { class: 'itemrow' },
            h('span', { class: 'grow' }, h('strong', {}, r.title), h('span', { class: 'muted block' }, r.grp + ' · ' + BASIS[r.basis] + (r.frequency_months ? ' · every ' + r.frequency_months + ' months' : ''))),
            h('span', { class: 'due' }, h('span', {}, fmtDate(r.due_date)), r.due_date != null && r.days_left != null ? h('span', { class: 'muted block' }, r.days_left < 0 ? Math.abs(r.days_left) + ' days overdue' : r.days_left + ' days left') : null),
            badge(r.status, STATUS[r.status]),
            h('button', { class: 'btn ghost small', onclick: () => { openId = openId === r.id ? null : r.id; confirmId = null; redraw(); } }, openId === r.id ? 'Close' : 'Edit')),
          openId === r.id ? h('div', { class: 'editpanel' }, itemForm(r, libs, id, () => { openId = null; reload(); }, () => { openId = null; confirmId = null; redraw(); }),
            confirmId === r.id
              ? h('div', { class: 'actions' }, h('span', { class: 'muted' }, 'Delete this item and its history link?'),
                  h('button', { class: 'btn danger small', onclick: async (e) => { await busy(e.target, async () => {
                    try { await q(ctx.sb.from('compliance_items').delete().eq('id', r.id)); reload(); } catch (err) { chrome('clients', errorBox(err)); } }); } }, 'Yes, delete'),
                  h('button', { class: 'btn ghost small', onclick: () => { confirmId = null; redraw(); } }, 'Keep'))
              : h('button', { class: 'linkbtn', onclick: () => { confirmId = r.id; redraw(); } }, 'Delete this item')) : null)))
          : h('p', { class: 'muted' }, rows.length ? 'Nothing in this view.' : 'No compliance items yet. Add the first one.'));
    };
    const reload = () => pageSite(++token, id);
    const addPanel = h('div');
    const addBtn = h('button', { class: 'btn small', onclick: () => {
      adding = !adding;
      addPanel.replaceChildren(adding ? h('section', { class: 'card' }, h('h2', {}, 'Add a compliance item'), itemForm({}, libs, id, reload, () => { adding = false; addPanel.replaceChildren(); })) : '');
    } }, 'Add item');
    chrome('clients',
      h('p', {}, h('a', { href: '#/clients' }, 'Clients'), ' / ', c ? h('a', { href: '#/clients/' + c.id }, c.name) : '…'),
      h('div', { class: 'titlerow' }, h('h1', {}, p.name), addBtn),
      p.address ? h('p', { class: 'muted' }, p.address) : null,
      h('section', { class: 'card overall' }, donut(sum, 110),
        h('div', {}, sum.total ? h('p', {}, sum.pct_in_date + '% of ' + sum.total + ' recorded items are in date.') : h('p', {}, 'No items recorded yet.'), counts(sum),
          h('p', { class: 'hint' }, 'Green is more than 30 days away, amber is within 30 days, red is overdue. Items with no date are never green.'))),
      addPanel,
      h('section', { class: 'card' }, h('h2', {}, 'Compliance items'), holder));
    redraw();
  }

  // ---------- Subscriptions ----------
  async function pageSubscriptions(my) {
    chrome('subscriptions', h('h1', {}, 'Subscriptions'), loading());
    const companies = await q(ctx.sb.from('companies').select('id,name,level,subscription,monthly_value_pence').order('name', { ascending: true }));
    if (my !== token) return;
    const mrr = companies.filter((c) => c.subscription === 'active').reduce((t, c) => t + (c.monthly_value_pence || 0), 0);
    const n = (fn) => String(companies.filter(fn).length);
    chrome('subscriptions', h('h1', {}, 'Subscriptions'),
      h('div', { class: 'tiles' },
        tile('Monthly recurring revenue (active)', money(mrr)), tile('Self-Managed', n((c) => c.level === 1 && c.subscription !== 'cancelled')),
        tile('Managed Service', n((c) => c.level === 2 && c.subscription !== 'cancelled')), tile('Past due', n((c) => c.subscription === 'past_due'))),
      h('p', { class: 'hint' }, 'Subscriptions are recorded by hand for now. Automatic billing comes later.'),
      h('div', { class: 'tablewrap' }, h('table', {},
        h('thead', {}, h('tr', {}, ['Client', 'Package', 'Subscription', 'Monthly (£)', ''].map((x) => h('th', {}, x)))),
        h('tbody', {}, companies.length ? companies.map((c) => {
          const st = select(SUBS, c.subscription), val = text((c.monthly_value_pence / 100).toFixed(2), { inputmode: 'decimal' });
          st.setAttribute('aria-label', 'Subscription for ' + c.name); val.setAttribute('aria-label', 'Monthly value for ' + c.name);
          const out = h('span', { class: 'muted', role: 'status' });
          const save = h('button', { class: 'btn ghost small', onclick: async () => {
            const pence = parsePounds(val.value);
            if (pence === null) return out.replaceChildren('Enter pounds, e.g. 49.50');
            await busy(save, async () => { try { await q(ctx.sb.from('companies').update({ subscription: st.value, monthly_value_pence: pence }).eq('id', c.id)); out.replaceChildren('Saved'); }
              catch (err) { out.replaceChildren('Not saved: ' + err.message); } });
          } }, 'Save');
          return h('tr', {}, h('td', {}, h('a', { href: '#/clients/' + c.id }, c.name)), h('td', {}, LEVELS[c.level]), h('td', {}, st), h('td', {}, val), h('td', {}, save, ' ', out));
        }) : [h('tr', {}, h('td', { colspan: '5', class: 'muted' }, 'No clients yet.'))]))));
  }

  // ---------- Revenue & growth ----------
  async function pageRevenue(my) {
    chrome('revenue', h('h1', {}, 'Revenue & growth'), loading());
    const companies = await q(ctx.sb.from('companies').select('id,name,level,subscription,monthly_value_pence,source,created_at'));
    if (my !== token) return;
    const active = companies.filter((c) => c.subscription === 'active');
    const mrr = active.reduce((t, c) => t + (c.monthly_value_pence || 0), 0);
    const count = (st) => companies.filter((c) => c.subscription === st).length;
    const ever = companies.filter((c) => c.subscription !== 'trial').length;
    const conv = companies.length ? Math.round((active.length / companies.length) * 100) + '%' : '-';
    const avg = active.length ? money(Math.round(mrr / active.length)) : '-';
    const months = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); months.push({ key: d.getFullYear() + '-' + d.getMonth(), label: d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }), n: 0, self: 0 }); }
    companies.forEach((c) => { const d = new Date(c.created_at); const m = months.find((x) => x.key === d.getFullYear() + '-' + d.getMonth()); if (m) { m.n += 1; if (c.source === 'self_signup') m.self += 1; } });
    const byLevel = [1, 2, 3].map((l) => { const rows = active.filter((c) => c.level === l); return { l, n: rows.length, v: rows.reduce((t, c) => t + (c.monthly_value_pence || 0), 0) }; }).filter((r) => r.l !== 3 || r.n);
    const top = active.slice().sort((a, b) => (b.monthly_value_pence || 0) - (a.monthly_value_pence || 0)).slice(0, 5);
    const noValue = active.filter((c) => !c.monthly_value_pence).length;
    chrome('revenue', h('h1', {}, 'Revenue & growth'),
      h('div', { class: 'tiles' },
        tile('Monthly recurring revenue', money(mrr)), tile('Yearly run rate', money(mrr * 12)),
        tile('Paying clients', String(active.length)), tile('Average per paying client', avg),
        tile('On trial', String(count('trial'))), tile('Past due', String(count('past_due'))),
        tile('Cancelled', String(count('cancelled'))), tile('Trial to paying', conv)),
      noValue ? h('div', { class: 'msg' }, noValue + ' active client' + (noValue === 1 ? ' has' : 's have') + ' no monthly value set, so the figures above are low. Set them on the Subscriptions page.') : null,
      h('p', { class: 'hint' }, 'Based on the subscriptions and monthly values you record by hand. When Stripe is connected these will fill in automatically. Figures exclude VAT.'),
      h('div', { class: 'grid2' },
        h('div', { class: 'card' }, h('h2', {}, 'Revenue by package'), h('div', { class: 'tablewrap' }, h('table', {},
          h('thead', {}, h('tr', {}, ['Package', 'Paying', 'Monthly'].map((x) => h('th', {}, x)))),
          h('tbody', {}, byLevel.length ? byLevel.map((r) => h('tr', {}, h('td', {}, LEVELS[r.l]), h('td', { class: 'num' }, String(r.n)), h('td', { class: 'num' }, money(r.v)))) : [h('tr', {}, h('td', { colspan: '3', class: 'muted' }, 'No paying clients yet.'))])))),
        h('div', { class: 'card' }, h('h2', {}, 'New clients, last 6 months'), h('div', { class: 'tablewrap' }, h('table', {},
          h('thead', {}, h('tr', {}, ['Month', 'New', 'Self sign-ups'].map((x) => h('th', {}, x)))),
          h('tbody', {}, months.map((m) => h('tr', {}, h('td', {}, m.label), h('td', { class: 'num' }, String(m.n)), h('td', { class: 'num' }, String(m.self)))))))),
        h('div', { class: 'card' }, h('h2', {}, 'Biggest paying clients'), h('div', { class: 'tablewrap' }, h('table', {},
          h('thead', {}, h('tr', {}, ['Client', 'Monthly'].map((x) => h('th', {}, x)))),
          h('tbody', {}, top.length ? top.map((c) => h('tr', {}, h('td', {}, h('a', { href: '#/clients/' + c.id }, c.name)), h('td', { class: 'num' }, money(c.monthly_value_pence)))) : [h('tr', {}, h('td', { colspan: '2', class: 'muted' }, 'No paying clients yet.'))]))))));
  }

  // ---------- Enquiries ----------
  async function pageEnquiries(my) {
    chrome('enquiries', h('h1', {}, 'Enquiries'), loading());
    const rows = await q(ctx.sb.from('enquiries').select('*').order('created_at', { ascending: false }));
    if (my !== token) return;
    chrome('enquiries', h('h1', {}, 'Enquiries'),
      h('p', { class: 'hint' }, 'From the “Book a demo” form on the website. Newest first.'),
      rows.length ? rows.map((e) => {
        const st = select(ENQ, e.status), nt = area(e.notes), out = h('span', { class: 'muted', role: 'status' });
        st.setAttribute('aria-label', 'Status for ' + e.name); nt.setAttribute('aria-label', 'Notes for ' + e.name);
        const save = h('button', { class: 'btn small', onclick: async () => {
          await busy(save, async () => { try { await q(ctx.sb.from('enquiries').update({ status: st.value, notes: nt.value.trim() }).eq('id', e.id)); out.replaceChildren('Saved'); }
            catch (err) { out.replaceChildren('Not saved: ' + err.message); } });
        } }, 'Save');
        return h('section', { class: 'card enq' },
          h('div', { class: 'titlerow' }, h('h2', {}, e.name + (e.company ? ' · ' + e.company : '')), h('span', { class: 'muted' }, new Date(e.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }))),
          h('p', {}, h('a', { href: 'mailto:' + e.email }, e.email), e.phone ? ' · ' : '', e.phone ? h('a', { href: 'tel:' + e.phone.replace(/[^\d+]/g, '') }, e.phone) : null),
          h('p', { class: 'muted' }, [e.sites ? SITES[e.sites] : null, e.package_interest ? 'Interested in Self-Managed' : null].filter(Boolean).join(' · ')),
          e.message ? h('p', { class: 'quote' }, e.message) : null,
          h('div', { class: 'grid2' }, h('div', { class: 'f' }, h('label', {}, 'Status'), st), h('div', { class: 'f' }, h('label', {}, 'Notes'), nt)),
          h('div', { class: 'actions' }, save, out));
      }) : h('p', { class: 'muted' }, 'No enquiries yet.'));
  }


  // ---------- Settings (administrators only) ----------
  async function pageSettings(my) {
    chrome('settings', h('h1', {}, 'Settings'), loading());
    const rows = await q(ctx.sb.from('app_settings').select('key,value').eq('key', 'self_signup_open'));
    if (my !== token) return;
    const open = rows.length > 0 && rows[0].value === true;
    const out = h('div');
    const btn = h('button', { class: 'btn small' + (open ? ' danger' : ''), onclick: async () => {
      await busy(btn, async () => {
        try {
          const done = await q(ctx.sb.from('app_settings').update({ value: !open, updated_at: new Date().toISOString() }).eq('key', 'self_signup_open').select());
          if (!done || !done.length) throw new Error('Only a Tremcore administrator can change this.');
          pageSettings(++token);
        } catch (err) { note(out, 'err', 'Not changed: ' + err.message); }
      });
    } }, open ? 'Close sign-up' : 'Open sign-up');
    chrome('settings', h('h1', {}, 'Settings'),
      h('section', { class: 'card' },
        h('div', { class: 'titlerow' }, h('h2', {}, 'Self-Managed sign-up'), badge(open ? 'green' : 'missing', open ? 'Open' : 'Closed')),
        h('p', {}, open
          ? 'Businesses can create their own Self-Managed account from the website and the sign-in page. Each one starts as a trial with no charge, and appears under Clients marked “Self sign-up”.'
          : 'Sign-up is closed. The website shows only “Book a demo” and nobody can create an account for themselves.'),
        h('p', { class: 'hint' }, 'Before opening: in Supabase switch on email sign-ups and “Confirm email”, add the site address to the allowed redirect URLs, and have the Terms and Privacy pages checked and finished.'),
        btn, out));
  }

  // ---------- routing ----------
  async function render() {
    if (!ctx) return;
    const my = ++token;
    const [a, id] = (location.hash.replace(/^#\/?/, '') || 'dashboard').split('/');
    try {
      if (a === 'clients' && id && UUID.test(id)) await pageClient(my, id);
      else if (a === 'sites' && id && UUID.test(id)) await pageSite(my, id);
      else if (a === 'clients') await pageClients(my);
      else if (a === 'subscriptions') await pageSubscriptions(my);
      else if (a === 'revenue') await pageRevenue(my);
      else if (a === 'enquiries') await pageEnquiries(my);
      else if (a === 'settings' && ctx.req.role_name === 'tremcore_admin') await pageSettings(my);
      else await pageDashboard(my);
    } catch (e) { if (my === token) chrome(a === 'clients' || a === 'sites' ? 'clients' : (navFor().some((n) => n[0] === a) ? a : 'dashboard'), errorBox(e)); }
    if (my === token) window.scrollTo(0, 0);
  }

  window.TCHub = {
    // Called by the sign-in code once a Tremcore staff member has fully signed in (2FA included).
    async mount(c) {
      ctx = c;
      try { const { data } = await ctx.sb.auth.getSession(); ctx.userId = (data && data.session && data.session.user && data.session.user.id) || null; } catch { ctx.userId = null; }
      window.removeEventListener('hashchange', render); window.addEventListener('hashchange', render);
      await render();
    },
    unmount() { window.removeEventListener('hashchange', render); ctx = null; token++; }
  };
})();
