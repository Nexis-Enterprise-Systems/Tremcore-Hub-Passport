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
    { code: 'toolbox_talks', name: 'Toolbox Talks', description: 'A library of 30 ready-made safety talks plus up to 10 of your own, with digital sign-off by your team and saved PDF records. Charged for each site.', price_pence: 399, charged_per: 'site', owned: false },
    { code: 'staff_signin', name: 'Staff Clock In / Out', description: 'Staff scan a QR code shown at your site to clock in and out, with attendance records you can view.', price_pence: 699, charged_per: 'site', owned: false }
  ];
  const ICON = {
    home: 'M3 11l9-8 9 8v10h-6v-6H9v6H3z', compliance: 'M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z M8.5 12l2.5 2.5L16 9.5',
    tasks: 'M5 4h14v16H5z M8 9h8 M8 13h8 M8 17h5', settings: 'M4 7h10 M18 7h2 M4 17h2 M10 17h10 M16 5v4 M8 15v4'
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
    let site = 'all', filter = 'all', tab = 'home', ctab = 'overview', ttab = 'pending';
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
          sb.from('compliance_status').select('id,property_id,grp,title,basis,frequency_months,last_done,due_date,notes,status,days_left').order('title'),
          sb.rpc('passport_rights'),
          sb.from('core_checks').select('code,label,grp,basis,frequency_months,sort').order('sort'),
          sb.from('tasks').select('id,property_id,title,notes,due_date,repeat_months,status,completed_at').order('due_date'),
          sb.rpc('my_extras'),
          sb.from('companies').select('id,name,contact_phone,address,postcode,level,billing_interval,subscription').limit(1)
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
    const shell = (cur, ...nodes) => page('dash', h('div', { class: 'appshell' },
      h('nav', { class: 'appnav', 'aria-label': 'Main menu' }, ...TABS.map(([k, l]) => h('button', { type: 'button', class: 'navbtn' + (cur === k ? ' on' : ''), 'data-nav': k, 'aria-current': cur === k ? 'page' : null, onclick: () => go(k) }, icon(k), h('span', {}, l)))),
      h('div', { class: 'appbody' }, ...nodes)));
    const backTo = (label) => backBtn(label, () => go(tab));

    // All sites, then each site underneath (up to 12 as cards; beyond that a plain drop-down).
    function sitePicker(refresh) {
      if (props.length < 2) return null;
      if (props.length <= 12) {
        const card = (id, name, cc) => h('button', { class: 'sitecard', type: 'button', 'data-site': id, 'aria-pressed': String(site === id), onclick: () => { site = id; refresh(); } },
          donut(cc, 'mini'), h('span', { class: 'sname' }, h('strong', {}, name), h('span', { class: 'muted small' },
            cc.total ? [cc.red + ' overdue', cc.amber + ' due soon', cc.missing + ' no date'].join(' · ') : 'No checks yet')));
        return h('div', { class: 'sitesgrid' }, card('all', 'All sites', tally(items)), ...props.map((p) => card(p.id, p.name, tally(items.filter((i) => i.property_id === p.id)))));
      }
      return h('div', {}, h('label', { for: 'site-pick' }, 'Site'), h('select', { id: 'site-pick', onchange: (e) => { site = e.target.value; refresh(); } },
        h('option', { value: 'all', selected: site === 'all' }, 'All sites'), ...props.map((p) => h('option', { value: p.id, selected: site === p.id }, p.name))));
    }
    const extraOf = (code) => extras.find((e) => e.code === code) || EXTRA_DEFAULT.find((e) => e.code === code);
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
      const c = tally(rows);
      const pend = tasks.filter((t) => t.status === 'pending' && (site === 'all' || t.property_id === site)).length;
      const q = (code, label, sub, onclick, locked) => h('button', { class: 'qtile' + (locked ? ' locked' : ''), type: 'button', 'data-q': code, onclick },
        h('strong', {}, label), h('span', { class: 'muted small' }, sub), locked ? h('span', { class: 'tag add' }, 'Add') : null);
      const tt = extraOf('toolbox_talks'), ss = extraOf('staff_signin');
      shell('home',
        h('div', { class: 'card overview' },
          h('div', { class: 'welcome' }, h('h1', {}, 'Welcome' + (ctx.req && ctx.req.full_name ? ', ' + ctx.req.full_name.split(' ')[0] : '')), h('p', { class: 'muted' }, 'The smarter way to stay compliant' + (site !== 'all' ? ' · ' + siteName(site) : ''))),
          ...heading(note),
          h('h2', {}, 'Overall Compliance'),
          h('div', { class: 'summary' }, donut(c), c.total ? legendLines(c) : h('div', { class: 'legend' }, h('strong', { class: 'big' }, 'No checks yet'), h('div', { class: 'muted' }, 'Add your checks in Compliance and enter the date each one is next due.'))),
          h('button', { class: 'btn', id: 'view-full', type: 'button', onclick: () => go('compliance') }, 'View Full Compliance')),
        sitePicker(viewHome),
        h('div', { class: 'card' }, h('h2', {}, 'Quick Access'),
          h('div', { class: 'qtiles' },
            q('toolbox_talks', 'Toolbox Talks', tt.owned ? '30+ available' : 'Add-on · ' + money(tt.price_pence) + '/month', () => viewExtra('toolbox_talks'), !tt.owned),
            q('staff_signin', 'Staff Clock In / Out', ss.owned ? 'QR code per site' : 'Add-on · ' + money(ss.price_pence) + '/site/month', () => viewExtra('staff_signin'), !ss.owned),
            q('tasks', 'My Tasks', pend + ' pending', () => go('tasks')),
            q('emergency', 'Emergency Information', 'Contacts and shut-offs', () => viewEmergency()))));
    }

    // ---------- Compliance: Overview / By Category / Due Soon ----------
    function itemRow(r, multi) {
      return h('button', { class: 'item' + (multi ? '' : ' nosite'), type: 'button', 'data-id': r.id, onclick: () => viewItem(r.id) },
        h('i', { class: 'dot ' + r.status }), h('span', { class: 'title' }, r.title),
        h('span', { class: 'meta muted' }, multi ? h('span', { class: 'site' }, siteName(r.property_id)) : null, h('span', { class: 'due' }, dueText(r, true))),
        h('span', { class: 'tag ' + r.status }, ST[r.status].label));
    }
    const byUrgency = (a, b) => ST[a.status].rank - ST[b.status].rank || String(a.due_date || '').localeCompare(String(b.due_date || '')) || String(a.title).localeCompare(b.title);

    function viewList(note) {
      tab = 'compliance';
      const rows = items.filter((r) => site === 'all' || r.property_id === site);
      const c = tally(rows);
      const shown = rows.filter((r) => filter === 'all' || r.status === filter);
      const level = ctx.req && ctx.req.level;
      const multi = props.length > 1;
      const tiles = [['all', 'All', rows.length], ['red', 'Overdue', c.red], ['amber', 'Due soon', c.amber], ['green', 'Complete', c.green], ['missing', 'No date', c.missing]]
        .map(([k, l, n]) => h('button', { class: 'stat ' + k, type: 'button', 'data-filter': k, 'aria-pressed': String(filter === k), onclick: () => { filter = k; viewList(); } },
          h('span', { class: 'num' }, String(n)), h('span', { class: 'lbl' }, l)));
      const subtabs = h('div', { class: 'subtabs', role: 'tablist' }, ...[['overview', 'Overview'], ['category', 'By Category'], ['due', 'Due Soon']].map(([k, l]) =>
        h('button', { type: 'button', class: 'subtab', role: 'tab', 'data-ctab': k, 'aria-selected': String(ctab === k), onclick: () => { ctab = k; viewList(); } }, l)));

      const summary = h('div', { class: 'card overview' },
        h('div', { class: 'welcome' }, h('h1', {}, 'Compliance'), h('p', { class: 'muted' }, 'Your compliance passport' + (site !== 'all' ? ' · ' + siteName(site) : ''))),
        ...heading(note), subtabs,
        !rights.can_edit ? h('p', { class: 'muted' }, level > 1 ? 'Tremcore manages your compliance records for you. If anything looks wrong, use the contact button at the top.' : 'You can view the passport but not change it. Ask your head-office user if something needs updating.') : null,
        ctab !== 'due' ? h('div', { class: 'summary' }, donut(c),
          h('div', { class: 'legend' }, h('strong', { class: 'big' }, c.pct == null ? 'No checks yet' : c.pct + '% in date'),
            h('div', { class: 'muted' }, c.total ? 'Checks with no date entered count against this figure, so a missing date is never shown as green.' : 'Add your checks below and enter the date each one is next due.'))) : null,
        ctab !== 'due' && rows.length ? h('div', { class: 'tiles5', role: 'group', 'aria-label': 'Show' }, ...tiles) : null);

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
      const empty = ctab === 'due' ? 'Nothing is due soon, overdue or missing a date. Well done.' : rows.length ? 'Nothing here.' : rights.can_manage ? 'You have no checks yet. Add your first one with the button above.' : 'There are no checks to show yet.';
      const checksCard = h('div', { class: 'card' },
        h('div', { class: 'titlerow' }, h('h2', {}, ctab === 'due' ? 'Due Soon' : ctab === 'category' ? 'By Category' : 'Core Compliance'),
          rights.can_manage && props.length ? h('div', { class: 'btnrow' }, h('button', { class: 'btn small ghost', id: 'manage-sites', type: 'button', onclick: () => viewSites() }, multi ? 'Checks by site' : 'Choose checks'), h('button', { class: 'btn small', id: 'add-check', type: 'button', onclick: () => viewAdd() }, 'Add a check')) : null),
        body.length && ctab !== 'category' ? h('div', { class: 'thead' + (multi ? '' : ' nosite'), 'aria-hidden': 'true' }, h('span', {}, ''), h('span', {}, 'Check'), multi ? h('span', {}, 'Site') : null, h('span', {}, 'Next due'), h('span', {}, 'Status')) : null,
        ...(body.length ? body : [h('p', { class: 'muted' }, empty)]));
      shell('compliance', summary, sitePicker(viewList), checksCard);
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
      shell('tasks', h('div', { class: 'card' },
        h('div', { class: 'titlerow' }, h('h1', {}, 'My Tasks'), rights.can_edit && props.length ? h('button', { class: 'btn small', id: 'add-task', type: 'button', onclick: () => viewTaskAdd() }, 'Add New Task +') : null),
        ...heading(note), tabs, box,
        !rights.can_edit ? h('p', { class: 'muted' }, 'You can see these tasks but not change them.') : null,
        ...(list.length ? list.map(row) : [h('p', { class: 'muted' }, ttab === 'pending' ? 'No pending tasks.' : 'No completed tasks yet.')])),
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
      const F = [['assembly_point', 'Assembly point', 'e-assembly'], ['gas_shutoff', 'Gas shut-off', 'e-gas'], ['water_shutoff', 'Water shut-off', 'e-water'], ['electric_shutoff', 'Electric shut-off', 'e-electric']];
      const inputs = {};
      F.forEach(([k, , id]) => { inputs[k] = h('input', { id, maxlength: '300', value: (e0 && e0[k]) || '', autocomplete: 'off' }); });
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
        h('h2', {}, 'Assembly point and shut-offs'),
        ...(can ? [...F.flatMap(([k, l, id]) => [h('label', { for: id }, l), inputs[k]]), h('label', { for: 'e-notes' }, 'Other notes (optional)'), notes, saveBtn]
          : [...F.map(([k, l]) => h('div', { class: 'kv' }, h('span', {}, l), h('span', {}, (e0 && e0[k]) || 'Not added yet'))), (e0 && e0.notes) ? h('p', {}, e0.notes) : null]),
        box));
    }

    // ---------- paid add-ons (Toolbox Talks, Staff Clock In / Out) ----------
    // The head-office user is sent to Stripe to pay; the add-on switches on when Stripe confirms (the database decides, not this screen).
    let onExtra = null, extraChecks = 0;
    async function startExtraPayment(code, btn, box) {
      await ctx.busy(btn, async () => {
        try {
          const { data: { session } } = await sb.auth.getSession();
          const r = await fetch('/api/checkout-extra', { method: 'POST', headers: { Authorization: 'Bearer ' + ((session && session.access_token) || ''), 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
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
    function viewExtra(code, state) {
      const e = extraOf(code);
      if (e.owned && state !== 'confirming' && code === 'toolbox_talks') {
        tab = 'home';
        return window.TCToolbox.open({ sb, h, ctx, page, backTo, props: () => props, site: () => site, rights: () => rights, isHead: () => isHead, shortDate, siteName,
          companyName: () => (company && company.name) || '', companyId: () => company && company.id, back: backBtn, openPeople: (pid) => viewClock(null, pid, 'toolbox') }, state === 'thanks' ? e.name + ' is now on your account. Pick a talk to get started.' : null);
      }
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
          : state === 'confirming' ? null : [h('p', { class: 'big' }, priceText(e)),
            e.charged_per === 'site' ? h('p', { class: 'muted' }, 'This is charged for each site. You have ' + sites + (sites === 1 ? ' site' : ' sites') + ': ' + sites + ' × ' + money(e.price_pence) + ' = ' + money(total) + ' + VAT per month. Add-ons are always charged monthly, with no yearly discount.') : null,
            isHead && ((company && company.level) || 1) === 1
              ? [h('button', { class: 'btn', id: 'extra-add', type: 'button', onclick: (ev) => startExtraPayment(code, ev.target, box) }, 'Add ' + e.name + ' · pay now'),
                h('p', { class: 'muted small' }, 'You will be taken to our secure payment page. The add-on starts as soon as your payment is confirmed and is added to your monthly subscription.')]
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
          h('button', { class: 'btn small ghost', type: 'button', 'data-rm-staff': m.id, onclick: async () => { const x = await sb.from('staff_members').delete().eq('id', m.id); if (x.error) return ctx.message(box, 'err', 'Sorry, that did not work.'); refresh('Person removed.'); } }, 'Remove')) : null);
      const sitePick = props.length > 1 ? [h('label', { for: 's-site' }, 'Site'), h('select', { id: 's-site', onchange: (ev) => viewClock(null, ev.target.value, from) }, ...props.map((p) => h('option', { value: p.id, selected: p.id === pid }, p.name)))] : null;
      const fromTalks = from === 'toolbox';
      page('form', h('div', { class: 'card form' }, fromTalks ? backBtn('Back to Toolbox Talks', () => viewExtra('toolbox_talks')) : backTo('Back to home'), h('h1', {}, fromTalks ? 'People at this site' : 'Staff Clock In / Out'),
        note ? h('div', { class: 'msg ok', role: 'status' }, note) : null, sitePick,
        h('h2', {}, (fromTalks ? 'People you can choose for talks at ' : 'People who use it at ') + siteName(pid)),
        ...(staff.length ? staff.map(row) : [h('p', { class: 'muted' }, fromTalks ? 'Nobody added yet. Add the people who will attend talks at this site.' : 'Nobody added yet. Add the people who need to clock in and out at this site.')]),
        can ? [h('label', { for: 's-name' }, 'Name'), name, h('label', { for: 's-title' }, 'Job title (optional)'), title, add] : h('p', { class: 'muted' }, 'You can see this list but not change it.'),
        box),
        fromTalks ? null : h('div', { class: 'card', id: 'clock-soon' }, h('h2', {}, 'Site QR code and attendance'), h('p', { class: 'muted' }, 'The QR code for each site, the clock-in page staff will use and the attendance record are being finished and will appear here in the next update. The people you add now will be ready for it.')));
    }

    // ---------- Settings ----------
    function viewSettings(note) {
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
        await reload(); viewSettings('Business information saved.');
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
          await reload(); viewSettings('Site saved.');
        }) }, 'Save')] : [h('strong', {}, p.name), h('span', { class: 'muted small' }, [p.address, p.postcode].filter(Boolean).join(', '))]);
      };
      const premises = h('div', { class: 'card' }, h('h2', {}, 'Manage Premises'), ...props.map(siteRow),
        h('p', { class: 'muted small' }, 'To add another site, ', h('a', { href: 'mailto:hello@tremcore.co.uk?subject=Add%20a%20site' }, 'email Tremcore'), '. Each site is £7.99 + VAT per month.'));
      const lvl = (company && company.level) || (ctx.req && ctx.req.level) || 1;
      const n = props.length, yearly = company && company.billing_interval === 'annual';
      const owned = extras.filter((e) => e.owned).map((e) => e.name);
      const plan = h('div', { class: 'card' }, h('h2', {}, 'Subscription Details'),
        h('div', { class: 'kv' }, h('span', {}, 'Plan'), h('span', {}, lvl === 1 ? 'Self-Managed' : lvl === 2 ? 'Managed Compliance' : 'Property & Compliance Managed')),
        h('div', { class: 'kv' }, h('span', {}, 'Sites'), h('span', {}, String(n))),
        lvl === 1 ? h('div', { class: 'kv' }, h('span', {}, 'Price'), h('span', {}, yearly ? money(15290 + 8150 * Math.max(n - 1, 0)) + ' + VAT per year' : money(1499 + 799 * Math.max(n - 1, 0)) + ' + VAT per month')) : null,
        h('div', { class: 'kv' }, h('span', {}, 'Add-ons'), h('span', {}, owned.length ? owned.join(', ') : 'None')),
        h('div', { class: 'kv' }, h('span', {}, 'Status'), h('span', {}, company && company.subscription ? String(company.subscription).replace(/^./, (x) => x.toUpperCase()) : '–')));
      const repeating = tasks.filter((t) => t.status === 'pending' && t.repeat_months).length;
      const custom = h('div', { class: 'card' }, h('h2', {}, 'Customised Tasks'),
        h('p', { class: 'muted' }, 'Your own repeating tasks. You are using ' + repeating + ' of 10.'),
        h('button', { class: 'btn small ghost', id: 'open-tasks', type: 'button', onclick: () => go('tasks') }, 'Open My Tasks'));
      const help = h('div', { class: 'card' }, h('h2', {}, 'Help & Support'),
        h('p', { class: 'muted' }, 'Questions about your passport? We are happy to help.'),
        h('a', { class: 'btn small', id: 'help-email', href: 'mailto:hello@tremcore.co.uk?subject=Tremcore%20Passport%20help' }, 'Email Tremcore'));
      const acct = h('div', { class: 'card' }, h('h2', {}, 'My account'), ...(ctx.account || []));
      shell('settings', h('div', { class: 'card' }, h('h1', {}, 'Settings'), ...heading(note), box), biz, premises, plan, custom, help, acct);
    }

    // ---------- one check ----------
    async function viewItem(id, note) {
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
        // When the last date and the repeat period are both known, suggest the next due date. It can still be changed.
        const suggest = () => { const n = parseInt(freq.value, 10); const d = addMonths(last.value, n); if (d) due.value = d; };
        last.addEventListener('input', suggest); freq.addEventListener('input', suggest);
        const save = h('button', { class: 'btn', type: 'submit' }, 'Save');
        form = h('form', { novalidate: true, onsubmit: async (e) => {
          e.preventDefault();
          const f = freq.value.trim() === '' ? null : Number(freq.value);
          if (!validDate(last.value) || !validDate(due.value)) return message(msg, 'err', 'Please check the dates.');
          if (f !== null && (!Number.isInteger(f) || f < 1 || f > 120)) return message(msg, 'err', 'Repeat every: please enter a whole number of months between 1 and 120, or leave it empty.');
          await busy(save, async () => {
            const u = await sb.from('compliance_items').update({ last_done: last.value || null, frequency_months: f, due_date: due.value || null, notes: notes.value.trim() }).eq('id', id);
            if (u.error) return message(msg, 'err', 'Sorry, that could not be saved. You may not have permission to change this check.');
            await reload(); viewItem(id, 'Saved.');
          });
        } },
          h('label', { for: 'f-last' }, 'Last done'), last,
          h('label', { for: 'f-freq' }, 'Repeat every (months)'), freq,
          h('label', { for: 'f-due' }, 'Next due date'), due,
          h('p', { class: 'muted small' }, 'Leave the due date empty if you do not know it yet. It will show as "No date", never as in date.'),
          h('label', { for: 'f-notes' }, 'Notes'), notes, save);
      } else {
        form = h('div', {},
          h('div', { class: 'kv' }, h('span', {}, 'Last done'), h('span', {}, item.last_done ? fmtDate(item.last_done) : 'Not entered')),
          h('div', { class: 'kv' }, h('span', {}, 'Repeat every'), h('span', {}, item.frequency_months ? item.frequency_months + ' months' : 'Not set')),
          h('div', { class: 'kv' }, h('span', {}, 'Next due date'), h('span', {}, item.due_date ? fmtDate(item.due_date) : 'Not entered')),
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
          const ins = await sb.from('documents').insert({ item_id: item.id, property_id: item.property_id, storage_path: path, filename: f.name, content_type: f.type || null, size_bytes: f.size, uploaded_by: uid });
          if (ins.error) { await sb.storage.from('documents').remove([path]); return message(msg, 'err', 'Sorry, the document could not be saved. Please try again.'); }
          viewItem(id, 'Document added.');
        });
      });
      const docsBox = h('div', { class: 'docs' }, h('h3', {}, 'Certificates and documents'),
        ...(docs.length ? docs.map((d) => h('div', { class: 'doc' }, h('span', { class: 'fname' }, d.filename),
          h('button', { class: 'linkbtn', type: 'button', onclick: () => openDoc(d) }, 'Open'),
          rights.can_manage ? h('button', { class: 'linkbtn', type: 'button', onclick: () => delDoc(d) }, 'Delete') : null))
          : [h('p', { class: 'muted' }, 'No documents yet.')]),
        rights.can_edit ? h('div', {}, h('label', { for: 'file' }, 'Add a certificate or document'), fileIn, upBtn) : null);

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
    function viewAdd() {
      const msg = h('div', { id: 'add-msg' });
      const title = h('input', { id: 'a-title', maxlength: '120', required: true });
      const groups = Array.from(new Set(GROUPS.concat(items.map((i) => i.grp).filter(Boolean)))).sort();
      const grp = h('select', { id: 'a-grp' }, ...groups.map((g) => h('option', { value: g, selected: g === 'Other' }, g)));
      const basis = h('select', { id: 'a-basis' }, ...Object.entries(BASIS).map(([k, l]) => h('option', { value: k, selected: k === 'standard' }, l)));
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
          const rows = target.map((pid) => ({ property_id: pid, grp: grp.value, title: t, basis: basis.value, frequency_months: f, last_done: last.value || null, due_date: due.value || null, created_by: uid }));
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
