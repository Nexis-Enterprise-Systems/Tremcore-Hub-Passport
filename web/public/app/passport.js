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

  function donut(c) {
    const R = 15.915; let off = 25;   // 100 units round the circle; 25 starts at the top
    const parts = c.total ? [['green', c.green], ['amber', c.amber], ['red', c.red], ['missing', c.missing]].filter((s) => s[1] > 0).map(([k, n]) => {
      const len = 100 * n / c.total;
      const el = svg('circle', { class: 'seg ' + k, cx: 21, cy: 21, r: R, fill: 'none', 'stroke-width': 6, 'stroke-dasharray': len + ' ' + (100 - len), 'stroke-dashoffset': off });
      off -= len; return el;
    }) : [];
    return svg('svg', { viewBox: '0 0 42 42', class: 'donut', role: 'img', 'aria-label': c.pct == null ? 'No checks yet' : c.pct + ' per cent of your checks are in date' },
      svg('circle', { class: 'seg track', cx: 21, cy: 21, r: R, fill: 'none', 'stroke-width': 6 }), ...parts,
      svg('text', { x: 21, y: 23.2, 'text-anchor': 'middle', class: 'pct' }, c.pct == null ? '–' : c.pct + '%'));
  }

  async function mount(ctx) {
    const { sb, h, message, busy, fmtDate } = ctx;
    let props = [], items = [], rights = { can_edit: false, can_manage: false }, loadError = false;
    let site = 'all', filter = 'all';
    const page = (...nodes) => { ctx.show(...nodes); document.body.classList.add('passport'); };
    const siteName = (id) => (props.find((p) => p.id === id) || {}).name || '';

    async function reload() {
      try {
        const [p, i, r] = await Promise.all([
          sb.from('properties').select('id,name').order('name'),
          sb.from('compliance_status').select('id,property_id,grp,title,basis,frequency_months,last_done,due_date,notes,status,days_left').order('title'),
          sb.rpc('passport_rights')
        ]);
        if (p.error || i.error) throw new Error('load');
        props = p.data || []; items = i.data || [];
        rights = (r && r.data && r.data[0]) || { can_edit: false, can_manage: false };
        loadError = false;
      } catch { loadError = true; }
    }
    const dueText = (r) => {
      if (r.status === 'missing') return 'No date entered';
      if (r.status === 'red') return 'Overdue since ' + fmtDate(r.due_date);
      const n = r.days_left;
      return 'Due ' + fmtDate(r.due_date) + (n === 0 ? ' (today)' : n === 1 ? ' (tomorrow)' : ' (in ' + n + ' days)');
    };
    const goBack = (label) => h('button', { class: 'btn ghost', type: 'button', onclick: () => viewList() }, label || 'Back to my passport');

    // ---------- the passport ----------
    function viewList(note) {
      const rows = items.filter((r) => site === 'all' || r.property_id === site);
      const c = tally(rows);
      const shown = rows.filter((r) => filter === 'all' || r.status === filter);
      const level = ctx.req && ctx.req.level;
      const chips = [['all', 'All', rows.length], ['red', 'Overdue', c.red], ['missing', 'No date', c.missing], ['amber', 'Due soon', c.amber], ['green', 'In date', c.green]];

      const siteSel = props.length > 1 && h('div', {}, h('label', { for: 'site-pick' }, 'Site'),
        h('select', { id: 'site-pick', onchange: (e) => { site = e.target.value; viewList(); } },
          h('option', { value: 'all', selected: site === 'all' }, 'All sites'), ...props.map((p) => h('option', { value: p.id, selected: site === p.id }, p.name))));

      const summary = h('div', { class: 'summary' }, donut(c),
        h('div', { class: 'legend' },
          h('div', {}, h('strong', {}, c.pct == null ? 'No checks yet' : c.pct + '% in date')),
          h('div', { class: 'muted' }, c.total ? 'Checks with no date entered count against this figure, so a missing date is never shown as green.' : 'Add your checks below and enter the date each one is next due.'),
          h('div', { class: 'counts' }, ...[['red', 'Overdue', c.red], ['amber', 'Due soon', c.amber], ['green', 'In date', c.green], ['missing', 'No date', c.missing]].map(([k, l, n]) =>
            h('span', { class: 'count ' + k }, h('i', { class: 'dot ' + k }), l + ': ' + n)))));

      const groups = {};
      shown.forEach((r) => { (groups[r.grp || 'Other'] = groups[r.grp || 'Other'] || []).push(r); });
      const list = Object.keys(groups).sort().map((g) => h('div', { class: 'group' }, h('h3', {}, g),
        ...groups[g].sort((a, b) => ST[a.status].rank - ST[b.status].rank || String(a.title).localeCompare(b.title)).map((r) =>
          h('button', { class: 'item', type: 'button', 'data-id': r.id, onclick: () => viewItem(r.id) },
            h('i', { class: 'dot ' + r.status }),
            h('span', { class: 'name' }, h('span', { class: 'title' }, r.title), h('span', { class: 'muted small' }, (props.length > 1 && !(site !== 'all') ? siteName(r.property_id) + ' · ' : '') + dueText(r))),
            h('span', { class: 'tag ' + r.status }, ST[r.status].label)))));

      const note2 = !rights.can_edit
        ? h('p', { class: 'muted' }, level > 1 ? 'Tremcore manages your compliance records for you. If anything looks wrong, use Call Tremcore at the top.' : 'You can view the passport but not change it. Ask your head-office user if something needs updating.')
        : null;

      page(
        h('div', { class: 'card wide' },
          h('h1', {}, 'Welcome' + (ctx.req && ctx.req.full_name ? ', ' + ctx.req.full_name.split(' ')[0] : '')),
          h('p', { class: 'muted' }, 'Your compliance passport'),
          ctx.banner, note ? h('div', { class: 'msg ok', role: 'status' }, note) : null, note2,
          loadError ? h('div', { class: 'msg err', role: 'alert' }, 'Sorry, we could not load your checks. Please refresh the page.') : null,
          siteSel, summary,
          rows.length ? h('div', { class: 'chips', role: 'group', 'aria-label': 'Show' }, ...chips.map(([k, l, n]) =>
            h('button', { class: 'chip', type: 'button', 'aria-pressed': String(filter === k), 'data-filter': k, onclick: () => { filter = k; viewList(); } }, l + ' (' + n + ')'))) : null,
          ...(list.length ? list : [rows.length ? h('p', { class: 'muted' }, 'Nothing here.') : h('p', { class: 'muted' }, rights.can_manage ? 'You have no checks yet. Add your first one below.' : 'There are no checks to show yet.')]),
          rights.can_manage && props.length ? h('button', { class: 'btn', id: 'add-check', type: 'button', onclick: () => viewAdd() }, 'Add a check') : null),
        h('div', { class: 'card wide' }, h('h2', {}, 'My account'), ...(ctx.account || [])));
    }

    // ---------- one check ----------
    async function viewItem(id, note) {
      page(h('div', { class: 'card wide' }, h('p', { class: 'muted center' }, 'Loading…')));
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

      page(h('div', { class: 'card wide' }, goBack(),
        h('h1', {}, item.title),
        h('div', { class: 'statusline' }, h('span', { class: 'tag ' + item.status }, ST[item.status].label), h('span', { class: 'muted' }, dueText(item))),
        props.length > 1 ? h('p', { class: 'muted' }, siteName(item.property_id)) : null,
        h('div', { class: 'kv' }, h('span', {}, 'Basis'), h('span', {}, BASIS[item.basis] || 'Standard')),
        h('p', { class: 'muted small' }, 'The basis shown is a general guide only, not legal advice. What applies to your premises depends on the property, equipment and risk assessment, so please check with a competent professional.'),
        msg, form, docsBox, remove));
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
      const siteSel = props.length > 1 ? h('select', { id: 'a-site' }, h('option', { value: 'all' }, 'All my sites'), ...props.map((p) => h('option', { value: p.id, selected: site === p.id }, p.name))) : null;
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
        const target = siteSel ? (siteSel.value === 'all' ? props.map((p) => p.id) : [siteSel.value]) : props.map((p) => p.id);
        if (!target.length) return message(msg, 'err', 'You have no site to add this to yet.');
        let uid = null; try { uid = (await sb.auth.getSession()).data.session.user.id; } catch { uid = null; }
        await busy(save, async () => {
          const rows = target.map((pid) => ({ property_id: pid, grp: grp.value, title: t, basis: basis.value, frequency_months: f, last_done: last.value || null, due_date: due.value || null, created_by: uid }));
          const r = await sb.from('compliance_items').insert(rows);
          if (r.error) return message(msg, 'err', 'Sorry, that could not be added. You may not have permission to add checks.');
          await reload(); viewList('Check added.');
        });
      } },
        siteSel ? h('label', { for: 'a-site' }, 'Site') : null, siteSel,
        h('label', { for: 'a-title' }, 'Name of the check'), title,
        h('label', { for: 'a-grp' }, 'Group'), grp,
        h('label', { for: 'a-basis' }, 'Basis'), basis,
        h('label', { for: 'a-last' }, 'Last done (optional)'), last,
        h('label', { for: 'a-freq' }, 'Repeat every (months, optional)'), freq,
        h('label', { for: 'a-due' }, 'Next due date (optional)'), due,
        h('p', { class: 'muted small' }, 'If you do not know the due date yet, leave it empty. It will show as "No date" until you enter it.'),
        save, msg);
      page(h('div', { class: 'card wide' }, goBack(), h('h1', {}, 'Add a check'), h('p', { class: 'muted' }, 'Add anything your premises need, such as an extra inspection or a piece of equipment.'), form));
    }

    page(h('div', { class: 'card wide' }, h('p', { class: 'muted center' }, 'Loading your passport…')));
    await reload();
    viewList();
  }

  window.TCPassport = { mount, addMonths, tally };
})();
