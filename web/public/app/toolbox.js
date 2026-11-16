// Toolbox Talks (a paid add-on): the library, running a talk with on-screen signatures, saved records with a PDF, and the company's own talks.
// This only decides what to SHOW. The database decides who may read or write, and records can never be changed or deleted by a client.
(function () {
  'use strict';
  const CATS = ['Health & Safety', 'Fire Safety', 'Wellbeing', 'Workplace Responsibilities', 'Industry Specific'];
  const NOTE = 'General guidance for team briefings. It does not replace your own risk assessments, procedures or professional advice, and it needs professional review before you rely on it.';
  const SIG_W = 1000, SIG_H = 400;   // signatures are stored as strokes on a 1000 x 400 grid
  const NS = 'http://www.w3.org/2000/svg';

  function open(api, note) {
    const { sb, h, ctx } = api;
    let talks = [], cat = 'all', loadError = false;
    const rights = () => api.rights();
    const lines = (t) => String(t || '').split('\n').map((x) => x.trim()).filter(Boolean);

    function sigSvg(strokes) {
      const s = document.createElementNS(NS, 'svg'); s.setAttribute('viewBox', '0 0 ' + SIG_W + ' ' + SIG_H); s.setAttribute('class', 'sigsvg'); s.setAttribute('role', 'img'); s.setAttribute('aria-label', 'Signature');
      for (const st of strokes || []) {
        if (!Array.isArray(st) || !st.length) continue;
        const p = document.createElementNS(NS, st.length === 1 ? 'circle' : 'polyline');
        if (st.length === 1) { p.setAttribute('cx', st[0][0]); p.setAttribute('cy', st[0][1]); p.setAttribute('r', 4); p.setAttribute('class', 'sigdot'); }
        else { p.setAttribute('points', st.map((q) => q[0] + ',' + q[1]).join(' ')); p.setAttribute('fill', 'none'); p.setAttribute('class', 'sigline'); }
        s.append(p);
      }
      return s;
    }

    async function load() {
      const r = await sb.from('toolbox_talks').select('id,company_id,code,category,title,summary,points,discuss,minutes,sort').order('sort');
      loadError = !!r.error; talks = (r.data || []).slice();
    }

    // ---------- library ----------
    async function viewLibrary(msg) {
      api.page('form', h('div', { class: 'card' }, h('p', { class: 'muted center' }, 'Loading…')));
      await load();
      const own = talks.filter((t) => t.company_id), core = talks.filter((t) => !t.company_id);
      const shown = (cat === 'all' ? talks : talks.filter((t) => t.category === cat)).slice().sort((a, b) => (b.company_id ? 1 : 0) - (a.company_id ? 1 : 0) || (a.sort - b.sort) || a.title.localeCompare(b.title));
      const chip = (k, l, n) => h('button', { class: 'chip', type: 'button', 'data-cat': k, 'aria-pressed': String(cat === k), onclick: () => { cat = k; viewLibrary(); } }, l + ' (' + n + ')');
      const row = (t) => h('button', { class: 'talkrow', type: 'button', 'data-talk': t.id, onclick: () => viewTalk(t) },
        h('span', { class: 'ttitle' }, t.title), h('span', { class: 'muted small' }, t.category + ' · ' + t.minutes + ' min'), t.company_id ? h('span', { class: 'tag green' }, 'Your own') : null);
      api.page('form', h('div', { class: 'card' }, api.backTo('Back to home'), h('div', { class: 'titlerow' }, h('h1', {}, 'Toolbox Talks'),
        h('div', { class: 'btnrow' }, h('button', { class: 'btn small ghost', id: 'tb-records', type: 'button', onclick: () => viewRecords() }, 'Records'), api.isHead() ? h('button', { class: 'btn small ghost', id: 'tb-own', type: 'button', onclick: () => viewOwn() }, 'My own talks') : null)),
        msg ? h('div', { class: 'msg ok', role: 'status' }, msg) : null, loadError ? h('div', { class: 'msg err', role: 'alert' }, 'Sorry, we could not load the talks. Please refresh the page.') : null,
        h('p', { class: 'muted' }, core.length + ' ready-made talks' + (own.length ? ' and ' + own.length + ' of your own' : '') + '. Pick one, run it with your team, and have everyone sign on screen. Each talk is saved as a record you can download as a PDF.'),
        h('div', { class: 'chips', role: 'group', 'aria-label': 'Categories' }, chip('all', 'All', talks.length), ...CATS.map((c) => chip(c, c, talks.filter((t) => t.category === c).length))),
        ...(shown.length ? shown.map(row) : [h('p', { class: 'muted' }, 'No talks in this category.')]),
        h('p', { class: 'muted small' }, NOTE)));
    }

    function viewTalk(t) {
      api.page('form', h('div', { class: 'card form', 'data-talk-page': t.id }, h('button', { class: 'btn ghost', type: 'button', onclick: () => viewLibrary() }, 'Back to all talks'),
        h('h1', {}, t.title), h('p', { class: 'muted' }, t.category + ' · about ' + t.minutes + ' minutes' + (t.company_id ? ' · your own talk' : '')),
        t.summary ? h('p', {}, t.summary) : null,
        h('h2', {}, 'Key points'), h('ul', { class: 'points' }, ...(t.points || []).map((p) => h('li', {}, p))),
        (t.discuss || []).length ? [h('h2', {}, 'Talk about it together'), h('ul', { class: 'points' }, ...t.discuss.map((p) => h('li', {}, p)))] : null,
        rights().can_edit ? h('button', { class: 'btn', id: 'tb-deliver', type: 'button', onclick: () => viewDeliver(t) }, 'Run this talk and collect signatures') : h('p', { class: 'muted' }, 'You can read the talk, but only users who can edit the passport can record one.'),
        h('p', { class: 'muted small' }, NOTE)));
    }

    // ---------- running a talk: attendees sign on screen ----------
    function viewDeliver(t) {
      const props = api.props();
      const st = { site: api.site() !== 'all' ? api.site() : (props[0] || {}).id, date: new Date().toISOString().slice(0, 10), presenter: (ctx.req && ctx.req.full_name) || '', notes: '', people: [], signing: null };
      const box = h('div', {});
      function render() {
        box.replaceChildren();
        const sel = props.length > 1 ? [h('label', { for: 'd-site' }, 'Site'), h('select', { id: 'd-site', onchange: (e) => { st.site = e.target.value; } }, ...props.map((p) => h('option', { value: p.id, selected: p.id === st.site }, p.name)))] : null;
        const date = h('input', { id: 'd-date', type: 'date', value: st.date, oninput: (e) => { st.date = e.target.value; } });
        const pres = h('input', { id: 'd-presenter', maxlength: '120', value: st.presenter, autocomplete: 'off', oninput: (e) => { st.presenter = e.target.value; } });
        const notes = h('textarea', { id: 'd-notes', rows: '2', maxlength: '2000', oninput: (e) => { st.notes = e.target.value; } }, st.notes);
        const nm = h('input', { id: 'd-name', maxlength: '120', autocomplete: 'off', placeholder: 'Name of person attending' });
        const addPerson = () => { const v = nm.value.trim(); if (!v) return; st.people.push({ name: v, strokes: null }); render(); const n = document.getElementById('d-name'); if (n) n.focus(); };
        nm.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addPerson(); } });
        const prow = (p, i) => h('div', { class: 'econ', 'data-person': String(i) },
          h('span', {}, h('strong', {}, p.name)), p.strokes ? h('span', { class: 'sigwrap' }, sigSvg(p.strokes)) : null,
          h('span', { class: 'rowtools' }, h('button', { class: 'btn small' + (p.strokes ? ' ghost' : ''), type: 'button', 'data-sign': String(i), onclick: () => { st.signing = i; render(); } }, p.strokes ? 'Sign again' : 'Sign'),
            h('button', { class: 'btn small ghost', type: 'button', 'data-remove-person': String(i), onclick: () => { st.people.splice(i, 1); st.signing = null; render(); } }, 'Remove')));
        const save = h('button', { class: 'btn', id: 'd-save', type: 'button', onclick: (e) => ctx.busy(e.target, async () => {
          if (!st.site) return ctx.message(box, 'err', 'Please choose a site.');
          if (!st.presenter.trim()) return ctx.message(box, 'err', 'Please enter who is giving the talk.');
          if (!st.people.length) return ctx.message(box, 'err', 'Add at least one person who attended.');
          if (st.people.some((p) => !p.strokes)) return ctx.message(box, 'err', 'Everyone listed needs to sign before you save the record.');
          const r = await sb.rpc('record_talk', { p_property: st.site, p_talk: t.id, p_date: st.date || null, p_presenter: st.presenter.trim(), p_notes: st.notes.trim(), p_attendees: st.people.map((p) => ({ name: p.name, signature: p.strokes })) });
          if (r.error) return ctx.message(box, 'err', 'Sorry, the record did not save. You may not have permission, or the add-on may have stopped.');
          viewRecord(r.data, 'Record saved. Everyone who signed is on it.');
        }) }, 'Save record');
        const pad = st.signing != null && st.people[st.signing] ? signPad(st.people[st.signing].name, (strokes) => { st.people[st.signing].strokes = strokes; st.signing = null; render(); }, () => { st.signing = null; render(); }) : null;
        api.page('form', h('div', { class: 'card form', 'data-deliver': t.id }, h('button', { class: 'btn ghost', type: 'button', onclick: () => viewTalk(t) }, 'Back to the talk'),
          h('h1', {}, t.title), h('p', { class: 'muted' }, 'Read the key points together, then add each person and ask them to sign on the screen.'),
          sel, h('label', { for: 'd-date' }, 'Date'), date, h('label', { for: 'd-presenter' }, 'Given by'), pres, h('label', { for: 'd-notes' }, 'Notes (optional)'), notes,
          h('h2', {}, 'Who attended'), ...(st.people.length ? st.people.map(prow) : [h('p', { class: 'muted' }, 'Nobody added yet.')]),
          pad, !pad ? [nm, h('button', { class: 'btn small ghost', id: 'd-add', type: 'button', onclick: addPerson }, 'Add person')] : null,
          !pad ? save : null, box));
      }
      render();
    }

    // A signing box: draw with a finger, stylus or mouse.
    function signPad(name, onSave, onCancel) {
      const strokes = []; let cur = null;
      const cv = h('canvas', { class: 'sigpad', id: 'sigpad', width: '600', height: '240', 'aria-label': 'Sign here' });
      const g = cv.getContext('2d');
      const paint = () => { g.fillStyle = '#0d0d0d'; g.fillRect(0, 0, 600, 240); g.strokeStyle = '#f4efe2'; g.lineWidth = 3; g.lineCap = 'round'; g.lineJoin = 'round';
        for (const s of strokes) { g.beginPath(); s.forEach((p, i) => { const x = p[0] * 0.6, y = p[1] * 0.6; if (i) g.lineTo(x, y); else g.moveTo(x, y); }); if (s.length === 1) g.lineTo(s[0][0] * 0.6 + 0.1, s[0][1] * 0.6); g.stroke(); } };
      const at = (e) => { const b = cv.getBoundingClientRect(); return [Math.round(Math.min(Math.max((e.clientX - b.left) / b.width, 0), 1) * SIG_W), Math.round(Math.min(Math.max((e.clientY - b.top) / b.height, 0), 1) * SIG_H)]; };
      cv.addEventListener('pointerdown', (e) => { e.preventDefault(); try { cv.setPointerCapture(e.pointerId); } catch { /* ignore */ } cur = [at(e)]; strokes.push(cur); paint(); });
      cv.addEventListener('pointermove', (e) => { if (!cur) return; if (cur.length < 500) cur.push(at(e)); paint(); });
      const end = () => { cur = null; };
      cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
      paint();
      const err = h('div', {});
      return h('div', { class: 'sigbox' }, h('h2', {}, 'Signature: ' + name), h('p', { class: 'muted small' }, 'Sign inside the box to confirm you attended this talk and understood it.'), cv, err,
        h('div', { class: 'btnrow' }, h('button', { class: 'btn small', id: 'sig-save', type: 'button', onclick: () => {
          const use = strokes.filter((s) => s.length).slice(0, 50);
          if (!use.length) return ctx.message(err, 'err', 'Please sign in the box first.');
          onSave(use);
        } }, 'Use this signature'), h('button', { class: 'btn small ghost', id: 'sig-clear', type: 'button', onclick: () => { strokes.length = 0; paint(); } }, 'Clear'),
        h('button', { class: 'btn small ghost', type: 'button', onclick: onCancel }, 'Cancel')));
    }

    // ---------- records ----------
    async function viewRecords(msg) {
      api.page('form', h('div', { class: 'card' }, h('p', { class: 'muted center' }, 'Loading…')));
      const [sr, ar] = await Promise.all([sb.from('talk_sessions').select('id,property_id,talk_title,talk_category,delivered_on,presenter').order('delivered_on', { ascending: false }).limit(200), sb.from('talk_attendees').select('session_id')]);
      const sessions = (sr && sr.data) || [], count = {}; ((ar && ar.data) || []).forEach((a) => { count[a.session_id] = (count[a.session_id] || 0) + 1; });
      const multi = api.props().length > 1;
      const row = (s) => h('button', { class: 'talkrow', type: 'button', 'data-record': s.id, onclick: () => viewRecord(s.id) },
        h('span', { class: 'ttitle' }, s.talk_title), h('span', { class: 'muted small' }, api.shortDate(s.delivered_on) + (multi ? ' · ' + api.siteName(s.property_id) : '') + ' · ' + (count[s.id] || 0) + (count[s.id] === 1 ? ' person' : ' people') + ' · ' + s.presenter));
      api.page('form', h('div', { class: 'card' }, h('button', { class: 'btn ghost', type: 'button', onclick: () => viewLibrary() }, 'Back to all talks'), h('h1', {}, 'Talk records'),
        msg ? h('div', { class: 'msg ok', role: 'status' }, msg) : null,
        h('p', { class: 'muted' }, 'Every talk you have run, with who attended and their signatures. Records cannot be changed or deleted.'),
        ...(sessions.length ? sessions.map(row) : [h('p', { class: 'muted' }, 'No talks recorded yet.')])));
    }

    async function viewRecord(id, msg) {
      api.page('form', h('div', { class: 'card' }, h('p', { class: 'muted center' }, 'Loading…')));
      const [sr, ar] = await Promise.all([sb.from('talk_sessions').select('*').eq('id', id).maybeSingle(), sb.from('talk_attendees').select('*').eq('session_id', id).order('signed_at')]);
      const s = sr && sr.data;
      if (!s) return viewRecords();
      const people = (ar && ar.data) || [];
      const when = (x) => new Date(x).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      const pdf = h('button', { class: 'btn', id: 'rec-pdf', type: 'button', onclick: () => {
        const co = api.companyName();
        const bytes = window.TCPdf.build({ title: 'Toolbox Talk Record', subtitle: (co ? co + ' - ' : '') + api.siteName(s.property_id), footer: 'Tremcore Compliance Passport',
          blocks: [{ h: s.talk_title }, { kv: ['Category', s.talk_category || ''] }, { kv: ['Date', api.shortDate(s.delivered_on)] }, { kv: ['Site', api.siteName(s.property_id)] }, { kv: ['Given by', s.presenter] },
            s.notes ? { kv: ['Notes', s.notes] } : { gap: 0 },
            { h: 'Key points covered' }, ...(s.talk_points || []).map((p) => ({ li: p })),
            { h: 'Attendance and signatures (' + people.length + ')' }, { p: 'Each person listed signed on screen to confirm they attended this talk and understood it.' }, { gap: 4 },
            ...people.map((p) => ({ sig: { name: p.full_name, when: 'Signed ' + when(p.signed_at), strokes: p.signature } })),
            { gap: 10 }, { small: 'Talk content is general guidance and does not replace your own risk assessments or professional advice.' }] });
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
        const a = h('a', { href: url, download: 'toolbox-talk-' + s.delivered_on + '-' + s.talk_title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) + '.pdf' });
        document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
      } }, 'Download PDF');
      api.page('form', h('div', { class: 'card form', 'data-record-page': id }, h('button', { class: 'btn ghost', type: 'button', onclick: () => viewRecords() }, 'Back to records'),
        h('h1', {}, s.talk_title), msg ? h('div', { class: 'msg ok', role: 'status' }, msg) : null,
        h('div', { class: 'kv' }, h('span', {}, 'Date'), h('span', {}, api.shortDate(s.delivered_on))), h('div', { class: 'kv' }, h('span', {}, 'Site'), h('span', {}, api.siteName(s.property_id))),
        h('div', { class: 'kv' }, h('span', {}, 'Given by'), h('span', {}, s.presenter)), s.notes ? h('div', { class: 'kv' }, h('span', {}, 'Notes'), h('span', {}, s.notes)) : null,
        h('h2', {}, 'Attendance (' + people.length + ')'),
        ...people.map((p) => h('div', { class: 'econ', 'data-attendee': p.id }, h('span', {}, h('strong', {}, p.full_name), h('span', { class: 'muted small' }, ' · signed ' + when(p.signed_at))), h('span', { class: 'sigwrap' }, sigSvg(p.signature)))),
        pdf));
    }

    // ---------- the company's own talks (head office) ----------
    async function viewOwn(msg) {
      api.page('form', h('div', { class: 'card' }, h('p', { class: 'muted center' }, 'Loading…')));
      await load();
      const own = talks.filter((t) => t.company_id);
      const row = (t) => h('div', { class: 'econ', 'data-own': t.id }, h('span', {}, h('strong', {}, t.title), h('span', { class: 'muted small' }, ' · ' + t.category)),
        h('span', { class: 'rowtools' }, h('button', { class: 'btn small ghost', type: 'button', 'data-edit-own': t.id, onclick: () => viewOwnForm(t) }, 'Edit'),
          h('button', { class: 'btn small ghost', type: 'button', 'data-remove-own': t.id, onclick: async () => { const r = await sb.from('toolbox_talks').delete().eq('id', t.id); if (r.error) return viewOwn('Sorry, that did not work.'); viewOwn('Talk removed. Records of talks already given are kept.'); } }, 'Remove')));
      api.page('form', h('div', { class: 'card' }, h('button', { class: 'btn ghost', type: 'button', onclick: () => viewLibrary() }, 'Back to all talks'), h('h1', {}, 'My own talks'),
        msg ? h('div', { class: 'msg ok', role: 'status' }, msg) : null,
        h('p', { class: 'muted' }, 'Write talks that fit your own sites. You can have up to 10 (' + own.length + ' in use).'),
        ...(own.length ? own.map(row) : [h('p', { class: 'muted' }, 'You have not written any talks yet.')]),
        own.length < 10 ? h('button', { class: 'btn', id: 'own-add', type: 'button', onclick: () => viewOwnForm(null) }, 'Add my own talk') : null));
    }

    function viewOwnForm(t) {
      const box = h('div', {});
      const title = h('input', { id: 'o-title', maxlength: '120', value: t ? t.title : '', autocomplete: 'off' });
      const category = h('select', { id: 'o-cat' }, ...CATS.map((c) => h('option', { value: c, selected: t ? t.category === c : c === 'Health & Safety' }, c)));
      const summary = h('textarea', { id: 'o-summary', rows: '2', maxlength: '500' }, t ? t.summary : '');
      const points = h('textarea', { id: 'o-points', rows: '6' }, t ? (t.points || []).join('\n') : '');
      const discuss = h('textarea', { id: 'o-discuss', rows: '3' }, t ? (t.discuss || []).join('\n') : '');
      const mins = h('input', { id: 'o-min', type: 'number', min: '1', max: '120', inputmode: 'numeric', value: t ? String(t.minutes) : '10' });
      const save = h('button', { class: 'btn', id: 'o-save', type: 'button', onclick: (e) => ctx.busy(e.target, async () => {
        const v = { title: title.value.trim(), category: category.value, summary: summary.value.trim(), points: lines(points.value).slice(0, 12), discuss: lines(discuss.value).slice(0, 8), minutes: Math.min(Math.max(parseInt(mins.value, 10) || 10, 1), 120) };
        if (!v.title) return ctx.message(box, 'err', 'Please give the talk a title.');
        if (!v.points.length) return ctx.message(box, 'err', 'Add at least one key point, one per line.');
        const r = t ? await sb.from('toolbox_talks').update(v).eq('id', t.id) : await sb.from('toolbox_talks').insert(Object.assign({ company_id: api.companyId() }, v));
        if (r.error) return ctx.message(box, 'err', /talk_limit/.test(r.error.message || '') ? 'You can have up to 10 of your own talks.' : 'Sorry, that did not save. Please try again.');
        viewOwn(t ? 'Talk saved.' : 'Talk added.');
      }) }, 'Save talk');
      api.page('form', h('div', { class: 'card form' }, h('button', { class: 'btn ghost', type: 'button', onclick: () => viewOwn() }, 'Back'), h('h1', {}, t ? 'Edit talk' : 'Add my own talk'),
        h('label', { for: 'o-title' }, 'Title'), title, h('label', { for: 'o-cat' }, 'Category'), category, h('label', { for: 'o-summary' }, 'Short summary (optional)'), summary,
        h('label', { for: 'o-points' }, 'Key points (one per line)'), points, h('label', { for: 'o-discuss' }, 'Questions to talk about (optional, one per line)'), discuss,
        h('label', { for: 'o-min' }, 'Minutes'), mins, save, box));
    }

    return viewLibrary(note);
  }
  window.TCToolbox = { open };
})();
