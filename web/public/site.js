// Tremcore website behaviour. No packages, no inline code (the security policy forbids it).
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  // mobile menu
  var mb = $('.menu'), nav = $('nav.main');
  if (mb && nav) mb.addEventListener('click', function () {
    var open = nav.classList.toggle('open'); mb.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  // Self-Managed sign-up buttons stay hidden unless Tremcore has switched sign-up on (a yes/no answer from the database).
  var su = $$('[data-signup]');
  if (su.length && window.fetch) {
    fetch('/config.json', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (c) {
      if (!c || !c.url || !c.anonKey) return null;
      return fetch(c.url + '/rest/v1/rpc/signup_open', { method: 'POST', headers: { apikey: c.anonKey, Authorization: 'Bearer ' + c.anonKey, 'Content-Type': 'application/json' }, body: '{}' })
        .then(function (r) { return r.ok ? r.json() : false; })
        .then(function (open) { if (open === true) su.forEach(function (el) { el.hidden = false; }); });
    }).catch(function () {});
  }

  // donut: sweep is 0..1 of the sample split
  var SPLIT = [['--green', 0.55], ['--amber', 0.25], ['--red', 0.10], ['--grey', 0.10]];
  function paintDonut(el, sweep) {
    var css = getComputedStyle(document.documentElement), at = 0, parts = [];
    SPLIT.forEach(function (s) {
      var w = s[1] * sweep * 100, col = css.getPropertyValue(s[0]).trim();
      parts.push(col + ' ' + at + '% ' + (at + w) + '%'); at += w;
    });
    if (at < 100) parts.push('#2a271e ' + at + '% 100%');
    el.style.background = 'conic-gradient(' + parts.join(',') + ')';
  }
  $$('[data-donut]').forEach(function (d) { paintDonut(d, 1); });

  // ---------- demo walkthrough ----------
  var demo = $('#demo-player');
  if (demo) {
    var SCENE = 5000, TOTAL = 20000, TICK = 200;
    var CAPS = [['Your dashboard', 'Every property in one traffic-light view.'], ['Add a certificate', 'Upload it, set the date and the status updates.'], ['Reminders', 'An email arrives before anything lapses.'], ['There is more to see', 'Book a walkthrough to see the rest.']];
    var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    // On a phone the walkthrough opens full screen by itself when someone presses play (same query as the CSS).
    var phoneQ = window.matchMedia && matchMedia('(max-width: 700px), (pointer: coarse) and (max-height: 500px)');
    var isPhone = function () { return !!(phoneQ && phoneQ.matches); };
    var t = 0, timer = null, popped = false, lastFocus = null;
    var scenes = $$('.scene', demo), chap = $$('.chap button', demo), btn = $('#d-toggle'), bar = $('#d-bar'), prog = $('#d-prog'), tl = $('#d-time');
    var poster = $('.poster', demo), cap = $('#d-cap'), donut = $('#d-donut'), pct = $('#d-pct');
    var upPill = $('#u-pill'), upFile = $('#u-file'), upDate = $('#u-date'), upDone = $('#u-done'), note = $('#n-card'), dateTxt = $('#u-datetxt');
    var fmt = function (ms) { var s = Math.floor(ms / 1000); return '0:' + (s < 10 ? '0' : '') + s; };
    var future = new Date(Date.now() + 182 * 864e5).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    if (dateTxt) dateTxt.textContent = future;
    // The dashboard is shown complete from the first moment (no build-up): paint it once, before anything plays.
    paintDonut(donut, 1); pct.textContent = '80';
    function render() {
      var si = Math.min(3, Math.floor(t / SCENE)), p = (t % SCENE) / SCENE;
      if (t >= TOTAL) { si = 3; p = 1; }
      scenes.forEach(function (s, i) { s.classList.toggle('on', i === si); });
      chap.forEach(function (c, i) { c.setAttribute('aria-pressed', i === si ? 'true' : 'false'); });
      cap.querySelector('b').textContent = CAPS[si][0]; cap.querySelector('span').textContent = CAPS[si][1];
      if (si === 1) {
        var ok = p >= 0.7; upPill.textContent = ok ? 'In date' : 'Due in 12d'; upPill.className = 'pill ' + (ok ? 'g' : 'a');
        upFile.classList.toggle('hid', p < 0.2); upDate.classList.toggle('hid', p < 0.4); upDone.classList.toggle('hid', p < 0.82);
      }
      if (si === 2) note.classList.toggle('in', p >= 0.12);
      var pc = Math.min(100, t / TOTAL * 100);
      bar.style.width = pc + '%'; prog.setAttribute('aria-valuenow', Math.round(pc)); tl.textContent = fmt(Math.min(t, TOTAL)) + ' / 0:20';
      var ended = t >= TOTAL;
      btn.querySelector('span').textContent = ended ? 'Replay' : (timer ? 'Pause' : (t > 0 ? 'Resume' : 'Play'));
      poster.hidden = !(t === 0 && !timer);
    }
    function stop() { if (timer) { clearInterval(timer); timer = null; } }
    function play() {
      if (t >= TOTAL) t = 0; stop();
      timer = setInterval(function () { t += TICK; if (t >= TOTAL) { t = TOTAL; stop(); } render(); }, TICK); render();
    }
    function start() { if (isPhone() && !popped) openPop(); play(); }
    function toggle() { if (timer) { stop(); render(); } else start(); }
    btn.addEventListener('click', toggle);
    $('.poster .play', demo).addEventListener('click', start);
    chap.forEach(function (c, i) { c.addEventListener('click', function () { t = i * SCENE; start(); }); });

    var bd = null, closeBtn = $('#d-close'), popBtn = $('#d-pop');
    function openPop() {
      if (popped) return; popped = true; lastFocus = document.activeElement;
      bd = document.createElement('div'); bd.className = 'backdrop'; bd.addEventListener('click', closePop); document.body.appendChild(bd);
      document.documentElement.classList.add('lock');
      demo.classList.add('pop'); demo.setAttribute('role', 'dialog'); demo.setAttribute('aria-modal', 'true'); demo.setAttribute('aria-label', 'Walkthrough');
      closeBtn.focus();
    }
    function closePop() {
      if (!popped) return; popped = false; if (bd) { bd.remove(); bd = null; }
      document.documentElement.classList.remove('lock');
      demo.classList.remove('pop'); demo.removeAttribute('role'); demo.removeAttribute('aria-modal'); demo.removeAttribute('aria-label');
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }
    closeBtn.addEventListener('click', closePop); popBtn.addEventListener('click', function () { openPop(); if (!reduce && !timer) play(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closePop(); });
    render();
    if (/[?&]play=1/.test(location.search) && !reduce) { openPop(); play(); }
  }

  // ---------- enquiry form ----------
  var form = $('#enquiry');
  if (form) {
    var out = $('#f-out'), go = $('#f-go');
    var pre = (location.search.match(/[?&]package=([^&]*)/) || [])[1]; if (pre && form.package) form.package.value = decodeURIComponent(pre);
    form.addEventListener('submit', function (e) {
      e.preventDefault(); out.className = ''; out.textContent = '';
      var data = {}; new FormData(form).forEach(function (v, k) { data[k] = String(v); });
      go.disabled = true; go.textContent = 'Sending…';
      fetch('/api/enquiry', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify(data) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (r) {
          if (r.ok) { form.reset(); out.className = 'msg ok'; out.textContent = 'Thank you. We have your details and will be in touch to arrange a time.'; }
          else { out.className = 'msg err'; out.textContent = (r.j && r.j.error) || 'Sorry, that did not send. Please try again or call us.'; }
        })
        .catch(function () { out.className = 'msg err'; out.textContent = 'Sorry, that did not send. Please check your connection and try again.'; })
        .then(function () { go.disabled = false; go.textContent = 'Book my demo'; });
    });
  }
})();
