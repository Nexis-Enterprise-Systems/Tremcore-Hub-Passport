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

module.exports = { shell, fromLines, interestThanks, welcomeReceipt, paymentFailed, firstName, COMPANY };
