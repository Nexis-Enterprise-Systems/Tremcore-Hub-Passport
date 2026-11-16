// How things are written everywhere in the app: names and addresses start each word with a capital, postcodes are capitals with a space
// (ME3 8FX), phone numbers are 5 digits, a space, 6 digits (01634 123456). The database applies the same rules when it saves.
(function () {
  'use strict';
  const cap = (t) => String(t == null ? '' : t).replace(/(^|[\s\-'])([a-z])/g, (m, a, b) => a + b.toUpperCase());
  // Returns { ok, value }. Empty is fine (value ''). Accepts +44 and spaces, dashes, brackets.
  function phone(v) {
    const raw = String(v == null ? '' : v).trim(); if (!raw) return { ok: true, value: '' };
    let d = raw.replace(/[^\d+]/g, '');
    if (d.startsWith('+44')) d = '0' + d.slice(3); else if (d.startsWith('0044')) d = '0' + d.slice(4);
    d = d.replace(/\D/g, '');
    if (/^0\d{10}$/.test(d)) return { ok: true, value: d.slice(0, 5) + ' ' + d.slice(5) };
    return { ok: false, value: raw };
  }
  function postcode(v) {
    const raw = String(v == null ? '' : v).trim(); if (!raw) return { ok: true, value: '' };
    const p = raw.replace(/\s+/g, '').toUpperCase();
    if (/^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(p)) return { ok: true, value: p.slice(0, -3) + ' ' + p.slice(-3) };
    return { ok: false, value: raw.toUpperCase() };
  }
  const PHONE_HELP = 'Please enter the phone number as 11 digits, like 01634 123456.';
  const POSTCODE_HELP = 'Please check the postcode, for example ME3 8FX.';
  // Tidy a text box when the person leaves it.
  const tidyBox = (input, kind) => { input.addEventListener('blur', () => { const v = input.value; input.value = kind === 'phone' ? phone(v).value : kind === 'postcode' ? postcode(v).value : cap(v.trim()); }); return input; };
  window.TCFormat = { cap, phone, postcode, tidyBox, PHONE_HELP, POSTCODE_HELP };
})();
