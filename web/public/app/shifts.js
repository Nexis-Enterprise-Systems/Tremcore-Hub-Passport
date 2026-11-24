'use strict';
// Compares clock-ins and clock-outs with each person's weekly shift, in UK time. Pure rules, no outside service.
//   Start: red if even one minute late; green if 5 or more minutes early; otherwise plain (on time or less than 5 minutes early).
//   Finish: red if they left before the end of the shift; otherwise plain.
// A shift whose end time is not later than its start time runs past midnight (22:00 to 06:00).
(function () {
  const EARLY_MINUTES = 5;
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const dayNo = (s) => { const p = String(s).split('-').map(Number); return Math.round(Date.UTC(p[0], p[1] - 1, p[2]) / 86400000); };
  const dayStr = (n) => new Date(n * 86400000).toISOString().slice(0, 10);
  const weekdayOf = (dateStr) => { const w = new Date(dayNo(dateStr) * 86400000).getUTCDay(); return w === 0 ? 7 : w; };   // 1 = Monday ... 7 = Sunday
  // UK date, minutes since midnight and weekday for an instant.
  function ukParts(iso) {
    const o = {}; fmt.formatToParts(new Date(iso)).forEach((p) => { o[p.type] = p.value; });
    const hour = +o.hour % 24, date = o.year + '-' + o.month + '-' + o.day;
    return { date, minutes: hour * 60 + (+o.minute), weekday: weekdayOf(date) };
  }
  const toMin = (t) => { const p = String(t || '').split(':'); return (+p[0]) * 60 + (+p[1] || 0); };
  const hm = (m) => String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  const plural = (n) => n + (n === 1 ? ' min' : ' mins');

  // att: { clocked_in, clocked_out, no_clock_out }, shift: { start_time, end_time } or null.
  function judge(att, shift) {
    const inP = ukParts(att.clocked_in), out = { date: inP.date, inMinutes: inP.minutes, inState: 'none', inNote: '', outState: 'none', outNote: '' };
    if (!shift) return out;
    const start = toMin(shift.start_time), end = toMin(shift.end_time), overnight = end <= start;
    const diff = inP.minutes - start;
    if (diff > 0) { out.inState = 'late'; out.inNote = plural(diff) + ' late'; }
    else if (-diff >= EARLY_MINUTES) { out.inState = 'early'; out.inNote = plural(-diff) + ' early'; }
    else out.inState = 'ontime';
    if (att.clocked_out) {
      const o = ukParts(att.clocked_out), outMin = (dayNo(o.date) - dayNo(inP.date)) * 1440 + o.minutes, expected = (overnight ? 1440 : 0) + end;
      if (outMin < expected) { out.outState = 'early'; out.outNote = 'left ' + plural(expected - outMin) + ' early'; }
      else out.outState = 'ok';
    }
    return out;
  }

  // The report: one row per clock-in in the range, plus a muted "No clock-in" row for each shift day that has passed with nothing recorded.
  // members: [{id, full_name, active}], shifts: [{member_id, weekday, start_time, end_time}], atts: staff_attendance rows.
  function buildRows(atts, shifts, members, from, to, today, onlyMember) {
    const shiftOf = (mid, wd) => shifts.find((s) => s.member_id === mid && s.weekday === wd) || null;
    const rows = [];
    atts.forEach((a) => {
      const p = ukParts(a.clocked_in);
      if (p.date < from || p.date > to) return;
      if (onlyMember && a.member_id !== onlyMember) return;
      const sh = a.member_id ? shiftOf(a.member_id, p.weekday) : null, j = judge(a, sh);
      rows.push({ date: p.date, name: a.member_name, member_id: a.member_id, shift: sh, att: a, judged: j, kind: 'clocked' });
    });
    members.filter((m) => m.active && (!onlyMember || m.id === onlyMember)).forEach((m) => {
      for (let d = dayNo(from); d <= dayNo(to); d++) {
        const ds = dayStr(d); if (ds >= today) continue;   // today and later are not "missed" yet
        const sh = shiftOf(m.id, weekdayOf(ds)); if (!sh) continue;
        if (!atts.some((a) => a.member_id === m.id && ukParts(a.clocked_in).date === ds)) rows.push({ date: ds, name: m.full_name, member_id: m.id, shift: sh, att: null, judged: null, kind: 'none' });
      }
    });
    rows.sort((x, y) => x.date.localeCompare(y.date) || x.name.localeCompare(y.name) || (x.att ? x.att.clocked_in : '').localeCompare(y.att ? y.att.clocked_in : ''));
    return rows;
  }
  // The Monday and Sunday of the UK week containing a date.
  function weekOf(dateStr) { const n = dayNo(dateStr), wd = weekdayOf(dateStr); return { from: dayStr(n - (wd - 1)), to: dayStr(n + (7 - wd)) }; }
  const addDays = (dateStr, n) => dayStr(dayNo(dateStr) + n);

  const api = { judge, buildRows, ukParts, weekOf, addDays, weekdayOf, hm, EARLY_MINUTES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else window.TCShifts = api;
})();
