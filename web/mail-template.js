'use strict';
// Branded email wrapper and the "thank you for registering your interest" email.
// Email programs ignore most modern styling, so this uses simple tables and inline styles, and the logo is a full web address.
const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const COMPANY = { name: 'Tremcore Ltd', number: '17507064', email: 'info@tremcore.co.uk' };
const GOLD = '#c9a24a', BLACK = '#0c0b09';

// siteUrl: the website's address with no trailing slash (the logo and links are built from it).
function shell({ title, bodyHtml, siteUrl, why }) {
  const font = "font-family:Arial,Helvetica,sans-serif;";
  return '<!doctype html><html><body style="margin:0;padding:0;background:#f1eee6;">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1eee6;"><tr><td align="center" style="padding:24px 12px;">'
    + '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:6px;overflow:hidden;">'
    // header
    + '<tr><td align="center" style="background:' + BLACK + ';padding:34px 28px;border-bottom:3px solid ' + GOLD + ';"><div style="' + font + 'font-size:24px;line-height:1.3;color:' + GOLD + ';font-weight:bold;">' + esc(title) + '</div></td></tr>'
    // body
    + '<tr><td style="padding:34px 36px 12px;' + font + 'font-size:16px;line-height:1.65;color:#222222;">' + bodyHtml + '</td></tr>'
    // logo
    + '<tr><td align="center" style="background:' + BLACK + ';padding:26px 28px;"><a href="' + esc(siteUrl) + '/"><img src="' + esc(siteUrl) + '/img/logo-full.png" width="170" alt="Tremcore Ltd" style="display:block;border:0;width:170px;height:auto;"></a></td></tr>'
    // footer
    + '<tr><td align="center" style="background:#17140f;padding:22px 30px 26px;' + font + 'font-size:12px;line-height:1.6;color:#b9b19a;">'
    + '<div style="color:#e7dfc8;font-weight:bold;">' + esc(COMPANY.name) + '</div>'
    + '<div>Company number ' + esc(COMPANY.number) + '</div>'
    + '<div style="margin-top:8px;"><a href="mailto:' + COMPANY.email + '" style="color:' + GOLD + ';text-decoration:none;">' + COMPANY.email + '</a> &nbsp;|&nbsp; <a href="' + esc(siteUrl) + '/" style="color:' + GOLD + ';text-decoration:none;">' + esc(siteUrl.replace(/^https?:\/\//, '')) + '</a> &nbsp;|&nbsp; <a href="' + esc(siteUrl) + '/privacy/" style="color:' + GOLD + ';text-decoration:none;">Privacy notice</a></div>'
    + (why ? '<div style="margin-top:10px;color:#8f8978;">' + esc(why) + '</div>' : '')
    + '</td></tr></table></td></tr></table></body></html>';
}

function firstName(name) {
  const f = String(name || '').trim().split(/\s+/)[0] || '';
  return f ? f.charAt(0).toUpperCase() + f.slice(1).toLowerCase() : '';
}

function interestThanks(person, siteUrl) {
  const first = firstName(person.name);
  const hi = first ? 'Hi ' + first + ',' : 'Hi,';
  const p = [
    'Thank you for registering your interest in using the Tremcore Passport. We are excited to bring this to you and once this is live we shall send out further communication so that you can then register your business in the Passport.',
    'Keep an eye out for further communication and if you have any questions then please reply to this email and one of the team will be in touch.'
  ];
  const sign = ['Kindest Regards,', 'Tremcore Passport Team'];
  const why = 'You are receiving this email because you registered your interest on our website. If you would rather not hear from us, just reply with the word STOP.';
  const text = [hi, '', p[0], '', p[1], '', sign[0], sign[1], '', '--', COMPANY.name, 'Company number ' + COMPANY.number, COMPANY.email + ' | ' + siteUrl, '', why].join('\n');
  const para = (t) => '<p style="margin:0 0 18px;">' + esc(t) + '</p>';
  const bodyHtml = para(hi) + para(p[0]) + para(p[1]) + '<p style="margin:26px 0 20px;">' + esc(sign[0]) + '<br><strong>' + esc(sign[1]) + '</strong></p>';
  return { subject: 'Thank you for registering your interest', text, html: shell({ title: 'Thank you for registering your interest', bodyHtml, siteUrl, why }) };
}


// Turns a plain list of lines (blank line = new paragraph, "- " = bullet, a line holding the link = a gold button) into the branded email.
// Used for the emails Tremcore staff send out: offers, free access and the "now open" email.
function fromLines(lines, { link, label, title, subject, siteUrl, why }) {
  const out = []; let bullets = [];
  const flush = () => { if (bullets.length) { out.push('<ul style="margin:0 0 18px;padding-left:22px;">' + bullets.map((b) => '<li style="margin:0 0 6px;">' + esc(b) + '</li>').join('') + '</ul>'); bullets = []; } };
  const signIdx = lines.lastIndexOf('Kind regards,');
  const body = signIdx >= 0 ? lines.slice(0, signIdx) : lines;
  for (const l of body) {
    if (l === '') { flush(); continue; }
    if (l.startsWith('- ')) { bullets.push(l.slice(2)); continue; }
    flush();
    if (link && l.includes(link)) {
      const before = l.split(link)[0].replace(/[:\s]+$/, '');
      if (before) out.push('<p style="margin:0 0 14px;">' + esc(before) + '</p>');
      out.push('<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 20px;"><tr><td style="background:' + GOLD + ';border-radius:4px;"><a href="' + esc(link) + '" style="display:inline-block;padding:13px 26px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;color:' + BLACK + ';text-decoration:none;">' + esc(label || 'Open') + '</a></td></tr></table>'
        + '<p style="margin:0 0 18px;font-size:13px;color:#777;">If the button does not work, copy this address into your browser:<br><span style="word-break:break-all;">' + esc(link) + '</span></p>');
      continue;
    }
    out.push('<p style="margin:0 0 18px;">' + esc(l) + '</p>');
  }
  flush();
  out.push('<p style="margin:26px 0 20px;">Kind regards,<br><strong>' + esc(signIdx >= 0 ? lines[signIdx + 1] : 'Tremcore Ltd') + '</strong></p>');
  return shell({ title, bodyHtml: out.join(''), siteUrl, why });
}

function simpleMail(title, paras, siteUrl, why, subject) {
  const text = [].concat(paras, ['', 'Kindest Regards,', 'Tremcore Passport Team', '', '--', COMPANY.name, 'Company number ' + COMPANY.number, COMPANY.email + ' | ' + siteUrl, '', why]).join('\n');
  const bodyHtml = paras.map((t) => '<p style="margin:0 0 18px;">' + esc(t) + '</p>').join('') + '<p style="margin:26px 0 20px;">Kindest Regards,<br><strong>Tremcore Passport Team</strong></p>';
  return { subject: subject || title, text, html: shell({ title, bodyHtml, siteUrl, why }) };
}

// Sent once, after the first successful payment.
function welcomeReceipt(person, siteUrl) {
  const first = firstName(person.name), hi = first ? 'Hi ' + first + ',' : 'Hi,';
  const paras = [hi, 'Thank you. We have received your payment and your Tremcore Passport account is now active' + (person.company ? ' for ' + person.company : '') + '.',
    'You can sign in at ' + siteUrl + '/app/ to add your sites and compliance records. Stripe will email you a separate receipt for this payment, and you can see your plan in the app under Your account.',
    'If you have any questions, just reply to this email and one of the team will be in touch.'];
  return simpleMail('Welcome to the Tremcore Passport', paras, siteUrl, 'You are receiving this email because you signed up for the Tremcore Passport.', 'Welcome to the Tremcore Passport. Payment received');
}

// A payment did not go through. Sent to the head-office user, and a copy to Tremcore.
function paymentFailed(person, siteUrl, forTremcore) {
  const first = firstName(person.name), hi = forTremcore ? 'Hello,' : (first ? 'Hi ' + first + ',' : 'Hi,');
  const paras = forTremcore
    ? [hi, 'A payment failed for ' + (person.company || 'a customer') + (person.email ? ' (' + person.email + ')' : '') + '. Their account is marked Past due in the Hub. Stripe will retry automatically.']
    : [hi, 'We were not able to take your latest Tremcore Passport payment' + (person.company ? ' for ' + person.company : '') + '.',
       'Please check that your card or bank details are up to date. Sign in at ' + siteUrl + '/app/ and open Your account to update them. Your account stays open while we retry the payment.',
       'If you need a hand, just reply to this email.'];
  return simpleMail('Payment problem', paras, siteUrl, forTremcore ? 'Internal alert from the Tremcore Passport.' : 'You are receiving this email because you have a Tremcore Passport subscription.', forTremcore ? 'Payment failed: ' + (person.company || 'customer') : 'We could not take your payment');
}

// ---- compliance reminders (Level 1) and the "Tremcore is managing this" notice (Levels 2 and 3)
const longDate = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
function dueTag(it) {
  const n = it.days_left;
  const red = n < 0, text = red ? 'OVERDUE BY ' + (-n) + (n === -1 ? ' DAY' : ' DAYS') : n === 0 ? 'DUE TODAY' : 'DUE IN ' + n + (n === 1 ? ' DAY' : ' DAYS');
  return { red, text };
}
function itemTable(items, showSite) {
  const MAX = 25, shown = items.slice(0, MAX);
  const rows = shown.map((it) => {
    const t = dueTag(it);
    return '<tr><td style="padding:14px 16px;border-top:1px solid #e3dccb;">'
      + '<div style="font-size:16px;font-weight:bold;color:' + BLACK + ';">' + esc(it.title) + '</div>'
      + (showSite && it.site ? '<div style="font-size:13px;color:#777;">' + esc(it.site) + '</div>' : '')
      + '<div style="margin-top:6px;"><span style="display:inline-block;background:' + (t.red ? '#c0392b' : '#f0b429') + ';color:' + (t.red ? '#ffffff' : BLACK) + ';font-size:11px;font-weight:bold;padding:3px 9px;border-radius:10px;">' + t.text + '</span>'
      + ' <span style="font-size:13px;color:#555;">Due ' + esc(longDate(String(it.due_date).slice(0, 10))) + '</span></div></td></tr>';
  }).join('');
  const more = items.length > MAX ? '<tr><td style="padding:12px 16px;border-top:1px solid #e3dccb;font-size:13px;color:#555;">and ' + (items.length - MAX) + ' more. Open your passport to see them all.</td></tr>' : '';
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;border:1px solid #e3dccb;border-radius:4px;border-collapse:separate;">' + rows.replace(/^<tr><td style="padding:14px 16px;border-top:1px solid #e3dccb;">/, '<tr><td style="padding:14px 16px;">') + more + '</table>';
}
function itemText(items) {
  return items.slice(0, 25).map((it) => { const t = dueTag(it); return '- ' + it.title + (it.site ? ' (' + it.site + ')' : '') + ': ' + t.text.toLowerCase() + ', due ' + longDate(String(it.due_date).slice(0, 10)); }).join('\n')
    + (items.length > 25 ? '\nand ' + (items.length - 25) + ' more' : '');
}
function button(href, label) {
  return '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 20px;"><tr><td style="background:' + GOLD + ';border-radius:4px;"><a href="' + esc(href) + '" style="display:inline-block;padding:13px 26px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;color:' + BLACK + ';text-decoration:none;">' + esc(label) + '</a></td></tr></table>';
}

// rec: { name, company, items:[{title, site, due_date, days_left}] }. Level 1 summary of everything due soon or overdue.
function complianceReminder(rec, siteUrl) {
  const first = firstName(rec.name), hi = first ? 'Hi ' + first + ',' : 'Hi,';
  const items = rec.items, overdue = items.filter((i) => i.days_left < 0).length;
  const multi = new Set(items.map((i) => i.site)).size > 1;
  const intro = overdue
    ? (overdue === 1 ? 'One compliance item' : overdue + ' compliance items') + ' for ' + rec.company + ' ' + (overdue === 1 ? 'is' : 'are') + ' overdue' + (items.length > overdue ? ', and others are coming due' : '') + '. Here is where things stand:'
    : 'The following compliance ' + (items.length === 1 ? 'item for ' : 'items for ') + rec.company + (items.length === 1 ? ' is' : ' are') + ' coming due:';
  const outro = 'Please arrange the work and upload the new certificate once you have it, so your passport stays up to date. If a date is wrong, you can correct it in the passport.';
  const subject = overdue ? 'Action needed: ' + (overdue === 1 ? '1 compliance item is overdue' : overdue + ' compliance items are overdue') : (items.length === 1 ? 'Reminder: a compliance item is due soon' : 'Reminder: ' + items.length + ' compliance items are due soon');
  const why = 'You are receiving this reminder because you look after compliance records for ' + rec.company + ' in the Tremcore Passport. If you would rather not receive these, reply with the word STOP.';
  const text = [hi, '', intro, '', itemText(items), '', outro, 'Open your passport: ' + siteUrl + '/app/', '', 'Kindest Regards,', 'Tremcore Passport Team', '', '--', COMPANY.name, 'Company number ' + COMPANY.number, COMPANY.email + ' | ' + siteUrl, '', why].join('\n');
  const bodyHtml = '<p style="margin:0 0 18px;">' + esc(hi) + '</p><p style="margin:0 0 18px;">' + esc(intro) + '</p>' + itemTable(items, multi)
    + '<p style="margin:0 0 14px;">' + esc(outro) + '</p>' + button(siteUrl + '/app/', 'Open my passport')
    + '<p style="margin:26px 0 20px;">Kindest Regards,<br><strong>Tremcore Passport Team</strong></p>';
  return { subject, text, html: shell({ title: overdue ? 'Compliance overdue' : 'Compliance reminder', bodyHtml, siteUrl, why }) };
}

// Levels 2 and 3: Tremcore looks after the renewal, so the message says so instead of asking the client to act.
function managedNotice(rec, siteUrl) {
  const first = firstName(rec.name), hi = first ? 'Hi ' + first + ',' : 'Hi,';
  const items = rec.items, multi = new Set(items.map((i) => i.site)).size > 1;
  const intro = (items.length === 1 ? 'A compliance item' : items.length + ' compliance items') + ' for ' + rec.company + ' will soon be due for renewal:';
  const outro = 'There is nothing you need to do. Tremcore is managing the renewal and will be in touch about the arrangements. You can see the up to date status in your passport at any time.';
  const subject = 'Your renewal is coming up. Tremcore is on it';
  const why = 'You are receiving this because you are the head-office user for ' + rec.company + ' in the Tremcore Passport.';
  const text = [hi, '', intro, '', itemText(items), '', outro, 'Open your passport: ' + siteUrl + '/app/', '', 'Kindest Regards,', 'Tremcore Passport Team', '', '--', COMPANY.name, 'Company number ' + COMPANY.number, COMPANY.email + ' | ' + siteUrl, '', why].join('\n');
  const bodyHtml = '<p style="margin:0 0 18px;">' + esc(hi) + '</p><p style="margin:0 0 18px;">' + esc(intro) + '</p>' + itemTable(items, multi)
    + '<p style="margin:0 0 14px;">' + esc(outro) + '</p>' + button(siteUrl + '/app/', 'Open my passport')
    + '<p style="margin:26px 0 20px;">Kindest Regards,<br><strong>Tremcore Passport Team</strong></p>';
  return { subject, text, html: shell({ title: 'Renewal coming up', bodyHtml, siteUrl, why }) };
}

// rec: { name, company, items:[{title, site, due_date, due_time, all_day, location, priority, minutes}] }. A task alert: one email per person, listing every task whose alert is due.
function taskAlert(rec, siteUrl) {
  const first = firstName(rec.name), hi = first ? 'Hi ' + first + ',' : 'Hi,';
  const items = rec.items, multi = new Set(items.map((i) => i.site)).size > 1;
  const dateText = (i) => { const d = new Date(String(i.due_date).slice(0, 10) + 'T12:00:00Z'); const ds = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }); return ds + (!i.all_day && i.due_time ? ' at ' + String(i.due_time).slice(0, 5) : ' (all day)'); };
  const line = (i) => i.title + ' - ' + dateText(i) + (multi && i.site ? ' - ' + i.site : '') + (i.location ? ' - ' + i.location : '') + (i.priority === 'urgent' ? ' - URGENT' : '');
  const intro = items.length === 1 ? 'This is a reminder for a task at ' + rec.company + ':' : 'These are reminders for tasks at ' + rec.company + ':';
  const outro = 'You can complete, skip or change the task in your passport under My Tasks.';
  const subject = items.length === 1 ? 'Task reminder: ' + items[0].title : 'Task reminders: ' + items.length + ' tasks need your attention';
  const why = 'You are receiving this because you set an alert on a task in the Tremcore Passport for ' + rec.company + '. You can change or remove the alert on the task.';
  const text = [hi, '', intro, '', items.map((i) => '- ' + line(i)).join('\n'), '', outro, 'Open your passport: ' + siteUrl + '/app/', '', 'Kindest Regards,', 'Tremcore Passport Team', '', '--', COMPANY.name, 'Company number ' + COMPANY.number, COMPANY.email + ' | ' + siteUrl, '', why].join('\n');
  const rows = items.map((i) => '<tr><td style="padding:10px 12px;border-bottom:1px solid #e6e0d3;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;"><strong>' + esc(i.title) + '</strong>' + (i.priority === 'urgent' ? ' <span style="color:#b3261e;font-weight:bold;">URGENT</span>' : '') + '<br><span style="color:#555;">' + esc(dateText(i)) + (multi && i.site ? ' &middot; ' + esc(i.site) : '') + (i.location ? ' &middot; ' + esc(i.location) : '') + '</span></td></tr>').join('');
  const bodyHtml = '<p style="margin:0 0 18px;">' + esc(hi) + '</p><p style="margin:0 0 18px;">' + esc(intro) + '</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border:1px solid #e6e0d3;">' + rows + '</table>'
    + '<p style="margin:0 0 14px;">' + esc(outro) + '</p>' + button(siteUrl + '/app/', 'Open my tasks') + '<p style="margin:26px 0 20px;">Kindest Regards,<br><strong>Tremcore Passport Team</strong></p>';
  return { subject, text, html: shell({ title: 'Task reminder', bodyHtml, siteUrl, why }) };
}

module.exports = { complianceReminder, taskAlert, managedNotice, shell, fromLines, interestThanks, welcomeReceipt, paymentFailed, firstName, COMPANY };
