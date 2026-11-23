'use strict';
// Reads what a certificate is, and its dates, from the TEXT inside it. No artificial intelligence and no outside service:
// simple, predictable rules. It only ever suggests. The person checks every row before anything is saved, and anything it is not sure about is left blank.
(function () {
  // What a document can be. `titleRe` finds a check the person already has for it; `label`, `grp`, `basis`, `freq` are used if a new check is needed.
  const TYPES = [
    { code: 'fra', re: /fire risk assessment|\bFRA\b/i, titleRe: /fire risk/i, label: 'Fire Risk Assessment', grp: 'Fire safety', basis: 'legal', freq: 12 },
    { code: 'fire_alarm', re: /fire alarm|BS ?5839/i, titleRe: /fire alarm/i, label: 'Fire Alarm Testing & Maintenance', grp: 'Fire safety', basis: 'standard', freq: 6 },
    { code: 'emerg_light', re: /emergency light|BS ?5266/i, titleRe: /emergency light/i, label: 'Emergency Light Testing', grp: 'Fire safety', basis: 'standard', freq: 12 },
    { code: 'extinguish', re: /extinguisher/i, titleRe: /extinguisher/i, label: 'Fire Extinguisher Maintenance', grp: 'Fire safety', basis: 'standard', freq: 12 },
    { code: 'fire_door', re: /fire door/i, titleRe: /fire door/i, label: 'Fire Door Inspection', grp: 'Fire safety', basis: 'standard', freq: 12 },
    { code: 'eicr', re: /electrical installation condition|\bEICR\b|periodic inspection report/i, titleRe: /eicr|electrical installation/i, label: 'Electrical Installation Condition Reporting (EICR)', grp: 'Electrical', basis: 'standard', freq: 60 },
    { code: 'pat', re: /portable appliance|\bPAT\b ?test/i, titleRe: /\bpat\b|portable appliance/i, label: 'PAT Testing', grp: 'Electrical', basis: 'best_practice', freq: 12 },
    { code: 'asbestos', re: /asbestos/i, titleRe: /asbestos/i, label: 'Asbestos Management Survey / Register', grp: 'Building and services', basis: 'legal', freq: 12 },
    { code: 'legionella', re: /legionella|water hygiene|\bL8\b/i, titleRe: /legionella|water/i, label: 'Legionella (water) Risk Management', grp: 'Water hygiene', basis: 'legal', freq: 24 },
    { code: 'gas', re: /gas safety|\bCP ?12\b|landlord.?s gas|gas appliance/i, titleRe: /gas/i, label: 'Gas Safety Inspection & Maintenance', grp: 'Building and services', basis: 'legal', freq: 12 },
    { code: 'fgas', re: /\bf-?gas\b|fluorinated|refrigerant/i, titleRe: /f-?gas/i, label: 'F-Gas', grp: 'Building and services', basis: 'standard', freq: 12 },
    { code: 'aircon', re: /air.?con(ditioning)?/i, titleRe: /air.?con/i, label: 'Air Conditioning Servicing', grp: 'Building and services', basis: 'best_practice', freq: 12 },
    { code: 'boiler', re: /boiler service|heating (system )?service/i, titleRe: /boiler|heating/i, label: 'Heating and Boiler Servicing', grp: 'Building and services', basis: 'best_practice', freq: 12 },
    { code: 'lift', re: /\bLOLER\b|lift (thorough )?(examination|inspection)/i, titleRe: /lift|loler/i, label: 'Lift Inspection (LOLER)', grp: 'Building and services', basis: 'legal', freq: 6 },
    { code: 'extract', re: /kitchen extract|extract(ion)? (system )?clean/i, titleRe: /extract/i, label: 'Kitchen Extract Cleaning', grp: 'Building and services', basis: 'standard', freq: 12 },
    { code: 'pest', re: /pest control/i, titleRe: /pest/i, label: 'Pest Control', grp: 'Building and services', basis: 'best_practice', freq: 12 },
    { code: 'ins_el', re: /employers.? liability/i, titleRe: /employers/i, label: "Employers' Liability Insurance", grp: 'Insurance', basis: 'legal', freq: 12 },
    { code: 'ins_pl', re: /public liability/i, titleRe: /public liability/i, label: 'Public Liability Insurance', grp: 'Insurance', basis: 'best_practice', freq: 12 },
    { code: 'ins_bc', re: /buildings? (and|&) contents|buildings? insurance/i, titleRe: /buildings/i, label: 'Buildings and contents insurance', grp: 'Insurance', basis: 'best_practice', freq: 12 }
  ];

  // Pick the most likely type. The words inside the document count for more than the file name.
  function classify(text, filename) {
    const t = String(text || ''), f = String(filename || '').replace(/[_-]+/g, ' ');
    let best = null, bestScore = 0;
    TYPES.forEach((ty) => {
      const inText = (t.match(new RegExp(ty.re.source, 'gi')) || []).length;
      const score = Math.min(inText, 5) * 2 + (ty.re.test(f) ? 3 : 0);
      if (score > bestScore) { best = ty; bestScore = score; }
    });
    return best;
  }

  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
  const monthNo = (m) => MONTHS[String(m).toLowerCase().slice(0, 3)] || 0;
  function iso(y, m, d) {
    y = +y; m = +m; d = +d;
    if (y < 100) y += 2000;
    if (!(y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }

  // Every date in the text, with where it sits.
  function findDates(text) {
    const out = [], s = String(text || '').replace(/\s+/g, ' ');
    const add = (index, len, value) => { if (value) out.push({ index, end: index + len, value }); };
    let m;
    const numeric = /\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4}|\d{2})\b/g;
    while ((m = numeric.exec(s))) add(m.index, m[0].length, iso(m[3], m[2], m[1]));
    const isoRe = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
    while ((m = isoRe.exec(s))) add(m.index, m[0].length, iso(m[1], m[2], m[3]));
    const MN = '(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
    const dmy = new RegExp('\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?' + MN + '\\.?,?\\s+(\\d{4})\\b', 'gi');
    while ((m = dmy.exec(s))) add(m.index, m[0].length, iso(m[3], monthNo(m[2]), m[1]));
    const mdy = new RegExp('\\b' + MN + '\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b', 'gi');
    while ((m = mdy.exec(s))) add(m.index, m[0].length, iso(m[3], monthNo(m[1]), m[2]));
    out.sort((a, b) => a.index - b.index);
    return { s, dates: out };
  }

  const EXPIRY = /(expir\w*|valid (?:until|to|till)|next (?:inspection|test(?:ing)?|service|due|review|visit|assessment|examination)|(?:re-?inspection|renewal|review|due|retest|re-test) date|recommended (?:date )?(?:for )?next|date for next|due for (?:renewal|review|inspection)|period of (?:insurance|cover) to|cover ends|end date|renew(?:s|al)? on)/gi;
  const ISSUE = /(date of (?:issue|inspection|test(?:ing)?|assessment|service|visit|survey|report|completion)|issued(?: on)?|inspection date|test date|service date|assessment date|survey date|completed(?: on)?|carried out(?: on)?|inspected on|period of (?:insurance|cover) from|start date|inception|effective (?:from|date)|commencement)/gi;

  // The label closest BEFORE the date decides what the date is (labels usually come just before their value).
  function labelFor(s, d) {
    const before = s.slice(Math.max(0, d.index - 55), d.index);
    let e = -1, i = -1, m;
    EXPIRY.lastIndex = 0; while ((m = EXPIRY.exec(before))) e = m.index + m[0].length;
    ISSUE.lastIndex = 0; while ((m = ISSUE.exec(before))) i = m.index + m[0].length;
    if (e < 0 && i < 0) return null;
    return e > i ? 'expiry' : 'issue';
  }

  function addMonthsIso(v, n) {
    if (!v || !n) return null;
    const p = v.split('-').map(Number), dt = new Date(Date.UTC(p[0], p[1] - 1 + n, p[2]));
    if (dt.getUTCDate() !== p[2]) dt.setUTCDate(0);   // 31 Jan + 1 month is the end of February, not March
    return dt.toISOString().slice(0, 10);
  }

  function findNumber(text) {
    const m = /(?:certificate|policy|report|reference|ref)\.?\s*(?:no\.?|number|#|:)\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9\/\-]{3,24})/i.exec(String(text || '').replace(/\s+/g, ' '));
    return m ? m[1] : null;
  }

  // The whole read. Returns what it believes, and whether it is sure enough to call the row "read".
  function parse(text, filename) {
    const type = classify(text, filename);
    const { s, dates } = findDates(text);
    let issue = null, expiry = null;
    dates.forEach((d, n) => {
      let l = labelFor(s, d);
      const prev = dates[n - 1];   // "from 01/09/2026 to 31/08/2027": a date straight after "to" or "until" is the end date
      if (prev && /^\s*(to|until|till|-|\u2013)\s*$/i.test(s.slice(prev.end, d.index))) l = 'expiry';
      if (l === 'expiry') { if (!expiry || d.value > expiry) expiry = d.value; }
      else if (l === 'issue') { if (!issue) issue = d.value; }
    });
    let worked = false;
    if (issue && !expiry && type && type.freq) { expiry = addMonthsIso(issue, type.freq); worked = !!expiry; }
    if (issue && expiry && expiry < issue && !worked) { const t = issue; issue = expiry; expiry = t; }
    return { type, issue, expiry, expiryWorkedOut: worked, number: findNumber(text), sure: !!(type && (expiry || issue)) };
  }

  const api = { TYPES, classify, findDates, parse, addMonthsIso };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.TCCertRead = api;
})();
