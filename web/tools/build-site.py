#!/usr/bin/env python3
"""Generates the static website pages in web/public from the copy below.
Run:  python3 web/tools/build-site.py     (the generated pages are committed, so Railway needs no build step)
Placeholders in [SQUARE BRACKETS] must be replaced before launch (see docs/DECISIONS.md)."""
import os
OUT = os.path.join(os.path.dirname(__file__), '..', 'public')
PHONE, EMAIL, HOURS, ADDR, CO = '', 'hello@tremcore.co.uk', '', 'Goldfinch Grove, Rochester, Kent, ME3 8FX', '17507064'
# Phone and opening hours are left out of the pages until they are filled in above (no placeholder text on the live site).
PHONE_P = f'<p>{PHONE}</p>' if PHONE else ''
OR_CALL = f'{OR_CALL}' if PHONE else ''
PHONE_DT = f'<div><dt>Phone</dt><dd>{PHONE}</dd></div>' if PHONE else ''
HOURS_DT = f'<div><dt>Opening hours</dt><dd>{HOURS}</dd></div>' if HOURS else ''
ARROW = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h9M8.5 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
PLAY = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 1.5v11l9-5.5z" fill="currentColor"/></svg>'
LOCK = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5" fill="none" stroke="#d4af55" stroke-width="1.4"/><path d="M5.2 7V5.2a2.8 2.8 0 0 1 5.6 0V7" fill="none" stroke="#d4af55" stroke-width="1.4"/></svg>'
NAV = [('/', 'Home'), ('/passport/', 'The passport'), ('/what-you-get/', 'What you get'), ('/how-it-works/', 'How it works'), ('/contact/', 'Contact')]

SIGNUP = '<a class="btn solid" data-signup href="/app/?signup=1">Sign up</a>'   # shown by site.js only while Tremcore has sign-up switched on

def page(path, title, desc, body, current, noindex=False):
    nav = ''.join('<a href="%s"%s>%s</a>' % (h, ' aria-current="page"' if h == current else '', l) for h, l in NAV)
    foot = ''.join('<a href="%s">%s</a>' % (h, l) for h, l in NAV)
    html = f'''<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{title}</title>
<meta name="description" content="{desc}">
<meta name="theme-color" content="#0c0b09">{'<meta name="robots" content="noindex">' if noindex else ''}
<meta property="og:title" content="{title}"><meta property="og:description" content="{desc}"><meta property="og:type" content="website">
<link rel="icon" href="/img/favicon.png">
<link rel="stylesheet" href="/site.css">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="top"><div class="wrap">
  <a class="brand" href="/" aria-label="Tremcore Ltd home"><img class="mark" src="/img/logo-mark.png" alt="" width="75" height="52"><img class="word" src="/img/logo-word.png" alt="Tremcore" width="158" height="18"></a>
  <nav class="main" id="nav" aria-label="Main">{nav}</nav>
  <div class="hdr-actions"><a class="btn ghost" href="/app/">Login</a><a class="btn solid" data-signup href="/app/?signup=1">Sign up</a><button class="btn ghost menu" type="button" aria-expanded="false" aria-controls="nav">Menu</button></div>
</div></header>
<main id="main">
{body}
</main>
<footer><div class="wrap">
  <div><img src="/img/logo-full.png" alt="Tremcore Ltd" width="150" height="115"><p>Compliance passports for commercial premises.</p></div>
  <nav aria-label="Footer">{foot}<a href="/app/">Login</a></nav>
  <div>{PHONE_P}<p>{EMAIL}</p><p>{ADDR}</p></div>
  <div class="legal"><span>&copy; 2026 Tremcore Ltd. Company number {CO}.</span></div>
</div></footer>
<script src="/site.js"></script>
</body>
</html>
'''
    d = os.path.join(OUT, path.strip('/'))
    os.makedirs(d, exist_ok=True)
    open(os.path.join(d, 'index.html'), 'w').write(html)

def cta(h, p):
    return f'<section class="sec alt"><div class="wrap cta"><h2 class="h2">{h}</h2><p>{p}</p><div class="row">{SIGNUP}<a class="btn ghost" href="/contact/">Ask a question</a>{OR_CALL}</div></div></section>'

ITEMS = [('g','Fire risk assessment','Mar 2027','In date'),('a','Fire alarm service and test','in 12 days','Due in 12d'),('r','Portable appliance testing','4 days ago','Overdue 4d'),('m','Kitchen extract cleaning','Not entered','No date'),('g','Legionella risk assessment','Jan 2027','In date'),('g','Emergency lighting test','Feb 2027','In date')]
items = ''.join(f'<li{" class=fade" if i==5 else ""}><span class="dot {c}"></span><span>{t}</span><span class="lab">{l}</span></li>' for i,(c,t,d,l) in enumerate(ITEMS))
home = f'''<section class="sec hero"><div class="wrap">
<div><div class="eyebrow">Commercial property compliance</div>
<h1 class="h1">Every certificate. Every site. <span class="gold">One calm view.</span></h1>
<p class="lead">Tremcore gives you a single, clear picture of where every property stands: certificates, due dates and reminders, all in one place.</p>
<div class="row" style="margin-top:32px">{SIGNUP}<a class="btn ghost" href="/what-you-get/?play=1#demo">{PLAY} Watch a 20-second preview</a></div>
<p class="small" style="margin-top:24px">Fire safety &middot; Electrical &middot; Water hygiene &middot; Building services &middot; and more</p></div>
<div class="card pass" role="img" aria-label="Sample compliance passport: 80 percent compliant"><div class="pass-head"><img src="/img/logo-mark.png" alt="" width="55" height="38"><div><div class="t">Compliance Passport</div><div class="n">Northgate House</div></div><span class="badge" style="margin-left:auto">Sample property</span></div>
<div class="pass-body"><div class="donut" data-donut><div class="in"><b>80%</b><span>compliant</span></div></div>
<div class="legend"><div><span class="dot g"></span>In date<span class="n mono">11</span></div><div><span class="dot a"></span>Due soon<span class="n mono">5</span></div><div><span class="dot r"></span>Overdue<span class="n mono">2</span></div><div><span class="dot m"></span>No date<span class="n mono">2</span></div></div></div>
<ul class="items">{items}</ul><p class="small" style="margin:12px 0 0">Sample data. The rest is inside the app.</p></div></div></section>
<div class="strip"><div class="wrap"><div><b>Clear at a glance</b><p>Green, amber and red tell you where to look first.</p></div><div><b>Yours to run</b><p>Your records, your dates, your reminders.</p></div><div><b>Honest about gaps</b><p>Missing information is never dressed up as compliant.</p></div><div><b>Phone, tablet or desktop</b><p>Built to work wherever you are.</p></div></div></div>
<section class="sec"><div class="wrap"><div class="eyebrow">Sound familiar?</div><h2 class="h2">Compliance has a way of getting scattered</h2>
<div class="grid3"><div class="tile"><span class="rule"></span><div class="h3">Certificates in inboxes</div><p>The current fire alarm certificate is somewhere in an email from last spring, or with the contractor who issued it.</p></div><div class="tile"><span class="rule"></span><div class="h3">Dates in someone&rsquo;s head</div><p>Renewals depend on whoever remembers them, until that person is busy, away or moves on.</p></div><div class="tile"><span class="rule"></span><div class="h3">No clear picture</div><p>Nobody can say, in one look, what is in date across every site and what needs attention.</p></div></div>
<p class="lead">The Compliance Passport brings it back together, one property at a time.</p></div></section>
<section class="sec alt"><div class="wrap"><div class="eyebrow">The Compliance Passport</div><h2 class="h2">Your premises, in your hands</h2><p class="lead">Keep your own certificates, due dates and reminders in one place, and know at a glance what needs attention.</p>
<div class="grid3"><a class="tile" href="/passport/"><span class="rule"></span><div class="h3">Your records</div><p>Certificates and due dates, always to hand.</p><span class="more">Explore {ARROW}</span></a><a class="tile" href="/passport/"><span class="rule"></span><div class="h3">Your reminders</div><p>A nudge before anything lapses.</p><span class="more">Explore {ARROW}</span></a><a class="tile" href="/passport/"><span class="rule"></span><div class="h3">Your building</div><p>Your premises mapped out, floor by floor.</p><span class="more">Explore {ARROW}</span></a></div></div></section>
<section class="sec"><div class="wrap"><div class="eyebrow">Inside the app</div><h2 class="h2">There&rsquo;s a lot more behind the passport</h2><p class="lead">What you&rsquo;ve seen here is the surface. Sign up and you can explore the rest yourself, around the premises you look after.</p>
<div class="grid3">''' + ''.join(f'<div class="locked">{LOCK}<div><b>{a}</b><p>{b}</p></div></div>' for a,b in [('Your whole estate at a glance','See how several sites roll up into one picture.'),('What matters most','Every check labelled, so you know where the law ends and good practice begins.'),('Reminders that find you','How a due date reaches the right person in time.'),('Your building, mapped','Your premises, floor by floor, with the safety points marked.'),('Your records, protected','Who sees what, and how it&rsquo;s kept private.'),('Made around you','Add the checks that are specific to your premises.')]) + '</div></div></section>' + cta('Ready to get your premises in order?','Sign up, add your first site and start adding your certificates.')

def cat(t, p, lis):
    ul = '<ul>' + ''.join(f'<li>{x}</li>' for x in lis) + '</ul>' if lis else ''
    return f'<div class="tile"><span class="rule"></span><div class="h3">{t}</div><p>{p}</p>{ul}</div>'
plan_svg = '<svg viewBox="0 0 320 200" aria-hidden="true"><rect x="20" y="20" width="280" height="160" fill="none" stroke="#e7e0cf" stroke-width="6"/><path d="M170 20v90M20 110h150M230 110v70" stroke="#e7e0cf" stroke-width="5" fill="none"/><circle cx="70" cy="60" r="8" fill="#f0545a"/><circle cx="210" cy="60" r="8" fill="#3dbb76"/><circle cx="110" cy="150" r="8" fill="#f2902f"/><circle cx="260" cy="145" r="8" fill="#3dbb76"/></svg>'
passport = f'''<section class="sec"><div class="wrap"><div class="eyebrow">What it covers</div><h2 class="h2">The checks that keep a building safe, in one place</h2><p class="lead">Each property&rsquo;s passport holds the checks that apply to it, and you can add your own for anything particular to your premises.</p>
<div class="grid3">''' + cat('Fire safety','Assessments, alarms, lighting and equipment.',['Fire risk assessments','Fire alarm servicing','Emergency lighting','and more']) + cat('Electrical','Installation and equipment testing.',['Installation condition reports','Portable appliance testing','and more']) + cat('Water hygiene','Keeping water systems safe.',['Legionella risk assessments','Temperature monitoring','and more']) + cat('Building and services','The wider fabric and plant.',['Asbestos management','Gas and heating','Air conditioning','and more']) + cat('Made for your premises','Add a title for anything specific to you, from kitchen extract cleaning to a particular piece of equipment.',[]) + f'''</div>
<p class="small" style="margin-top:28px;max-width:70ch">These are examples. Which checks apply, and how often, depends on the premises, the equipment, current legislation and guidance, and your risk assessment. Nothing here is legal advice.</p></div></section>
<section class="sec alt"><div class="wrap"><div class="grid2" style="align-items:center"><div><div class="eyebrow">Traffic lights</div><h2 class="h2">See where you stand in a second</h2><p class="lead">Every check has a due date and a colour. If a date hasn&rsquo;t been recorded, the passport says so rather than showing green.</p>
<div class="lights"><div><span class="dot g"></span><span><b>In date.</b> More than 30 days to go.</span></div><div><span class="dot a"></span><span><b>Due soon.</b> Due within 30 days.</span></div><div><span class="dot r"></span><span><b>Overdue.</b> Past the due date.</span></div><div><span class="dot m"></span><span><b>No date.</b> Never shown as green.</span></div></div></div>
<div class="card"><div class="bar" aria-hidden="true"></div><div style="margin-top:20px"><b>Your score, across every site</b><p style="color:var(--mute);margin:6px 0 14px">We&rsquo;ll show you how your own properties would look.</p>{SIGNUP}</div></div></div></div></section>
<section class="sec"><div class="wrap"><div class="grid2" style="align-items:center"><div><div class="eyebrow">Site plans</div><h2 class="h2">See your building, not just your records</h2><p class="lead">Your premises mapped out floor by floor, with the things that matter to your safety marked where they actually are.</p><div style="margin-top:24px">{SIGNUP}</div></div>
<div class="plan">{plan_svg}<div class="cap"><b>Floor by floor. Seen in 3D.</b><span>The rest is inside the app.</span></div></div></div></div></section>
<section class="sec alt"><div class="wrap"><div class="eyebrow">Privacy and control</div><h2 class="h2">Your records stay yours</h2><div class="grid2">''' + ''.join(f'<div class="tile"><span class="rule"></span><div class="h3">{a}</div><p>{b}</p></div>' for a,b in [('Only your company&rsquo;s records','Each client sees their own properties and records, and nothing belonging to anyone else.'),('Rules enforced by the system','What each person can see and do is controlled by the system itself, not just hidden on screen.'),('Private document storage','Certificates, documents and uploaded photos are stored privately.'),('A record of changes','Changes to compliance records are logged, so there is always a clear trail.')]) + '</div></div></section>' + cta('Ready to see your own sites scored?','Sign up and add your first site. It takes a few minutes.')

def faq(q, a): return f'<details><summary><span>{q}</span><span class="plus" aria-hidden="true">+</span></summary><p>{a}</p></details>'
rows = ''.join(f'<div class="drow"><span class="dot {c}"></span><span>{t}</span><span class="lab">{l}</span></div>' for c,t,l in [('g','Fire risk assessment','In date'),('a','Fire alarm service and test','Due in 12d'),('r','Portable appliance testing','Overdue 4d'),('m','Kitchen extract cleaning','No date'),('g','Legionella risk assessment','In date')])
demo = f'''<div class="demo-head"><div><div class="eyebrow">See it in action</div><h2 class="h2">A 20-second taste</h2></div><button class="btn ghost" id="d-pop" type="button">Pop out</button></div>
<div class="demo" id="demo-player"><div class="popbar"><span class="eyebrow" style="margin:0">Walkthrough</span><button class="btn ghost" id="d-close" type="button">Close</button></div>
<div class="screen"><div class="top"><img src="/img/logo-mark.png" alt="" width="44" height="30"><span class="badge">Sample property</span></div>
<div class="scene on"><div style="display:flex;gap:22px;align-items:center;flex-wrap:wrap"><div class="donut" id="d-donut"><div class="in"><b><span id="d-pct" style="font-size:inherit;color:inherit;text-transform:none;letter-spacing:0">80</span>%</b><span>compliant</span></div></div><div style="flex:1;min-width:220px">{rows}</div></div></div>
<div class="scene"><div class="up"><div style="font-weight:700;margin-bottom:10px">Your Compliance Passport</div><div class="drow"><span>Fire alarm service and test</span><span class="lab"><span class="pill a" id="u-pill">Due in 12d</span></span></div>
<div class="box hid" id="u-file"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 1.5h6l3 3v10h-9z M9.5 1.5v3h3" fill="none" stroke="#d4af55" stroke-width="1.4" stroke-linejoin="round"/></svg><span>fire-alarm-certificate.pdf</span></div>
<div class="drow hid" id="u-date"><span>New due date</span><span class="lab" id="u-datetxt"></span></div><div class="done hid" id="u-done">Saved to your passport</div></div></div>
<div class="scene"><div class="note" id="n-card"><div class="nh"><img src="/img/logo-mark.png" alt="" width="32" height="22"><span>Tremcore</span><span style="margin-left:auto">now</span></div><b>Reminder: Fire extinguisher service is due in 30 days</b><span style="color:var(--mute);font-size:14px">Book your inspection and upload the new certificate when you have it.</span></div></div>
<div class="scene"><div class="end"><img src="/img/logo-mark.png" alt="" width="84" height="58"><div class="h3">There is more to see</div><p style="color:var(--mute)">Book a walkthrough and we will show you the rest.</p></div></div>
<div class="poster" hidden><img src="/img/logo-mark.png" alt="" width="84" height="58"><div class="eyebrow" style="margin:0">Compliance Passport</div><button class="play" type="button" aria-label="Play the demo"><svg width="26" height="26" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 1.5v11l9-5.5z" fill="#16110a"/></svg></button><div class="small">20 seconds. No sound.</div></div></div>
<div class="cap2" id="d-cap" aria-live="polite"><b>Your dashboard</b><span>Every property in one traffic-light view.</span></div>
<div class="ctl"><button class="btn solid" id="d-toggle" type="button">{PLAY}<span>Play</span></button><div class="prog" id="d-prog" role="progressbar" aria-label="Demo progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i id="d-bar"></i></div><span class="small mono" id="d-time">0:00 / 0:20</span></div>
<div class="chap" role="group" aria-label="Jump to a part of the demo"><button type="button" aria-pressed="true">Dashboard</button><button type="button" aria-pressed="false">Certificate</button><button type="button" aria-pressed="false">Reminders</button><button type="button" aria-pressed="false">More</button></div>
<p class="small" style="margin:16px 0 0">A short animated preview with sample data. There is a lot more behind it, and training videos are on the way.</p></div>'''
SHOW_MANAGED = False   # Managed Service is not offered on the public website for now (8 Nov 2026). Set True to bring the card, postcode check and form option back.
managed_html = '''<article class="plan-card" id="managed"><div class="eyebrow">The Compliance Passport</div><h3 class="h3" style="font-size:36px">Managed Service</h3><p style="color:var(--mute)">We look after it for you. Tremcore keeps your records and renewals up to date, and you simply see where you stand.</p>
<ul><li>Everything in Self-Managed, view-only for you</li><li>Tremcore maintains your dates, certificates and renewals</li><li>Reminders that tell you we are arranging it</li><li>A Call Tremcore button whenever you need help</li></ul>
<div class="quote"><b>Available near Medway.</b> We only offer the Managed Service within 30 miles of Medway, so we can be on site when needed.
<form class="row" id="area-check" novalidate style="margin-top:16px;align-items:flex-end"><div style="flex:1;min-width:180px"><label class="lbl" for="area-pc">Your premises postcode</label><input class="fld" id="area-pc" name="postcode" type="text" autocomplete="postal-code" inputmode="text" maxlength="9" placeholder="e.g. ME4 4TL"></div><button class="btn ghost" id="area-go" type="submit">Check my postcode</button></form>
<div id="area-out" role="status" style="margin-top:12px"></div>
<div class="row" style="margin-top:16px"><a class="btn solid" id="area-ask" hidden href="/contact/?package=2">Ask about Managed Service</a></div></div></article>
'''
row_open = '<div class="plan-row">' if SHOW_MANAGED else ''
row_close = '</div>' if SHOW_MANAGED else ''
what = f'''<section class="sec"><div class="wrap"><div class="center-head"><div class="eyebrow">What you get</div><h2 class="h2">One passport, quoted to suit your premises</h2><p class="lead">Tell us about your sites and we&rsquo;ll put together a quote that fits.</p></div>
{row_open}<article class="plan-card"><div class="eyebrow">The Compliance Passport</div><h3 class="h3" style="font-size:36px">Self-Managed</h3><p style="color:var(--mute)">For businesses that want to keep their own records and arrange their own inspections.</p>
<ul><li>Your own digital compliance passport</li><li>Traffic-light view of every property</li><li>Reminders before anything lapses</li><li>Upload and keep your certificates safe</li><li>Add your own checks for your premises</li><li>A Call Tremcore button whenever you need help</li></ul>
<div class="quote">Tailored to your premises. Ask for a quote.<div class="row" style="margin-top:16px">{SIGNUP}<a class="btn ghost" href="#demo-player">{PLAY} Watch the preview</a><a class="btn ghost" href="/contact/?package=1">Ask a question</a></div></div></article>
{managed_html if SHOW_MANAGED else ""}{row_close}<div id="demo">{demo}</div></div></section>''' + cta('Want to see it around your premises?','Tell us about your premises and we&rsquo;ll show you how it would work.')
how = f'''<section class="sec"><div class="wrap"><div class="eyebrow">How it works</div><h2 class="h2">Simple to start. Easy to live with.</h2>
<ol class="steps"><li><span class="no">01</span><div class="h3">Sign up</div><p>Create your account and add your first site. It takes a few minutes.</p></li><li><span class="no">02</span><div class="h3">Add your records</div><p>Upload certificates, enter due dates and add the checks specific to your premises. Each site has its own passport, ready on your phone or computer.</p></li><li><span class="no">03</span><div class="h3">Stay on top of it</div><p>Keep your records up to date and watch the colours stay green.</p></li></ol></div></section>
<section class="sec alt" id="faq"><div class="wrap"><div class="eyebrow">Questions</div><h2 class="h2">Before you ask</h2><p class="lead">Something not covered here? Get in touch and we will answer it.</p><div class="faq">''' + ''.join(faq(q,a) for q,a in [
('Is every check on the list a legal requirement?','No. The list shows common checks for commercial premises. What applies to your property, and how often, depends on the premises, the equipment, current legislation and guidance, and your risk assessment. If you are unsure, ask us.'),
('Can I keep using my own contractors?','Yes. You stay in control. You choose your own contractors and record the results in your passport.'),
('What happens if a date or certificate is missing?','The check shows as &ldquo;No date&rdquo; instead of green, and it counts as not compliant in your percentage. Nothing is hidden to make a site look better than it is.'),
('Can I manage more than one property?','Yes. Several sites can sit under one company, and each property keeps its own passport and records.'),
('Does it work on a phone?','Yes. It is designed to work on phones, tablets and computers.'),
('Can I see it before I decide?','Watch the short preview on this site. The passport is simple to use, and we are adding short training videos so you can learn it at your own pace. If you have a question first, ask us.'),
('How much does it cost?','&pound;14.99 a month for your first site, which includes a head-office user and one manager, and &pound;7.99 a month for each extra site, which includes one more user. Pay yearly and save 15%. Prices exclude VAT.')]) + '</div></div></section>' + cta('Have a question we haven&rsquo;t answered?','Send us a message and we will get back to you.')
contact = f'''<section class="sec"><div class="wrap contact"><div><div class="eyebrow">Contact us</div><h2 class="h2">Ask us a question</h2><p class="lead">Tell us a little about your properties and which package interests you. We&rsquo;ll get back to you to arrange a time for a walkthrough.</p>
<dl class="cd">{PHONE_DT}<div><dt>Email</dt><dd>{EMAIL}</dd></div><div><dt>Address</dt><dd>{ADDR}</dd></div>{HOURS_DT}</dl></div>
<form class="f card" id="enquiry" method="post" action="/api/enquiry"><div class="two"><div><label class="lbl" for="f-name">Your name</label><input class="fld" id="f-name" name="name" type="text" autocomplete="name" required maxlength="120"></div><div><label class="lbl" for="f-company">Company</label><input class="fld" id="f-company" name="company" type="text" autocomplete="organization" maxlength="160"></div></div>
<div class="two"><div><label class="lbl" for="f-email">Email</label><input class="fld" id="f-email" name="email" type="email" autocomplete="email" required maxlength="200"></div><div><label class="lbl" for="f-phone">Phone</label><input class="fld" id="f-phone" name="phone" type="tel" autocomplete="tel" maxlength="40"></div></div>
<div class="two"><div><label class="lbl" for="f-sites">Number of properties</label><select class="fld" id="f-sites" name="sites"><option value="1">1</option><option value="2-5">2 to 5</option><option value="6-20">6 to 20</option><option value="20+">More than 20</option></select></div><div><label class="lbl" for="f-pkg">Package</label><select class="fld" id="f-pkg" name="package"><option value="">Not sure yet</option><option value="1">Self-Managed</option>''' + ('<option value="2">Managed Service (near Medway)</option>' if SHOW_MANAGED else '') + '''</select></div></div>
<div><label class="lbl" for="f-msg">What would you most like to see?</label><textarea class="fld" id="f-msg" name="message" rows="4" maxlength="2000"></textarea></div>
<div class="hp" aria-hidden="true"><label>Leave this empty <input name="website" type="text" tabindex="-1" autocomplete="off"></label></div>
<button class="btn solid" id="f-go" type="submit">Send my question</button><div id="f-out" role="status"></div>
<p class="small" style="margin:0">We only use your details to reply to this enquiry.</p></form></div></section>'''


DRAFT = '<div class="quote" role="note"><b>Draft for review.</b> This page is a working draft and has not been checked by a solicitor. It is not in force until Tremcore Ltd has reviewed and finalised it. Items in [SQUARE BRACKETS] are still to be completed.</div>'
privacy = f'''<section class="sec"><div class="wrap narrow"><div class="eyebrow">Privacy notice</div><h1 class="h2">How Tremcore uses your information</h1>{DRAFT}
<h3>Who we are</h3><p>Tremcore Ltd, company number {CO}, {ADDR}. Questions about your information: {EMAIL}. [ICO REGISTRATION NUMBER TO BE ADDED.]</p>
<h3>Two roles: your data and our own</h3>
<p><b>Your records are yours.</b> The compliance records, dates, notes, certificates, photographs, site details and the names of your own colleagues that you put into the passport belong to your company. For that information your company is the <i>controller</i> and Tremcore is your <i>processor</i>: we only handle it to run the service for you, on your instructions, as set out in our <a href="/terms/">Terms</a> and the data processing terms within them.</p>
<p>For our own account, billing and sales information (who you are, how to contact you, what you pay) Tremcore is the controller.</p>
<h3>What we collect</h3><p>When you enquire or create an account: your name, work email, phone number (if you give one), business name and the names and addresses of your sites. When you use the passport: the records, certificates and photographs you add, a record of changes made to them, and basic security information such as sign-in times. When you pay: payment details are collected and held by our payment provider, not by us .</p>
<h3>Why we use it</h3><p>To run your account and passport (to carry out our contract with you), to send reminders and service messages, to take payment and keep financial records (to meet our legal obligations), to protect the service (our legitimate interest in keeping it secure and fair), and to answer your enquiries. [LEGAL BASES TO BE CONFIRMED BY SOLICITOR.]</p>
<h3>We do not share or sell your data</h3><p>We do not sell your data, use it for advertising, or show it to other customers. Each company can only see its own records; this is enforced by the database itself. Tremcore staff only look at your records to support you. We only use a small number of service providers, strictly to run the service, under written contracts: hosting and database (Supabase), web hosting (Railway), email delivery ([EMAIL PROVIDER]) and payments ([STRIPE]). Where a provider is outside the UK we rely on approved transfer safeguards. [PROVIDERS, LOCATIONS AND SAFEGUARDS TO BE CONFIRMED.]</p>
<h3>How long we keep it</h3><p>While your account is open we keep your records. If you cancel, you can use the service until your notice ends; after that you can no longer sign in and your records, documents and photographs are permanently deleted shortly afterwards (within [14] days), except copies in secure backups, which expire on their normal cycle [BACKUP PERIOD TO BE CONFIRMED]. Billing records are kept for [6] years because the law requires it. Enquiries that do not become customers are deleted after [12] months.</p>
<h3>Getting a copy of your data</h3><p>Before your notice ends you can ask us for a copy of your records in a common format, free of charge. [EXPORT FEATURE TO BE BUILT.]</p>
<h3>Security</h3><p>Records are held in private storage. Access is checked by the database for every request, head-office users must use 2FA, and changes to records are logged.</p>
<h3>Your rights</h3><p>You can ask to see, correct or delete your information, restrict or object to how we use it, or ask for it to be moved, by contacting {EMAIL}. If your records are about people at your company or sites, we will pass requests about them to you as the controller. You can also complain to the Information Commissioner&rsquo;s Office (ico.org.uk).</p>
</div></section>'''
terms = f'''<section class="sec"><div class="wrap narrow"><div class="eyebrow">Terms of use</div><h1 class="h2">Terms for the Self-Managed Compliance Passport</h1>{DRAFT}
<p class="small">These terms are for businesses. By creating an account you confirm you are signing up for a business and that you are allowed to bind it to these terms.</p>
<h3>1. What the service is</h3><p>The Compliance Passport is a record-keeping tool. It helps you store certificates, track due dates and receive reminders. It does not carry out inspections, and nothing in it is legal, health and safety or fire-safety advice.</p>
<h3>2. Your responsibilities</h3><p>You are responsible for deciding which checks apply to your premises, arranging them, keeping your records accurate and up to date, and for the compliance of your premises. The checks and labels shown are examples and must be confirmed for your own premises and risk assessment. Reminders are a help, not a guarantee: please do not rely on them alone.</p>
<h3>3. Your account</h3><p>Keep your sign-in details and your authenticator app secure. 2FA is required for head-office users. Tell us straight away if you think someone else has access. You are responsible for what people you add to your account do with it.</p>
<h3>4. Signing up</h3><p>There is no free trial. You sign up and pay, and your account opens as soon as the payment is confirmed. We do not store your card details: payments are handled by our payment provider.</p>
<h3>5. Price and payment</h3><p>The price is &pound;14.99 a month for your first location and &pound;7.99 a month for each extra location, plus VAT. If you choose to pay yearly you get 15% off, paid in advance. [PRICES AND VAT TO BE CONFIRMED.] You choose monthly or yearly when you sign up. Payments are taken automatically by our payment provider on the same date each month (or year). Your first site includes a head-office user and one manager; each extra site includes one more user. Your subscription continues until you cancel. We will give you at least [30] days&rsquo; written notice before any price rise.</p>
<h3>6. If a payment fails</h3><p>We will tell the head-office user in the app and by email. If the payment is not made within 7 days, your account will be put on stop: nobody at your company will be able to open or see anything until the payment is made. Your data is not deleted just because of a failed payment, and the account opens again as soon as you pay what is owed. [HOW LONG A STOPPED ACCOUNT IS KEPT BEFORE CLOSURE TO BE CONFIRMED.]</p>
<h3>7. Cancelling</h3><p><b>Monthly plans:</b> you can cancel at any time by giving us one month&rsquo;s notice, using the Cancel button in the app or by writing to us. You keep full access and pay as normal until the notice ends.</p><p><b>Yearly plans (paid in advance):</b> you can cancel at any time. The amount you have paid for the year is non-refundable, and you keep access until the end of the year you paid for (or the end of one month&rsquo;s notice if later). [SOLICITOR TO CONFIRM THIS WORDING.]</p>
<p><b>When the notice ends:</b> you will no longer be able to sign in, and your records, documents and photographs will be permanently deleted shortly afterwards. Please save anything you need before then; ask us if you would like a copy of your data. Nothing is kept for any other use.</p>
<h3>8. Your data is your data</h3><p>All the records, documents and photographs you put in the passport belong to you. We use them only to provide the service to you. We do not sell them, share them with other customers or use them for marketing. Our service providers only handle them to run the service, under contract. How we handle personal data is set out in our <a href="/privacy/">Privacy notice</a>.</p>
<h3>9. Data protection</h3><p>For personal data in your records you are the controller and we are your processor. We will: only use it on your instructions; keep it confidential and secure; only use approved sub-processors and tell you if they change; help you respond to people exercising their rights; tell you without undue delay if we find a personal data breach; delete it when the service ends (see 7); and let you check we are doing this. The detail is in a separate data processing agreement. [DPA TO BE DRAFTED BY SOLICITOR.]</p>
<h3>10. Acceptable use</h3><p>Do not misuse the service, try to access other companies&rsquo; information, or upload unlawful or harmful material. We may suspend an account that does.</p>
<h3>11. Availability</h3><p>We work to keep the service running but cannot promise it will always be available or error-free. We will tell you in advance where we can about planned downtime.</p>
<h3>12. Our liability</h3><p>[TO BE COMPLETED WITH LEGAL ADVICE: limits on liability, which must be reasonable for a business contract, and what we do not exclude, such as death or personal injury caused by our negligence and fraud.]</p>
<h3>13. Changes and law</h3><p>We may update these terms and will tell you in advance of any material change. These terms are governed by the law of England and Wales. [GOVERNING LAW AND COURTS TO BE CONFIRMED.]</p>
</div></section>'''

page('/', 'Tremcore | Compliance passports for commercial premises', 'One clear view of every certificate, due date and reminder across your commercial properties.', home, '/')
page('/passport/', 'The passport | Tremcore', 'The checks that keep a building safe, with traffic lights and reminders, in one place.', passport, '/passport/')
page('/what-you-get/', 'What you get | Tremcore', 'The Self-Managed Compliance Passport, quoted to suit your premises.', what, '/what-you-get/')
page('/how-it-works/', 'How it works | Tremcore', 'Simple to start, easy to live with. Common questions answered.', how, '/how-it-works/')
page('/contact/', 'Contact us | Tremcore', 'Ask us a question about the Compliance Passport.', contact, '/contact/')
print('built 5 pages')
page('/privacy/', 'Privacy notice (draft) | Tremcore', 'How Tremcore uses your information.', privacy, '/privacy/', noindex=True)
page('/terms/', 'Terms of use (draft) | Tremcore', 'Terms for the Self-Managed Compliance Passport.', terms, '/terms/', noindex=True)
