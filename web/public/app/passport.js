// The client's compliance passport: traffic lights, the list of checks, each check's details, certificates, and (where allowed) editing.
// This screen only decides what to SHOW. What a person may actually change is decided by the database (row-level rules), so a
// view-only user who calls the API directly still cannot change anything.
(function () {
  'use strict';

  const ST = {
    red: { label: 'Overdue', rank: 0 }, missing: { label: 'No date', rank: 1 },
    amber: { label: 'Due soon', rank: 2 }, green: { label: 'In date', rank: 3 }
  };
  const BASIS = { legal: 'Legal requirement', standard: 'Standard', best_practice: 'Best practice' };
  const GROUPS = ['Fire safety', 'Electrical', 'Water hygiene', 'Building and services', 'Other'];
  const MAX_FILE = 10 * 1024 * 1024;
  const FILE_OK = /\.(pdf|jpe?g|png|docx?)$/i;
  const NS = 'http://www.w3.org/2000/svg';
  // Shown if the server list cannot be read, so the paid add-ons are always visible with their price.
  const EXTRA_DEFAULT = [
    { code: 'toolbox_talks', name: 'Toolbox Talks', description: 'A library of 30 ready-made safety talks plus up to 10 of your own, with digital sign-off by your team and saved PDF records. Charged for each site.', price_pence: 299, yearly_pence: 3050, charged_per: 'site', owned: false },
    { code: 'staff_signin', name: 'Staff Clock In / Out', description: 'Staff scan a QR code shown at your site to clock in and out, with attendance records you can view.', price_pence: 599, yearly_pence: 6110, charged_per: 'site', owned: false },
    { code: 'posters', name: 'Poster Generator', description: 'Make branded posters from 17 ready-made templates for pubs, caf\u00e9s, shops, seasonal offers and notices, with your own logo, colours and QR codes. Download as PNG or PDF. One price for your whole account.', price_pence: 499, yearly_pence: 5090, charged_per: 'company', owned: false }
  ];
  // Add-ons that are announced but not built into the real app yet: shown on Home as "Coming soon", never sold.
  // All four add-ons for one price (per month, one site). The saving is worked out from the four separate monthly prices (2.99 + 5.99 + 9.99 + 4.99 = 23.96).
  const BUNDLE = { price_pence: 1499, save_pence: 299 + 599 + 999 + 499 - 1499 };
  const SOON = [
    { code: 'reviews', icon: 'star', name: 'Reviews', short: 'Reply to Google & Tripadvisor reviews', price_pence: 999,
      intro: 'Every Google and Tripadvisor review in one inbox, with replies drafted in your brand voice so none go unanswered.',
      feats: ['One inbox for Google and Tripadvisor reviews, with the lowest ratings at the top', 'Replies drafted for you in your brand voice', 'Insights on ratings, trends and what guests mention most', 'Feedback QR cards for tables, rooms and receipts: happy guests go to Google, complaints reach the manager first', 'Import reviews from a CSV or JSON export'] }
  ];

  // Help & Support: short answers written for the real app (what is on screen today). g = group heading.
  const FAQ = [
    { g: 'Compliance', q: 'How is my compliance score worked out?', a: 'The score is the share of your Core Compliance items that are in date (green, or amber because the date is still ahead). Overdue items and items with no date count against it, and an item with no date is never shown as green. Items in Other Compliance are not part of the score.' },
    { g: 'Compliance', q: 'What is the difference between Core and Other compliance?', a: 'Core items make up your score, such as fire safety and electrical checks. Other items are still tracked with dates and documents but do not change the score.' },
    { g: 'Compliance', q: 'How do I move an item between Core and Other?', a: 'Open the item and tap Move to Other or Move to Core. The score updates straight away. Only people who can edit your records see this button.' },
    { g: 'Compliance', q: 'How is the colour code set?', a: 'Automatically from the due date. Green means more than 30 days to go, amber means due within 30 days, and red means the date has passed. An item with no date shows as No date, never green. It cannot be changed by hand.' },
    { g: 'Compliance', q: 'How do I add a certificate, report or photo?', a: 'Open the item and tap Upload to add a PDF or a photo. Then tap Read details and the app reads the dates from the document so you can check them. Dates left empty will show as No date, never as in date.' },
    { g: 'Compliance', q: 'How do I add several certificates at once?', a: 'On the Compliance screen tap Bulk upload. Choose your files, let the app read them, then check where each one belongs before saving.' },
    { g: 'Compliance', q: 'How do I add or remove a check of my own?', a: 'On the Compliance screen tap Add a check for anything your premises need. To remove one, open it and tap Remove this check. Its documents are removed with it, and you are asked to confirm first.' },
    { g: 'Tasks', q: 'How do I add a new task?', a: 'Go to My Tasks and tap Add New Task. Give it a title, choose the site, add a due date and notes. If it should come back regularly, fill in Repeat every (months). You can have up to 10 repeating tasks.' },
    { g: 'Tasks', q: 'How do I complete or delete a task?', a: 'Open My Tasks and tap the task. You can mark it complete or remove it. Completed tasks stay in the list so you can see what was done.' },
    { g: 'Add-ons', q: 'How do I unlock an add-on?', a: 'On the Home screen tap Buy Now on the add-on, choose to pay monthly or a year upfront (15% off), and pay on the secure Stripe page. Only the head-office user can add an add-on. Toolbox Talks is £2.99 and Staff Clock In / Out is £5.99 per site per month, and Poster Generator is £4.99 a month for the whole account. All prices are plus VAT.' },
    { g: 'Add-ons', q: 'Can I try an add-on before I buy it?', a: 'Tap any add-on card on Home to see what is included and the price. Nothing is charged until you pay on the Stripe page.' },
    { g: 'Add-ons', q: 'How long is the contract?', a: 'Add-ons are on a 12-month rolling contract. It renews for a further 12 months unless you request cancellation at least 30 days before the renewal date. You can pay monthly, or pay for 12 months upfront and save 15%.' },
    { g: 'Add-ons', q: 'How do I cancel an add-on?', a: 'Email Tremcore at info@tremcore.co.uk at least 30 days before your renewal date, saying which add-on you want to cancel. Otherwise it renews for a further 12 months.' },
    { g: 'Toolbox Talks', q: 'How do I run a talk and record who attended?', a: 'Open Toolbox Talks, choose a talk and tap Run this talk and collect signatures. Pick the people who attended and they sign on screen. The record is saved, can be downloaded as a PDF, and is found under Records.' },
    { g: 'Toolbox Talks', q: 'Can I write a talk of my own?', a: 'Yes. In Toolbox Talks open My own talks and tap Add my own talk. You can keep up to 10 of your own alongside the ready-made library.' },
    { g: 'Staff Clock In / Out', q: 'How do staff clock in and out?', a: 'Put the QR poster up where staff will see it. They scan it with their phone camera, tap their name, then tap Clock in when they arrive and Clock out when they leave.' },
    { g: 'Staff Clock In / Out', q: 'How do I add or remove staff?', a: 'Open Staff Clock In / Out, choose the site, then add a person with their name and job title, or tap Remove next to someone who has left. The poster does not need reprinting.' },
    { g: 'Staff Clock In / Out', q: 'How do I print the QR poster?', a: 'Open Staff Clock In / Out and tap Print the poster. Print it on A4 at 100% scale so the code scans reliably.' },
    { g: 'Staff Clock In / Out', q: 'How do I set shifts and see hours?', a: 'Tap Shifts next to a person to set their weekly shifts. Then tap Open the shift report to compare set hours with the times they clocked in and out.' },
    { g: 'Poster Generator', q: 'How do I make a poster?', a: 'Open Poster Generator, pick a template, type in your wording, choose your colours and logo, then download it as a PNG or PDF. Your settings are kept on this device.' },
    { g: 'Poster Generator', q: 'Can a poster have a QR code for Google reviews?', a: 'Yes. Paste your Google review link into the brand details, then choose the reviews QR on the poster. Scanning it takes people straight to your Google review page.' },
    { g: 'Emergency', q: 'How do I update the assembly point, fire marshal or first aider?', a: 'Open Emergency Information from the Home screen, tap Edit on the box you want to change, then save.' }
  ];
  const ISSUE_TOPICS = ['Compliance', 'Documents or photos', 'Tasks', 'Toolbox Talks', 'Staff Clock In / Out', 'Poster Generator', 'Billing or add-ons', 'Something else'];
  const ICON = {
    home: 'M3 11l9-8 9 8v10h-6v-6H9v6H3z', compliance: 'M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z M8.5 12l2.5 2.5L16 9.5',
    tasks: 'M5 4h14v16H5z M8 9h8 M8 13h8 M8 17h5', chat: 'M4 5h16v11H10l-5 4v-4H4z M8 9h8 M8 12h5', clock: 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18z M12 7v5l3 2', apps: 'M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h6v6h-6z', star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z', poster: 'M6 3h9l4 4v14H6z M9 12h7 M9 16h7', lock: 'M7 11V8a5 5 0 0 1 10 0v3 M5 11h14v10H5z', alert: 'M12 3l10 18H2z M12 10v5 M12 18v.01', taskck: 'M5 4h14v16H5z M9 12l2.5 2.5L15.5 9.5', settings: 'M4 7h10 M18 7h2 M4 17h2 M10 17h10 M16 5v4 M8 15v4'
  };
  const icon = (k) => svg('svg', { viewBox: '0 0 24 24', class: 'ico', 'aria-hidden': 'true', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, svg('path', { d: ICON[k] }));
  const money = (p) => '£' + (p / 100).toFixed(2);
  const today = () => new Date().toISOString().slice(0, 10);

  // ---------- small helpers ----------
  function svg(tag, attrs, ...kids) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
    for (const k of kids) if (k != null) el.append(k);
    return el;
  }
  const tally = (rows) => {
    const c = { green: 0, amber: 0, red: 0, missing: 0, total: rows.length };
    rows.forEach((r) => { if (c[r.status] !== undefined) c[r.status] += 1; });
    // Missing dates count against the score: the figure is in-date items out of ALL items.
    c.pct = c.total ? Math.round(100 * (c.green + c.amber) / c.total) : null;
    return c;
  };
  // Core checks count towards the score; Other checks are tracked but not counted.
  const isCore = (r) => r.is_core !== false;
  // Add whole months to a YYYY-MM-DD date, keeping the day where possible (31 Jan + 1 month = 28/29 Feb).
  function addMonths(iso, n) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); if (!m || !(n > 0)) return '';
    const y = +m[1], mo = +m[2] - 1, d = +m[3];
    const tm = mo + n, ty = y + Math.floor(tm / 12), tmm = ((tm % 12) + 12) % 12;
    const last = new Date(Date.UTC(ty, tmm + 1, 0)).getUTCDate();
    return new Date(Date.UTC(ty, tmm, Math.min(d, last))).toISOString().slice(0, 10);
  }
  const validDate = (v) => v === '' || (/^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(new Date(v + 'T00:00:00Z').getTime()));

  function donut(c, size) {
    const R = 15.915; let off = 25;   // 100 units round the circle; 25 starts at the top
    const parts = c.total ? [['green', c.green], ['amber', c.amber], ['red', c.red], ['missing', c.missing]].filter((s) => s[1] > 0).map(([k, n]) => {
      const len = 100 * n / c.total;
      const el = svg('circle', { class: 'seg ' + k, cx: 21, cy: 21, r: R, fill: 'none', 'stroke-width': 6, 'stroke-dasharray': len + ' ' + (100 - len), 'stroke-dashoffset': off });
      off -= len; return el;
    }) : [];
    return svg('svg', { viewBox: '0 0 42 42', class: 'donut' + (size ? ' ' + size : ''), role: 'img', 'aria-label': c.pct == null ? 'No checks yet' : c.pct + ' per cent of your checks are in date' },
      svg('circle', { class: 'seg track', cx: 21, cy: 21, r: R, fill: 'none', 'stroke-width': 6 }), ...parts,
      svg('text', { x: 21, y: 23.2, 'text-anchor': 'middle', class: 'pct' }, c.pct == null ? '–' : c.pct + '%'));
  }

  async function mount(ctx) {
    const { sb, h, message, busy, fmtDate } = ctx;
    let props = [], items = [], core = [], tasks = [], extras = [], company = null, rights = { can_edit: false, can_manage: false }, loadError = false;
    let site = 'all', filter = 'all', tab = 'home', ctab = 'overview', ttab = 'pending', cgroup = 'core', tview = 'list', calMonth = null, calDay = null;
    const isHead = !!(ctx.req && ctx.req.role_name === 'client_super');
    // 'dash' = the wide dashboard; 'form' = a medium-width page for one check or a form.
    // One clear back button (a chevron and the word Back, top left). The phone's own back button and the browser's back button do the same thing.
    let pendingBack = null, activeBack = null;
    const backBtn = (label, fn) => { pendingBack = fn; return h('button', { class: 'backbtn', type: 'button', 'data-back': '1', 'aria-label': label || 'Back', onclick: () => { activeBack = null; fn(); } }, h('span', { class: 'chev', 'aria-hidden': 'true' }, '\u2039'), h('span', {}, 'Back')); };
    window.addEventListener('popstate', () => { const f = activeBack; activeBack = null; if (f) f(); });
    const page = (mode, ...nodes) => { onExtra = null; ctx.show(...nodes); if (pendingBack) { activeBack = pendingBack; try { history.pushState({ tcBack: 1 }, ''); } catch (e) { /* ignore */ } } else activeBack = null; pendingBack = null; document.body.classList.add(mode === 'dash' ? 'passport' : 'formwide'); if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); };
    const siteName = (id) => (props.find((p) => p.id === id) || {}).name || '';

    async function reload() {
      try {
        const [p, i, r, cc, tk, ex, co] = await Promise.all([
          sb.from('properties').select('id,name,address,postcode').order('name'),
          sb.from('compliance_status').select('id,property_id,grp,title,basis,frequency_months,last_done,due_date,notes,certificate_number,provider,is_core,status,days_left').order('title'),
          sb.rpc('passport_rights'),
          sb.from('core_checks').select('code,label,grp,basis,frequency_months,sort').order('sort'),
          sb.from('tasks').select('id,property_id,title,notes,due_date,repeat_months,status,completed_at').order('due_date'),
          sb.rpc('my_extras'),
          sb.from('companies').select('id,name,contact_phone,address,postcode,level,billing_interval,subscription,offer_code,offer_ends_at').limit(1)
        ]);
        if (p.error || i.error) throw new Error('load');
        props = p.data || []; items = i.data || []; core = (cc && cc.data) || [];
        tasks = (tk && tk.data) || [];
        extras = (ex && ex.data && ex.data.length) ? ex.data : EXTRA_DEFAULT;
        company = (co && co.data && co.data[0]) || null;
        rights = (r && r.data && r.data[0]) || { can_edit: false, can_manage: false };
        loadError = false;
      } catch { loadError = true; }
    }
    const shortDate = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    // The list uses short dates so each row stays on one line on a computer; the detail page spells them out.
    const dueText = (r, short) => {
      const f = short ? shortDate : fmtDate;
      if (r.status === 'missing') return 'No date entered';
      if (r.status === 'red') return 'Overdue since ' + f(r.due_date);
      const n = r.days_left;
      return 'Due ' + f(r.due_date) + (n === 0 ? ' (today)' : n === 1 ? ' (tomorrow)' : ' (in ' + n + ' days)');
    };
    const goBack = (label) => backBtn(label || 'Back to compliance', () => viewList());

    // ---------- shell: bottom menu on a phone, left-hand menu on a computer ----------
    const TABS = [['home', 'Home'], ['compliance', 'Compliance'], ['tasks', 'Tasks'], ['settings', 'Settings']];
    const go = (k) => { tab = k; if (k === 'home') viewHome(); else if (k === 'compliance') viewList(); else if (k === 'tasks') viewTasks(); else viewSettings(); };
    // The menu sits in a left-hand column; on the home page the add-ons and tools sit in that column too, underneath the menu.
    const shellWith = (cur, side, nodes) => page('dash', h('div', { class: 'appshell appshell-' + cur },
      h('div', { class: 'appleft' },
        h('nav', { class: 'appnav', 'aria-label': 'Main menu' }, ...TABS.map(([k, l]) => h('button', { type: 'button', class: 'navbtn' + (cur === k ? ' on' : ''), 'data-nav': k, 'aria-current': cur === k ? 'page' : null, onclick: () => go(k) }, icon(k), h('span', {}, l)))),
        ...side),
      h('div', { class: 'appbody view-' + cur }, ...nodes)));
    const shell = (cur, ...nodes) => shellWith(cur, [], nodes);
    const backTo = (label) => backBtn(label, () => go(tab));

    // All sites, then each site underneath (up to 12 as cards; beyond that a plain drop-down).
    function sitePicker(refresh) {
      if (props.length < 2) return null;
      if (props.length <= 12) {
        const card = (id, name, cc) => h('button', { class: 'sitecard', type: 'button', 'data-site': id, 'aria-pressed': String(site === id), onclick: () => { site = id; refresh(); } },
          donut(cc, 'mini'), h('span', { class: 'sname' }, h('strong', {}, name), h('span', { class: 'muted small' },
            cc.total ? [cc.red + ' overdue', cc.amber + ' due soon', cc.missing + ' no date'].join(' · ') : 'No checks yet')));
        return h('div', { class: 'sitesgrid' }, card('all', 'All sites', tally(items.filter(isCore))), ...props.map((p) => card(p.id, p.name, tally(items.filter((i) => i.property_id === p.id && isCore(i))))));
      }
      return h('div', {}, h('label', { for: 'site-pick' }, 'Site'), h('select', { id: 'site-pick', onchange: (e) => { site = e.target.value; refresh(); } },
        h('option', { value: 'all', selected: site === 'all' }, 'All sites'), ...props.map((p) => h('option', { value: p.id, selected: site === p.id }, p.name))));
    }
    const extraOf = (code) => extras.find((e) => e.code === code) || EXTRA_DEFAULT.find((e) => e.code === code);
    // Paying a year upfront is 15% off twelve months, to the nearest 10p (the database works it out the same way and is what Stripe is charged).
    const yearlyPence = (e) => e.yearly_pence || Math.round(e.price_pence * 12 * 0.85 / 10) * 10;
    const priceText = (e) => money(e.price_pence) + ' + VAT ' + (e.charged_per === 'site' ? 'per site, ' : '') + 'per month';
    const legendLines = (c) => h('div', { class: 'lglist' },
      h('div', { class: 'lg' }, h('i', { class: 'dot green' }), 'On track · ' + c.green),
      h('div', { class: 'lg' }, h('i', { class: 'dot amber' }), c.amber + (c.amber === 1 ? ' item due soon' : ' items due soon')),
      h('div', { class: 'lg' }, h('i', { class: 'dot red' }), c.red + ' overdue'),
      c.missing ? h('div', { class: 'lg' }, h('i', { class: 'dot missing' }), c.missing + ' with no date') : null);
    const heading = (note) => [ctx.banner, note ? h('div', { class: 'msg ok', role: 'status' }, note) : null,
      loadError ? h('div', { class: 'msg err', role: 'alert' }, 'Sorry, we could not load your passport. Please refresh the page.') : null];

    // ---------- Home ----------
    function viewHome(note) {
      tab = 'home';
      const rows = items.filter((r) => site === 'all' || r.property_id === site);
      const c = tally(rows.filter(isCore)), cAll = tally(rows), nCore = rows.filter(isCore).length, nOther = rows.length - nCore;
      const pend = tasks.filter((t) => t.status === 'pending' && (site === 'all' || t.property_id === site)).length;
      const q = (code, label, sub, onclick, locked, ik) => h('button', { class: 'qtile' + (locked ? ' locked' : ''), type: 'button', 'data-q': code, onclick },
        ik ? icon(ik) : null, h('strong', {}, label), h('span', { class: 'muted small' }, sub), locked ? h('span', { class: 'tag add' }, 'Add') : null);
      const tt = extraOf('toolbox_talks'), ss = extraOf('staff_signin'), pg = extraOf('posters');
      // Add-on promo cards: bold gold, so the two paid extras are not overlooked (only for Self-Managed accounts that do not have them yet)
      const isL1 = !company || (company.level || 1) === 1;
      // Add-on cards, 2 across: icon with a lock until bought, price a month, Buy Now. Reviews and Poster Generator are announced only (Coming soon, nothing to buy).
      const aoc = (o) => h('button', { class: 'aoc' + (o.soon ? ' soon' : '') + (o.owned ? ' owned' : ''), type: 'button', [o.soon ? 'data-soon' : 'data-promo']: o.code, onclick: o.go },
        h('span', { class: 'aoc-i', 'aria-hidden': 'true' }, 'i'),
        h('span', { class: 'aoc-ic', 'aria-hidden': 'true' }, icon(o.icon), o.owned ? null : h('span', { class: 'aoc-lock' }, icon('lock'))),
        h('strong', { class: 'aoc-name' }, o.name), h('span', { class: 'aoc-blurb' }, o.blurb),
        h('span', { class: 'aoc-price' }, o.price, h('small', {}, ' pcm')), h('span', { class: 'aoc-sub' }, o.sub), o.yearly ? h('span', { class: 'aoc-year' }, 'or ' + o.yearly + ' a year upfront \u00b7 save 15%') : null,
        h('span', { class: 'aoc-btn' }, o.owned ? 'Active \u2013 open' : o.soon ? 'Coming soon' : [icon('lock'), 'Buy Now']));
      const live = (code, ik, blurb) => { const e = extraOf(code); if (e.owned) return null; return aoc({ code, icon: ik, name: e.name, blurb, price: money(e.price_pence), yearly: money(yearlyPence(e)), sub: (e.charged_per === 'site' ? 'per site \u00b7 ' : '') + '+ VAT', owned: !!e.owned, go: () => viewExtra(code) }); };
      const promos = isL1 ? [live('toolbox_talks', 'chat', '30 talks, bespoke talks \u00a31.99 each'), live('staff_signin', 'clock', 'QR clock-in and attendance log'), live('posters', 'poster', '17 templates for print & social')].filter(Boolean) : [];
      const soons = isL1 ? SOON.map((x) => aoc({ code: x.code, icon: x.icon, name: x.name, blurb: x.short, price: money(x.price_pence), sub: '+ VAT', soon: true, go: () => viewSoon(x.code) })) : [];
      // The all-in-one offer under the add-on cards: it pulses to draw the eye. Hidden once the business already has every add-on that can be bought today.
      const bundleCard = () => !isL1 || !promos.length ? null : h('button', { class: 'bundle', type: 'button', 'data-bundle': 'all', onclick: () => viewBundle() },
        h('span', { class: 'aoc-ic', 'aria-hidden': 'true' }, icon('apps'), h('span', { class: 'aoc-lock' }, icon('lock'))),
        h('span', { class: 'bundle-txt' }, h('strong', {}, 'Unlock all 4 add-ons'), h('span', { class: 'bundle-list' }, 'Toolbox Talks \u00b7 Clock In / Out \u00b7 Reviews \u00b7 Posters'), h('span', { class: 'bundle-save' }, 'Save ' + money(BUNDLE.save_pence) + ' a month')),
        h('span', { class: 'bundle-buy' }, h('span', { class: 'bundle-price' }, money(BUNDLE.price_pence), h('small', {}, ' pcm')), h('span', { class: 'bundle-go' }, 'Unlock all \u2192')));
      // What needs attention now: overdue first, then due in the next 30 days (checks and tasks), so it is the first thing seen.
      const multiH = props.length > 1 && site === 'all';
      const lateItems = rows.filter((r) => r.status === 'red').sort(byUrgency), soonItems = rows.filter((r) => r.status === 'amber').sort(byUrgency);
      const myTasks = tasks.filter((t) => t.status === 'pending' && (site === 'all' || t.property_id === site));
      const lateTasks = myTasks.filter((t) => taskState(t) === 'red'), soonTasks = myTasks.filter((t) => taskState(t) === 'amber');
      const taskRow = (t) => h('button', { class: 'item' + (multiH ? '' : ' nosite'), type: 'button', 'data-task-row': t.id, onclick: () => go('tasks') },
        h('i', { class: 'dot ' + taskState(t) }), h('span', { class: 'title' }, t.title + ' (task)'), h('span', { class: 'meta muted' }, multiH ? h('span', { class: 'site' }, '') : null, h('span', { class: 'due' }, taskText(t))), h('span', { class: 'tag ' + taskState(t) }, ST[taskState(t)].label));
      const attRows = [...lateItems.map((r) => itemRow(r, multiH)), ...lateTasks.map(taskRow), ...soonItems.map((r) => itemRow(r, multiH)), ...soonTasks.map(taskRow)];
      const nLate = lateItems.length + lateTasks.length, nSoon = soonItems.length + soonTasks.length;
      const attention = h('div', { class: 'card attention', id: 'attention' },
        h('div', { class: 'titlerow' }, h('h2', {}, 'Needs attention'),
          h('span', { class: 'attcounts' }, nLate ? h('span', { class: 'tag red' }, nLate + ' overdue') : null, nSoon ? h('span', { class: 'tag amber' }, nSoon + ' due soon') : null)),
        ...(attRows.length ? attRows.slice(0, 8) : [h('p', { class: 'muted', id: 'att-none' }, rows.length || myTasks.length ? 'Nothing is overdue or due in the next 30 days. Well done.' : 'Add your checks in Compliance and enter the date each one is next due. Anything overdue or coming up will be listed here.')]),
        attRows.length > 8 ? h('button', { class: 'btn small ghost', id: 'att-all', type: 'button', onclick: () => { ctab = 'due'; go('compliance'); } }, 'See all ' + attRows.length) : null,
        cAll.missing ? h('p', { class: 'muted small', id: 'att-missing' }, cAll.missing + (cAll.missing === 1 ? ' check has' : ' checks have') + ' no date entered yet, so ' + (cAll.missing === 1 ? 'it is' : 'they are') + ' not counted as in date. ',
          h('button', { class: 'linkbtn', type: 'button', id: 'att-dates', onclick: () => { filter = 'missing'; ctab = 'overview'; go('compliance'); } }, 'Add the dates')) : null);
      const sideCards = [
        promos.length || soons.length ? h('div', { class: 'card addons' }, h('div', { class: 'titlerow' }, h('h2', {}, 'Add-ons'), h('span', { class: 'muted small' }, 'Unlock extra tools')), h('div', { class: 'promos' }, ...promos, ...soons), bundleCard()) : null
      ].filter(Boolean);
      const toolsCard =
        h('div', { class: 'card tools' }, h('h2', {}, 'Quick Access'),
          h('div', { class: 'qtiles' },
            q('mytasks', 'My Tasks', pend + ' Pending', () => go('tasks'), false, 'taskck'),
            tt.owned ? q('toolbox_talks', 'Toolbox Talks', '30+ available', () => viewExtra('toolbox_talks'), false, 'chat') : null,
            ss.owned ? q('staff_signin', 'Staff Clock In / Out', 'QR code per site', () => viewExtra('staff_signin'), false, 'clock') : null,
            pg && pg.owned ? q('posters', 'Poster Generator', '17 templates', () => viewExtra('posters'), false, 'poster') : null,
            q('emergency', 'Emergency Information', 'Contacts and emergency numbers', () => viewEmergency(), false, 'alert')));
      shellWith('home', sideCards, [
        h('div', { class: 'homehead' }, h('img', { class: 'homelogo', src: '/img/logo-full.png', alt: 'Tremcore' }), h('h1', { class: 'sr-only' }, 'Welcome' + (ctx.req && ctx.req.full_name ? ', ' + ctx.req.full_name.split(' ')[0] : '')), h('p', { class: 'tagline' }, 'the smarter way to stay compliant' + (site !== 'all' ? ' · ' + siteName(site) : ''))),
        h('div', { class: 'card overview' },
          ...heading(note),
          h('h2', {}, 'Core Compliance'),
          h('div', { class: 'summary' }, donut(c), c.total ? legendLines(c) : h('div', { class: 'legend' }, h('strong', { class: 'big' }, 'No checks yet'), h('div', { class: 'muted' }, 'Add your checks in Compliance and enter the date each one is next due.'))),
          h('button', { class: 'btn countbtn', id: 'view-full', type: 'button', onclick: () => { cgroup = 'core'; ctab = 'overview'; go('compliance'); } }, h('span', {}, 'Core Compliance'), h('span', { class: 'cnt' }, String(nCore)), h('span', { class: 'arr', 'aria-hidden': 'true' }, '\u2192')),
          h('button', { class: 'btn ghost countbtn', id: 'view-other', type: 'button', onclick: () => { cgroup = 'other'; ctab = 'overview'; go('compliance'); } }, h('span', {}, 'Other Compliance'), h('span', { class: 'cnt' }, String(nOther)), h('span', { class: 'arr', 'aria-hidden': 'true' }, '\u2192'))),
        sitePicker(viewHome),
        attention, toolsCard]);
    }

    // ---------- Compliance: Overview / By Category / Due Soon ----------
    function itemRow(r, multi) {
      return h('button', { class: 'item' + (multi ? '' : ' nosite'), type: 'button', 'data-id': r.id, onclick: () => viewItem(r.id) },
        h('i', { class: 'dot ' + r.status }), h('span', { class: 'title' }, r.title),
        h('span', { class: 'meta muted' }, multi ? h('span', { class: 'site' }, siteName(r.property_id)) : null, h('span', { class: 'due' }, dueText(r, true))),
        h('span', { class: 'tag ' + r.status }, ST[r.status].label));
    }
    const byUrgency = (a, b) => ST[a.status].rank - ST[b.status].rank || String(a.due_date || '').localeCompare(String(b.due_date || '')) || String(a.title).localeCompare(b.title);

    // Full compliance report as a PDF: a summary, a table by site, then every check for each site (Core, then Other), most urgent first.
    function downloadReport() {
      const rowsAll = items.filter((r) => site === 'all' || r.property_id === site);
      const co = (company && company.name) || '';
      const sites = (site === 'all' ? props : props.filter((p) => p.id === site)).slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
      const scope = sites.length === 1 ? sites[0].name : 'All sites';
      const today = new Date(), dstr = today.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
      const split = (c) => c.total + ' (' + c.green + ' in date, ' + c.amber + ' due soon, ' + c.red + ' overdue, ' + c.missing + ' with no date)';
      const cCore = tally(rowsAll.filter(isCore)), cOther = tally(rowsAll.filter((r) => !isCore(r)));
      const colour = { green: 'green', amber: 'amber', red: 'red', missing: 'grey' };
      const statusText = (r) => r.status === 'red' ? 'Overdue' + (r.days_left != null ? ' (' + Math.abs(r.days_left) + (Math.abs(r.days_left) === 1 ? ' day)' : ' days)') : '')
        : r.status === 'amber' ? 'Due soon' + (r.days_left != null ? ' (' + r.days_left + (r.days_left === 1 ? ' day)' : ' days)') : '') : r.status === 'green' ? 'In date' : 'No date entered';
      const checkTable = (rows) => ({ table: { cols: [{ t: 'Check', w: 175 }, { t: 'Basis', w: 80 }, { t: 'Last done', w: 70 }, { t: 'Next due', w: 70 }, { t: 'Status', w: 100 }],
        rows: rows.slice().sort(byUrgency).map((r) => [
          { t: r.title, b: true, sub: [r.provider, r.certificate_number ? 'Ref ' + r.certificate_number : '', r.notes].filter(Boolean).join(' - ').slice(0, 150) },
          BASIS[r.basis] || 'Standard', r.last_done ? shortDate(r.last_done) : '-', r.due_date ? shortDate(r.due_date) : 'Not entered', { t: statusText(r), c: colour[r.status] || 'grey', b: true }]) } });
      const blocks = [{ h: 'Summary' }, { kv: ['Business', co || '-'] }, { kv: ['Sites covered', sites.length ? sites.map((p) => p.name).join(', ') : '-'] }, { kv: ['Report date', dstr] },
        { kv: ['Core score', cCore.pct == null ? 'No checks yet' : cCore.pct + '% in date'] }, { kv: ['Core checks', split(cCore)] }, { kv: ['Other checks', split(cOther)] }];
      if (sites.length > 1) {
        blocks.push({ h: 'By site (Core checks)' });
        blocks.push({ table: { cols: [{ t: 'Site', w: 175 }, { t: 'Score', w: 70 }, { t: 'In date', w: 60 }, { t: 'Due soon', w: 65 }, { t: 'Overdue', w: 60 }, { t: 'No date', w: 65 }],
          rows: sites.map((p) => { const c = tally(items.filter((r) => r.property_id === p.id && isCore(r))); return [{ t: p.name, b: true }, c.pct == null ? '-' : c.pct + '%', String(c.green), String(c.amber), String(c.red), String(c.missing)]; }) } });
      }
      sites.forEach((p) => {
        const mine = items.filter((r) => r.property_id === p.id), core = mine.filter(isCore), other = mine.filter((r) => !isCore(r));
        blocks.push({ h: p.name + ' - Core Compliance (' + core.length + ')' });
        blocks.push(core.length ? checkTable(core) : { p: 'No Core checks have been added for this site yet.' });
        if (other.length) { blocks.push({ h: p.name + ' - Other Compliance (' + other.length + ')' }); blocks.push(checkTable(other)); }
      });
      if (!sites.length) blocks.push({ p: 'No checks have been added yet.' });
      blocks.push({ h: 'About this report' });
      blocks.push({ small: 'Status is worked out automatically from the next due date: in date means more than 30 days to go, due soon means within 30 days, and overdue means the date has passed. A check with no date entered is never counted as in date. The score is the share of Core checks that are in date, and checks with no date count against it.' });
      blocks.push({ small: 'The basis shown for each check (legal requirement, standard or best practice) is a general guide only and is not legal advice. What applies to your premises depends on the property, equipment, current legislation and your risk assessment, so please take professional advice where needed.' });
      const bytes = window.TCPdf.build({ title: 'Compliance Report', subtitle: (co ? co + ' - ' : '') + scope + ' - ' + dstr, footer: 'Tremcore Compliance Passport', blocks });
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const iso = today.toISOString().slice(0, 10), slug = (co || 'compliance').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'compliance';
      const a = h('a', { href: url, download: slug + '-compliance-report-' + iso + '.pdf' });
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
    }

    function viewList(note) {
      tab = 'compliance';
      const rows = items.filter((r) => site === 'all' || r.property_id === site);
      const cCore = tally(rows.filter(isCore));   // the ring: Core checks only
      const grows = rows.filter((r) => (cgroup === 'core') === isCore(r));   // the list: the chosen group
      const c = tally(grows);
      const nCore = rows.filter(isCore).length, nOther = rows.length - nCore;
      const shown = grows.filter((r) => filter === 'all' || r.status === filter);
      const level = ctx.req && ctx.req.level;
      const multi = props.length > 1;
      const tiles = [['all', 'All', grows.length], ['red', 'Overdue', c.red], ['amber', 'Due soon', c.amber], ['green', 'Complete', c.green], ['missing', 'No date', c.missing]]
        .map(([k, l, n]) => h('button', { class: 'stat ' + k, type: 'button', 'data-filter': k, 'aria-pressed': String(filter === k), onclick: () => { filter = k; viewList(); } },
          h('span', { class: 'num' }, String(n)), h('span', { class: 'lbl' }, l)));
      const subtabs = h('div', { class: 'subtabs', role: 'tablist' }, ...[['overview', 'Overview'], ['category', 'By Category'], ['due', 'Due Soon']].map(([k, l]) =>
        h('button', { type: 'button', class: 'subtab', role: 'tab', 'data-ctab': k, 'aria-selected': String(ctab === k), onclick: () => { ctab = k; viewList(); } }, l)));

      const summary = h('div', { class: 'card overview' },
        h('div', { class: 'welcome' }, h('h1', {}, 'Compliance'), h('p', { class: 'muted' }, 'Your compliance passport' + (site !== 'all' ? ' · ' + siteName(site) : ''))),
        ...heading(note), subtabs,
        !rights.can_edit ? h('p', { class: 'muted' }, level > 1 ? 'Tremcore manages your compliance records for you. If anything looks wrong, use the contact button at the top.' : 'You can view the passport but not change it. Ask your head-office user if something needs updating.') : null,
        ctab !== 'due' ? h('div', { class: 'summary' }, donut(cCore),
          h('div', { class: 'legend' }, h('strong', { class: 'big' }, cCore.pct == null ? 'No checks yet' : cCore.pct + '% in date'),
            h('div', { class: 'muted' }, cCore.total ? 'Checks with no date entered count against this figure, so a missing date is never shown as green.' : 'Add your checks below and enter the date each one is next due.'))) : null,
        ctab !== 'due' ? h('div', { class: 'btnrow reportrow' }, h('button', { class: 'btn small ghost', id: 'report-pdf', type: 'button', onclick: downloadReport }, 'Download full report (PDF)')) : null,
        ctab !== 'due' ? h('div', { class: 'subtabs groupswitch', role: 'tablist', 'aria-label': 'Core or Other' }, ...[['core', 'Core (' + nCore + ')'], ['other', 'Other (' + nOther + ')']].map(([k, l]) =>
          h('button', { type: 'button', class: 'subtab', role: 'tab', 'data-group': k, 'aria-selected': String(cgroup === k), onclick: () => { cgroup = k; filter = 'all'; viewList(); } }, l))) : null,
        ctab !== 'due' ? h('p', { class: 'muted small', id: 'group-help' }, (cgroup === 'core' ? 'These items make up the score above.' : 'These items are tracked but not counted in the score.') + (rights.can_edit ? ' Open an item to move it between Core and Other.' : '')) : null,
        ctab !== 'due' && grows.length ? h('div', { class: 'tiles5', role: 'group', 'aria-label': 'Show' }, ...tiles) : null);

      let body;
      if (ctab === 'category') {
        const groups = {};
        shown.forEach((r) => { (groups[r.grp || 'Other'] = groups[r.grp || 'Other'] || []).push(r); });
        const names = Object.keys(groups).sort((x, y) => (GROUPS.indexOf(x) + 99) % 99 - (GROUPS.indexOf(y) + 99) % 99 || x.localeCompare(y));
        body = names.map((g) => h('div', { class: 'group' }, h('h3', {}, g + ' (' + groups[g].length + ')'), ...groups[g].sort(byUrgency).map((r) => itemRow(r, multi))));
      } else if (ctab === 'due') {
        const due = rows.filter((r) => r.status !== 'green').sort(byUrgency);
        body = due.length ? due.map((r) => itemRow(r, multi)) : [];
      } else body = shown.slice().sort(byUrgency).map((r) => itemRow(r, multi));
      const empty = ctab === 'due' ? 'Nothing is due soon, overdue or missing a date. Well done.' : grows.length ? 'Nothing here.' : rows.length ? 'No ' + cgroup + ' compliance items here yet.' : rights.can_manage ? 'You have no checks yet. Add your first one with the button above.' : 'There are no checks to show yet.';
      const checksCard = h('div', { class: 'card' },
        h('div', { class: 'titlerow' }, h('h2', {}, ctab === 'due' ? 'Due Soon' : ctab === 'category' ? 'By Category' : (cgroup === 'core' ? 'Core Compliance' : 'Other Compliance')),
          (rights.can_edit || rights.can_manage) && props.length ? h('div', { class: 'btnrow' }, h('button', { class: 'btn small ghost', id: 'bulk-upload', type: 'button', onclick: () => viewBulk() }, 'Bulk upload'), rights.can_manage ? h('button', { class: 'btn small ghost', id: 'manage-sites', type: 'button', onclick: () => viewSites() }, multi ? 'Checks by site' : 'Choose checks') : null, rights.can_manage ? h('button', { class: 'btn small', id: 'add-check', type: 'button', onclick: () => viewAdd() }, 'Add a check') : null) : null),
        body.length && ctab !== 'category' ? h('div', { class: 'thead' + (multi ? '' : ' nosite'), 'aria-hidden': 'true' }, h('span', {}, ''), h('span', {}, 'Check'), multi ? h('span', {}, 'Site') : null, h('span', {}, 'Next due'), h('span', {}, 'Status')) : null,
        ...(body.length ? body : [h('p', { class: 'muted' }, empty)]));
      // Business insurance missed at set-up: one tap adds the missing insurance checks to the sites being shown.
      const INS = core.filter((c) => c.grp === 'Insurance');
      const targetSites = site === 'all' ? props : props.filter((p) => p.id === site);
      const haveCheck = (pid, label) => items.some((i) => i.property_id === pid && String(i.title).toLowerCase() === String(label).toLowerCase());
      const insMissing = []; targetSites.forEach((p) => INS.forEach((c) => { if (!haveCheck(p.id, c.label)) insMissing.push({ pid: p.id, c }); }));
      let insHidden = false; try { insHidden = localStorage.getItem('tc_noins') === '1'; } catch (e) { insHidden = false; }
      const insCard = rights.can_manage && INS.length && insMissing.length && !insHidden ? h('div', { class: 'card insprompt', id: 'ins-prompt' },
        h('h2', {}, 'Business insurance'),
        h('p', { class: 'muted' }, 'Employers\u2019 Liability, Public Liability and Buildings and contents insurance are not all on your list yet. Add them to keep your policy numbers, renewal dates and certificates here with everything else.'),
        h('button', { class: 'btn', id: 'ins-add', type: 'button', onclick: async (e) => { await busy(e.target, async () => {
          let uid = null; try { uid = (await sb.auth.getSession()).data.session.user.id; } catch (x) { uid = null; }
          const ins = await sb.from('compliance_items').insert(insMissing.map((m) => ({ property_id: m.pid, grp: m.c.grp, title: m.c.label, basis: m.c.basis, frequency_months: m.c.frequency_months || null, created_by: uid })));
          if (ins.error) return ctx.message(document.getElementById('ins-msg'), 'err', 'Sorry, the insurance checks could not be added. Please try again.');
          await reload(); viewList('Insurance checks added. Open each one and upload the policy certificate: we will read the dates and number for you to check.');
        }); } }, 'Add insurance checks'),
        h('div', { id: 'ins-msg' }),
        h('button', { class: 'linkbtn', id: 'ins-hide', type: 'button', onclick: () => { try { localStorage.setItem('tc_noins', '1'); } catch (x) { /* ignore */ } viewList(); } }, 'We do not need this')) : null;
      shell('compliance', summary, sitePicker(viewList), insCard, checksCard);
    }

    // ---------- My Tasks ----------
    const taskState = (t) => {
      if (t.status === 'done') return 'green';
      if (!t.due_date) return 'missing';
      const d = Math.round((new Date(t.due_date + 'T00:00:00Z') - new Date(today() + 'T00:00:00Z')) / 864e5);
      return d < 0 ? 'red' : d <= 30 ? 'amber' : 'green';
    };
    const taskText = (t) => t.status === 'done' ? 'Completed ' + shortDate(t.completed_at) : !t.due_date ? 'No due date' : (taskState(t) === 'red' ? 'Overdue since ' : 'Due ') + shortDate(t.due_date);
    function viewTasks(note) {
      tab = 'tasks';
      const mine = tasks.filter((t) => site === 'all' || t.property_id === site);
      const pend = mine.filter((t) => t.status === 'pending').sort((a, b) => String(a.due_date || '9999').localeCompare(String(b.due_date || '9999')));
      const done = mine.filter((t) => t.status === 'done').sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at)));
      const list = ttab === 'pending' ? pend : done;
      const box = h('div', { id: 'task-msg' });
      const act = async (btn, fn, okNote) => ctx.busy(btn, async () => {
        const r = await fn();
        if (r && r.error) { ctx.message(box, 'err', 'Sorry, that did not save. You may not have permission to change tasks.'); return; }
        await reload(); viewTasks(okNote);
      });
      const row = (t) => h('div', { class: 'item taskrow nosite', 'data-task': t.id },
        h('i', { class: 'dot ' + taskState(t) }), h('span', { class: 'title' }, t.title, t.repeat_months ? h('span', { class: 'muted small rep' }, ' · repeats every ' + t.repeat_months + (t.repeat_months === 1 ? ' month' : ' months')) : null),
        h('span', { class: 'meta muted' }, props.length > 1 ? h('span', { class: 'site' }, siteName(t.property_id)) : null, h('span', { class: 'due' }, taskText(t))),
        rights.can_edit && t.status === 'pending' ? h('span', { class: 'rowtools' },
          h('button', { class: 'btn small', type: 'button', 'data-done': t.id, onclick: (e) => act(e.target, () => sb.rpc('complete_task', { p_id: t.id }), 'Task completed.') }, 'Done'),
          h('button', { class: 'btn small ghost', type: 'button', 'data-del': t.id, onclick: (e) => act(e.target, () => sb.from('tasks').delete().eq('id', t.id), 'Task removed.') }, 'Remove')) : h('span', { class: 'tag ' + taskState(t) }, t.status === 'done' ? 'Done' : ST[taskState(t)].label));
      const tabs = h('div', { class: 'subtabs', role: 'tablist' },
        h('button', { type: 'button', class: 'subtab', role: 'tab', 'data-ttab': 'pending', 'aria-selected': String(ttab === 'pending'), onclick: () => { ttab = 'pending'; viewTasks(); } }, 'Pending (' + pend.length + ')'),
        h('button', { type: 'button', class: 'subtab', role: 'tab', 'data-ttab': 'done', 'aria-selected': String(ttab === 'done'), onclick: () => { ttab = 'done'; viewTasks(); } }, 'Completed'));
      // List or Calendar (calendar shows pending tasks by their due date)
      const viewSwitch = h('div', { class: 'pills', role: 'group', 'aria-label': 'View' },
        h('button', { type: 'button', class: 'pill', 'data-tview': 'list', 'aria-pressed': String(tview === 'list'), onclick: () => { tview = 'list'; viewTasks(); } }, 'List'),
        h('button', { type: 'button', class: 'pill', 'data-tview': 'calendar', 'aria-pressed': String(tview === 'calendar'), onclick: () => { tview = 'calendar'; viewTasks(); } }, 'Calendar'));
      const calendar = () => {
        const t0 = today(); const ym = calMonth || t0.slice(0, 7);
        const y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1;
        const first = new Date(Date.UTC(y, m, 1)), days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(), lead = (first.getUTCDay() + 6) % 7;   // week starts on Monday
        const shift = (d) => { const n = new Date(Date.UTC(y, m + d, 1)); calMonth = n.toISOString().slice(0, 7); calDay = null; viewTasks(); };
        const byDay = {}; pend.forEach((t) => { if (t.due_date && t.due_date.slice(0, 7) === ym) (byDay[t.due_date] = byDay[t.due_date] || []).push(t); });
        const cells = []; for (let i = 0; i < lead; i++) cells.push(h('span', { class: 'cal-blank', 'aria-hidden': 'true' }));
        for (let d = 1; d <= days; d++) {
          const iso = ym + '-' + String(d).padStart(2, '0'), ts = byDay[iso] || [];
          const st = ts.length ? (ts.some((x) => taskState(x) === 'red') ? 'red' : ts.some((x) => taskState(x) === 'amber') ? 'amber' : 'green') : '';
          cells.push(h('button', { type: 'button', class: 'cal-day' + (iso === t0 ? ' today' : '') + (calDay === iso ? ' sel' : ''), 'data-day': iso, 'aria-label': d + ' ' + first.toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' }) + (ts.length ? ', ' + ts.length + (ts.length === 1 ? ' task' : ' tasks') : ''), onclick: () => { calDay = calDay === iso ? null : iso; viewTasks(); } },
            h('span', {}, String(d)), ts.length ? h('i', { class: 'dot ' + st }) : null));
        }
        const dayTasks = calDay ? (byDay[calDay] || []) : [];
        return h('div', { class: 'calendar', id: 'task-calendar' },
          h('div', { class: 'cal-head' }, h('button', { type: 'button', class: 'linkbtn', id: 'cal-prev', 'aria-label': 'Previous month', onclick: () => shift(-1) }, '\u2039'),
            h('strong', {}, first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })),
            h('button', { type: 'button', class: 'linkbtn', id: 'cal-next', 'aria-label': 'Next month', onclick: () => shift(1) }, '\u203A')),
          h('div', { class: 'cal-week', 'aria-hidden': 'true' }, ...['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((x) => h('span', {}, x))),
          h('div', { class: 'cal-grid' }, ...cells),
          calDay ? h('div', { class: 'cal-day-list' }, h('h3', {}, shortDate(calDay)), ...(dayTasks.length ? dayTasks.map(row) : [h('p', { class: 'muted' }, 'No tasks due this day.')])) : h('p', { class: 'muted small' }, 'Tap a day to see its tasks.'),
          pend.some((t) => !t.due_date) ? h('p', { class: 'muted small' }, 'Tasks with no due date only show in the list.') : null);
      };
      shell('tasks', h('div', { class: 'card' },
        h('div', { class: 'titlerow' }, h('h1', {}, 'My Tasks')),
        ...heading(note), viewSwitch, tview === 'list' ? tabs : null, box,
        !rights.can_edit ? h('p', { class: 'muted' }, 'You can see these tasks but not change them.') : null,
        ...(tview === 'calendar' ? [calendar()] : list.length ? list.map(row) : [h('p', { class: 'muted' }, ttab === 'pending' ? 'No pending tasks.' : 'No completed tasks yet.')]),
        rights.can_edit && props.length ? h('button', { class: 'btn', id: 'add-task', type: 'button', onclick: () => viewTaskAdd() }, 'Add New Task +') : null),
        sitePicker(viewTasks));
    }
    function viewTaskAdd() {
      const box = h('div', {});
      const title = h('input', { id: 't-title', maxlength: '160', autocomplete: 'off' });
      const due = h('input', { id: 't-due', type: 'date' });
      const rep = h('input', { id: 't-repeat', type: 'number', min: '1', max: '120', inputmode: 'numeric' });
      const sel = h('select', { id: 't-site' }, ...props.map((p) => h('option', { value: p.id, selected: p.id === (site !== 'all' ? site : props[0].id) }, p.name)));
      const notes = h('textarea', { id: 't-notes', rows: '3', maxlength: '2000' });
      const used = tasks.filter((t) => t.status === 'pending' && t.repeat_months).length;
      const save = h('button', { class: 'btn', id: 't-save', type: 'button', onclick: async (e) => {
        const t = title.value.trim(); const r = rep.value.trim();
        if (!t) return ctx.message(box, 'err', 'Please give the task a name.');
        if (!validDate(due.value)) return ctx.message(box, 'err', 'Please check the due date.');
        if (r && !(Number.isInteger(+r) && +r >= 1 && +r <= 120)) return ctx.message(box, 'err', 'Repeat every must be a whole number of months, 1 to 120.');
        await ctx.busy(e.target, async () => {
          const res = await sb.from('tasks').insert({ property_id: sel.value, title: t, notes: notes.value.trim(), due_date: due.value || null, repeat_months: r ? +r : null });
          if (res.error) return ctx.message(box, 'err', /repeat_limit/.test(res.error.message || '') ? 'You already have 10 repeating tasks. Finish or remove one first.' : 'Sorry, that did not save. Please try again.');
          await reload(); viewTasks('Task added.');
        });
      } }, 'Save task');
      page('form', h('div', { class: 'card form' }, backTo('Back to tasks'), h('h1', {}, 'Add New Task'),
        h('label', { for: 't-title' }, 'Task'), title,
        props.length > 1 ? [h('label', { for: 't-site' }, 'Site'), sel] : null,
        h('label', { for: 't-due' }, 'Due date (optional)'), due,
        h('label', { for: 't-repeat' }, 'Repeat every (months, optional)'), rep,
        h('p', { class: 'muted small' }, 'Repeating tasks come back by themselves when you tick them off. You can have up to 10 repeating tasks (' + used + ' in use).'),
        h('label', { for: 't-notes' }, 'Notes (optional)'), notes, save, box));
    }

    // ---------- Emergency Information ----------
    async function viewEmergency(note, pid) {
      tab = 'home';
      if (!props.length) return viewHome('Add a site first.');
      pid = pid || (site !== 'all' ? site : props[0].id);
      page('form', h('div', { class: 'card' }, h('p', { class: 'muted center' }, 'Loading…')));
      const [er, cr] = await Promise.all([sb.from('site_emergency').select('*').eq('property_id', pid).maybeSingle(), sb.from('emergency_contacts').select('*').eq('property_id', pid).order('name')]);
      const e0 = (er && er.data) || null, contacts = (cr && cr.data) || [];
      const can = rights.can_edit;
      const box = h('div', {});
      const F = [['assembly_point', 'Assembly Point', 'e-assembly'], ['gas_shutoff', 'Gas Company Phone Number', 'e-gas'], ['water_shutoff', 'Water Board Phone Number', 'e-water'], ['electric_shutoff', 'Electric Board Phone Number', 'e-electric']];
      const inputs = {};
      F.forEach(([k, , id]) => { inputs[k] = h('input', Object.assign({ id, maxlength: '300', value: (e0 && e0[k]) || '', autocomplete: 'off' }, k === 'assembly_point' ? {} : { type: 'tel', inputmode: 'tel' })); });
      const notes = h('textarea', { id: 'e-notes', rows: '3', maxlength: '2000' }, (e0 && e0.notes) || '');
      const saveBtn = h('button', { class: 'btn', id: 'e-save', type: 'button', onclick: async (ev) => ctx.busy(ev.target, async () => {
        const v = { assembly_point: inputs.assembly_point.value.trim(), gas_shutoff: inputs.gas_shutoff.value.trim(), water_shutoff: inputs.water_shutoff.value.trim(), electric_shutoff: inputs.electric_shutoff.value.trim(), notes: notes.value.trim() };
        const res = e0 ? await sb.from('site_emergency').update(v).eq('property_id', pid) : await sb.from('site_emergency').insert(Object.assign({ property_id: pid }, v));
        if (res.error) return ctx.message(box, 'err', 'Sorry, that did not save. Please try again.');
        viewEmergency('Emergency information saved.', pid);
      }) }, 'Save');
      const FM = window.TCFormat;
      const cname = FM.tidyBox(h('input', { id: 'c-name', maxlength: '120', autocomplete: 'off' })), crole = FM.tidyBox(h('input', { id: 'c-role', maxlength: '120', autocomplete: 'off' })), cphone = FM.tidyBox(h('input', { id: 'c-phone', type: 'tel', maxlength: '40', autocomplete: 'off', placeholder: '01634 123456' }), 'phone');
      const addC = h('button', { class: 'btn small', id: 'c-add', type: 'button', onclick: async (ev) => ctx.busy(ev.target, async () => {
        if (!cname.value.trim()) return ctx.message(box, 'err', 'Please enter the contact\'s name.');
        const ph = FM.phone(cphone.value); if (!ph.ok) return ctx.message(box, 'err', FM.PHONE_HELP);
        const res = await sb.from('emergency_contacts').insert({ property_id: pid, name: FM.cap(cname.value.trim()), role: FM.cap(crole.value.trim()), phone: ph.value });
        if (res.error) return ctx.message(box, 'err', /contact_limit/.test(res.error.message || '') ? 'You can add up to 10 contacts per site.' : 'Sorry, that did not save. Please try again.');
        viewEmergency('Contact added.', pid);
      }) }, 'Add contact');
      const crow = (c) => h('div', { class: 'econ', 'data-contact': c.id }, h('span', {}, h('strong', {}, c.name), c.role ? h('span', { class: 'muted small' }, ' · ' + c.role) : null),
        c.phone ? h('a', { href: 'tel:' + c.phone.replace(/[^\d+]/g, '') }, c.phone) : null,
        can ? h('button', { class: 'btn small ghost', type: 'button', 'data-rm-contact': c.id, onclick: async () => { const r = await sb.from('emergency_contacts').delete().eq('id', c.id); if (r.error) return ctx.message(box, 'err', 'Sorry, that did not work.'); viewEmergency('Contact removed.', pid); } }, 'Remove') : null);
      const sitePick = props.length > 1 ? [h('label', { for: 'e-site' }, 'Site'), h('select', { id: 'e-site', onchange: (ev) => viewEmergency(null, ev.target.value) }, ...props.map((p) => h('option', { value: p.id, selected: p.id === pid }, p.name)))] : null;
      page('form', h('div', { class: 'card form' }, backTo('Back to home'), h('h1', {}, 'Emergency Information'),
        note ? h('div', { class: 'msg ok', role: 'status' }, note) : null, sitePick,
        h('h2', {}, 'Key contacts'),
        ...(contacts.length ? contacts.map(crow) : [h('p', { class: 'muted' }, 'No contacts added yet.')]),
        can ? [h('label', { for: 'c-name' }, 'Name'), cname, h('label', { for: 'c-role' }, 'Role (optional)'), crole, h('label', { for: 'c-phone' }, 'Phone'), cphone, addC] : null,
        h('h2', {}, 'Assembly Point and Emergency Numbers'),
        ...(can ? [...F.flatMap(([k, l, id]) => [h('label', { for: id }, l), inputs[k]]), h('label', { for: 'e-notes' }, 'Other Numbers'), notes, saveBtn]
          : [...F.map(([k, l]) => h('div', { class: 'kv' }, h('span', {}, l), h('span', {}, (e0 && e0[k]) || 'Not added yet'))), (e0 && e0.notes) ? h('p', {}, e0.notes) : null]),
        box));
    }

    // ---------- paid add-ons (Toolbox Talks, Staff Clock In / Out) ----------
    // The head-office user is sent to Stripe to pay; the add-on switches on when Stripe confirms (the database decides, not this screen).
    let onExtra = null, extraChecks = 0;
    async function startExtraPayment(code, btn, box, interval) {
      await ctx.busy(btn, async () => {
        try {
          const { data: { session } } = await sb.auth.getSession();
          const r = await fetch('/api/checkout-extra', { method: 'POST', headers: { Authorization: 'Bearer ' + ((session && session.access_token) || ''), 'Content-Type': 'application/json' }, body: JSON.stringify({ code, interval: interval === 'year' ? 'year' : 'month' }) });
          const j = await r.json().catch(() => ({}));
          if (r.ok && j.url) { location.href = j.url; return; }
          ctx.message(box, 'err', j.error || 'Sorry, we could not start the payment. Please try again, or contact Tremcore.');
        } catch { ctx.message(box, 'err', 'Sorry, we could not start the payment. Please try again, or contact Tremcore.'); }
      });
    }
    // Coming back from Stripe: wait (up to about a minute) for the confirmation, then show the add-on.
    async function afterExtraPayment(code, paid) {
      const clean = () => { try { history.replaceState(null, '', '/app/'); } catch { /* ignore */ } };
      if (!extraOf(code) || !EXTRA_DEFAULT.some((x) => x.code === code)) { clean(); return viewHome(); }
      if (paid !== '1') { clean(); return viewExtra(code, 'cancelled'); }
      await reload();
      if (extraOf(code).owned) { clean(); extraChecks = 0; return viewExtra(code, 'thanks'); }
      extraChecks += 1;
      if (extraChecks > 20) { clean(); extraChecks = 0; return viewExtra(code, 'late'); }
      viewExtra(code, 'confirming');
      setTimeout(() => { if (onExtra === code) afterExtraPayment(code, '1'); }, 3000);
    }
    // An announced add-on that is not available yet: what it will do and its price, with nothing to buy.
    // The all-4 bundle: Toolbox Talks + Staff Clock In / Out + Reviews + Poster Generator for one price. Reviews is not built yet, so it cannot be bought for now.
    function viewBundle() {
      tab = 'home';
      const names = ['Toolbox Talks', 'Staff Clock In / Out', 'Reviews', 'Poster Generator'];
      page('form', h('div', { class: 'card form', 'data-bundle-page': 'all' }, backTo('Back to home'), h('h1', {}, 'Unlock all 4 add-ons'),
        h('p', {}, 'Toolbox Talks, Staff Clock In / Out, Reviews and Poster Generator together on one subscription.'),
        h('ul', { class: 'ticks' }, ...names.map((n) => h('li', {}, n))),
        h('p', { class: 'big goldbox' }, money(BUNDLE.price_pence) + ' + VAT per month'),
        h('p', { class: 'muted' }, 'That saves ' + money(BUNDLE.save_pence) + ' a month compared with buying the four separately (prices for one site).'),
        h('div', { class: 'msg ok', role: 'status', id: 'bundle-note' }, 'Coming soon. The bundle opens as soon as Reviews is ready. Until then you can add Toolbox Talks, Staff Clock In / Out and Poster Generator on their own from Home.'),
        h('button', { class: 'btn ghost', type: 'button', id: 'bundle-back', onclick: () => viewHome() }, 'Back to add-ons')));
    }
    function viewSoon(code) {
      const x = SOON.find((y) => y.code === code); if (!x) return viewHome();
      tab = 'home';
      page('form', h('div', { class: 'card form', 'data-soon-page': code }, backTo('Back to home'), h('h1', {}, x.name), h('p', {}, x.intro),
        h('ul', { class: 'ticks' }, ...x.feats.map((f) => h('li', {}, f))),
        h('p', { class: 'big goldbox' }, money(x.price_pence) + ' + VAT per month'),
        h('div', { class: 'msg ok', role: 'status', id: 'soon-note' }, 'Coming soon. ' + x.name + ' is not ready to add yet. We will let you know when it is.')));
    }
    // Poster Generator: a self-contained tool kept on our server. It opens in a locked-down frame that cannot reach the app's sign-in; the saved poster settings
    // go in through the frame name and come back out as messages, and are kept in this browser for this business.
    let posterFrame = null;
    window.addEventListener('message', (ev) => {
      if (!posterFrame || ev.source !== posterFrame.contentWindow || !ev.data || ev.data.tc !== 'poster-save' || !company) return;
      try { const t = JSON.stringify(ev.data.state); if (t && t.length < 3000000) localStorage.setItem('tc-poster-' + company.id, t); } catch (e) { /* storage full or off: nothing is lost except the saved settings */ }
    });
    async function viewPosters(note) {
      tab = 'home';
      const box = h('div', {});
      page('form', h('div', { class: 'posterwrap', 'data-addon-page': 'posters' }, backTo('Back to home'), note ? h('div', { class: 'msg ok', role: 'status' }, note) : null, box,
        h('p', { class: 'muted center', id: 'poster-loading' }, 'Opening the Poster Generator\u2026')));
      try {
        const { data: { session } } = await sb.auth.getSession();
        const r = await fetch('/api/addon-ticket', { method: 'POST', headers: { Authorization: 'Bearer ' + ((session && session.access_token) || ''), 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'posters' }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.url) return ctx.message(box, 'err', j.error || 'Sorry, we could not open the Poster Generator. Please try again.');
        let saved = null; try { saved = JSON.parse(localStorage.getItem('tc-poster-' + (company && company.id)) || 'null'); } catch (e) { saved = null; }
        const f = h('iframe', { class: 'posterframe', id: 'poster-frame', title: 'Poster Generator', sandbox: 'allow-scripts allow-downloads allow-modals allow-popups', referrerpolicy: 'no-referrer',
          name: JSON.stringify({ state: saved, brand: { name: (company && company.name) || '' } }), src: j.url });
        posterFrame = f;
        const ld = document.getElementById('poster-loading'); if (ld) ld.remove();
        box.appendChild(f);
      } catch (e) { ctx.message(box, 'err', 'Sorry, we could not open the Poster Generator. Please try again.'); }
    }
    function viewExtra(code, state) {
      const e = extraOf(code);
      if (e.owned && state !== 'confirming' && code === 'toolbox_talks') {
        tab = 'home';
        return window.TCToolbox.open({ sb, h, ctx, page, backTo, props: () => props, site: () => site, rights: () => rights, isHead: () => isHead, shortDate, siteName,
          companyName: () => (company && company.name) || '', companyId: () => company && company.id, back: backBtn, openPeople: (pid) => viewClock(null, pid, 'toolbox') }, state === 'thanks' ? e.name + ' is now on your account. Pick a talk to get started.' : null);
      }
      if (e.owned && state !== 'confirming' && code === 'posters') return viewPosters(state === 'thanks' ? e.name + ' is now on your account. Pick a template to get started.' : null);
      if (e.owned && state !== 'confirming' && code === 'staff_signin') return viewClock(state === 'thanks' ? e.name + ' is now on your account. Add the people who will use it below.' : null);
      const box = h('div', {});
      const sites = props.length || 1, qty = e.charged_per === 'site' ? sites : 1;
      const total = e.price_pence * qty;
      page('form', h('div', { class: 'card form', 'data-extra': code }, backTo('Back to home'), h('h1', {}, e.name),
        h('p', {}, e.description),
        state === 'confirming' ? h('div', { class: 'msg ok', role: 'status', id: 'extra-confirming' }, 'Thank you. We are waiting for your payment to be confirmed. This page updates by itself, usually within a few seconds.') : null,
        state === 'cancelled' ? h('div', { class: 'msg err', role: 'status' }, 'The payment was not completed. You have not been charged. You can try again when you are ready.') : null,
        state === 'late' ? h('div', { class: 'msg err', role: 'status' }, 'Your payment is taking longer than usual to confirm. Please check again in a few minutes. If it still has not appeared, email Tremcore and we will sort it out.') : null,
        state === 'thanks' && e.owned ? h('div', { class: 'msg ok', role: 'status' }, 'Thank you. ' + e.name + ' is now on your account.') : null,
        e.owned && state !== 'confirming'
          ? h('div', { class: 'msg ok', role: 'status' }, 'This add-on is active on your account.')
          : state === 'confirming' ? null : [h('p', { class: 'big goldbox' }, priceText(e)),
            e.charged_per === 'site' ? h('p', { class: 'muted' }, 'This is charged for each site. You have ' + sites + (sites === 1 ? ' site' : ' sites') + ': ' + sites + ' × ' + money(e.price_pence) + ' = ' + money(total) + ' + VAT per month, or ' + money(yearlyPence(e) * qty) + ' + VAT for 12 months paid upfront.') : null,
            isHead && ((company && company.level) || 1) === 1 ? h('fieldset', { class: 'payway', id: 'extra-way' }, h('legend', {}, 'How would you like to pay?'),
              h('label', { class: 'payopt' }, h('input', { type: 'radio', name: 'extra-way', value: 'year', checked: true }), h('span', {}, h('strong', {}, 'Yearly upfront'), ' ' + money(yearlyPence(e) * qty) + ' + VAT a year \u00b7 save 15%')),
              h('label', { class: 'payopt' }, h('input', { type: 'radio', name: 'extra-way', value: 'month' }), h('span', {}, h('strong', {}, 'Monthly'), ' ' + money(total) + ' + VAT a month'))) : null,
            isHead && ((company && company.level) || 1) === 1
              ? [h('button', { class: 'btn', id: 'extra-add', type: 'button', onclick: (ev) => { const w = document.querySelector('input[name=extra-way]:checked'); startExtraPayment(code, ev.target, box, w && w.value); } }, 'Add ' + e.name + ' · pay now'),
                h('p', { class: 'muted small' }, 'You will be taken to our secure payment page. The add-on starts as soon as your payment is confirmed. Monthly add-ons are added to your monthly subscription; a yearly add-on is one payment for 12 months.'),
                h('p', { class: 'muted small', id: 'extra-terms' }, 'Add-ons run on a 12-month rolling contract: it renews for a further 12 months unless you request cancellation at least 30 days before the renewal date.')]
              : h('p', { class: 'muted' }, 'Ask your head-office user to add this to your account.'), box]));
      onExtra = code;
    }

    // ---------- Staff Clock In / Out: who uses it ----------
    async function viewClock(note, pid, from) {
      tab = 'home';
      if (!props.length) return viewHome('Add a site first.');
      pid = pid || (site !== 'all' ? site : props[0].id);
      page('form', h('div', { class: 'card' }, h('p', { class: 'muted center' }, 'Loading…')));
      const r = await sb.from('staff_members').select('*').eq('property_id', pid).order('full_name');
      const staff = (r && r.data) || [];
      const can = rights.can_edit, box = h('div', {});
      const name = window.TCFormat.tidyBox(h('input', { id: 's-name', maxlength: '120', autocomplete: 'off' })), title = window.TCFormat.tidyBox(h('input', { id: 's-title', maxlength: '120', autocomplete: 'off' }));
      const refresh = (n) => viewClock(n, pid, from);
      const add = h('button', { class: 'btn small', id: 's-add', type: 'button', onclick: (ev) => ctx.busy(ev.target, async () => {
        if (!name.value.trim()) return ctx.message(box, 'err', 'Please enter the person\'s name.');
        const res = await sb.from('staff_members').insert({ property_id: pid, full_name: window.TCFormat.cap(name.value.trim()), job_title: window.TCFormat.cap(title.value.trim()) });
        if (res.error) return ctx.message(box, 'err', /staff_limit/.test(res.error.message || '') ? 'You can add up to 300 people per site.' : 'Sorry, that did not save. Please try again.');
        refresh('Person added.');
      }) }, 'Add person');
      const row = (m) => h('div', { class: 'econ', 'data-staff': m.id },
        h('span', {}, h('strong', {}, m.full_name), m.job_title ? h('span', { class: 'muted small' }, ' · ' + m.job_title) : null, m.active ? null : h('span', { class: 'tag missing' }, 'Not active')),
        can ? h('span', { class: 'rowtools' },
          h('button', { class: 'btn small ghost', type: 'button', 'data-toggle-staff': m.id, onclick: async () => { const x = await sb.from('staff_members').update({ active: !m.active }).eq('id', m.id); if (x.error) return ctx.message(box, 'err', 'Sorry, that did not work.'); refresh(m.active ? 'Marked as not active.' : 'Marked as active.'); } }, m.active ? 'Stop' : 'Restore'),
          h('button', { class: 'btn small ghost', type: 'button', 'data-shifts': m.id, onclick: () => viewShifts(pid, m, from) }, 'Shifts'),
          h('button', { class: 'btn small ghost', type: 'button', 'data-rm-staff': m.id, onclick: async () => { const x = await sb.from('staff_members').delete().eq('id', m.id); if (x.error) return ctx.message(box, 'err', 'Sorry, that did not work.'); refresh('Person removed.'); } }, 'Remove')) : null);
      const sitePick = props.length > 1 ? [h('label', { for: 's-site' }, 'Site'), h('select', { id: 's-site', onchange: (ev) => viewClock(null, ev.target.value, from) }, ...props.map((p) => h('option', { value: p.id, selected: p.id === pid }, p.name)))] : null;
      const fromTalks = from === 'toolbox';
      page('form', h('div', { class: fromTalks ? '' : 'clockpage' }, h('div', { class: 'card form' }, fromTalks ? backBtn('Back to Toolbox Talks', () => viewExtra('toolbox_talks')) : backTo('Back to home'), h('h1', {}, fromTalks ? 'People at this site' : 'Staff Clock In / Out'),
        note ? h('div', { class: 'msg ok', role: 'status' }, note) : null, sitePick,
        h('h2', {}, (fromTalks ? 'People you can choose for talks at ' : 'People who use it at ') + siteName(pid)),
        ...(staff.length ? staff.map(row) : [h('p', { class: 'muted' }, fromTalks ? 'Nobody added yet. Add the people who will attend talks at this site.' : 'Nobody added yet. Add the people who need to clock in and out at this site.')]),
        can ? [h('label', { for: 's-name' }, 'Name'), name, h('label', { for: 's-title' }, 'Job title (optional)'), title, add] : h('p', { class: 'muted' }, 'You can see this list but not change it.'),
        box),
        fromTalks ? null : h('div', { class: 'card', id: 'shift-report-card' }, h('h2', {}, 'Shift report'), h('p', { class: 'muted' }, 'Set each person\u2019s weekly shifts with the Shifts button above, then see how their clock-in and clock-out times compare, day by day.'), h('button', { class: 'btn', type: 'button', id: 'shift-report', onclick: () => viewShiftReport(pid, from) }, 'Open the shift report')),
        fromTalks ? null : clockCards(pid),
        fromTalks ? null : h('div', { class: 'card', id: 'clock-more' }, h('p', { class: 'muted small' }, 'Anyone who has seen the QR code could clock in as any name on the list, so only put the poster somewhere your team can see it, and replace the code if it is ever taken away or photographed.'))));
    }


    // ---------- Staff shifts and the shift report ----------
    const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const hhmm = (t) => (t ? String(t).slice(0, 5) : '');

    async function viewShifts(pid, m, from) {
      const msg = h('div', { id: 'shift-msg' });
      const r = await sb.from('staff_shifts').select('weekday,start_time,end_time').eq('member_id', m.id);
      const cur = {}; ((r && r.data) || []).forEach((x) => { cur[x.weekday] = x; });
      const inputs = DAYS.map((d, i) => ({
        day: i + 1,
        start: h('input', { type: 'time', class: 's-start', 'data-day': String(i + 1), 'aria-label': d + ' start', value: hhmm(cur[i + 1] && cur[i + 1].start_time), disabled: !rights.can_edit }),
        end: h('input', { type: 'time', class: 's-end', 'data-day': String(i + 1), 'aria-label': d + ' finish', value: hhmm(cur[i + 1] && cur[i + 1].end_time), disabled: !rights.can_edit })
      }));
      const copy = h('button', { class: 'btn small ghost', type: 'button', id: 'shift-copy', onclick: () => { for (let i = 1; i < 5; i++) { inputs[i].start.value = inputs[0].start.value; inputs[i].end.value = inputs[0].end.value; } } }, 'Copy Monday to Tuesday-Friday');
      const clear = h('button', { class: 'btn small ghost', type: 'button', id: 'shift-clear', onclick: () => inputs.forEach((x) => { x.start.value = ''; x.end.value = ''; }) }, 'Clear all');
      const save = h('button', { class: 'btn', type: 'button', id: 'shift-save', onclick: () => ctx.busy(save, async () => {
        const rows = [];
        for (const x of inputs) {
          const a = x.start.value, b = x.end.value;
          if (!a && !b) continue;
          if (!a || !b) return ctx.message(msg, 'err', DAYS[x.day - 1] + ': please enter both a start and a finish time, or leave both empty for a day off.');
          if (a === b) return ctx.message(msg, 'err', DAYS[x.day - 1] + ': the start and finish times cannot be the same.');
          rows.push({ member_id: m.id, weekday: x.day, start_time: a, end_time: b });
        }
        const d = await sb.from('staff_shifts').delete().eq('member_id', m.id);
        if (d.error) return ctx.message(msg, 'err', 'Sorry, the shifts could not be saved. You may not have permission to change them.');
        if (rows.length) { const i = await sb.from('staff_shifts').insert(rows); if (i.error) return ctx.message(msg, 'err', 'Sorry, the shifts could not be saved. Please try again.'); }
        viewClock('Shifts saved for ' + m.full_name + '.', pid, from);
      }) }, 'Save shifts');
      page('form', h('div', { class: 'card form' }, backBtn('Back to people', () => viewClock(null, pid, from)), h('h1', {}, 'Shifts for ' + m.full_name),
        h('p', { class: 'muted' }, 'Enter the start and finish time for each day this person works. Leave a day empty if it is a day off. A finish time earlier than the start time means the shift runs past midnight. All times are UK time.'),
        h('div', { class: 'shiftgrid', role: 'group', 'aria-label': 'Weekly shifts' }, h('span', { class: 'sg-h' }, 'Day'), h('span', { class: 'sg-h' }, 'Start'), h('span', { class: 'sg-h' }, 'Finish'),
          ...inputs.flatMap((x) => [h('span', { class: 'sg-day' }, DAYS[x.day - 1]), x.start, x.end])),
        rights.can_edit ? h('div', { class: 'btnrow' }, copy, clear) : h('p', { class: 'muted' }, 'You can see these shifts but not change them.'),
        rights.can_edit ? save : null, msg));
    }

    async function viewShiftReport(pid, from, range, who) {
      const SH = window.TCShifts;
      const today = SH.ukParts(new Date().toISOString()).date;
      const rg = range || SH.weekOf(today);
      page('form', h('div', { class: 'card' }, h('p', { class: 'muted center' }, 'Loading…')));
      const lo = SH.addDays(rg.from, -1) + 'T00:00:00Z', hi = SH.addDays(rg.to, 2) + 'T00:00:00Z';
      const [mr, sr, ar] = await Promise.all([
        sb.from('staff_members').select('id,full_name,active').eq('property_id', pid).order('full_name'),
        sb.from('staff_shifts').select('member_id,weekday,start_time,end_time').eq('property_id', pid),
        sb.from('staff_attendance').select('id,member_id,member_name,clocked_in,clocked_out,no_clock_out').eq('property_id', pid).gte('clocked_in', lo).lt('clocked_in', hi).order('clocked_in')]);
      const members = (mr && mr.data) || [], shifts = ((sr && sr.data) || []).map((x) => Object.assign({}, x, { start_time: hhmm(x.start_time), end_time: hhmm(x.end_time) })), atts = (ar && ar.data) || [];
      const rows = SH.buildRows(atts, shifts, members, rg.from, rg.to, today, who || '');
      const dlabel = (d) => new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(d + 'T00:00:00Z'));
      const go = (r2, w2) => viewShiftReport(pid, from, r2, w2 === undefined ? who : w2);
      const fromIn = h('input', { type: 'date', id: 'rep-from', value: rg.from, 'aria-label': 'From' }), toIn = h('input', { type: 'date', id: 'rep-to', value: rg.to, 'aria-label': 'To' });
      const whoSel = h('select', { id: 'rep-who', 'aria-label': 'Person' }, h('option', { value: '' }, 'Everyone'), ...members.map((m) => h('option', { value: m.id, selected: m.id === who }, m.full_name)));
      const apply = () => { if (!fromIn.value || !toIn.value || fromIn.value > toIn.value) return; const days = (new Date(toIn.value) - new Date(fromIn.value)) / 864e5; if (days > 92) return; go({ from: fromIn.value, to: toIn.value }, whoSel.value); };
      fromIn.addEventListener('change', apply); toIn.addEventListener('change', apply); whoSel.addEventListener('change', apply);
      const cell = (cls, time, note) => h('span', { class: 'rcell ' + cls }, time, note ? h('small', {}, ' ' + note) : null);
      const trs = rows.map((r) => {
        const sh = r.shift ? r.shift.start_time + ' to ' + r.shift.end_time : 'No shift set';
        if (r.kind === 'none') return h('tr', { class: 'rep-none', 'data-name': r.name }, h('td', {}, dlabel(r.date)), h('td', {}, r.name), h('td', {}, sh), h('td', { colspan: '2', class: 'muted' }, 'No clock-in recorded'));
        const j = r.judged, a = r.att;
        const outTime = a.clocked_out ? londonTime(a.clocked_out) : a.no_clock_out ? 'No clock-out' : 'Still in';
        return h('tr', { 'data-name': r.name }, h('td', {}, dlabel(r.date)), h('td', {}, r.name), h('td', {}, sh),
          h('td', { class: 'in-' + j.inState }, cell(j.inState === 'late' ? 't-late' : j.inState === 'early' ? 't-early' : '', londonTime(a.clocked_in), j.inNote)),
          h('td', { class: 'out-' + j.outState }, cell(j.outState === 'early' ? 't-late' : '', outTime, j.outNote)));
      });
      const late = rows.filter((r) => r.judged && r.judged.inState === 'late').length, early = rows.filter((r) => r.judged && r.judged.inState === 'early').length;
      const csv = () => { const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
        const lines = [['Site', 'Date', 'Name', 'Shift', 'In', 'In note', 'Out', 'Out note'].map(q).join(',')].concat(rows.map((r) => [siteName(pid), r.date, r.name, r.shift ? r.shift.start_time + ' to ' + r.shift.end_time : 'No shift set',
          r.att ? londonTime(r.att.clocked_in) : 'No clock-in', r.judged ? r.judged.inNote || (r.judged.inState === 'ontime' ? 'on time' : '') : '', r.att ? (r.att.clocked_out ? londonTime(r.att.clocked_out) : r.att.no_clock_out ? 'No clock-out' : 'Still in') : '', r.judged ? r.judged.outNote : ''].map(q).join(',')));
        const a = h('a', { href: URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv' })), download: 'shift-report-' + rg.from + '-to-' + rg.to + '.csv' }); document.body.appendChild(a); a.click(); a.remove(); };
      page('form', h('div', { class: 'card form' }, backBtn('Back to people', () => viewClock(null, pid, from)), h('h1', {}, 'Shift report'), h('p', { class: 'muted' }, siteName(pid) + ' · UK times'),
        h('div', { class: 'btnrow' }, h('button', { class: 'btn small ghost', type: 'button', id: 'rep-prev', onclick: () => go({ from: SH.addDays(rg.from, -7), to: SH.addDays(rg.to, -7) }) }, '← Previous week'),
          h('button', { class: 'btn small ghost', type: 'button', id: 'rep-this', onclick: () => go(SH.weekOf(today)) }, 'This week'),
          h('button', { class: 'btn small ghost', type: 'button', id: 'rep-next', onclick: () => go({ from: SH.addDays(rg.from, 7), to: SH.addDays(rg.to, 7) }) }, 'Next week →')),
        h('label', { for: 'rep-from' }, 'From'), fromIn, h('label', { for: 'rep-to' }, 'To'), toIn, h('label', { for: 'rep-who' }, 'Person'), whoSel,
        h('p', { class: 'small muted', id: 'rep-key' }, h('span', { class: 't-late' }, 'Red'), ' = clocked in late, or left before the end of the shift. ', h('span', { class: 't-early' }, 'Green'), ' = clocked in ' + SH.EARLY_MINUTES + ' or more minutes early. Anything else is shown plain.'),
        rows.length ? h('p', { class: 'small', id: 'rep-sum' }, late + (late === 1 ? ' late start' : ' late starts') + ', ' + early + (early === 1 ? ' early start' : ' early starts') + '.') : null,
        rows.length ? h('div', { class: 'tablewrap' }, h('table', { class: 'shiftrep', id: 'shift-table' }, h('thead', {}, h('tr', {}, ...['Day', 'Person', 'Shift', 'In', 'Out'].map((x) => h('th', {}, x)))), h('tbody', {}, ...trs)))
          : h('p', { class: 'muted' }, 'Nothing to show for these dates. Set up shifts with the Shifts button, and the report fills in as people clock in.'),
        rows.length ? h('button', { class: 'btn ghost', type: 'button', id: 'rep-csv', onclick: csv }, 'Download as a spreadsheet (CSV)') : null));
    }

    // ---------- Staff Clock In / Out: the QR code, who is on site now, and the attendance record ----------
    const clockUrl = (token) => location.origin + '/clock/' + token;
    const londonTime = (iso) => iso ? new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }).format(new Date(iso)) : '';
    const londonDay = (iso) => new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London' }).format(new Date(iso));
    const hoursText = (a, b) => { const m = Math.max(0, Math.round((new Date(b) - new Date(a)) / 60000)); return Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0') + ' min'; };
    function clockCards(pid) {
      const wrap = h('div', { id: 'clock-cards' });
      (async () => {
        const [tk, rows] = await Promise.all([
          sb.from('properties').select('clock_token').eq('id', pid).single(),
          sb.from('staff_attendance').select('id,member_name,clocked_in,clocked_out,no_clock_out,closed_by').eq('property_id', pid).order('clocked_in', { ascending: false }).limit(400)]);
        const token = tk && tk.data && tk.data.clock_token, att = (rows && rows.data) || [], box = h('div', {});
        const again = (n) => viewClock(n, pid);
        const qrCard = h('div', { class: 'card', id: 'clock-qr' }, h('h2', {}, 'QR code for ' + siteName(pid)),
          token ? [h('p', { class: 'muted' }, 'Print this and put it up where your team can scan it. It is different for every site. Staff scan it with their phone, tap their name and clock in or out. No app or login is needed.'),
            h('div', { class: 'qrbox' }, window.TCQr.svg(clockUrl(token), { label: 'QR code for clocking in and out at ' + siteName(pid) })),
            h('p', { class: 'small muted breakall', id: 'clock-link' }, clockUrl(token)),
            h('div', { class: 'btnrow' }, h('button', { class: 'btn', type: 'button', id: 'clock-poster', onclick: () => viewPoster(pid, token) }, 'Print the poster'),
              h('button', { class: 'btn ghost', type: 'button', id: 'clock-copy', onclick: async (e) => { try { await navigator.clipboard.writeText(clockUrl(token)); e.target.textContent = 'Copied'; } catch (x) { e.target.textContent = 'Press and hold the link to copy it'; } } }, 'Copy the link'),
              rights.can_manage ? h('button', { class: 'btn ghost', type: 'button', id: 'clock-regen', onclick: () => {
                box.replaceChildren(h('div', { class: 'msg err', role: 'alert', id: 'regen-ask' }, h('p', {}, 'Replace this QR code? The printed one will stop working straight away and you will need to print and put up the new one.'),
                  h('div', { class: 'btnrow' }, h('button', { class: 'btn small', type: 'button', id: 'regen-yes', onclick: (e) => ctx.busy(e.target, async () => {
                    const r = await sb.rpc('regen_clock_token', { p_property: pid });
                    if (r.error) return ctx.message(box, 'err', 'Sorry, that did not work. You may need to sign in with your 2FA code first.');
                    again('New QR code made. The old one no longer works, so please print the new poster.');
                  }) }, 'Yes, replace it'), h('button', { class: 'btn small ghost', type: 'button', onclick: () => box.replaceChildren() }, 'Cancel'))));
              } }, 'Replace the QR code') : null), box] : h('p', { class: 'muted' }, 'The QR code could not be loaded. Please refresh the page.'));
        const open = att.filter((x) => !x.clocked_out && !x.no_clock_out);
        const nowCard = h('div', { class: 'card', id: 'clock-now' }, h('h2', {}, 'On site now (' + open.length + ')'),
          open.length ? open.map((x) => h('div', { class: 'econ', 'data-onsite': x.id }, h('span', {}, h('strong', {}, x.member_name), h('span', { class: 'muted small' }, ' · in since ' + londonTime(x.clocked_in) + ', ' + londonDay(x.clocked_in))),
            rights.can_edit ? h('button', { class: 'btn small ghost', type: 'button', 'data-clockout': x.id, onclick: async () => { const u = await sb.from('staff_attendance').update({ clocked_out: new Date().toISOString() }).eq('id', x.id); again(u.error ? 'Sorry, that did not work.' : 'Clocked out.'); } }, 'Clock out') : null))
            : h('p', { class: 'muted' }, 'Nobody is clocked in right now.'));
        const byDay = []; att.forEach((x) => { const d = londonDay(x.clocked_in); let g = byDay.find((y) => y.d === d); if (!g) byDay.push(g = { d, rows: [] }); g.rows.push(x); });
        const csv = () => { const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; const day = (i) => i ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date(i)) : '';
          const lines = [['Site', 'Name', 'Date', 'In', 'Out', 'Hours', 'Note'].map(q).join(',')].concat(att.slice().reverse().map((x) => [siteName(pid), x.member_name, day(x.clocked_in), londonTime(x.clocked_in), londonTime(x.clocked_out), x.clocked_out ? hoursText(x.clocked_in, x.clocked_out) : '', x.no_clock_out ? 'No clock-out recorded' : (!x.clocked_out ? 'Still in' : (x.closed_by === 'manager' ? 'Clocked out by manager' : ''))].map(q).join(',')));
          const a = h('a', { href: URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv' })), download: 'attendance-' + siteName(pid).replace(/[^\w]+/g, '-').toLowerCase() + '.csv' }); document.body.append(a); a.click(); a.remove(); };
        const recCard = h('div', { class: 'card', id: 'clock-record' }, h('div', { class: 'titlerow' }, h('h2', {}, 'Attendance record'), att.length ? h('button', { class: 'btn small ghost', type: 'button', id: 'clock-csv', onclick: csv }, 'Download (spreadsheet)') : null),
          att.length ? byDay.map((g) => h('div', { class: 'daygroup' }, h('h3', {}, g.d), g.rows.map((x) => h('div', { class: 'econ', 'data-att': x.id }, h('span', {}, h('strong', {}, x.member_name)),
            h('span', { class: 'muted small' }, x.no_clock_out ? 'In ' + londonTime(x.clocked_in) + ' · no clock-out recorded' : x.clocked_out ? londonTime(x.clocked_in) + ' to ' + londonTime(x.clocked_out) + ' · ' + hoursText(x.clocked_in, x.clocked_out) + (x.closed_by === 'manager' ? ' (clocked out by a manager)' : '') : 'In ' + londonTime(x.clocked_in) + ' · still in')))))
            : h('p', { class: 'muted' }, 'No one has clocked in yet. The record of every clock in and out will appear here.'));
        wrap.replaceChildren(qrCard, nowCard, recCard);
      })();
      return wrap;
    }
    function viewPoster(pid, token) {
      page('form', h('div', { class: 'card form' }, backBtn('Back', () => viewClock(null, pid)),
        h('div', { class: 'poster', id: 'poster' }, h('div', { class: 'p-brand' }, 'Tremcore'), h('h1', {}, 'Clock in / out'), h('h2', {}, siteName(pid)),
          h('div', { class: 'qrbox big' }, window.TCQr.svg(clockUrl(token), { label: 'QR code for clocking in and out' })),
          h('ol', { class: 'p-steps' }, h('li', {}, 'Scan the QR code with your phone camera.'), h('li', {}, 'Tap your name.'), h('li', {}, 'Tap Clock in when you arrive, and Clock out when you leave.')),
          h('p', { class: 'p-small' }, 'Please clock out every time you leave the site.')),
        h('div', { class: 'btnrow noprint' }, h('button', { class: 'btn', type: 'button', id: 'poster-print', onclick: () => window.print() }, 'Print'))));
    }

    // ---------- Settings ----------
    function viewSettings(note, part) {
      tab = 'settings';
      const box = h('div', {});
      const F = window.TCFormat;
      const bphone = F.tidyBox(h('input', { id: 'b-phone', type: 'tel', maxlength: '40', value: (company && company.contact_phone) || '', placeholder: '01634 123456' }), 'phone');
      const baddr = F.tidyBox(h('input', { id: 'b-address', maxlength: '300', value: (company && company.address) || '' }));
      const bpc = F.tidyBox(h('input', { id: 'b-postcode', maxlength: '12', value: (company && company.postcode) || '', placeholder: 'ME3 8FX' }), 'postcode');
      const bsave = h('button', { class: 'btn small', id: 'b-save', type: 'button', onclick: (ev) => ctx.busy(ev.target, async () => {
        const ph = F.phone(bphone.value), pc = F.postcode(bpc.value);
        if (!ph.ok) return ctx.message(box, 'err', F.PHONE_HELP);
        if (!pc.ok) return ctx.message(box, 'err', F.POSTCODE_HELP);
        const r = await sb.rpc('update_business', { p_phone: ph.value, p_address: F.cap(baddr.value.trim()), p_postcode: pc.value });
        if (r.error) return ctx.message(box, 'err', 'Sorry, that did not save. Please try again.');
        await reload(); viewSettings('Business information saved.', 'biz');
      }) }, 'Save');
      const biz = h('div', { class: 'card' }, h('h2', {}, 'Business Information'),
        h('div', { class: 'kv' }, h('span', {}, 'Business'), h('span', {}, (company && company.name) || '')),
        isHead ? [h('label', { for: 'b-phone' }, 'Phone'), bphone, h('label', { for: 'b-address' }, 'Address'), baddr, h('label', { for: 'b-postcode' }, 'Postcode'), bpc, bsave]
          : [h('div', { class: 'kv' }, h('span', {}, 'Phone'), h('span', {}, (company && company.contact_phone) || '–')), h('div', { class: 'kv' }, h('span', {}, 'Address'), h('span', {}, [company && company.address, company && company.postcode].filter(Boolean).join(', ') || '–'))]);
      const siteRow = (p) => {
        const n = F.tidyBox(h('input', { 'data-site-name': p.id, maxlength: '120', value: p.name, 'aria-label': 'Site name' }));
        const a = F.tidyBox(h('input', { 'data-site-addr': p.id, maxlength: '300', value: p.address || '', placeholder: 'Address', 'aria-label': 'Site address' }));
        const z = F.tidyBox(h('input', { 'data-site-pc': p.id, maxlength: '12', value: p.postcode || '', placeholder: 'Postcode', 'aria-label': 'Site postcode' }), 'postcode');
        return h('div', { class: 'siteedit' }, isHead ? [n, a, z, h('button', { class: 'btn small ghost', type: 'button', 'data-save-site': p.id, onclick: (ev) => ctx.busy(ev.target, async () => {
          const pc = F.postcode(z.value); if (!pc.ok) return ctx.message(box, 'err', F.POSTCODE_HELP);
          const r = await sb.rpc('update_site', { p_id: p.id, p_name: F.cap(n.value.trim()), p_address: F.cap(a.value.trim()), p_postcode: pc.value });
          if (r.error) return ctx.message(box, 'err', 'Sorry, that did not save. Please check the name and try again.');
          await reload(); viewSettings('Site saved.', 'premises');
        }) }, 'Save')] : [h('strong', {}, p.name), h('span', { class: 'muted small' }, [p.address, p.postcode].filter(Boolean).join(', '))]);
      };
      const premises = h('div', { class: 'card' }, h('h2', {}, 'Manage Premises'), ...props.map(siteRow),
        h('p', { class: 'muted small' }, 'To add another site, ', h('a', { href: 'mailto:info@tremcore.co.uk?subject=Add%20a%20site' }, 'email Tremcore'), '. Each site is £7.99 + VAT per month.'));
      const lvl = (company && company.level) || (ctx.req && ctx.req.level) || 1;
      const n = props.length, yearly = company && company.billing_interval === 'annual';
      const owned = extras.filter((e) => e.owned).map((e) => e.name);
      // Each add-on the business has, with what it costs; the ones it does not have can be added from here.
      const addonsOwned = extras.filter((e) => e.owned), addonsNot = extras.filter((e) => !e.owned && EXTRA_DEFAULT.some((x) => x.code === e.code));
      const perMonth = (e) => e.price_pence * (e.charged_per === 'site' ? Math.max(n, 1) : 1);
      const perYear = (e) => yearlyPence(e) * (e.charged_per === 'site' ? Math.max(n, 1) : 1);
      const isYr = (e) => e.billing_interval === 'year';
      const costOf = (e) => (e.charged_per === 'site' ? Math.max(n, 1) + (n === 1 ? ' site \u00d7 ' : ' sites \u00d7 ') + money(isYr(e) ? yearlyPence(e) : e.price_pence) + ' = ' : '') + (isYr(e) ? money(perYear(e)) + ' + VAT per year (paid upfront)' : money(perMonth(e)) + ' + VAT per month');
      const addonRows = addonsOwned.length ? [
        ...addonsOwned.map((e) => h('div', { class: 'kv', 'data-addon': e.code }, h('span', {}, e.name), h('span', {}, costOf(e)))),
        h('div', { class: 'kv', id: 'addons-total' }, h('span', {}, 'Add-ons total'), h('span', {}, [addonsOwned.some((e) => !isYr(e)) ? money(addonsOwned.filter((e) => !isYr(e)).reduce((a, e) => a + perMonth(e), 0)) + ' + VAT per month' : null, addonsOwned.some(isYr) && addonsOwned.some((e) => !isYr(e)) ? ' and ' : null, addonsOwned.some(isYr) ? money(addonsOwned.filter(isYr).reduce((a, e) => a + perYear(e), 0)) + ' + VAT per year' : null].filter(Boolean).join('')))
      ] : [h('div', { class: 'kv' }, h('span', {}, 'Add-ons'), h('span', {}, 'None'))];
      const addLinks = lvl === 1 && isHead ? addonsNot.map((e) => h('button', { class: 'linkbtn', type: 'button', 'data-add-addon': e.code, onclick: () => viewExtra(e.code) }, 'Add ' + e.name + ' (' + money(e.price_pence) + (e.charged_per === 'site' ? ' per site' : '') + ' + VAT per month)')) : [];
      const plan = h('div', { class: 'card' }, h('h2', {}, 'Subscription Details'),
        h('div', { class: 'kv' }, h('span', {}, 'Plan'), h('span', {}, lvl === 1 ? 'Self-Managed' : lvl === 2 ? 'Managed Compliance' : 'Property & Compliance Managed')),
        h('div', { class: 'kv' }, h('span', {}, 'Sites'), h('span', {}, String(n))),
        lvl === 1 ? h('div', { class: 'kv' }, h('span', {}, 'Price'), h('span', {}, yearly ? money(15290 + 8150 * Math.max(n - 1, 0)) + ' + VAT per year' : money(1499 + 799 * Math.max(n - 1, 0)) + ' + VAT per month')) : null,
        // The introductory offer, while it lasts: the first site is cheaper until the end date, then the normal price carries on by itself.
        lvl === 1 && !yearly && company && company.offer_ends_at && new Date(company.offer_ends_at) > new Date()
          ? h('div', { class: 'kv', id: 'offer-line' }, h('span', {}, 'Introductory offer'), h('span', {}, 'First site ' + money(799) + ' + VAT per month until ' + fmtDate(company.offer_ends_at.slice(0, 10)) + ', then ' + money(1499) + ' + VAT per month')) : null,
        ...addonRows,
        h('div', { class: 'kv' }, h('span', {}, 'Status'), h('span', {}, company && company.subscription ? String(company.subscription).replace(/^./, (x) => x.toUpperCase()) : '–')),
        ...addLinks);
      const repeating = tasks.filter((t) => t.status === 'pending' && t.repeat_months).length;
      const custom = h('div', { class: 'card' }, h('h2', {}, 'Customised Tasks'),
        h('p', { class: 'muted' }, 'Your own repeating tasks. You are using ' + repeating + ' of 10.'),
        h('button', { class: 'btn small ghost', id: 'open-tasks', type: 'button', onclick: () => go('tasks') }, 'Open My Tasks'));
      // Help & Support: a searchable list of short answers, then a way to tell Tremcore if still stuck (opens an email to Tremcore).
      const help = (() => {
        const list = h('div', { id: 'faqwrap', class: 'faqwrap' }), box = h('div', {});
        const search = h('input', { id: 'hq', type: 'search', placeholder: 'Search help, e.g. photo, poster, score', autocomplete: 'off', 'aria-label': 'Search help' });
        const draw = () => {
          const q = search.value.trim().toLowerCase(); list.replaceChildren();
          const groups = [...new Set(FAQ.map((f) => f.g))]; let n = 0;
          groups.forEach((g) => {
            const fs = FAQ.filter((f) => f.g === g && (!q || (f.q + ' ' + f.a).toLowerCase().includes(q))); if (!fs.length) return; n += fs.length;
            list.appendChild(h('h3', { class: 'faqh' }, g));
            list.appendChild(h('div', { class: 'faq' }, ...fs.map((f) => h('details', q ? { open: 'open' } : {}, h('summary', {}, h('span', {}, f.q)), h('p', {}, f.a)))));
          });
          if (!n) list.appendChild(h('p', { class: 'muted', id: 'faq-none' }, 'No answers match “' + search.value.trim() + '”. Try another word or report the issue below.'));
        };
        search.addEventListener('input', draw); draw();
        const topic = h('select', { id: 'ri-t' }, ...ISSUE_TOPICS.map((t) => h('option', {}, t)));
        const desc = h('textarea', { id: 'ri-d', rows: '4', placeholder: 'What were you trying to do, and what happened?' });
        const nm = h('input', { id: 'ri-n', autocomplete: 'name', placeholder: 'Your name' }), ct = h('input', { id: 'ri-c', autocomplete: 'email', placeholder: 'Best phone number or email' });
        const form = h('div', { id: 'issue-form', class: 'issueform', hidden: 'hidden' }, h('h3', {}, 'Report an Issue'),
          h('label', { for: 'ri-t' }, 'What is it about?'), topic, h('label', { for: 'ri-d' }, 'Describe the problem'), desc, h('label', { for: 'ri-n' }, 'Your name'), nm, h('label', { for: 'ri-c' }, 'Best phone number or email'), ct,
          h('button', { class: 'btn', id: 'ri-send', type: 'button', onclick: () => {
            if (!desc.value.trim()) { desc.focus(); return ctx.message(box, 'err', 'Describe the problem to send the report.'); }
            if (!nm.value.trim()) { nm.focus(); return ctx.message(box, 'err', 'Add your name.'); }
            if (!ct.value.trim()) { ct.focus(); return ctx.message(box, 'err', 'Add a phone number or email so we can contact you.'); }
            const body = 'Topic: ' + topic.value + '\nBusiness: ' + ((company && company.name) || '') + '\nName: ' + nm.value.trim() + '\nContact: ' + ct.value.trim() + '\n\n' + desc.value.trim();
            location.href = 'mailto:info@tremcore.co.uk?subject=' + encodeURIComponent('Tremcore Passport issue: ' + topic.value) + '&body=' + encodeURIComponent(body);
            ctx.message(box, 'ok', 'Your email app should open with the report ready to send. Please press Send there. If nothing opens, email info@tremcore.co.uk.');
          } }, 'Send Report'), box);
        return h('div', { class: 'helppage' }, h('h2', {}, 'Help & Support'),
          h('label', { class: 'faqsearch', for: 'hq' }, search), list,
          h('div', { class: 'card still', id: 'still-stuck' }, h('h3', {}, 'Still stuck?'), h('p', { class: 'muted' }, 'Tell us what is wrong and someone from the Tremcore team will contact you within 48 hours.'),
            h('button', { class: 'btn', id: 'report-issue', type: 'button', onclick: () => { form.hidden = false; desc.focus(); } }, 'Report an Issue'), form),
          h('p', { class: 'muted small' }, 'Or email us any time: ', h('a', { id: 'help-email', href: 'mailto:info@tremcore.co.uk?subject=Tremcore%20Passport%20help' }, 'info@tremcore.co.uk')));
      })();
      const reminders = h('div', { class: 'card' }, h('h2', {}, 'Reminder Emails'),
        h('p', { class: 'muted' }, rights.can_edit ? 'We email you before a check or task falls due, and again if it becomes overdue, so nothing slips past you.' : 'Tremcore manages your renewals and will be in touch before anything falls due.'),
        h('p', { class: 'muted small' }, 'Reminders go to the email address you sign in with.'));
      const acct = h('div', { class: 'card' }, h('h2', {}, 'My account'), ...(ctx.account || []));
      // Settings is a menu of rows (as in the prototype); each row opens its own page with a back arrow.
      const PARTS = [['biz', 'Business Information', biz, 'M3 11l9-8 9 8v10H3z M9 21v-6h6v6'], ['premises', 'Manage Premises', premises, 'M4 21V8l8-5 8 5v13 M9 21v-7h6v7'], ['plan', 'Subscription Details', plan, 'M6 3h12v18H6z M9 8h6 M9 12h6 M9 16h4'],
        ['reminders', 'Reminder Emails', reminders, 'M4 6h16v12H4z M4 7l8 6 8-6'], ['custom', 'Customised Tasks', custom, 'M5 4h14v16H5z M8 9h8 M8 13h8 M8 17h5'], ['help', 'Help & Support', help, 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.7 M12 17h.01'], ['acct', 'My account', acct, 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21c0-4 3.6-7 8-7s8 3 8 7']];
      if (part) {
        const cur = PARTS.find((x) => x[0] === part);
        if (cur) return shell('settings', h('div', { class: 'card settitle' }, backBtn('Back to settings', () => viewSettings()), h('h1', {}, cur[1]), ...heading(note), box), cur[2]);
      }
      const row = ([k, label, , d]) => h('button', { class: 'setrow', type: 'button', 'data-set': k, onclick: () => viewSettings(null, k) },
        svg('svg', { viewBox: '0 0 24 24', class: 'ico', 'aria-hidden': 'true', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, svg('path', { d })),
        h('span', { class: 'setlabel' }, label), h('span', { class: 'setchev', 'aria-hidden': 'true' }, '\u203A'));
      shell('settings', h('div', { class: 'card' }, h('h1', {}, 'Settings'), ...heading(note), box), h('div', { class: 'setmenu' }, ...PARTS.map(row),
          h('button', { class: 'setrow', type: 'button', id: 'set-logout', onclick: async () => { try { await sb.auth.signOut(); } finally { window.location.reload(); } } },
            svg('svg', { viewBox: '0 0 24 24', class: 'ico', 'aria-hidden': 'true', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, svg('path', { d: 'M9 4H5v16h4 M16 8l4 4-4 4 M20 12H9' })),
            h('span', { class: 'setlabel' }, 'Log Out'))),
        h('div', { class: 'setfoot' }, h('img', { src: '/img/logo-full.png', alt: 'Tremcore', width: 150 }), h('p', { class: 'muted small' }, 'The smarter way to stay compliant')));
    }

    // ---------- one check ----------
    async function viewItem(id, note, reading) {
      page('form', h('div', { class: 'card' }, h('p', { class: 'muted center' }, 'Loading…')));
      const r = await sb.from('compliance_status').select('*').eq('id', id).maybeSingle();
      const item = r.data;
      if (!item) { await reload(); return viewList('That check could not be found. It may have been removed.'); }
      const dr = await sb.from('documents').select('id,filename,storage_path,uploaded_at,size_bytes').eq('item_id', id).order('uploaded_at', { ascending: false });
      const docs = (dr && dr.data) || [];
      const msg = h('div', { id: 'item-msg' });
      if (note) message(msg, 'ok', note);

      let form;
      if (rights.can_edit) {
        const last = h('input', { id: 'f-last', type: 'date', value: item.last_done || '' });
        const freq = h('input', { id: 'f-freq', type: 'number', min: '1', max: '120', inputmode: 'numeric', value: item.frequency_months || '' });
        const due = h('input', { id: 'f-due', type: 'date', value: item.due_date || '' });
        const notes = h('textarea', { id: 'f-notes', maxlength: '2000', rows: '4' }, item.notes || '');
        const certNo = h('input', { id: 'f-cert', maxlength: '100', autocomplete: 'off', value: item.certificate_number || '' });
        const prov = h('input', { id: 'f-prov', maxlength: '160', autocomplete: 'off', value: item.provider || '' });
        // When the last date and the repeat period are both known, suggest the next due date. It can still be changed.
        const suggest = () => { const n = parseInt(freq.value, 10); const d = addMonths(last.value, n); if (d) due.value = d; };
        last.addEventListener('input', suggest); freq.addEventListener('input', suggest);
        // Details read from an uploaded certificate fill the boxes for the person to check. Nothing is saved until they press Save.
        let filled = false;
        if (reading && reading.found) {
          if (reading.issue_date) { last.value = reading.issue_date; filled = true; }
          if (reading.expiry_date) { due.value = reading.expiry_date; filled = true; }
          if (reading.certificate_number) { certNo.value = reading.certificate_number; filled = true; }
          if (reading.provider) { prov.value = reading.provider; filled = true; }
          [[last, reading.issue_date], [due, reading.expiry_date], [certNo, reading.certificate_number], [prov, reading.provider]].forEach(([el, v]) => { if (v) el.classList.add('autofilled'); });
        }
        const save = h('button', { class: 'btn', type: 'submit' }, filled ? 'Check and save' : 'Save');
        form = h('form', { novalidate: true, onsubmit: async (e) => {
          e.preventDefault();
          const f = freq.value.trim() === '' ? null : Number(freq.value);
          if (!validDate(last.value) || !validDate(due.value)) return message(msg, 'err', 'Please check the dates.');
          if (f !== null && (!Number.isInteger(f) || f < 1 || f > 120)) return message(msg, 'err', 'Repeat every: please enter a whole number of months between 1 and 120, or leave it empty.');
          await busy(save, async () => {
            const u = await sb.from('compliance_items').update({ last_done: last.value || null, frequency_months: f, due_date: due.value || null, notes: notes.value.trim(), certificate_number: certNo.value.trim() || null, provider: prov.value.trim() || null }).eq('id', id);
            if (u.error) return message(msg, 'err', 'Sorry, that could not be saved. You may not have permission to change this check.');
            await reload(); viewItem(id, 'Saved.');
          });
        } },
          h('label', { for: 'f-last' }, 'Last done'), last,
          h('label', { for: 'f-freq' }, 'Repeat every (months)'), freq,
          h('label', { for: 'f-due' }, 'Next due date'), due,
          h('label', { for: 'f-cert' }, 'Certificate or policy number'), certNo,
          h('label', { for: 'f-prov' }, 'Issued by (insurer or company)'), prov,
          h('p', { class: 'muted small' }, 'Leave the due date empty if you do not know it yet. It will show as "No date", never as in date.'),
          h('label', { for: 'f-notes' }, 'Notes'), notes, save);
      } else {
        form = h('div', {},
          h('div', { class: 'kv' }, h('span', {}, 'Last done'), h('span', {}, item.last_done ? fmtDate(item.last_done) : 'Not entered')),
          h('div', { class: 'kv' }, h('span', {}, 'Repeat every'), h('span', {}, item.frequency_months ? item.frequency_months + ' months' : 'Not set')),
          h('div', { class: 'kv' }, h('span', {}, 'Next due date'), h('span', {}, item.due_date ? fmtDate(item.due_date) : 'Not entered')),
          item.certificate_number ? h('div', { class: 'kv' }, h('span', {}, 'Certificate or policy number'), h('span', {}, item.certificate_number)) : null,
          item.provider ? h('div', { class: 'kv' }, h('span', {}, 'Issued by'), h('span', {}, item.provider)) : null,
          item.notes ? h('p', {}, item.notes) : h('p', { class: 'muted' }, 'No notes.'));
      }

      // Certificates and documents: private storage, opened through a short-lived link.
      const openDoc = async (d) => {
        const w = window.open('about:blank', '_blank');
        const s = await sb.storage.from('documents').createSignedUrl(d.storage_path, 120);
        if (s.error || !s.data) { if (w) w.close(); return message(msg, 'err', 'Sorry, that document could not be opened.'); }
        if (w) { w.opener = null; w.location.href = s.data.signedUrl; } else message(msg, 'err', 'Please allow pop-ups for this site, then try again.');
      };
      const delDoc = async (d) => {
        const x = await sb.storage.from('documents').remove([d.storage_path]);
        if (x.error) return message(msg, 'err', 'Sorry, that document could not be removed.');
        const y = await sb.from('documents').delete().eq('id', d.id);
        if (y.error) return message(msg, 'err', 'Sorry, that document could not be removed.');
        viewItem(id, 'Document removed.');
      };
      // Ask the server to read a stored document and suggest the dates and numbers. It only suggests; the person checks and saves.
      const READABLE = /\.(pdf|jpe?g|png)$/i;
      const readDoc = async (docId, intro) => {
        message(msg, 'ok', 'Reading your document…');
        let reply = null, status = 0;
        try {
          const tok = (await sb.auth.getSession()).data.session.access_token;
          const r = await fetch('/api/read-document', { method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify({ document_id: docId }) });
          status = r.status; reply = await r.json().catch(() => ({}));
        } catch (e) { reply = null; }
        const lead = intro ? intro + ' ' : '';
        if (reply && reply.reading && reply.reading.found) return viewItem(id, lead + 'We read your document and filled in the details below. Please check them, then press "Check and save".', reply.reading);
        if (reply && reply.reading) return viewItem(id, lead + 'We could not find dates or numbers in that document, so please type them in.');
        return viewItem(id, lead + ((reply && reply.error) || 'We could not read it just now, so please type the details in.'));
      };
      const fileIn = h('input', { id: 'file', type: 'file', accept: '.pdf,.jpg,.jpeg,.png,.doc,.docx' });
      const upBtn = h('button', { class: 'btn ghost', type: 'button', id: 'upload' }, 'Upload');
      upBtn.addEventListener('click', async () => {
        const f = fileIn.files && fileIn.files[0];
        if (!f) return message(msg, 'err', 'Choose a file first.');
        if (!FILE_OK.test(f.name)) return message(msg, 'err', 'Please use a PDF, a photo (JPG or PNG) or a Word document.');
        if (f.size > MAX_FILE) return message(msg, 'err', 'That file is too big. The limit is 10 MB.');
        await busy(upBtn, async () => {
          const safe = f.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80);
          const path = item.property_id + '/' + item.id + '/' + (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())) + '-' + safe;
          const up = await sb.storage.from('documents').upload(path, f, { contentType: f.type || undefined });
          if (up.error) return message(msg, 'err', 'Sorry, the upload did not work. Please try again.');
          let uid = null; try { uid = (await sb.auth.getSession()).data.session.user.id; } catch { uid = null; }
          const ins = await sb.from('documents').insert({ item_id: item.id, property_id: item.property_id, storage_path: path, filename: f.name, content_type: f.type || null, size_bytes: f.size, uploaded_by: uid }).select('id').maybeSingle();
          if (ins.error) { await sb.storage.from('documents').remove([path]); return message(msg, 'err', 'Sorry, the document could not be saved. Please try again.'); }
          if (READABLE.test(f.name) && ins.data && ins.data.id) return readDoc(ins.data.id, 'Document added.');
          viewItem(id, 'Document added.');
        });
      });
      const docsBox = h('div', { class: 'docs' }, h('h3', {}, 'Certificates and documents'),
        ...(docs.length ? docs.map((d) => h('div', { class: 'doc' }, h('span', { class: 'fname' }, d.filename),
          h('button', { class: 'linkbtn', type: 'button', onclick: () => openDoc(d) }, 'Open'),
          rights.can_edit && READABLE.test(d.filename || '') ? h('button', { class: 'linkbtn', type: 'button', 'data-read': d.id, onclick: () => readDoc(d.id) }, 'Read details') : null,
          rights.can_manage ? h('button', { class: 'linkbtn', type: 'button', onclick: () => delDoc(d) }, 'Delete') : null))
          : [h('p', { class: 'muted' }, 'No documents yet.')]),
        rights.can_edit ? h('div', {}, h('label', { for: 'file' }, 'Add a certificate or document'), fileIn, upBtn, h('p', { class: 'muted small' }, 'For a PDF or a photo, we read it and fill in the dates and number for you to check. Nothing is saved until you press Save.')) : null);

      // Removing a check also removes its documents from storage, so nothing is left behind.
      let remove = null;
      if (rights.can_manage) {
        const go = h('button', { class: 'btn ghost', type: 'button', id: 'remove-check' }, 'Remove this check');
        go.addEventListener('click', () => {
          const sure = h('button', { class: 'btn', type: 'button', id: 'remove-confirm' }, 'Yes, remove it and its documents');
          sure.addEventListener('click', async () => {
            await busy(sure, async () => {
              if (docs.length) { const x = await sb.storage.from('documents').remove(docs.map((d) => d.storage_path)); if (x.error) return message(msg, 'err', 'Sorry, the documents could not be removed, so the check was kept.'); }
              const y = await sb.from('compliance_items').delete().eq('id', id);
              if (y.error) return message(msg, 'err', 'Sorry, that check could not be removed.');
              await reload(); viewList('Check removed.');
            });
          });
          go.replaceWith(sure);
        });
        remove = go;
      }

      page('form', h('div', { class: 'detail' }, h('div', { class: 'card' }, goBack(),
        h('h1', {}, item.title),
        h('div', { class: 'statusline' }, h('span', { class: 'tag ' + item.status }, ST[item.status].label), h('span', { class: 'muted' }, dueText(item))),
        props.length > 1 ? h('p', { class: 'muted' }, siteName(item.property_id)) : null,
        h('div', { class: 'kv' }, h('span', {}, 'Basis'), h('span', {}, BASIS[item.basis] || 'Standard')),
        h('div', { class: 'kv grpline', id: 'core-line' }, h('span', {}, (isCore(item) ? 'Core' : 'Other') + ' Compliance'), h('span', { class: 'muted small' }, isCore(item) ? 'Counts towards the score' : 'Not counted in the score')),
        rights.can_edit ? h('button', { class: 'btn small ghost', id: 'move-group', type: 'button', onclick: (e) => busy(e.target, async () => {
          const u = await sb.from('compliance_items').update({ is_core: !isCore(item) }).eq('id', id);
          if (u.error) return message(msg, 'err', 'Sorry, that could not be changed. You may not have permission to change this check.');
          await reload(); viewItem(id, 'Moved to ' + (isCore(item) ? 'Other' : 'Core') + ' Compliance.');
        }) }, isCore(item) ? 'Move to Other' : 'Move to Core') : null,
        h('p', { class: 'muted small' }, 'The basis shown is a general guide only, not legal advice. What applies to your premises depends on the property, equipment and risk assessment, so please check with a competent professional.'),
        msg, form, remove), h('div', { class: 'card' }, docsBox)));
    }

    // ---------- which checks apply to which site ----------
    // Rows are check names (the standard ten plus anything the business added); columns are sites. Ticking adds the check to that site
    // with no date yet; unticking removes it (after a warning if it holds dates, notes or documents).
    async function viewSites(note) {
      page('form', h('div', { class: 'card' }, h('p', { class: 'muted center' }, 'Loading…')));
      await reload();
      const key = (t) => String(t || '').trim().toLowerCase();
      const rowsBy = new Map();
      core.forEach((c) => rowsBy.set(key(c.label), { k: key(c.label), title: c.label, grp: c.grp, basis: c.basis, frequency_months: c.frequency_months, order: c.sort }));
      items.forEach((i) => { if (!rowsBy.has(key(i.title))) rowsBy.set(key(i.title), { k: key(i.title), title: i.title, grp: i.grp || 'Other', basis: i.basis || 'standard', frequency_months: i.frequency_months || null, order: 1000 }); });
      const rowList = Array.from(rowsBy.values()).sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
      const at = (k, pid) => items.filter((i) => key(i.title) === k && i.property_id === pid);
      const initial = new Set(); rowList.forEach((r) => props.forEach((p) => { if (at(r.k, p.id).length) initial.add(r.k + '|' + p.id); }));
      const msg = h('div', { id: 'sites-msg' });
      if (note) message(msg, 'ok', note);
      const boxes = {};
      const sections = {};
      rowList.forEach((r) => { (sections[r.grp] = sections[r.grp] || []).push(r); });
      const setRow = (r, on) => props.forEach((p) => { boxes[r.k + '|' + p.id].checked = on; });
      const body = Object.keys(sections).map((g) => h('div', { class: 'group' }, h('h3', {}, g), ...sections[g].map((r) =>
        h('fieldset', { class: 'checkrow', 'data-check': r.k }, h('legend', {}, r.title),
          h('div', { class: 'sitechecks' }, ...props.map((p) => {
            const box = h('input', { type: 'checkbox', 'data-row': r.k, 'data-site': p.id, 'aria-label': r.title + ' at ' + p.name, checked: initial.has(r.k + '|' + p.id) });
            boxes[r.k + '|' + p.id] = box; return h('label', { class: 'check' }, box, ' ' + p.name);
          }), props.length > 1 ? h('span', { class: 'rowtools' }, h('button', { type: 'button', class: 'linkbtn', onclick: () => setRow(r, true) }, 'All'), h('button', { type: 'button', class: 'linkbtn', onclick: () => setRow(r, false) }, 'None')) : null)))));

      const save = h('button', { class: 'btn', type: 'button', id: 'sites-save' }, 'Save changes');
      async function apply(adds, removeIds, removeDocsOf) {
        if (adds.length) {
          let uid = null; try { uid = (await sb.auth.getSession()).data.session.user.id; } catch { uid = null; }
          const ins = await sb.from('compliance_items').insert(adds.map((a) => ({ property_id: a.pid, grp: a.r.grp, title: a.r.title, basis: a.r.basis, frequency_months: a.r.frequency_months || null, created_by: uid })));
          if (ins.error) return message(msg, 'err', 'Sorry, the new checks could not be added, so nothing was changed.');
        }
        if (removeIds.length) {
          if (removeDocsOf.length) { const x = await sb.storage.from('documents').remove(removeDocsOf); if (x.error) return message(msg, 'err', 'Sorry, some documents could not be removed. Please try again.'); }
          const del = await sb.from('compliance_items').delete().in('id', removeIds);
          if (del.error) return message(msg, 'err', 'Sorry, some checks could not be removed. Please try again.');
        }
        await reload(); viewList('Checks updated: ' + adds.length + ' added, ' + removeIds.length + ' removed.');
      }
      save.addEventListener('click', async () => {
        const adds = [], removeIds = [], removed = [];
        rowList.forEach((r) => props.forEach((p) => {
          const was = initial.has(r.k + '|' + p.id), now = boxes[r.k + '|' + p.id].checked;
          if (now && !was) adds.push({ r, pid: p.id });
          if (!now && was) at(r.k, p.id).forEach((i) => { removeIds.push(i.id); removed.push({ i, r, p }); });
        }));
        if (!adds.length && !removeIds.length) return message(msg, 'ok', 'No changes to save.');
        await busy(save, async () => {
          let docPaths = [], withDocs = new Set();
          if (removeIds.length) {
            const d = await sb.from('documents').select('item_id,storage_path').in('item_id', removeIds);
            ((d && d.data) || []).forEach((x) => { docPaths.push(x.storage_path); withDocs.add(x.item_id); });
          }
          const holds = removed.filter((x) => x.i.due_date || x.i.last_done || x.i.notes || withDocs.has(x.i.id));
          if (!holds.length) return apply(adds, removeIds, docPaths);
          // Something with real information in it would be lost: say so, and ask again.
          const sure = h('button', { class: 'btn', type: 'button', id: 'sites-confirm' }, 'Yes, save and delete them');
          sure.addEventListener('click', () => busy(sure, () => apply(adds, removeIds, docPaths)));
          msg.replaceChildren(h('div', { class: 'msg err', role: 'alert' }, h('strong', {}, 'These checks hold dates, notes or documents, which will be deleted: '),
            h('ul', {}, ...holds.map((x) => h('li', {}, x.r.title + (props.length > 1 ? ' at ' + x.p.name : ''))))), sure);
        });
      });
      page('form', h('div', { class: 'card' }, goBack(), h('h1', {}, props.length > 1 ? 'Checks by site' : 'Choose your checks'),
        h('p', { class: 'muted' }, props.length > 1 ? 'Different buildings need different checks. Tick the checks each site needs. A newly ticked check starts with no date, so it shows as "No date" until you enter one.' : 'Tick the checks your site needs. A newly ticked check starts with no date, so it shows as "No date" until you enter one.'),
        ...body, msg, save, h('p', { class: 'muted small' }, 'Need something that is not listed? Go back and use Add a check.')));
    }

    // ---------- add your own check ----------

    // ---------- bulk upload: drop in many certificates, check what we found, add them all ----------
    // Reading is done in this browser from the text inside a PDF, with plain rules (certread.js). Nothing is sent anywhere to be read.
    // It only suggests: every row is checked by the person, and anything uncertain is left blank.
    const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/';
    const loadScript = (src) => new Promise((ok, no) => { const el = document.createElement('script'); el.src = src; el.onload = ok; el.onerror = () => no(new Error('load')); document.head.appendChild(el); });
    let pdfReady = null;
    const ensurePdfJs = () => pdfReady || (pdfReady = (async () => {
      if (window.pdfjsLib) return true;
      await loadScript(PDFJS + 'pdf.worker.min.js');   // loaded first so the reader can run without a separate worker (the security rules only allow our own scripts and the pinned CDN)
      await loadScript(PDFJS + 'pdf.min.js');
      if (window.pdfjsLib && window.pdfjsLib.GlobalWorkerOptions) window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js';
      return !!window.pdfjsLib;
    })().catch(() => { pdfReady = null; return false; }));
    const withTimeout = (pr, ms) => Promise.race([pr, new Promise((ok) => setTimeout(() => ok(''), ms))]);
    async function pdfText(file) {
      if (!/\.pdf$/i.test(file.name) || !(await ensurePdfJs())) return '';
      try {
        const doc = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false }).promise;
        let out = '';
        for (let n = 1; n <= Math.min(doc.numPages, 6); n++) { const pg = await doc.getPage(n); const tc = await pg.getTextContent(); out += ' ' + tc.items.map((i) => i.str).join(' '); }
        return out;
      } catch (e) { return ''; }
    }
    const nameToTitle = (fn) => window.TCFormat.cap(String(fn).replace(/\.[A-Za-z0-9]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 120) || 'Certificate';

    function viewBulk(note) {
      const CR = window.TCCertRead;
      const msg = h('div', { id: 'bulk-msg' }), list = h('div', { id: 'bulk-rows' }), actions = h('div', { id: 'bulk-actions' });
      let rows = [];
      const fileIn = h('input', { id: 'bulk-files', type: 'file', multiple: true, accept: '.pdf,.jpg,.jpeg,.png,.doc,.docx' });
      const readBtn = h('button', { class: 'btn', type: 'button', id: 'bulk-read' }, 'Read these files');
      const itemsAt = (pid) => items.filter((i) => i.property_id === pid).sort((a, b) => String(a.title).localeCompare(String(b.title)));

      function drawRow(r) {
        const siteSel = props.length > 1 ? h('select', { class: 'b-site', 'aria-label': 'Site for ' + r.file.name }, ...props.map((p) => h('option', { value: p.id, selected: p.id === r.site }, p.name))) : null;
        const fileSel = h('select', { class: 'b-item', 'aria-label': 'Where to file ' + r.file.name });
        const titleIn = h('input', { class: 'b-title', maxlength: '120', value: r.title, 'aria-label': 'Name for the new check', placeholder: 'Name of the new check' });
        const last = h('input', { class: 'b-last', type: 'date', value: r.last || '', 'aria-label': 'Last done' }), due = h('input', { class: 'b-due', type: 'date', value: r.due || '', 'aria-label': 'Next due' });
        const fillItems = () => {
          const opts = [h('option', { value: '' }, 'Choose where to file it…')].concat(itemsAt(r.site).map((i) => h('option', { value: i.id }, i.title)));
          opts.push(h('option', { value: 'new' }, r.type ? 'New check: ' + r.type.label : 'New check (name it below)'), h('option', { value: 'skip' }, 'Do not add this file'));
          fileSel.replaceChildren(...opts); fileSel.value = r.target;
          titleIn.hidden = r.target !== 'new';
        };
        siteSel && siteSel.addEventListener('change', () => { r.site = siteSel.value; const m = r.type && itemsAt(r.site).find((i) => r.type.titleRe.test(i.title)); r.target = m ? m.id : r.type ? 'new' : ''; fillItems(); });
        fileSel.addEventListener('change', () => { r.target = fileSel.value; titleIn.hidden = r.target !== 'new'; });
        titleIn.addEventListener('input', () => { r.title = titleIn.value; });
        last.addEventListener('input', () => { r.last = last.value; });
        due.addEventListener('input', () => { r.due = due.value; });
        fillItems();
        r.els = { last, due };
        return h('div', { class: 'card bulkrow', 'data-file': r.file.name },
          h('div', { class: 'titlerow' }, h('strong', { class: 'fname' }, r.file.name),
            h('span', { class: 'pill ' + (r.sure ? 'green' : 'amber') }, r.sure ? 'Read' : 'Needs checking')),
          r.note ? h('p', { class: 'muted small' }, r.note) : null,
          siteSel ? h('label', {}, 'Site') : null, siteSel,
          h('label', {}, 'File it under'), fileSel, titleIn,
          h('div', { class: 'two' }, h('div', {}, h('label', {}, 'Last done'), last), h('div', {}, h('label', {}, 'Next due'), due)));
      }

      readBtn.addEventListener('click', async () => {
        const files = Array.from(fileIn.files || []);
        if (!files.length) return message(msg, 'err', 'Choose one or more files first.');
        if (files.length > 20) return message(msg, 'err', 'Please add up to 20 files at a time.');
        const bad = files.filter((f) => !FILE_OK.test(f.name) || f.size > MAX_FILE);
        if (bad.length) return message(msg, 'err', 'These cannot be used (PDF, JPG, PNG or Word only, up to 10 MB each): ' + bad.map((f) => f.name).join(', '));
        await busy(readBtn, async () => {
          message(msg, 'ok', 'Reading your files…'); rows = [];
          const defaultSite = site !== 'all' && props.some((p) => p.id === site) ? site : (props[0] || {}).id;
          for (const f of files) {
            const text = await withTimeout(pdfText(f), 20000);
            const got = CR.parse(text, f.name);
            const r = { file: f, site: defaultSite, type: got.type, last: got.issue || '', due: got.expiry || '', num: got.number || '', sure: got.sure, title: got.type ? got.type.label : nameToTitle(f.name), target: '' };
            const m = got.type && itemsAt(r.site).find((i) => got.type.titleRe.test(i.title));
            r.target = m ? m.id : got.type ? 'new' : '';
            r.note = !/\.pdf$/i.test(f.name) ? 'We cannot read photos or Word files yet, so please type the dates in.' : !text ? 'We could not read any text in this file (it may be a scan), so please type the dates in.' : !got.type ? 'We could not tell what this certificate is. Please choose where it belongs.' : got.expiryWorkedOut ? 'The next due date was worked out from the usual repeat period. Please check it.' : !got.sure ? 'We could not find dates. Please type them in.' : '';
            rows.push(r);
          }
          message(msg, 'ok', 'Please check each one below. Nothing is saved until you press "Add all".');
          list.replaceChildren(...rows.map(drawRow));
          actions.replaceChildren(h('button', { class: 'btn', type: 'button', id: 'bulk-add' }, 'Add all'), h('p', { class: 'muted small' }, 'Dates left empty will show as "No date", never as in date.'));
          actions.querySelector('#bulk-add').addEventListener('click', addAll);
        });
      });

      async function addAll(e) {
        const todo = rows.filter((r) => r.target !== 'skip');
        if (!todo.length) return message(msg, 'err', 'Nothing to add.');
        for (const r of todo) {
          if (!r.target) return message(msg, 'err', 'Please choose where to file "' + r.file.name + '", or choose "Do not add this file".');
          if (r.target === 'new' && !String(r.title).trim()) return message(msg, 'err', 'Please name the new check for "' + r.file.name + '".');
          if (!validDate(r.last || '') || !validDate(r.due || '')) return message(msg, 'err', 'Please check the dates for "' + r.file.name + '".');
        }
        await busy(e.currentTarget || e.target, async () => {
          let uid = null; try { uid = (await sb.auth.getSession()).data.session.user.id; } catch { uid = null; }
          const made = {}; let ok = 0; const failed = [];
          for (const r of todo) {
            try {
              let itemId = r.target;
              if (r.target === 'new') {
                const key = r.site + '|' + String(r.title).trim().toLowerCase();
                if (made[key]) itemId = made[key];
                else {
                  const ins = await sb.from('compliance_items').insert({ property_id: r.site, grp: r.type ? r.type.grp : 'Other', title: String(r.title).trim().replace(/\s+/g, ' '), basis: r.type ? r.type.basis : 'standard', frequency_months: r.type ? r.type.freq : null, last_done: r.last || null, due_date: r.due || null, certificate_number: r.num || null, created_by: uid }).select('id').maybeSingle();
                  if (ins.error || !ins.data) throw new Error('item');
                  itemId = made[key] = ins.data.id;
                }
              } else {
                const upd = {}; if (r.last) upd.last_done = r.last; if (r.due) upd.due_date = r.due; if (r.num) upd.certificate_number = r.num;
                if (Object.keys(upd).length) { const u = await sb.from('compliance_items').update(upd).eq('id', itemId); if (u.error) throw new Error('item'); }
              }
              const safe = r.file.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80);
              const path = r.site + '/' + itemId + '/' + (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())) + '-' + safe;
              const up = await sb.storage.from('documents').upload(path, r.file, { contentType: r.file.type || undefined });
              if (up.error) throw new Error('upload');
              const d = await sb.from('documents').insert({ item_id: itemId, property_id: r.site, storage_path: path, filename: r.file.name, content_type: r.file.type || null, size_bytes: r.file.size, uploaded_by: uid });
              if (d.error) { await sb.storage.from('documents').remove([path]); throw new Error('doc'); }
              ok++;
            } catch (x) { failed.push(r.file.name); }
          }
          await reload();
          if (failed.length) { rows = rows.filter((r) => failed.includes(r.file.name)); list.replaceChildren(...rows.map(drawRow)); message(msg, 'err', ok + ' added. These could not be added, so they are still listed: ' + failed.join(', ') + '. Please press "Add all" to try them again.'); return; }
          viewList(ok + (ok === 1 ? ' certificate' : ' certificates') + ' added.');
        });
      }

      page('form', h('div', { class: 'card form' }, goBack(), h('h1', {}, 'Bulk upload certificates'),
        h('p', { class: 'muted' }, 'Choose several certificates at once. We read what each one is and its dates from the text in the PDF, and suggest where it belongs. You check everything before it is saved. Photos and scans cannot be read yet, so you type their dates in.'),
        h('label', { for: 'bulk-files' }, 'Choose your files (up to 20)'), fileIn, readBtn, msg), list, actions);
      if (note) message(msg, 'ok', note);
    }

    function viewAdd() {
      const msg = h('div', { id: 'add-msg' });
      const title = h('input', { id: 'a-title', maxlength: '120', required: true });
      const groups = Array.from(new Set(GROUPS.concat(items.map((i) => i.grp).filter(Boolean)))).sort();
      const grp = h('select', { id: 'a-grp' }, ...groups.map((g) => h('option', { value: g, selected: g === 'Other' }, g)));
      const basis = h('select', { id: 'a-basis' }, ...Object.entries(BASIS).map(([k, l]) => h('option', { value: k, selected: k === 'standard' }, l)));
      const coreBox = h('input', { type: 'checkbox', id: 'a-core', checked: 'checked' });
      const freq = h('input', { id: 'a-freq', type: 'number', min: '1', max: '120', inputmode: 'numeric' });
      const last = h('input', { id: 'a-last', type: 'date' });
      const due = h('input', { id: 'a-due', type: 'date' });
      const siteBoxes = props.length > 1 ? h('fieldset', { class: 'sitepick' }, h('legend', {}, 'Which sites need this check?'),
        ...props.map((p) => h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'a-site', value: p.id, checked: site === 'all' || site === p.id }), ' ' + p.name))) : null;
      const suggest = () => { const d = addMonths(last.value, parseInt(freq.value, 10)); if (d) due.value = d; };
      last.addEventListener('input', suggest); freq.addEventListener('input', suggest);
      const save = h('button', { class: 'btn', type: 'submit' }, 'Add this check');
      const form = h('form', { novalidate: true, onsubmit: async (e) => {
        e.preventDefault();
        const t = title.value.trim().replace(/\s+/g, ' ');
        if (!t) return message(msg, 'err', 'Please give the check a name, for example "Kitchen Extract Cleaning".');
        const f = freq.value.trim() === '' ? null : Number(freq.value);
        if (f !== null && (!Number.isInteger(f) || f < 1 || f > 120)) return message(msg, 'err', 'Repeat every: please enter a whole number of months between 1 and 120, or leave it empty.');
        if (!validDate(last.value) || !validDate(due.value)) return message(msg, 'err', 'Please check the dates.');
        const target = siteBoxes ? Array.from(siteBoxes.querySelectorAll('input:checked')).map((x) => x.value) : props.map((p) => p.id);
        if (!target.length) return message(msg, 'err', 'Please tick at least one site.');
        let uid = null; try { uid = (await sb.auth.getSession()).data.session.user.id; } catch { uid = null; }
        await busy(save, async () => {
          const rows = target.map((pid) => ({ property_id: pid, is_core: coreBox.checked, grp: grp.value, title: t, basis: basis.value, frequency_months: f, last_done: last.value || null, due_date: due.value || null, created_by: uid }));
          const r = await sb.from('compliance_items').insert(rows);
          if (r.error) return message(msg, 'err', 'Sorry, that could not be added. You may not have permission to add checks.');
          await reload(); viewList('Check added.');
        });
      } },
        siteBoxes,
        h('label', { for: 'a-title' }, 'Name of the check'), title,
        h('label', { for: 'a-grp' }, 'Group'), grp,
        h('label', { for: 'a-basis' }, 'Basis'), basis,
        h('label', { for: 'a-last' }, 'Last done (optional)'), last,
        h('label', { for: 'a-freq' }, 'Repeat every (months, optional)'), freq,
        h('label', { for: 'a-due' }, 'Next due date (optional)'), due,
        h('p', { class: 'muted small' }, 'If you do not know the due date yet, leave it empty. It will show as "No date" until you enter it.'),
        h('label', { class: 'checkline', for: 'a-core' }, coreBox, h('span', {}, 'Add to Core Compliance so it counts towards the score')),
        save, msg);
      page('form', h('div', { class: 'card form' }, goBack(), h('h1', {}, 'Add a check'), h('p', { class: 'muted' }, 'Add anything your premises need, such as an extra inspection or a piece of equipment.'), form));
    }

    page('dash', h('div', { class: 'card' }, h('p', { class: 'muted center' }, 'Loading your passport…')));
    await reload();
    if (ctx.returned && ctx.returned.extra) return afterExtraPayment(ctx.returned.extra, ctx.returned.paid);
    viewHome(ctx.note);
  }

  window.TCPassport = { mount, addMonths, tally };
})();
