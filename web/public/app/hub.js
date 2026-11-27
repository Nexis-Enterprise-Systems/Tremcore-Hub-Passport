// Tremcore management hub (staff only). Stage 1: dashboard, clients, sites, compliance items, subscriptions, enquiries.
// Every read and write goes straight to Supabase as the signed-in staff member, so the database (row-level security)
// decides what is allowed; nothing here is trusted. Text is only ever inserted as text, never as HTML.
(function () {
  'use strict';

  const LEVELS = { 1: 'Self-Managed', 2: 'Managed Service', 3: 'Property & Compliance Managed' };
  const BILLING = { monthly: 'Monthly', annual: 'Yearly (15% off)' };
  const SUBS = { trial: 'Unpaid (awaiting payment)', active: 'Active', past_due: 'Past due', cancelled: 'Cancelled' };
  const BASIS = { legal: 'Legal', standard: 'Standard', best_practice: 'Best practice' };
  const STAGES = { due_soon: 'Due soon', booking_required: 'Booking required', booked: 'Booked', completed: 'Completed' };
  const STATUS = { green: 'In date', amber: 'Due soon', red: 'Overdue', missing: 'Not entered' };
  const ENQ = { new: 'New', contacted: 'Contacted', demo_booked: 'Demo booked', won: 'Won', lost: 'Lost' };
  const SITES = { '1': '1 site', '2-5': '2 to 5 sites', '6-20': '6 to 20 sites', '20+': 'More than 20 sites' };
  const ROLE = { client_super: 'Head office', client_site: 'Site user', tremcore_admin: 'Tremcore administrator', tremcore_staff: 'Tremcore staff' };
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const NAV = [['dashboard', 'Dashboard'], ['clients', 'Clients'], ['renewals', 'Renewals'], ['subscriptions', 'Subscriptions'], ['managed', 'Tremcore Managed'], ['interest', 'Interest list'], ['offers', 'Offers'], ['revenue', 'Revenue'], ['enquiries', 'Enquiries'], ['activity', 'Activity'], ['settings', 'Settings']];
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
  // Names start every word with a capital letter (the database does the same on save).
  const titleCase = (t) => String(t || '').replace(/(^|[\s\-'])([a-z])/g, (m, a, b) => a + b.toUpperCase());
  const nameBox = (v, extra) => { const el = text(v, extra); el.addEventListener('blur', () => { el.value = titleCase(el.value.trim()); }); return el; };
  const text = (v, extra) => h('input', Object.assign({ type: 'text', value: v == null ? '' : v }, extra || {}));
  const area = (v) => h('textarea', { rows: '3' }, v == null ? '' : v);
  function select(options, current) {
    return h('select', {}, Object.entries(options).map(([k, label]) => h('option', { value: k, selected: String(k) === String(current) }, label)));
  }
  const badge = (kind, label) => h('span', { class: 'badge ' + kind }, label);

  // ---------- page frame ----------
  // Menu groups, in the order they appear in the sidebar.
  const NAV_GROUPS = [['Overview', ['dashboard']], ['Customers', ['clients', 'subscriptions', 'managed', 'renewals']], ['Growth', ['interest', 'offers', 'revenue', 'enquiries']], ['System', ['activity', 'settings']]];
  function chrome(active, ...content) {
    const r = ctx.req;
    document.body.classList.add('hub');
    const items = Object.fromEntries(navFor());
    const burger = h('button', { type: 'button', class: 'hubburger', 'aria-label': 'Menu', 'aria-expanded': 'false', 'aria-controls': 'hub-menu', onclick: () => {
      const open = side.classList.toggle('open'); burger.setAttribute('aria-expanded', String(open));
    } }, h('span'), h('span'), h('span'));
    const side = h('header', { class: 'hubbar hubside' },
      h('div', { class: 'hubtop' },
        h('a', { href: '#/dashboard', class: 'hubbrand', 'aria-label': 'Tremcore Hub home' }, h('img', { class: 'hublogo', src: '/img/logo-mark.png', alt: 'Tremcore' }), h('span', { class: 'hubtitle' }, 'Management Hub')),
        burger),
      h('div', { class: 'hubmenu', id: 'hub-menu' },
        h('form', { class: 'hubsearch', role: 'search', onsubmit: (e) => { e.preventDefault(); const v = e.target.elements.q.value.trim(); if (v) { location.hash = '#/search/' + encodeURIComponent(v); side.classList.remove('open'); } } },
          h('input', { type: 'search', name: 'q', id: 'hub-search', placeholder: 'Search all clients (gas, EICR…)', 'aria-label': 'Search all clients', autocomplete: 'off', value: (location.hash.match(/^#\/search\/(.*)/) || [, ''])[1] ? decodeURIComponent(location.hash.replace(/^#\/search\//, '')) : '' })),
        h('nav', { class: 'hubnav', 'aria-label': 'Hub sections' },
          NAV_GROUPS.map(([label, keys]) => {
            const links = keys.filter((k) => items[k]).map((k) => h('a', { href: '#/' + k, class: active === k ? 'on' : null, 'aria-current': active === k ? 'page' : null }, items[k]));
            return links.length ? h('div', { class: 'hubgroup' }, h('div', { class: 'hubgroup-label' }, label), ...links) : null;
          })),
        h('div', { class: 'hubuser' },
          h('div', { class: 'muted' }, (r.full_name || 'Staff') + ' · ' + (ROLE[r.role_name] || r.role_name)),
          h('div', { class: 'hubuser-row' }, h('span', { class: 'muted small' }, '2FA'), h('span', { class: 'badge ' + (ctx.hasFactor ? 'on' : 'off'), title: '2FA' }, ctx.hasFactor ? 'On' : 'Off')),
          h('div', { class: 'hubuser-actions' }, h('button', { class: 'linkbtn', id: 'hub-refresh', onclick: (e) => { e.target.textContent = 'Refreshing…'; window.TCRefresh && window.TCRefresh(); } }, 'Refresh'), h('button', { class: 'linkbtn', onclick: ctx.signOut }, 'Sign out')))));
    const here = location.hash.replace(/^#\/?/, '').split('/');
    const back = !here[0] || here[0] === 'dashboard' ? null : h('button', { type: 'button', class: 'hubback', id: 'hub-back', onclick: () => {
      if (pagesSeen > 1) history.back(); else location.hash = (here[0] === 'clients' || here[0] === 'sites') && here[1] ? '#/clients' : '#/dashboard';
    } }, h('span', { 'aria-hidden': 'true' }, '‹'), ' Back');
    ctx.root.replaceChildren(side, h('div', { class: 'hubmain' }, back, ...content));
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
      name: nameBox(c.name, { required: true, autocomplete: 'off' }),
      level: select({ 1: LEVELS[1], 2: LEVELS[2] }, c.level),
      subscription: select(SUBS, c.subscription || 'trial'),
      billing: select(BILLING, c.billing_interval || 'monthly'),
      value: text(((c.monthly_value_pence || 0) / 100).toFixed(2), { inputmode: 'decimal' }),
      contact_name: nameBox(c.contact_name), contact_email: text(c.contact_email, { type: 'email' }), contact_phone: window.TCFormat.tidyBox(text(c.contact_phone, { type: 'tel', placeholder: '01634 123456' }), 'phone'),
      address: window.TCFormat.tidyBox(area(c.address)), postcode: window.TCFormat.tidyBox(text(c.postcode, { maxlength: '12', placeholder: 'ME3 8FX' }), 'postcode'), notes: area(c.notes),
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
      const ph = window.TCFormat.phone(f.contact_phone.value), pc = window.TCFormat.postcode(f.postcode.value);
      if (!ph.ok) return note(box, 'err', window.TCFormat.PHONE_HELP);
      if (!pc.ok) return note(box, 'err', window.TCFormat.POSTCODE_HELP);
      await busy(btn, async () => {
        try {
          await onSave({ name, level: Number(f.level.value), subscription: f.subscription.value, billing_interval: f.billing.value, monthly_value_pence: pence,
            contact_name: f.contact_name.value.trim() || null, contact_email: email || null, contact_phone: ph.value || null,
            address: window.TCFormat.cap(f.address.value.trim()) || null, postcode: pc.value || null, notes: f.notes.value.trim() || null, require_mfa: f.mfa.checked }, box);
        } catch (err) { note(box, 'err', 'Could not save: ' + err.message); }
      });
    } },
      h('div', { class: 'grid2' },
        field('c-name', 'Client name', f.name),
        field('c-level', 'Package', f.level, 'Level 3 is not being offered yet.'),
        field('c-sub', 'Subscription', f.subscription),
        field('c-billing', 'Billing', f.billing),
        field('c-value', 'Monthly value (£)', f.value, 'For yearly clients, enter the yearly price divided by 12.'),
        field('c-cname', 'Contact name', f.contact_name),
        field('c-cemail', 'Contact email', f.contact_email),
        field('c-cphone', 'Contact phone', f.contact_phone)),
      h('div', { class: 'grid2' }, field('c-address', 'Address', f.address), field('c-postcode', 'Postcode', f.postcode)),
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
      const name = window.TCFormat.cap(sn.value.trim()), spc = window.TCFormat.postcode(sp.value);
      if (!name) return note(siteBox, 'err', 'Enter the site name.');
      if (!spc.ok) return note(siteBox, 'err', window.TCFormat.POSTCODE_HELP);
      try { const made = await q(ctx.sb.from('properties').insert({ company_id: id, name, address: window.TCFormat.cap(sa.value.trim()) || null, postcode: spc.value || null }).select().single());
        location.hash = '#/sites/' + made.id; } catch (err) { note(siteBox, 'err', 'Could not add the site: ' + err.message); }
    } });
    const sn = nameBox('', { placeholder: 'Site name', 'aria-label': 'New site name' }), sa = text('', { placeholder: 'Address (optional)', 'aria-label': 'New site address' });
    const sp = window.TCFormat.tidyBox(text('', { placeholder: 'Postcode', 'aria-label': 'New site postcode', maxlength: '12' }), 'postcode');
    addSite.append(sn, sa, sp, h('button', { class: 'btn small', type: 'submit' }, 'Add site'));
    const saved = h('div');
    chrome('clients',
      h('p', {}, h('a', { href: '#/clients' }, '← All clients')),
      h('div', { class: 'titlerow' }, h('h1', {}, c.name), badge('sub-' + c.subscription, SUBS[c.subscription])),
      c.source === 'self_signup' ? h('div', { class: 'msg ok' }, 'This client signed themselves up online. They are on a trial: contact ' + (c.contact_name || 'them') + (c.contact_email ? ' at ' + c.contact_email : '') + ' to agree the plan, then set the subscription to Active. They chose ' + (c.billing_interval === 'annual' ? 'yearly billing (15% off)' : 'monthly billing') + '.') : null,
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
    const companies = await q(ctx.sb.from('companies').select('id,name,level,subscription,monthly_value_pence,billing_interval').order('name', { ascending: true }));
    if (my !== token) return;
    const mrr = companies.filter((c) => c.subscription === 'active').reduce((t, c) => t + (c.monthly_value_pence || 0), 0);
    const n = (fn) => String(companies.filter(fn).length);
    chrome('subscriptions', h('h1', {}, 'Subscriptions'),
      h('div', { class: 'tiles' },
        tile('Monthly recurring revenue (active)', money(mrr)), tile('Self-Managed', n((c) => c.level === 1 && c.subscription !== 'cancelled')),
        tile('Managed Service', n((c) => c.level === 2 && c.subscription !== 'cancelled')), tile('Past due', n((c) => c.subscription === 'past_due'))),
      h('p', { class: 'hint' }, 'Subscriptions are recorded by hand for now. Automatic billing comes later. The monthly value is what the client pays per month; for yearly clients, enter the yearly price divided by 12.'),
      h('div', { class: 'tablewrap' }, h('table', {},
        h('thead', {}, h('tr', {}, ['Client', 'Package', 'Subscription', 'Billing', 'Monthly (£)', ''].map((x) => h('th', {}, x)))),
        h('tbody', {}, companies.length ? companies.map((c) => {
          const st = select(SUBS, c.subscription), bl = select(BILLING, c.billing_interval || 'monthly'), val = text((c.monthly_value_pence / 100).toFixed(2), { inputmode: 'decimal' });
          st.setAttribute('aria-label', 'Subscription for ' + c.name); bl.setAttribute('aria-label', 'Billing for ' + c.name); val.setAttribute('aria-label', 'Monthly value for ' + c.name);
          const out = h('span', { class: 'muted', role: 'status' });
          const save = h('button', { class: 'btn ghost small', onclick: async () => {
            const pence = parsePounds(val.value);
            if (pence === null) return out.replaceChildren('Enter pounds, e.g. 49.50');
            await busy(save, async () => { try { await q(ctx.sb.from('companies').update({ subscription: st.value, billing_interval: bl.value, monthly_value_pence: pence }).eq('id', c.id)); out.replaceChildren('Saved'); }
              catch (err) { out.replaceChildren('Not saved: ' + err.message); } });
          } }, 'Save');
          return h('tr', {}, h('td', {}, h('a', { href: '#/clients/' + c.id }, c.name)), h('td', {}, LEVELS[c.level]), h('td', {}, st), h('td', {}, bl), h('td', {}, val), h('td', {}, save, ' ', out));
        }) : [h('tr', {}, h('td', { colspan: '6', class: 'muted' }, 'No clients yet.'))]))));
  }

  // ---------- Offers (introductory discount codes) ----------
  // One code per prospect. The first site is £7.00 a month cheaper for 12 months (so £7.99 instead of £14.99); extra sites stay at the normal price.
  async function pageOffers(my, flash) {
    chrome('offers', h('h1', {}, 'Offers'), loading());
    const codes = await q(ctx.sb.from('offer_codes').select('*').order('created_at', { ascending: false }));
    if (my !== token) return;
    const usedIds = [...new Set(codes.map((c) => c.used_company).filter(Boolean))];
    const used = usedIds.length ? await q(ctx.sb.from('companies').select('id,name,offer_ends_at').in('id', usedIds)) : [];
    if (my !== token) return;
    const co = Object.fromEntries(used.map((c) => [c.id, c]));
    // Everyone who signed up with any discount code, so the codes can be monitored.
    const withCode = await q(ctx.sb.from('companies').select('id,name,offer_code,subscription').not('offer_code', 'is', null));
    if (my !== token) return;
    const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
    const stateOf = (c) => c.status === 'used' ? ['green', 'Used'] : c.status === 'cancelled' ? ['missing', 'Switched off'] : c.reusable ? ['green', 'Always on'] : new Date(c.expires_at) <= new Date() ? ['red', 'Expired'] : ['amber', 'Waiting'];
    const out = h('div', { id: 'offer-out' });
    const name = text('', { id: 'of-name', autocomplete: 'off', maxlength: '120' }), email = text('', { id: 'of-email', type: 'email', inputmode: 'email', autocomplete: 'off' });
    const days = select({ '14': '14 days', '30': '30 days', '60': '60 days', '90': '90 days' }, '30');
    const kind = select({ discount: 'Introductory offer (first site for 12 months)', free: 'Free access (no payment)' }, 'discount'); kind.id = 'of-kind';
    const price = text('7.99', { id: 'of-price', inputmode: 'decimal', autocomplete: 'off' });
    const fcode = text('', { id: 'fl-code', autocomplete: 'off', maxlength: '24' }), fprice = text('12.99', { id: 'fl-price', inputmode: 'decimal', autocomplete: 'off' }), fname = text('Flyers', { id: 'fl-name', maxlength: '120' });
    const toPence = (v) => { const n = Math.round(parseFloat(String(v).replace(/[^0-9.]/g, '')) * 100); return n >= 1 && n <= 1499 ? n : null; };
    const showResult = (j) => {
      const link = h('input', { type: 'text', readonly: true, value: j.link, 'aria-label': 'Sign-up link', id: 'offer-link' });
      const copy = h('button', { class: 'btn ghost small', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(j.link); copy.textContent = 'Copied'; } catch (e) { link.select(); } } }, 'Copy link');
      out.replaceChildren(h('div', { class: 'msg ' + (j.sent ? 'ok' : 'err'), role: 'status' }, (j.sent ? 'Email sent. ' : (j.note || '') + ' '), 'Code ', h('strong', {}, j.code)), link, ' ', copy);
    };
    const call = async (body) => {
      const { data } = await ctx.sb.auth.getSession();
      const r = await fetch('/api/send-offer', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ((data && data.session && data.session.access_token) || '') }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'That did not work.');
      return j;
    };
    const create = h('button', { class: 'btn', type: 'button', id: 'offer-create', onclick: async () => {
      const em = email.value.trim();
      if (!EMAIL.test(em)) return note(out, 'err', 'Please enter the prospect’s email address.');
      if (kind.value === 'discount' && toPence(price.value) == null) return note(out, 'err', 'Please enter the first-site price as pounds, for example 7.99 (between £0.01 and £14.99).');
      await busy(create, async () => {
        try { const j = await call({ email: em, name: titleCase(name.value.trim()), days: Number(days.value), kind: kind.value, price_pence: kind.value === 'discount' ? toPence(price.value) : null }); await pageOffers(++token, j); }
        catch (err) { note(out, 'err', err.message); }
      });
    } }, 'Create code and email it');
    const fout = h('div', { id: 'flyer-out' });
    const fcreate = h('button', { class: 'btn', type: 'button', id: 'flyer-create', onclick: async () => {
      const pc = toPence(fprice.value), cd = fcode.value.trim().toUpperCase();
      if (pc == null) return note(fout, 'err', 'Please enter the first-site price as pounds, for example 12.99.');
      if (cd && !/^[A-Z0-9-]{6,24}$/.test(cd)) return note(fout, 'err', 'The code must be 6 to 24 letters, numbers or dashes.');
      await busy(fcreate, async () => {
        try { await q(ctx.sb.rpc('create_offer_code', { p_email: '', p_name: fname.value.trim() || 'Flyers', p_days: 30, p_kind: 'discount', p_price_pence: pc, p_forever: true, p_code: cd || null })); await pageOffers(++token); }
        catch (err) { note(fout, 'err', 'The code was not made: ' + err.message); }
      });
    } }, 'Create flyer code');
    chrome('offers', h('h1', {}, 'Offers'),
      h('section', { class: 'card', id: 'flyer-card' }, h('h2', {}, 'Flyer code (always on)'),
        h('p', { class: 'hint' }, 'A code that never runs out and can be used by any number of new sign-ups, for printing on flyers. It only works for a new sign-up, never on an account that is already paying, and you can switch it off at any time. Prices are per month + VAT for the first site, for the first 12 months.'),
        h('div', { class: 'grid2' }, field('fl-code', 'Code (leave blank to make one)', fcode), field('fl-price', 'First site price a month (£)', fprice)),
        field('fl-name', 'Label (for your own reference)', fname),
        h('div', { class: 'actions' }, fcreate), fout),
      h('section', { class: 'card' }, h('h2', {}, 'Introductory offer for Self-Managed'),
        h('p', { class: 'hint' }, 'First site is cheaper for the first 12 months (normally £14.99), then it goes back to £14.99 by itself. Extra sites are the normal £7.99. Monthly billing only. Each code works once, for one prospect. Set the price below if you want something other than £7.99.'),
        h('div', { class: 'grid2' }, field('of-name', 'Prospect’s name (optional)', name), field('of-email', 'Prospect’s email', email)),
        h('div', { class: 'f' }, h('label', { for: 'of-kind' }, 'Type of code'), kind),
        field('of-price', 'First site price a month, £ (offer codes only)', price),
        h('div', { class: 'f' }, h('label', {}, 'Code is valid for'), days),
        h('div', { class: 'actions' }, create), out),
      (() => {
        const by = (code) => withCode.filter((x) => x.offer_code === code);
        const paying = (l) => l.filter((x) => x.subscription === 'active' || x.subscription === 'past_due').length, trial = (l) => l.filter((x) => x.subscription === 'trial').length, gone = (l) => l.filter((x) => x.subscription === 'cancelled' || x.subscription === 'expired').length;
        const tally = codes.map((c) => ({ c, l: by(c.code) })).filter((x) => x.l.length || x.c.reusable).sort((a, b) => b.l.length - a.l.length);
        const flyer = codes.find((c) => c.code === 'TREM2428');
        return h('section', { class: 'card', id: 'code-tally' }, h('h2', {}, 'Discount code tally'),
          h('p', { class: 'hint' }, 'Everyone who has signed up using a discount code. Paying means their subscription is active.'),
          h('div', { class: 'tiles' }, tile('Signed up with any code', String(withCode.length)), flyer ? tile('TREM2428 (\u00a312.99 intro, flyers)', String(by('TREM2428').length)) : null, tile('Paying now', String(paying(withCode))), tile('On free trial', String(trial(withCode)))),
          h('div', { class: 'tablewrap' }, h('table', { id: 'tally-table' },
            h('thead', {}, h('tr', {}, ['Code', 'Used for', 'Signed up', 'Paying', 'On trial', 'Cancelled'].map((x) => h('th', {}, x)))),
            h('tbody', {}, tally.length ? tally.map(({ c, l }) => h('tr', { 'data-tally': c.code }, h('td', {}, h('strong', {}, c.code)), h('td', {}, c.kind === 'free' ? 'Free access' : c.discount_pence ? 'First site \u00a3' + ((1499 - c.discount_pence) / 100).toFixed(2) : ''), h('td', { class: 'num' }, String(l.length)), h('td', { class: 'num' }, String(paying(l))), h('td', { class: 'num' }, String(trial(l))), h('td', { class: 'num' }, String(gone(l)))))
              : [h('tr', {}, h('td', { colspan: '6', class: 'muted' }, 'No code has been used yet.'))]))));
      })(),
      h('h2', {}, 'Codes'),
      h('div', { class: 'tablewrap' }, h('table', { id: 'offer-table' },
        h('thead', {}, h('tr', {}, ['Code', 'Prospect', 'Status', 'Emailed', 'Valid until', 'Used by', ''].map((x) => h('th', {}, x)))),
        h('tbody', {}, codes.length ? codes.map((c) => {
          const [kind, label] = stateOf(c), rowOut = h('span', { class: 'muted', role: 'status' }), live = kind === 'amber' || (c.reusable && c.status === 'active');
          const resend = live && !c.reusable ? h('button', { class: 'btn ghost small', onclick: async () => { await busy(resend, async () => { try { const j = await call({ id: c.id }); rowOut.replaceChildren(j.sent ? 'Sent again' : (j.note || 'Not sent')); } catch (err) { rowOut.replaceChildren(err.message); } }); } }, c.sent_at ? 'Resend' : 'Send') : null;
          const off = live ? h('button', { class: 'btn ghost small', onclick: async () => { await busy(off, async () => { try { await q(ctx.sb.rpc('cancel_offer_code', { p_id: c.id })); await pageOffers(++token); } catch (err) { rowOut.replaceChildren('Not switched off: ' + err.message); } }); } }, 'Switch off') : null;
          const copyLink = live ? h('button', { class: 'btn ghost small', onclick: async () => { const l = location.origin + '/app/?signup=1&code=' + encodeURIComponent(c.code); try { await navigator.clipboard.writeText(l); rowOut.replaceChildren('Link copied'); } catch (e) { rowOut.replaceChildren(l); } } }, 'Copy link') : null;
          const cc = c.used_company && co[c.used_company];
          return h('tr', { 'data-code': c.code }, h('td', {}, h('strong', {}, c.code), c.kind === 'free' ? h('div', { class: 'muted small' }, 'Free access') : c.discount_pence ? h('div', { class: 'muted small' }, 'First site £' + ((1499 - c.discount_pence) / 100).toFixed(2)) : null), h('td', {}, [c.prospect_name, c.prospect_email].filter(Boolean).join(' · ')), h('td', {}, badge(kind, label)),
            h('td', {}, c.reusable ? 'Flyers' : c.sent_at ? day(c.sent_at) : 'Not emailed'), h('td', {}, c.reusable ? 'Never expires' : day(c.expires_at)),
            h('td', {}, c.reusable ? c.uses + (c.uses === 1 ? ' sign-up' : ' sign-ups') : cc ? [h('a', { href: '#/clients/' + cc.id }, cc.name), cc.offer_ends_at ? h('div', { class: 'muted small' }, 'Offer price until ' + day(cc.offer_ends_at)) : null] : ''),
            h('td', {}, copyLink, ' ', resend, ' ', off, ' ', rowOut));
        }) : [h('tr', {}, h('td', { colspan: '7', class: 'muted' }, 'No codes yet.'))]))));
    if (flash) showResult(flash);
  }


  // ---------- Tremcore Managed: the VIP clients (Level 2 / 3), managed offer codes ----------
  let managedTab = 'overview', floorCo = '', floorProp = '', floorFrame = null;
  // Floor plan editor: a locked-down frame that cannot reach the hub's sign-in. The plans go in through the frame name and come back out as messages,
  // and are saved here, with the staff member's own sign-in, so the database decides who may change them.
  window.addEventListener('message', async (ev) => {
    if (!floorFrame || ev.source !== floorFrame.el.contentWindow || !ev.data || ev.data.tc !== 'fp-save' || !Array.isArray(ev.data.plans)) return;
    const st = document.getElementById('floor-status'), pid = floorFrame.prop;
    if (st) st.textContent = 'Saving\u2026';
    try { await q(ctx.sb.from('floor_plans').update({ data: ev.data.plans }).eq('property_id', pid)); if (st) st.textContent = 'Saved at ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); }
    catch (err) { if (st) st.textContent = 'Not saved: ' + err.message + '. Keep this page open and try a small change again.'; }
  });
  async function pageManaged(my, flash) {
    chrome('managed', h('h1', {}, 'Tremcore Managed'), loading());
    const [companies, props, summary, extras, codes, landlords, lsites] = await Promise.all([
      q(ctx.sb.from('companies').select('id,name,level,subscription,monthly_value_pence,free_access,contact_name,contact_email,created_at')),
      q(ctx.sb.from('properties').select('id,company_id,name')),
      q(ctx.sb.from('property_summary').select('*')),
      q(ctx.sb.from('company_extras').select('company_id,extra_code,status')),
      q(ctx.sb.from('offer_codes').select('*').eq('managed', true).order('created_at', { ascending: false })),
      managedTab === 'landlords' ? q(ctx.sb.from('landlords').select('*').order('created_at', { ascending: false })) : Promise.resolve([]),
      managedTab === 'landlords' ? q(ctx.sb.from('landlord_sites').select('id,landlord_id,status')) : Promise.resolve([])]);
    if (my !== token) return;
    const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
    const vip = companies.filter((c) => c.level >= 2 && c.subscription !== 'cancelled').sort((a, b) => (b.monthly_value_pence || 0) - (a.monthly_value_pence || 0));
    const sitesOf = (id) => props.filter((x) => x.company_id === id), addonsOf = (id) => extras.filter((x) => x.company_id === id && x.status !== 'cancelled').length;
    const pctOf = (id) => { const rows = summary.filter((x) => x.company_id === id); const tot = rows.reduce((t, r) => t + Number(r.total || 0), 0), ok = rows.reduce((t, r) => t + Number(r.green || 0) + Number(r.amber || 0), 0); return tot ? Math.round(100 * ok / tot) : null; };
    const total = vip.reduce((t, c) => t + (c.monthly_value_pence || 0), 0), nSites = vip.reduce((t, c) => t + sitesOf(c.id).length, 0);
    const reload = (t) => { if (t) managedTab = t; floorFrame = null; return pageManaged(++token); };
    const tabs = h('div', { class: 'actions', role: 'tablist' }, ...[['overview', 'Overview'], ['floor', 'Floor plan'], ['codes', 'Managed offer codes'], ['landlords', 'Landlord sub-hubs']].map(([k, l]) => h('button', { type: 'button', role: 'tab', 'data-mtab': k, 'aria-selected': String(managedTab === k), class: managedTab === k ? 'btn small' : 'btn ghost small', onclick: () => reload(k) }, l)));
    let body;
    if (managedTab === 'codes') {
      const out = h('div', { id: 'managed-out' });
      const name = text('', { id: 'mc-name', autocomplete: 'off', maxlength: '120' }), email = text('', { id: 'mc-email', type: 'email', inputmode: 'email', autocomplete: 'off' });
      const price = text('9.99', { id: 'mc-price', inputmode: 'decimal', autocomplete: 'off' });
      const days = select({ '14': '14 days', '30': '30 days', '60': '60 days', '90': '90 days' }, '30');
      const toP = (v) => { const n = Math.round(parseFloat(String(v).replace(/[^0-9.]/g, '')) * 100); return Number.isFinite(n) && n >= 1 && n <= 100000 ? n : null; };
      const make = h('button', { class: 'btn', type: 'button', id: 'managed-create', onclick: async () => {
        const em = email.value.trim(), pc = toP(price.value);
        if (!EMAIL.test(em)) return note(out, 'err', 'Please enter the client\u2019s email address.');
        if (pc == null) return note(out, 'err', 'Please enter the price per site as pounds, for example 9.99.');
        await busy(make, async () => { try { const r = await q(ctx.sb.rpc('create_managed_code', { p_email: em, p_name: titleCase(name.value.trim()), p_days: Number(days.value), p_price_pence: pc })); await pageManaged(++token, { code: r.code, link: location.origin + '/app/?signup=1&code=' + encodeURIComponent(r.code) }); } catch (err) { note(out, 'err', 'The code was not made: ' + err.message); } });
      } }, 'Create managed code');
      const pickCo = select(Object.fromEntries([['', 'Choose a client\u2026']].concat(companies.filter((c) => c.level < 2 && c.subscription !== 'cancelled').map((c) => [c.id, c.name]))), '');
      const mprice = text('0.00', { id: 'mm-price', inputmode: 'decimal', autocomplete: 'off' }), mout = h('div', { id: 'make-out' });
      const mk = h('button', { class: 'btn ghost', type: 'button', id: 'make-managed', onclick: async () => {
        const pc = toP(mprice.value); if (!pickCo.value) return note(mout, 'err', 'Please choose a client.'); if (pc == null) return note(mout, 'err', 'Please enter the price per site as pounds.');
        if (!window.confirm('Make this client managed (view-only for them, every add-on open)?')) return;
        await busy(mk, async () => { try { await q(ctx.sb.rpc('make_managed', { p_company: pickCo.value, p_price_pence: pc })); await pageManaged(++token, { done: true }); } catch (err) { note(mout, 'err', 'That did not work: ' + err.message); } });
      } }, 'Make managed');
      body = [
        h('section', { class: 'card' }, h('h2', {}, 'New managed offer code'),
          h('p', { class: 'hint' }, 'The client signs up with the link (monthly billing) and pays through Stripe at the price per site you set here, for all their sites. When the payment clears their account becomes Managed Compliance (view-only for them) with every add-on open. You can set a different price on each code.'),
          h('div', { class: 'grid2' }, field('mc-name', 'Client\u2019s name (optional)', name), field('mc-email', 'Client\u2019s email', email)),
          h('div', { class: 'grid2' }, field('mc-price', 'Price per site a month, \u00a3 (before VAT)', price), h('div', { class: 'f' }, h('label', {}, 'Code is valid for'), days)),
          h('div', { class: 'actions' }, make), out),
        h('section', { class: 'card' }, h('h2', {}, 'Make an existing client managed'),
          h('p', { class: 'hint' }, 'Moves a client you already have onto Tremcore Managed: Level 2, every add-on open, valued at the price per site below. This does not change what Stripe charges them: update their subscription in Stripe to match.'),
          h('div', { class: 'grid2' }, h('div', { class: 'f' }, h('label', {}, 'Client'), pickCo), field('mm-price', 'Price per site a month, \u00a3', mprice)),
          h('div', { class: 'actions' }, mk), mout),
        h('h2', {}, 'Managed codes'),
        h('div', { class: 'tablewrap' }, h('table', { id: 'managed-codes' }, h('thead', {}, h('tr', {}, ['Code', 'Prospect', 'Price per site', 'Status', 'Valid until', ''].map((x) => h('th', {}, x)))),
          h('tbody', {}, codes.length ? codes.map((c) => {
            const cc = c.used_company && companies.find((x) => x.id === c.used_company), live = c.status === 'active' && new Date(c.expires_at) > new Date(), msg = h('span', { class: 'muted', role: 'status' });
            const link = location.origin + '/app/?signup=1&code=' + encodeURIComponent(c.code);
            const copy = live ? h('button', { class: 'btn ghost small', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(link); msg.replaceChildren('Link copied'); } catch (e) { msg.replaceChildren(link); } } }, 'Copy link') : null;
            const off = live ? h('button', { class: 'btn ghost small', type: 'button', onclick: async () => { try { await q(ctx.sb.rpc('cancel_offer_code', { p_id: c.id })); await pageManaged(++token); } catch (err) { msg.replaceChildren('Not switched off'); } } }, 'Switch off') : null;
            return h('tr', { 'data-mcode': c.code }, h('td', {}, h('strong', {}, c.code)), h('td', {}, c.prospect_name || c.prospect_email || ''), h('td', { class: 'num' }, money(c.managed_price_pence)),
              h('td', {}, c.status === 'used' ? ['Used by ', cc ? h('a', { href: '#/clients/' + cc.id }, cc.name) : ''] : c.status === 'cancelled' ? 'Switched off' : live ? 'Waiting' : 'Expired'), h('td', {}, day(c.expires_at)), h('td', {}, copy, ' ', off, ' ', msg));
          }) : [h('tr', {}, h('td', { colspan: '6', class: 'muted' }, 'No managed codes yet.'))])))];
    } else if (managedTab === 'landlords') {
      const out = h('div', { id: 'landlord-out' });
      const name = text('', { id: 'ld-name', autocomplete: 'off', maxlength: '160' }), cname = text('', { id: 'ld-contact', autocomplete: 'off', maxlength: '120' });
      const email = text('', { id: 'ld-email', type: 'email', inputmode: 'email', autocomplete: 'off' }), price = text('9.99', { id: 'ld-price', inputmode: 'decimal', autocomplete: 'off' });
      const toP = (v) => { const n = Math.round(parseFloat(String(v).replace(/[^0-9.]/g, '')) * 100); return Number.isFinite(n) && n >= 1 && n <= 100000 ? n : null; };
      const make = h('button', { class: 'btn', type: 'button', id: 'landlord-create', onclick: async () => {
        const em = email.value.trim(), pc = toP(price.value);
        if (!name.value.trim()) return note(out, 'err', 'Please enter the landlord\u2019s company name.');
        if (!EMAIL.test(em)) return note(out, 'err', 'Please enter the landlord\u2019s email address.');
        if (pc == null) return note(out, 'err', 'Please enter the fixed price per site as pounds, for example 9.99.');
        await busy(make, async () => { try { await q(ctx.sb.rpc('create_landlord', { p_name: titleCase(name.value.trim()), p_contact_name: titleCase(cname.value.trim()), p_email: em, p_price_pence: pc })); await pageManaged(++token, { landlord: true }); } catch (err) { note(out, 'err', 'That did not work: ' + err.message); } });
      } }, 'Create landlord sub-hub');
      body = [
        h('section', { class: 'card' }, h('h2', {}, 'New landlord sub-hub'),
          h('p', { class: 'hint' }, 'For a landlord with many tenants. It is free to the landlord and is not advertised anywhere. The price per site is fixed here and the landlord cannot change it: it is the price a tenant pays Tremcore when the tenant is paying. The landlord then chooses their own core checks and invites tenants.'),
          h('div', { class: 'grid2' }, field('ld-name', 'Landlord company', name), field('ld-contact', 'Contact name (optional)', cname)),
          h('div', { class: 'grid2' }, field('ld-email', 'Landlord\u2019s email', email), field('ld-price', 'Fixed price per site a month, \u00a3 (before VAT)', price)),
          h('div', { class: 'actions' }, make), out),
        h('h2', {}, 'Landlords'),
        h('div', { class: 'tablewrap' }, h('table', { id: 'landlord-table' }, h('thead', {}, h('tr', {}, ['Landlord', 'Contact', 'Price per site', 'Sites', 'Add a login'].map((x) => h('th', {}, x)))),
          h('tbody', {}, landlords.length ? landlords.map((l) => {
            const msg = h('span', { class: 'muted', role: 'status' }), le = text('', { type: 'email', inputmode: 'email', autocomplete: 'off', 'aria-label': 'Login email for ' + l.name, placeholder: 'Their login email' });
            const add = h('button', { class: 'btn ghost small', type: 'button', onclick: async () => {
              if (!EMAIL.test(le.value.trim())) return msg.replaceChildren('Enter an email address.');
              try { const ok = await q(ctx.sb.rpc('add_landlord_login', { p_landlord: l.id, p_email: le.value.trim() })); msg.replaceChildren(ok ? 'Login added' : 'No account with that email yet. They need to sign up first.'); if (ok) le.value = ''; } catch (err) { msg.replaceChildren('That did not work: ' + err.message); }
            } }, 'Add');
            return h('tr', { 'data-landlord': l.name }, h('td', {}, h('strong', {}, l.name)), h('td', {}, [l.contact_name, l.contact_email].filter(Boolean).join(' \u00b7 ')), h('td', { class: 'num' }, money(l.price_per_site_pence)),
              h('td', { class: 'num' }, String(lsites.filter((x) => x.landlord_id === l.id && x.status !== 'cancelled').length)), h('td', {}, le, ' ', add, ' ', msg));
          }) : [h('tr', {}, h('td', { colspan: '5', class: 'muted' }, 'No landlord sub-hubs yet.'))]))),
        h('p', { class: 'hint' }, 'The landlord\u2019s own sign-in page and overview are the next step. Their price is fixed and shown to them read-only.')];
    } else if (managedTab === 'floor') {
      const area = h('div', { id: 'floor-area' });
      const allCo = companies.filter((c) => c.subscription !== 'cancelled').sort((a, b) => String(a.name).localeCompare(String(b.name)));
      const coSel = select(Object.fromEntries([['', 'Choose a client\u2026']].concat(allCo.map((c) => [c.id, c.name]))), floorCo);
      coSel.id = 'floor-client';
      const mine = props.filter((x) => x.company_id === floorCo);
      if (floorCo && !mine.some((x) => x.id === floorProp)) floorProp = mine.length === 1 ? mine[0].id : '';
      const siteSel = select(Object.fromEntries([['', mine.length ? 'Choose a site\u2026' : 'No sites yet']].concat(mine.map((x) => [x.id, x.name]))), floorProp);
      siteSel.id = 'floor-site';
      coSel.addEventListener('change', () => { floorCo = coSel.value; floorProp = ''; floorFrame = null; reload('floor'); });
      const openFloor = async () => {
        area.replaceChildren(h('p', { class: 'muted' }, 'Opening the floor plan\u2026'));
        try {
          let rows = await q(ctx.sb.from('floor_plans').select('data,public_key').eq('property_id', floorProp));
          if (!rows.length) { await q(ctx.sb.from('floor_plans').insert({ property_id: floorProp, data: [] })); rows = await q(ctx.sb.from('floor_plans').select('data,public_key').eq('property_id', floorProp)); }
          const row = rows[0]; if (!row) throw new Error('the plan could not be created');
          const { data: { session } } = await ctx.sb.auth.getSession();
          const r = await fetch('/api/addon-ticket', { method: 'POST', headers: { Authorization: 'Bearer ' + ((session && session.access_token) || ''), 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'floorplan' }) });
          const j = await r.json().catch(() => ({}));
          if (!r.ok || !j.url) return note(area, 'err', j.error || 'Sorry, the floor plan could not be opened. Please try again.');
          const pr = props.find((x) => x.id === floorProp), link = location.origin + '/f/' + row.public_key;
          const f = h('iframe', { class: 'posterframe', id: 'floor-frame', title: 'Floor plan', sandbox: 'allow-scripts allow-downloads allow-modals allow-popups', referrerpolicy: 'no-referrer',
            name: JSON.stringify({ site: { id: row.public_key.slice(0, 6), name: pr ? pr.name : '' }, plans: Array.isArray(row.data) ? row.data : [], planUrl: link }), src: j.url });
          floorFrame = { el: f, prop: floorProp };
          area.replaceChildren(h('p', { class: 'hint', id: 'floor-status', role: 'status' }, 'Changes save by themselves.'), f,
            h('p', { class: 'hint' }, 'The QR code on the poster points to ', h('a', { href: link, target: '_blank', rel: 'noopener', id: 'floor-link' }, link), '. It shows each floor as it was when you last pressed Finish, and nothing else. The address is private and cannot be guessed.'));
        } catch (err) { note(area, 'err', 'Sorry, the floor plan could not be opened: ' + err.message); }
      };
      siteSel.addEventListener('change', () => { floorProp = siteSel.value; floorFrame = null; if (floorProp) openFloor(); else area.replaceChildren(); });
      body = [h('section', { class: 'card' }, h('h2', {}, 'Floor plan'),
        h('p', { class: 'hint' }, 'Draw the floors of a site, mark the fire panel, gas valve, stop cock and electrics, and finish to make the QR poster. Plans are saved to the site in the database.'),
        h('div', { class: 'grid2' }, h('div', { class: 'f' }, h('label', { for: 'floor-client' }, 'Client'), coSel), h('div', { class: 'f' }, h('label', { for: 'floor-site' }, 'Site'), siteSel))), area];
      body.openFloor = floorProp ? openFloor : null;
    } else {
      body = [
        h('div', { class: 'tiles' }, tile('Managed clients', String(vip.length)), tile('Sites', String(nSites)), tile('Monthly value', money(total)), tile('Add-ons open', String(extras.filter((x) => vip.some((c) => c.id === x.company_id) && x.status !== 'cancelled').length))),
        h('div', { class: 'tablewrap' }, h('table', { id: 'managed-table' }, h('thead', {}, h('tr', {}, ['Client', 'Package', 'Sites', 'In date', 'Add-ons', 'Monthly', 'Contact'].map((x) => h('th', {}, x)))),
          h('tbody', {}, vip.length ? vip.map((c) => { const pc = pctOf(c.id); return h('tr', { 'data-managed': c.name }, h('td', {}, h('a', { href: '#/clients/' + c.id }, c.name)), h('td', {}, LEVELS[c.level]), h('td', { class: 'num' }, String(sitesOf(c.id).length)),
            h('td', { class: 'num' }, pc == null ? '-' : pc + '%'), h('td', { class: 'num' }, String(addonsOf(c.id))), h('td', { class: 'num' }, money(c.monthly_value_pence)), h('td', {}, c.contact_name || c.contact_email || '')); })
            : [h('tr', {}, h('td', { colspan: '7', class: 'muted' }, 'No managed clients yet. Make a managed code on the next tab.'))]))),
        h('p', { class: 'hint' }, 'Managed clients are the ones on Managed Compliance or Property & Compliance Managed. Click a name to open the client, their sites and their records.')];
    }
    chrome('managed', h('h1', {}, 'Tremcore Managed'), tabs, ...body);
    if (managedTab === 'floor' && body.openFloor && !floorFrame) body.openFloor();
    if (flash && flash.code) { const o = document.getElementById('managed-out'); if (o) o.replaceChildren(h('div', { class: 'msg ok', role: 'status' }, 'Code ', h('strong', {}, flash.code), ' is ready. Send the client this link: '), h('input', { type: 'text', readonly: true, value: flash.link, id: 'managed-link', 'aria-label': 'Sign-up link' })); }
    if (flash && flash.landlord) { const o = document.getElementById('landlord-out'); if (o) note(o, 'ok', 'Landlord sub-hub created.'); }
    if (flash && flash.done) { const o = document.getElementById('make-out'); if (o) note(o, 'ok', 'Done. The client is now managed with every add-on open.'); }
  }

  // ---------- Interest list (people who registered on the website before the passport opened) ----------
  async function pageInterest(my, flash) {
    chrome('interest', h('h1', {}, 'Interest list'), loading());
    const rows = await q(ctx.sb.from('interest_list').select('*').order('created_at', { ascending: false }));
    if (my !== token) return;
    const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
    const live = rows.filter((r) => r.status !== 'removed');
    const n = (st) => rows.filter((r) => r.status === st).length;
    const signed = n('signed_up'), total = live.length;
    const conv = total ? Math.round((signed / total) * 100) + '%' : '-';
    const out = h('div', { id: 'interest-out' });
    const STATE = { registered: ['amber', 'Waiting'], invited: ['green', 'Link sent'], signed_up: ['green', 'Signed up'], removed: ['missing', 'Removed'] };
    const post = async (url, body) => {
      const { data } = await ctx.sb.auth.getSession();
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ((data && data.session && data.session.access_token) || '') }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'That did not work.');
      return j;
    };
    const waiting = rows.filter((r) => r.status === 'registered').length;
    const sendAll = h('button', { class: 'btn', type: 'button', id: 'launch-send', disabled: waiting ? null : true, onclick: async () => {
      if (!window.confirm('Send the sign-up link to ' + waiting + ' ' + (waiting === 1 ? 'person' : 'people') + ' who have not had it yet?')) return;
      await busy(sendAll, async () => {
        try { const j = await post('/api/send-launch', {}); await pageInterest(++token, { kind: j.failed ? 'err' : 'ok', text: j.note || ('Sent to ' + j.sent + (j.failed ? '; ' + j.failed + ' did not send, try again.' : '.')) }); }
        catch (err) { note(out, 'err', err.message); }
      });
    } }, 'Send the sign-up link to everyone waiting (' + waiting + ')');
    const csvBtn = h('button', { class: 'btn ghost', type: 'button', id: 'interest-csv', onclick: () => {
      const cell = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
      const head = ['Name', 'Email', 'Business', 'Address', 'Sites', 'Registered', 'Status', 'Link sent', 'Signed up'];
      const lines = [head].concat(rows.map((r) => [r.name, r.email, r.business_name, r.business_address, r.sites, day(r.created_at), (STATE[r.status] || [])[1], day(r.invited_at), day(r.signed_up_at)]));
      const a = h('a', { href: URL.createObjectURL(new Blob([lines.map((l) => l.map(cell).join(',')).join('\r\n')], { type: 'text/csv' })), download: 'interest-list.csv' }); document.body.append(a); a.click(); a.remove();
    } }, 'Download as a spreadsheet');
    // The buttons for one person. Built fresh for each view (table and phone card) so each has its own message area.
    const actionsFor = (r) => {
      const rowOut = h('span', { class: 'muted', role: 'status' });
      const offer = r.status === 'signed_up' || r.status === 'removed' ? null : h('button', { class: 'btn ghost small', onclick: async () => {
        await busy(offer, async () => { try { const j = await post('/api/send-offer', { email: r.email, name: r.name, days: 30 }); rowOut.replaceChildren(j.sent ? 'Offer emailed. Code ' + j.code : (j.note || '') + ' Link: ' + j.link); } catch (err) { rowOut.replaceChildren(err.message); } });
      } }, 'Send offer code');
      const remove = r.status === 'removed' || r.status === 'signed_up' ? null : h('button', { class: 'btn ghost small', onclick: async () => {
        await busy(remove, async () => { try { await q(ctx.sb.from('interest_list').update({ status: 'removed' }).eq('id', r.id).select()); await pageInterest(++token); } catch (err) { rowOut.replaceChildren(err.message); } });
      } }, 'Remove');
      return { offer, remove, rowOut };
    };
    chrome('interest', h('h1', {}, 'Interest list'),
      h('div', { class: 'tiles' }, tile('Registered interest', String(total)), tile('Waiting for the link', String(waiting)), tile('Link sent', String(n('invited'))), tile('Signed up', String(signed)), tile('Registered to signed up', conv)),
      h('p', { class: 'hint' }, 'People who registered on the website. When the passport opens, send them the plain sign-up link below. They move to "Signed up" by themselves once they pay. To give someone an introductory offer instead, use "Send offer code" next to their name.'),
      h('div', { class: 'actions' }, sendAll, ' ', csvBtn), out,
      flash ? h('div', { class: 'msg ' + flash.kind, role: 'status' }, flash.text) : null,
      h('div', { class: 'only-wide' }, h('div', { class: 'tablewrap' }, h('table', { id: 'interest-table' },
        h('thead', {}, h('tr', {}, ['Name', 'Business', 'Address', 'Sites', 'Registered', 'Status', ''].map((x) => h('th', {}, x)))),
        h('tbody', {}, rows.length ? rows.map((r) => {
          const [kind, label] = STATE[r.status] || ['missing', r.status], a = actionsFor(r);
          return h('tr', { 'data-email': r.email }, h('td', {}, h('strong', {}, r.name), h('div', { class: 'muted small' }, r.email)), h('td', {}, r.business_name), h('td', {}, r.business_address),
            h('td', { class: 'num' }, String(r.sites)), h('td', {}, day(r.created_at)), h('td', {}, badge(kind, label), r.invited_at && r.status === 'invited' ? h('div', { class: 'muted small' }, day(r.invited_at)) : null),
            h('td', {}, a.offer, ' ', a.remove, ' ', a.rowOut));
        }) : [h('tr', {}, h('td', { colspan: '7', class: 'muted' }, 'Nobody has registered yet.'))])))),
      // On a phone each business is a card, so nothing needs scrolling sideways.
      h('div', { class: 'only-narrow', id: 'interest-cards' }, rows.length ? rows.map((r) => {
        const [kind, label] = STATE[r.status] || ['missing', r.status], a = actionsFor(r);
        return h('article', { class: 'icard', 'data-email': r.email },
          h('div', { class: 'icard-head' }, h('strong', { class: 'icard-biz' }, r.business_name), badge(kind, label)),
          h('div', {}, r.name + ' · ' + r.sites + (r.sites === 1 ? ' site' : ' sites')),
          h('div', {}, h('a', { href: 'mailto:' + r.email }, r.email)),
          h('div', { class: 'muted' }, r.business_address),
          h('div', { class: 'muted small' }, 'Registered ' + day(r.created_at) + (r.invited_at && r.status === 'invited' ? ' · Link sent ' + day(r.invited_at) : '') + (r.signed_up_at ? ' · Signed up ' + day(r.signed_up_at) : '')),
          (a.offer || a.remove) ? h('div', { class: 'icard-actions' }, a.offer, a.remove) : null, a.rowOut);
      }) : [h('p', { class: 'muted' }, 'Nobody has registered yet.')]));
  }

  // ---------- Revenue & growth ----------
  async function pageRevenue(my) {
    chrome('revenue', h('h1', {}, 'Revenue & growth'), loading());
    const companies = await q(ctx.sb.from('companies').select('id,name,level,subscription,monthly_value_pence,source,created_at,free_access'));
    if (my !== token) return;
    const freeN = companies.filter((c) => c.subscription === 'active' && c.free_access).length;
    const active = companies.filter((c) => c.subscription === 'active' && !c.free_access);   // free-access accounts are not paying, so they are left out of the revenue figures
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
    let interest = [];
    try { interest = await q(ctx.sb.from('interest_list').select('created_at,status,signed_up_at')); } catch (e) { interest = []; }
    if (my !== token) return;
    // Subscribers = clients who are subscribed today (active or past due, not on trial or cancelled), counted by when they joined, so the last point is today's real number.
    const subscribers = companies.filter((c) => c.subscription === 'active' || c.subscription === 'past_due');
    const per = (label, from, to) => {
      const inP = (iso) => iso && new Date(iso) >= from && new Date(iso) < to;
      const joined = companies.filter((c) => c.subscription !== 'trial' && inP(c.created_at));
      return { label, reg: interest.filter((r) => inP(r.created_at)).length, signed: joined.length, subs: subscribers.filter((c) => new Date(c.created_at) < to).length, added: joined.filter((c) => c.subscription === 'active').reduce((t, c) => t + (c.monthly_value_pence || 0), 0) };
    };
    const monthRows = [], yearRows = [];
    for (let i = 11; i >= 0; i--) { const a = new Date(now.getFullYear(), now.getMonth() - i, 1), b = new Date(now.getFullYear(), now.getMonth() - i + 1, 1); monthRows.push(per(a.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }), a, b)); }
    for (let y = now.getFullYear() - 2; y <= now.getFullYear(); y++) yearRows.push(per(String(y), new Date(y, 0, 1), new Date(y + 1, 0, 1)));
    // ---- click any column heading to see it as a line chart (green where it rises, red where it falls), with PDF download and print ----
    const NS = 'http://www.w3.org/2000/svg';
    const sv = (tag, at, ...kids) => { const e = document.createElementNS(NS, tag); Object.entries(at || {}).forEach(([k, v]) => e.setAttribute(k, v)); kids.forEach((k) => k != null && e.append(k)); return e; };
    const closeChart = () => { const m = document.getElementById('chart-modal'); if (m) m.remove(); document.body.classList.remove('chart-open'); };
    const openChart = (title, rows, pick, asMoney) => {
      closeChart();
      const vals = rows.map(pick), labels = rows.map((r) => r.label), fmt = (v) => (asMoney ? money(v) : String(v));
      const hi = Math.max(1, ...vals), Wd = 640, Ht = 300, L = 56, R = 20, T = 28, B = 40;
      const X = (i) => L + (vals.length > 1 ? (Wd - L - R) * i / (vals.length - 1) : (Wd - L - R) / 2), Y = (v) => Ht - B - (Ht - B - T) * v / hi;
      const svg = sv('svg', { viewBox: '0 0 ' + Wd + ' ' + Ht, class: 'linechart', role: 'img', 'aria-label': title + ' by period' });
      for (let g = 0; g <= 4; g++) { const gy = Y(hi * g / 4); svg.append(sv('line', { x1: L, x2: Wd - R, y1: gy, y2: gy, class: 'grid' }), sv('text', { x: L - 6, y: gy + 4, 'text-anchor': 'end', class: 'ax' }, fmt(Math.round(hi * g / 4)))); }
      for (let i = 1; i < vals.length; i++) svg.append(sv('line', { x1: X(i - 1), y1: Y(vals[i - 1]), x2: X(i), y2: Y(vals[i]), class: 'seg ' + (vals[i] > vals[i - 1] ? 'up' : vals[i] < vals[i - 1] ? 'down' : 'flat'), 'stroke-width': 3, 'stroke-linecap': 'round' }));
      vals.forEach((v, i) => { svg.append(sv('circle', { cx: X(i), cy: Y(v), r: 4, class: 'pt' }), sv('text', { x: X(i), y: Y(v) - 9, 'text-anchor': 'middle', class: 'val' }, fmt(v)), sv('text', { x: X(i), y: Ht - 14, 'text-anchor': 'middle', class: 'ax' }, labels[i])); });
      const first = vals[0], last = vals[vals.length - 1], tot = vals.reduce((t, v) => t + v, 0);
      const trend = last > first ? 'Up' : last < first ? 'Down' : 'Level';
      const doPdf = () => {
        const dstr = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
        const bytes = window.TCPdf.build({ title: title, subtitle: 'Tremcore Management Hub - ' + dstr, footer: 'Tremcore Management Hub',
          blocks: [{ p: 'Green lines show the figure going up from the period before, red lines show it going down.' }, { gap: 6 }, { chart: { labels, values: vals, tips: vals.map(fmt), axis: (v) => fmt(Math.round(v)) } }, { gap: 4 },
            { h: 'Figures' }, { table: { cols: [{ t: 'Period', w: 200 }, { t: title, w: 160 }, { t: 'Change', w: 135 }], rows: rows.map((r, i) => [r.label, fmt(vals[i]), i === 0 ? '-' : { t: (vals[i] > vals[i - 1] ? 'Up ' : vals[i] < vals[i - 1] ? 'Down ' : 'No change ') + (vals[i] === vals[i - 1] ? '' : fmt(Math.abs(vals[i] - vals[i - 1]))), c: vals[i] > vals[i - 1] ? 'green' : vals[i] < vals[i - 1] ? 'red' : 'grey' }]) } },
            { small: 'Figures are worked out from the values recorded in the hub, before VAT.' }] });
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
        const a = h('a', { href: url, download: 'tremcore-' + title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + new Date().toISOString().slice(0, 10) + '.pdf' });
        document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
      };
      const doPrint = () => { document.body.classList.add('chart-open'); window.print(); };
      const modal = h('div', { id: 'chart-modal', class: 'chartmodal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
        h('div', { class: 'chartcard' },
          h('div', { class: 'titlerow' }, h('h2', {}, title), h('button', { class: 'btn small ghost', type: 'button', id: 'chart-close', onclick: closeChart }, 'Close')),
          h('p', { class: 'muted small' }, 'Green means up on the period before, red means down. ' + trend + ' overall (' + fmt(first) + ' to ' + fmt(last) + ', total ' + fmt(tot) + ').'),
          h('div', { class: 'chartbox' }, svg),
          h('div', { class: 'actions noprint' }, h('button', { class: 'btn', type: 'button', id: 'chart-pdf', onclick: doPdf }, 'Download PDF'), ' ', h('button', { class: 'btn ghost', type: 'button', id: 'chart-print', onclick: doPrint }, 'Print'))));
      modal.addEventListener('click', (e) => { if (e.target === modal) closeChart(); });
      document.body.append(modal);
      const cl = document.getElementById('chart-close'); if (cl) cl.focus();
    };
    window.addEventListener('afterprint', () => document.body.classList.remove('chart-open'));
    window.addEventListener('hashchange', closeChart);
    const chartTh = (label, getRows, pick, asMoney, key) => h('th', {}, h('button', { class: 'thchart', type: 'button', 'data-chart': key, title: 'Show as a chart', onclick: () => openChart(label, getRows(), pick, asMoney) }, label, ' ', h('span', { 'aria-hidden': 'true' }, '\u2197')));
    let repRows = monthRows;
    const reportBody = h('tbody', {});
    const showReport = (rowsIn) => reportBody.replaceChildren(...rowsIn.map((r) => h('tr', {}, h('td', {}, r.label), h('td', { class: 'num' }, String(r.reg)), h('td', { class: 'num' }, String(r.signed)), h('td', { class: 'num' }, String(r.subs)), h('td', { class: 'num' }, money(r.added)), h('td', { class: 'num' }, money(r.added * 12)))));
    showReport(monthRows);
    const tabM = h('button', { class: 'btn small', type: 'button', id: 'rep-month', onclick: () => { repRows = monthRows; showReport(monthRows); tabM.className = 'btn small'; tabY.className = 'btn ghost small'; } }, 'Monthly');
    const tabY = h('button', { class: 'btn ghost small', type: 'button', id: 'rep-year', onclick: () => { repRows = yearRows; showReport(yearRows); tabY.className = 'btn small'; tabM.className = 'btn ghost small'; } }, 'Yearly');
    const report = h('div', { class: 'card', id: 'report-card' }, h('h2', {}, 'Sign-ups and revenue report'), h('div', { class: 'actions' }, tabM, ' ', tabY),
      h('div', { class: 'tablewrap' }, h('table', { id: 'report-table' }, h('thead', {}, h('tr', {}, h('th', {}, 'Period'), chartTh('Registered interest', () => repRows, (r) => r.reg, false, 'reg'), chartTh('Signed up', () => repRows, (r) => r.signed, false, 'signed'), chartTh('Current subscribers', () => repRows, (r) => r.subs, false, 'subscribers'), chartTh('New monthly revenue', () => repRows, (r) => r.added, true, 'monthly'), chartTh('New yearly value', () => repRows, (r) => r.added * 12, true, 'yearly'))), reportBody)),
      h('p', { class: 'hint' }, 'Tap any column heading to see it as a line chart.'),
      h('p', { class: 'hint' }, 'Current subscribers counts clients who are subscribed today, by the period they joined, so the latest figure is today\u2019s real number. Earlier periods do not include people who have since cancelled.'),
      h('p', { class: 'hint' }, 'New revenue is the monthly value of clients who joined in that period, before VAT. It is worked out from the values recorded here, not from individual Stripe payments.'));
    chrome('revenue', h('h1', {}, 'Revenue & growth'),
      h('div', { class: 'tiles' },
        tile('Monthly recurring revenue', money(mrr)), tile('Yearly run rate', money(mrr * 12)),
        tile('Current subscribers', String(subscribers.length)), tile('Paying clients', String(active.length)), tile('Average per paying client', avg),
        tile('Free accounts', String(freeN)), tile('On trial', String(count('trial'))), tile('Past due', String(count('past_due'))),
        tile('Cancelled', String(count('cancelled'))), tile('Trial to paying', conv)),
      noValue ? h('div', { class: 'msg' }, noValue + ' active client' + (noValue === 1 ? ' has' : 's have') + ' no monthly value set, so the figures above are low. Set them on the Subscriptions page.') : null,
      h('p', { class: 'hint' }, 'Based on the subscriptions and monthly values you record by hand. When Stripe is connected these will fill in automatically. Figures exclude VAT.'),
      report,
      h('div', { class: 'grid2' },
        h('div', { class: 'card' }, h('h2', {}, 'Revenue by package'), h('div', { class: 'tablewrap' }, h('table', {},
          h('thead', {}, h('tr', {}, ['Package', 'Paying', 'Monthly'].map((x) => h('th', {}, x)))),
          h('tbody', {}, byLevel.length ? byLevel.map((r) => h('tr', {}, h('td', {}, LEVELS[r.l]), h('td', { class: 'num' }, String(r.n)), h('td', { class: 'num' }, money(r.v)))) : [h('tr', {}, h('td', { colspan: '3', class: 'muted' }, 'No paying clients yet.'))])))),
        h('div', { class: 'card' }, h('h2', {}, 'New clients, last 6 months'), h('div', { class: 'tablewrap' }, h('table', {},
          h('thead', {}, h('tr', {}, h('th', {}, 'Month'), chartTh('New clients', () => months, (r) => r.n, false, 'newclients'), chartTh('Self sign-ups', () => months, (r) => r.self, false, 'selfsignups'))),
          h('tbody', {}, months.map((m) => h('tr', {}, h('td', {}, m.label), h('td', { class: 'num' }, String(m.n)), h('td', { class: 'num' }, String(m.self)))))))),
        h('div', { class: 'card' }, h('h2', {}, 'Biggest paying clients'), h('div', { class: 'tablewrap' }, h('table', {},
          h('thead', {}, h('tr', {}, ['Client', 'Monthly'].map((x) => h('th', {}, x)))),
          h('tbody', {}, top.length ? top.map((c) => h('tr', {}, h('td', {}, h('a', { href: '#/clients/' + c.id }, c.name)), h('td', { class: 'num' }, money(c.monthly_value_pence)))) : [h('tr', {}, h('td', { colspan: '2', class: 'muted' }, 'No paying clients yet.'))]))))));
  }

  // ---------- Renewals (work list for clients whose compliance Tremcore manages) ----------

  // ---------- search across every client ----------
  async function pageSearch(my, term) {
    chrome('dashboard', h('h1', {}, 'Search'), loading());
    const [items, props, companies] = await Promise.all([
      q(ctx.sb.from('compliance_status').select('*')),
      q(ctx.sb.from('properties').select('id,company_id,name,address')),
      q(ctx.sb.from('companies').select('id,name,level,subscription,contact_email'))]);
    if (my !== token) return;
    const words = term.toLowerCase().split(/\s+/).filter(Boolean);
    const hit = (...f) => { const t = f.filter(Boolean).join(' ').toLowerCase(); return words.every((w) => t.includes(w)); };
    const propOf = Object.fromEntries(props.map((x) => [x.id, x])), coOf = Object.fromEntries(companies.map((x) => [x.id, x]));
    const cos = companies.filter((c) => hit(c.name, c.contact_email));
    const sites = props.filter((x) => hit(x.name, x.address, (coOf[x.company_id] || {}).name));
    const recs = items.filter((i) => { const p = propOf[i.property_id], c = p && coOf[p.company_id]; return hit(i.title, i.notes, i.grp, p && p.name, c && c.name); })
      .sort((a, b) => String(a.due_date || '9999').localeCompare(String(b.due_date || '9999')));
    const sect = (title, rows) => rows.length ? h('div', { class: 'group' }, h('h3', {}, title + ' (' + rows.length + ')'), ...rows) : null;
    chrome('dashboard', h('h1', {}, 'Search: ' + term),
      !words.length ? h('p', { class: 'muted' }, 'Type something in the search box.') : null,
      words.length && !cos.length && !sites.length && !recs.length ? h('p', { class: 'muted' }, 'Nothing found for \u201c' + term + '\u201d.') : null,
      sect('Clients', cos.map((c) => h('p', {}, h('a', { href: '#/clients/' + c.id }, c.name), ' ', h('span', { class: 'muted' }, LEVELS[c.level])))),
      sect('Sites', sites.map((x) => h('p', {}, h('a', { href: '#/sites/' + x.id }, x.name), h('span', { class: 'muted' }, ' \u00b7 ' + ((coOf[x.company_id] || {}).name || ''))))),
      sect('Compliance records', recs.map((i) => { const p = propOf[i.property_id], c = p && coOf[p.company_id]; return h('p', { class: 'searchrow' }, badge(i.status, STATUS[i.status]), ' ', h('a', { href: '#/sites/' + i.property_id }, i.title), h('span', { class: 'muted' }, ' \u00b7 ' + (c ? c.name + ' \u00b7 ' : '') + (p ? p.name : '') + ' \u00b7 ' + (i.due_date ? fmtDate(i.due_date) : 'no date')));
      })));
  }

  async function pageRenewals(my) {
    chrome('renewals', h('h1', {}, 'Renewals'), loading());
    const [tasks, items, props, companies] = await Promise.all([
      q(ctx.sb.from('renewal_tasks').select('*')),
      q(ctx.sb.from('compliance_status').select('*')),
      q(ctx.sb.from('properties').select('id,company_id,name')),
      q(ctx.sb.from('companies').select('id,name,level,subscription'))]);
    if (my !== token) return;
    const managed = new Set(companies.filter((c) => c.level >= 2 && c.subscription !== 'cancelled').map((c) => c.id));
    const propOf = Object.fromEntries(props.map((p) => [p.id, p]));
    const coOf = Object.fromEntries(companies.map((c) => [c.id, c]));
    const itemOf = Object.fromEntries(items.map((i) => [i.id, i]));
    const mine = tasks.filter((t) => propOf[t.property_id] && managed.has(propOf[t.property_id].company_id) && itemOf[t.item_id]);
    const openItem = new Set(mine.filter((t) => t.stage !== 'completed').map((t) => t.item_id));
    const needs = items.filter((i) => (i.status === 'red' || i.status === 'amber') && propOf[i.property_id] && managed.has(propOf[i.property_id].company_id) && !openItem.has(i.id))
      .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
    const where = (propertyId) => { const p = propOf[propertyId]; return h('span', { class: 'muted block' }, (p && coOf[p.company_id] ? coOf[p.company_id].name + ' · ' : '') + (p ? p.name : '')); };
    const reload = () => pageRenewals(++token);
    const needRows = needs.map((i) => {
      const out = h('span', { class: 'muted', role: 'status' });
      const go = h('button', { class: 'btn ghost small', onclick: async () => {
        await busy(go, async () => { try { await q(ctx.sb.from('renewal_tasks').insert({ item_id: i.id, property_id: i.property_id, stage: 'due_soon' })); await reload(); } catch (err) { out.replaceChildren('Not started: ' + err.message); } });
      } }, 'Start renewal');
      return h('li', { class: 'renewal' }, h('a', { class: 'grow', href: '#/sites/' + i.property_id }, h('strong', {}, i.title), where(i.property_id)),
        badge(i.status, STATUS[i.status]), h('span', { class: 'muted' }, fmtDate(i.due_date)), go, out);
    });
    const card = (t) => {
      const i = itemOf[t.item_id];
      const stage = select(STAGES, t.stage), booked = text(t.booked_for || '', { type: 'date', 'aria-label': 'Booked for ' + i.title }), nt = text(t.note || '', { placeholder: 'Note (who, when, quote)', 'aria-label': 'Note for ' + i.title });
      stage.setAttribute('aria-label', 'Stage for ' + i.title);
      const out = h('span', { class: 'muted', role: 'status' });
      const save = h('button', { class: 'btn ghost small', onclick: async () => {
        if (!validDate(booked.value)) return out.replaceChildren('Check the booked date.');
        await busy(save, async () => {
          try { await q(ctx.sb.from('renewal_tasks').update({ stage: stage.value, booked_for: booked.value || null, note: nt.value.trim(), updated_at: new Date().toISOString() }).eq('id', t.id)); await reload(); }
          catch (err) { out.replaceChildren('Not saved: ' + err.message); }
        });
      } }, 'Save');
      return h('li', { class: 'renewal stack' },
        h('div', { class: 'titlerow' }, h('a', { href: '#/sites/' + t.property_id }, h('strong', {}, i.title)), badge(i.status, STATUS[i.status])),
        where(t.property_id), h('span', { class: 'muted' }, 'Due ' + fmtDate(i.due_date)),
        h('div', { class: 'row' }, stage, booked, nt, save, out),
        t.stage === 'completed' ? h('p', { class: 'hint' }, 'When the work is done, update the due date and upload the new certificate on the site page, so the traffic light turns green.') : null);
    };
    const col = (k) => {
      let list = mine.filter((t) => t.stage === k).sort((a, b) => String(itemOf[a.item_id].due_date).localeCompare(String(itemOf[b.item_id].due_date)));
      const total = list.length;
      if (k === 'completed') list = list.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))).slice(0, 10);
      return h('section', { class: 'card' }, h('h2', {}, STAGES[k] + ' (' + total + ')'),
        list.length ? h('ul', { class: 'list' }, list.map(card)) : h('p', { class: 'muted' }, 'Nothing here.'));
    };
    chrome('renewals', h('h1', {}, 'Renewals'),
      h('p', { class: 'muted' }, 'For clients on the Managed Service. Self-Managed clients arrange their own renewals.'),
      h('div', { class: 'tiles' },
        tile('Needs a renewal started', String(needs.length)), tile('Due soon', String(mine.filter((t) => t.stage === 'due_soon').length)),
        tile('Booking required', String(mine.filter((t) => t.stage === 'booking_required').length)), tile('Booked', String(mine.filter((t) => t.stage === 'booked').length))),
      h('section', { class: 'card' }, h('h2', {}, 'Due within 30 days or overdue, with no renewal started'),
        needRows.length ? h('ul', { class: 'list' }, needRows) : h('p', { class: 'muted' }, 'Everything due soon already has a renewal in progress.')),
      ['due_soon', 'booking_required', 'booked', 'completed'].map(col));
  }

  // ---------- Activity (who changed what) ----------
  async function pageActivity(my) {
    chrome('activity', h('h1', {}, 'Activity'), loading());
    const [log, props, companies, people] = await Promise.all([
      q(ctx.sb.from('audit_log').select('*').order('at', { ascending: false }).limit(100)),
      q(ctx.sb.from('properties').select('id,company_id,name')),
      q(ctx.sb.from('companies').select('id,name')),
      q(ctx.sb.from('profiles').select('id,full_name'))]);
    if (my !== token) return;
    const propOf = Object.fromEntries(props.map((p) => [p.id, p])), coOf = Object.fromEntries(companies.map((c) => [c.id, c.name])), who = Object.fromEntries(people.map((p) => [p.id, p.full_name]));
    const say = (r) => {
      const n = r.new_data || {}, o = r.old_data || {}, a = r.action;
      if (r.table_name === 'compliance_items') {
        const t = '“' + (n.title || o.title || 'item') + '”';
        if (a === 'INSERT') return 'Added ' + t;
        if (a === 'DELETE') return 'Removed ' + t;
        if (o.due_date !== n.due_date) return 'Changed the due date of ' + t + ' from ' + fmtDate(o.due_date) + ' to ' + fmtDate(n.due_date);
        return 'Updated ' + t;
      }
      if (r.table_name === 'documents') return (a === 'DELETE' ? 'Removed the document ' : 'Uploaded the document ') + (n.filename || o.filename || '');
      if (r.table_name === 'renewal_tasks') return a === 'INSERT' ? 'Started a renewal' : a === 'DELETE' ? 'Removed a renewal' : (o.stage !== n.stage ? 'Moved a renewal from ' + (STAGES[o.stage] || o.stage) + ' to ' + (STAGES[n.stage] || n.stage) : 'Updated a renewal');
      return (a === 'INSERT' ? 'Added' : a === 'DELETE' ? 'Removed' : 'Updated') + ' a record (' + r.table_name + ')';
    };
    chrome('activity', h('h1', {}, 'Activity'),
      h('p', { class: 'muted' }, 'The latest 100 changes to compliance items, documents and renewals, newest first. This record cannot be edited.'),
      h('div', { class: 'tablewrap' }, h('table', {},
        h('thead', {}, h('tr', {}, ['When', 'Who', 'Where', 'What'].map((x) => h('th', {}, x)))),
        h('tbody', {}, log.length ? log.map((r) => { const p = propOf[r.property_id];
          return h('tr', {}, h('td', {}, new Date(r.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })),
            h('td', {}, who[r.actor] || (r.actor ? 'A user' : 'The system')),
            h('td', {}, p ? h('a', { href: '#/sites/' + p.id }, (coOf[p.company_id] ? coOf[p.company_id] + ' · ' : '') + p.name) : ''), h('td', {}, say(r))); })
          : [h('tr', {}, h('td', { colspan: '4', class: 'muted' }, 'No changes recorded yet.'))]))));
  }

  // ---------- Enquiries ----------
  async function pageEnquiries(my) {
    chrome('enquiries', h('h1', {}, 'Enquiries'), loading());
    const rows = await q(ctx.sb.from('enquiries').select('*').order('created_at', { ascending: false }));
    if (my !== token) return;
    chrome('enquiries', h('h1', {}, 'Enquiries'),
      h('p', { class: 'hint' }, 'From the “Contact us” form on the website. Newest first.'),
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
          h('p', { class: 'muted' }, [e.sites ? SITES[e.sites] : null, e.package_interest ? 'Interested in ' + (e.package_interest === 'managed_service' ? 'Managed Service' : 'Self-Managed') : null].filter(Boolean).join(' · ')),
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
    const mfaRows = await q(ctx.sb.from('app_settings').select('key,value').eq('key', 'enforce_2fa'));
    if (my !== token) return;
    const mfaOn = !(mfaRows.length > 0 && mfaRows[0].value === false);
    const areaRows = await q(ctx.sb.from('app_settings').select('key,value').in('key', ['managed_base', 'managed_radius_miles']));
    if (my !== token) return;
    const base = (areaRows.find((r) => r.key === 'managed_base') || {}).value || null;
    const radius = (areaRows.find((r) => r.key === 'managed_radius_miles') || {}).value;
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
    const mfaOut = h('div');
    const mfaBtn = h('button', { class: 'btn small' + (mfaOn ? ' danger' : ''), id: 'mfa-toggle', onclick: async () => {
      await busy(mfaBtn, async () => {
        try {
          const done = await q(ctx.sb.from('app_settings').update({ value: !mfaOn, updated_at: new Date().toISOString() }).eq('key', 'enforce_2fa').select());
          if (!done || !done.length) throw new Error('Only a Tremcore administrator can change this.');
          pageSettings(++token);
        } catch (err) { note(mfaOut, 'err', 'Not changed: ' + err.message); }
      });
    } }, mfaOn ? 'Switch 2FA off' : 'Switch 2FA on');
    chrome('settings', h('h1', {}, 'Settings'),
      h('section', { class: 'card', id: 'mfa-card' },
        h('div', { class: 'titlerow' }, h('h2', {}, 'Two-step sign-in (2FA)'), badge(mfaOn ? 'green' : 'red', mfaOn ? 'On' : 'Off')),
        h('p', { class: 'hint' }, mfaOn ? 'Tremcore staff and customer head-office users must enter a code from an authenticator app each time they sign in.' : 'OFF: nobody is asked for a code. Fine for testing, but switch it back on before real customers use the system, because anyone with a staff password could see every client\u2019s records.'),
        h('div', { class: 'actions' }, mfaBtn), mfaOut),
      h('section', { class: 'card' },
        h('div', { class: 'titlerow' }, h('h2', {}, 'Self-Managed sign-up'), badge(open ? 'green' : 'missing', open ? 'Open' : 'Closed')),
        h('p', {}, open
          ? 'Businesses can create their own Self-Managed account from the website and the sign-in page. Each one is created unpaid and cannot open anything until payment is confirmed. Until online payment is built, set the company to Active under Clients to let it in. They appear under Clients marked “Self sign-up”.'
          : 'Sign-up is closed. Nobody can create an account for themselves yet, and the Sign up page says sign-up is not open.'),
        h('p', { class: 'hint' }, 'Before opening: in Supabase switch on email sign-ups and “Confirm email”, add the site address to the allowed redirect URLs, and have the Terms and Privacy pages checked and finished.'),
        btn, out),
      managedCard(base, radius));
  }

  // Where the Managed Service is offered: a base point and a distance in miles (straight-line).
  function managedCard(base, radius) {
    const box = h('div');
    const label = text(base ? base.label : '', { 'aria-label': 'Name of the area' });
    const pc = text('', { placeholder: 'Leave blank to keep the current point', 'aria-label': 'Base postcode', autocomplete: 'off' });
    const miles = text(radius != null ? String(radius) : '30', { inputmode: 'numeric', 'aria-label': 'Distance in miles' });
    const save = h('button', { class: 'btn small', type: 'submit' }, 'Save area');
    const form = h('form', { novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      const mi = Number(miles.value.trim());
      if (!Number.isInteger(mi) || mi < 1 || mi > 300) return note(box, 'err', 'Enter the distance as a whole number of miles, between 1 and 300.');
      if (!label.value.trim()) return note(box, 'err', 'Give the area a short name, for example Medway (ME).');
      await busy(save, async () => {
        try {
          let point = base ? { lat: base.lat, lng: base.lng } : null;
          if (pc.value.trim()) {
            const r = await fetch('/api/postcode?postcode=' + encodeURIComponent(pc.value.trim()), { headers: { Accept: 'application/json' } });
            const j = await r.json();
            if (!j.ok) throw new Error(j.error || 'postcode not found');
            point = { lat: j.lat, lng: j.lng };
          }
          if (!point) throw new Error('enter a base postcode');
          const now = new Date().toISOString();
          const a = await q(ctx.sb.from('app_settings').update({ value: { label: label.value.trim(), lat: point.lat, lng: point.lng }, updated_at: now }).eq('key', 'managed_base').select());
          const b = await q(ctx.sb.from('app_settings').update({ value: mi, updated_at: now }).eq('key', 'managed_radius_miles').select());
          if (!a || !a.length || !b || !b.length) throw new Error('only a Tremcore administrator can change this');
          note(box, 'ok', 'Saved. The website postcode check now uses this area.');
        } catch (err) { note(box, 'err', 'Not saved: ' + err.message); }
      });
    } },
      h('div', { class: 'grid2' }, field('m-label', 'Name of the area', label), field('m-miles', 'Distance (miles, in a straight line)', miles)),
      field('m-pc', 'New base postcode (optional)', pc), save, box);
    return h('section', { class: 'card' },
      h('div', { class: 'titlerow' }, h('h2', {}, 'Managed Service area')),
      h('p', {}, base ? 'The Managed Service is offered within ' + (radius != null ? radius : '?') + ' miles of ' + base.label + '.' : 'No area has been set yet, so the website postcode check will not work.'),
      h('p', { class: 'muted' }, 'Measured in a straight line from the base point. Visitors check their own postcode on the website; you still agree each plan by hand.'),
      form);
  }

  // ---------- routing ----------
  let pagesSeen = 0;   // how many pages have been opened in this visit: if there is a page before this one, Back goes to it
  async function render() {
    if (!ctx) return;
    const my = ++token;
    pagesSeen += 1;
    const [a, id] = (location.hash.replace(/^#\/?/, '') || 'dashboard').split('/');
    try {
      if (a === 'clients' && id && UUID.test(id)) await pageClient(my, id);
      else if (a === 'sites' && id && UUID.test(id)) await pageSite(my, id);
      else if (a === 'clients') await pageClients(my);
      else if (a === 'subscriptions') await pageSubscriptions(my);
      else if (a === 'managed') await pageManaged(my);
      else if (a === 'interest') await pageInterest(my);
      else if (a === 'offers') await pageOffers(my);
      else if (a === 'revenue') await pageRevenue(my);
      else if (a === 'search') await pageSearch(my, decodeURIComponent(location.hash.replace(/^#\/?search\/?/, '')));
      else if (a === 'renewals') await pageRenewals(my);
      else if (a === 'activity') await pageActivity(my);
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
