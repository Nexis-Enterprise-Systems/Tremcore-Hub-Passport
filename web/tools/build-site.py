#!/usr/bin/env python3
"""Generates the static website pages in web/public from the copy below.
Run:  python3 web/tools/build-site.py     (the generated pages are committed, so Railway needs no build step)
Placeholders in [SQUARE BRACKETS] must be replaced before launch (see docs/DECISIONS.md)."""
import os
OUT = os.path.join(os.path.dirname(__file__), '..', 'public')
PHONE, EMAIL, HOURS, ADDR, CO = '[YOUR PHONE NUMBER]', '[YOUR EMAIL ADDRESS]', '[YOUR OPENING HOURS]', '[REGISTERED OFFICE ADDRESS]', '[COMPANY NUMBER]'
ARROW = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h9M8.5 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
PLAY = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 1.5v11l9-5.5z" fill="currentColor"/></svg>'
LOCK = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5" fill="none" stroke="#d4af55" stroke-width="1.4"/><path d="M5.2 7V5.2a2.8 2.8 0 0 1 5.6 0V7" fill="none" stroke="#d4af55" stroke-width="1.4"/></svg>'
NAV = [('/', 'Home'), ('/passport/', 'The passport'), ('/what-you-get/', 'What you get'), ('/how-it-works/', 'How it works'), ('/contact/', 'Contact')]

SIGNUP = '<a class="btn solid" data-signup hidden href="/app/?signup=1">Sign up</a>'   # shown by site.js only while Tremcore has sign-up switched on

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
  <div class="hdr-actions"><a class="btn ghost" href="/app/">Login</a><a class="btn solid" href="/contact/">Book a demo</a><button class="btn ghost menu" type="button" aria-expanded="false" aria-controls="nav">Menu</button></div>
</div></header>
<main id="main">
{body}
</main>
<footer><div class="wrap">
  <div><img src="/img/logo-full.png" alt="Tremcore Ltd" width="150" height="115"><p>Compliance passports for commercial premises.</p></div>
  <nav aria-label="Footer">{foot}<a href="/app/">Login</a></nav>
  <div><p>{PHONE}</p><p>{EMAIL}</p><p>{ADDR}</p></div>
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
    return f'<section class="sec alt"><div class="wrap cta"><h2 class="h2">{h}</h2><p>{p}</p><div class="row"><a class="btn solid" href="/contact/">Book a demo {ARROW}</a>{SIGNUP}<span class="small">or call {PHONE}</span></div></div></section>'

ITEMS = [('g','Fire risk assessment','Mar 2027','In date'),('a','Fire alarm service and test','in 12 days','Due in 12d'),('r','Portable appliance testing','4 days ago','Overdue 4d'),('m','Kitchen extract cleaning','Not entered','No date'),('g','Legionella risk assessment','Jan 2027','In date'),('g','Emergency lighting test','Feb 2027','In date')]
items = ''.join(f'<li{" class=fade" if i==5 else ""}><span class="dot {c}"></span><span>{t}</span><span class="lab">{l}</span></li>' for i,(c,t,d,l) in enumerate(ITEMS))
home = f'''<section class="sec hero"><div class="wrap">
<div><div class="eyebrow">Commercial property compliance</div>
<h1 class="h1">Every certificate. Every site. <span class="gold">One calm view.</span></h1>
<p class="lead">Tremcore gives you a single, clear picture of where every property stands: certificates, due dates and reminders, all in one place.</p>
<div class="row" style="margin-top:32px"><a class="btn solid" href="/contact/">Book a demo {ARROW}</a><a class="btn ghost" href="/what-you-get/?play=1#demo">{PLAY} Watch a 20-second preview</a></div>
<p class="small" style="margin-top:24px">Fire safety &middot; Electrical &middot; Water hygiene &middot; Building services &middot; and more</p></div>
<div class="card pass" role="img" aria-label="Sample compliance passport: 80 percent compliant"><div class="pass-head"><img src="/img/logo-mark.png" alt="" width="55" height="38"><div><div class="t">Compliance Passport</div><div class="n">Northgate House</div></div><span class="badge" style="margin-left:auto">Sample property</span></div>
<div class="pass-body"><div class="donut" data-donut><div class="in"><b>80%</b><span>compliant</span></div></div>
<div class="legend"><div><span class="dot g"></span>In date<span class="n mono">11</span></div><div><span class="dot a"></span>Due soon<span class="n mono">5</span></div><div><span class="dot r"></span>Overdue<span class="n mono">2</span></div><div><span class="dot m"></span>No date<span class="n mono">2</span></div></div></div>
<ul class="items">{items}</ul><p class="small" style="margin:12px 0 0">Sample data. The rest is on your demo.</p></div></div></section>
<div class="strip"><div class="wrap"><div><b>Clear at a glance</b><p>Green, amber and red tell you where to look first.</p></div><div><b>Yours to run</b><p>Your records, your dates, your reminders.</p></div><div><b>Honest about gaps</b><p>Missing information is never dressed up as compliant.</p></div><div><b>Phone, tablet or desktop</b><p>Built to work wherever you are.</p></div></div></div>
<section class="sec"><div class="wrap"><div class="eyebrow">Sound familiar?</div><h2 class="h2">Compliance has a way of getting scattered</h2>
<div class="grid3"><div class="tile"><span class="rule"></span><div class="h3">Certificates in inboxes</div><p>The current fire alarm certificate is somewhere in an email from last spring, or with the contractor who issued it.</p></div><div class="tile"><span class="rule"></span><div class="h3">Dates in someone&rsquo;s head</div><p>Renewals depend on whoever remembers them, until that person is busy, away or moves on.</p></div><div class="tile"><span class="rule"></span><div class="h3">No clear picture</div><p>Nobody can say, in one look, what is in date across every site and what needs attention.</p></div></div>
<p class="lead">The Compliance Passport brings it back together, one property at a time.</p></div></section>
<section class="sec alt"><div class="wrap"><div class="eyebrow">The Compliance Passport</div><h2 class="h2">Your premises, in your hands</h2><p class="lead">Keep your own certificates, due dates and reminders in one place, and know at a glance what needs attention.</p>
<div class="grid3"><a class="tile" href="/passport/"><span class="rule"></span><div class="h3">Your records</div><p>Certificates and due dates, always to hand.</p><span class="more">Explore {ARROW}</span></a><a class="tile" href="/passport/"><span class="rule"></span><div class="h3">Your reminders</div><p>A nudge before anything lapses.</p><span class="more">Explore {ARROW}</span></a><a class="tile" href="/passport/"><span class="rule"></span><div class="h3">Your building</div><p>Your premises mapped out, floor by floor.</p><span class="more">Explore {ARROW}</span></a></div></div></section>
<section class="sec"><div class="wrap"><div class="eyebrow">On your demo</div><h2 class="h2">There&rsquo;s a lot more behind the passport</h2><p class="lead">What you&rsquo;ve seen here is the surface. On a short call we&rsquo;ll walk you through the rest, around the kind of premises you look after.</p>
<div class="grid3">''' + ''.join(f'<div class="locked">{LOCK}<div><b>{a}</b><p>{b}</p></div></div>' for a,b in [('Your whole estate at a glance','See how several sites roll up into one picture.'),('What matters most','Every check labelled, so you know where the law ends and good practice begins.'),('Reminders that find you','How a due date reaches the right person in time.'),('Your building, mapped','Your premises, floor by floor, with the safety points marked.'),('Your records, protected','Who sees what, and how it&rsquo;s kept private.'),('Made around you','Add the checks that are specific to your premises.')]) + '</div></div></section>' + cta('Ready to see it around your premises?','A short call is all it takes. We&rsquo;ll show you the parts this page only hints at.')

def cat(t, p, lis):
    ul = '<ul>' + ''.join(f'<li>{x}</li>' for x in lis) + '</ul>' if lis else ''
    return f'<div class="tile"><span class="rule"></span><div class="h3">{t}</div><p>{p}</p>{ul}</div>'
plan_svg = '<svg viewBox="0 0 320 200" aria-hidden="true"><rect x="20" y="20" width="280" height="160" fill="none" stroke="#e7e0cf" stroke-width="6"/><path d="M170 20v90M20 110h150M230 110v70" stroke="#e7e0cf" stroke-width="5" fill="none"/><circle cx="70" cy="60" r="8" fill="#f0545a"/><circle cx="210" cy="60" r="8" fill="#3dbb76"/><circle cx="110" cy="150" r="8" fill="#f2902f"/><circle cx="260" cy="145" r="8" fill="#3dbb76"/></svg>'
passport = f'''<section class="sec"><div class="wrap"><div class="eyebrow">What it covers</div><h2 class="h2">The checks that keep a building safe, in one place</h2><p class="lead">Each property&rsquo;s passport holds the checks that apply to it, and you can add your own for anything particular to your premises.</p>
<div class="grid3">''' + cat('Fire safety','Assessments, alarms, lighting and equipment.',['Fire risk assessments','Fire alarm servicing','Emergency lighting','and more']) + cat('Electrical','Installation and equipment testing.',['Installation condition reports','Portable appliance testing','and more']) + cat('Water hygiene','Keeping water systems safe.',['Legionella risk assessments','Temperature monitoring','and more']) + cat('Building and services','The wider fabric and plant.',['Asbestos management','Gas and heating','Air conditioning','and more']) + cat('Made for your premises','Add a title for anything specific to you, from kitchen extract cleaning to a particular piece of equipment.',[]) + f'''</div>
<p class="small" style="margin-top:28px;max-width:70ch">These are examples. Which checks apply, and how often, depends on the premises, the equipment, current legislation and guidance, and your risk assessment. Nothing here is legal advice.</p></div></section>
<section class="sec alt"><div class="wrap"><div class="grid2" style="align-items:center"><div><div class="eyebrow">Traffic lights</div><h2 class="h2">See where you stand in a second</h2><p class="lead">Every check has a due date and a colour. If a date hasn&rsquo;t been recorded, the passport says so rather than showing green.</p>
<div class="lights"><div><span class="dot g"></span><span><b>In date.</b> More than 30 days to go.</span></div><div><span class="dot a"></span><span><b>Due soon.</b> Due within 30 days.</span></div><div><span class="dot r"></span><span><b>Overdue.</b> Past the due date.</span></div><div><span class="dot m"></span><span><b>No date.</b> Never shown as green.</span></div></div></div>
<div class="card"><div class="bar" aria-hidden="true"></div><div style="margin-top:20px"><b>Your score, across every site</b><p style="color:var(--mute);margin:6px 0 14px">We&rsquo;ll show you how your own properties would look.</p><a class="btn ghost" href="/contact/">See it on a demo</a></div></div></div></div></section>
<section class="sec"><div class="wrap"><div class="grid2" style="align-items:center"><div><div class="eyebrow">Site plans</div><h2 class="h2">See your building, not just your records</h2><p class="lead">Your premises mapped out floor by floor, with the things that matter to your safety marked where they actually are.</p><div style="margin-top:24px"><a class="btn ghost" href="/contact/">See it on a demo</a></div></div>
<div class="plan">{plan_svg}<div class="cap"><b>Floor by floor. Seen in 3D.</b><span>The rest is on your demo.</span></div></div></div></div></section>
<section class="sec alt"><div class="wrap"><div class="eyebrow">Privacy and control</div><h2 class="h2">Your records stay yours</h2><div class="grid2">''' + ''.join(f'<div class="tile"><span class="rule"></span><div class="h3">{a}</div><p>{b}</p></div>' for a,b in [('Only your company&rsquo;s records','Each client sees their own properties and records, and nothing belonging to anyone else.'),('Rules enforced by the system','What each person can see and do is controlled by the system itself, not just hidden on screen.'),('Private document storage','Certificates, documents and uploaded photos are stored privately.'),('A record of changes','Changes to compliance records are logged, so there is always a clear trail.')]) + '</div></div></section>' + cta('Want to see your own sites scored?','Book a demo and we&rsquo;ll show you how your properties would look in the passport.')

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
<p class="small" style="margin:16px 0 0">A short animated preview with sample data. There is a lot more behind it, and we are happy to show you on a call.</p></div>'''
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
what = f'''<section class="sec"><div class="wrap"><div class="eyebrow">What you get</div><h2 class="h2">One passport, quoted to suit your premises</h2><p class="lead">Tell us about your sites and we&rsquo;ll put together a quote that fits.</p>
{row_open}<article class="plan-card"><div class="eyebrow">The Compliance Passport</div><h3 class="h3" style="font-size:36px">Self-Managed</h3><p style="color:var(--mute)">For businesses that want to keep their own records and arrange their own inspections.</p>
<ul><li>Your own digital compliance passport</li><li>Traffic-light view of every property</li><li>Reminders before anything lapses</li><li>Upload and keep your certificates safe</li><li>Add your own checks for your premises</li><li>A Call Tremcore button whenever you need help</li></ul>
<div class="quote">Tailored to your premises. Ask for a quote.<div class="row" style="margin-top:16px">{SIGNUP}<a class="btn ghost" href="#demo-player">{PLAY} Watch the preview</a><a class="btn ghost" href="/contact/?package=1">Ask a question</a></div></div></article>
{managed_html if SHOW_MANAGED else ""}{row_close}<div id="demo">{demo}</div></div></section>''' + cta('Want to see it around your premises?','Tell us about your premises and we&rsquo;ll show you how it would work.')
how = f'''<section class="sec"><div class="wrap"><div class="eyebrow">How it works</div><h2 class="h2">Simple to start. Easy to live with.</h2>
<ol class="steps"><li><span class="no">01</span><div class="h3">Tell us about your premises</div><p>A short call to understand your sites and what you need to keep track of.</p></li><li><span class="no">02</span><div class="h3">We set up your passport</div><p>Each property gets its own passport, ready to use on your phone or computer.</p></li><li><span class="no">03</span><div class="h3">Stay on top of it</div><p>Keep your records up to date and watch the colours stay green.</p></li></ol></div></section>
<section class="sec alt" id="faq"><div class="wrap"><div class="eyebrow">Questions</div><h2 class="h2">Before you ask</h2><p class="lead">Something not covered here? Get in touch and we will answer it.</p><div class="faq">''' + ''.join(faq(q,a) for q,a in [
('Is every check on the list a legal requirement?','No. The list shows common checks for commercial premises. What applies to your property, and how often, depends on the premises, the equipment, current legislation and guidance, and your risk assessment. If you are unsure, ask us.'),
('Can I keep using my own contractors?','Yes. You stay in control. You choose your own contractors and record the results in your passport.'),
('What happens if a date or certificate is missing?','The check shows as &ldquo;No date&rdquo; instead of green, and it counts as not compliant in your percentage. Nothing is hidden to make a site look better than it is.'),
('Can I manage more than one property?','Yes. Several sites can sit under one company, and each property keeps its own passport and records.'),
('Does it work on a phone?','Yes. It is designed to work on phones, tablets and computers.'),
('Can I see it before I decide?','Yes. Book a demo and we&rsquo;ll walk you through the system on a short call, using an example that fits your premises.'),
('How much does it cost?','Pricing is agreed per company. Get in touch and we will put a quote together for the package you are interested in.')]) + '</div></div></section>' + cta('Have a question we haven&rsquo;t answered?','Ask us on a short call. There&rsquo;s no need to work it out alone.')
contact = f'''<section class="sec"><div class="wrap contact"><div><div class="eyebrow">Book a demo</div><h2 class="h2">See it around your premises</h2><p class="lead">Tell us a little about your properties and which package interests you. We&rsquo;ll get back to you to arrange a time for a walkthrough.</p>
<dl class="cd"><div><dt>Phone</dt><dd>{PHONE}</dd></div><div><dt>Email</dt><dd>{EMAIL}</dd></div><div><dt>Opening hours</dt><dd>{HOURS}</dd></div></dl></div>
<form class="f card" id="enquiry" method="post" action="/api/enquiry"><div class="two"><div><label class="lbl" for="f-name">Your name</label><input class="fld" id="f-name" name="name" type="text" autocomplete="name" required maxlength="120"></div><div><label class="lbl" for="f-company">Company</label><input class="fld" id="f-company" name="company" type="text" autocomplete="organization" maxlength="160"></div></div>
<div class="two"><div><label class="lbl" for="f-email">Email</label><input class="fld" id="f-email" name="email" type="email" autocomplete="email" required maxlength="200"></div><div><label class="lbl" for="f-phone">Phone</label><input class="fld" id="f-phone" name="phone" type="tel" autocomplete="tel" maxlength="40"></div></div>
<div class="two"><div><label class="lbl" for="f-sites">Number of properties</label><select class="fld" id="f-sites" name="sites"><option value="1">1</option><option value="2-5">2 to 5</option><option value="6-20">6 to 20</option><option value="20+">More than 20</option></select></div><div><label class="lbl" for="f-pkg">Package</label><select class="fld" id="f-pkg" name="package"><option value="">Not sure yet</option><option value="1">Self-Managed</option>''' + ('<option value="2">Managed Service (near Medway)</option>' if SHOW_MANAGED else '') + '''</select></div></div>
<div><label class="lbl" for="f-msg">What would you most like to see?</label><textarea class="fld" id="f-msg" name="message" rows="4" maxlength="2000"></textarea></div>
<div class="hp" aria-hidden="true"><label>Leave this empty <input name="website" type="text" tabindex="-1" autocomplete="off"></label></div>
<button class="btn solid" id="f-go" type="submit">Book my demo</button><div id="f-out" role="status"></div>
<p class="small" style="margin:0">We only use your details to reply to this enquiry.</p></form></div></section>'''


DRAFT = '<div class="quote" role="note"><b>Draft for review.</b> This page is a working draft and has not been checked by a solicitor. It is not in force until Tremcore Ltd has reviewed and finalised it. Items in [SQUARE BRACKETS] are still to be completed.</div>'
privacy = f'''<section class="sec"><div class="wrap narrow"><div class="eyebrow">Privacy notice</div><h1 class="h2">How Tremcore uses your information</h1>{DRAFT}
<h3>Who we are</h3><p>Tremcore Ltd, company number {CO}, {ADDR}. Questions about your information: {EMAIL}.</p>
<h3>What we collect</h3><p>When you enquire or create an account: your name, work email, phone number (if you give one), business name, and the names and addresses of your sites. Once you use the passport: the compliance records, dates, notes, certificates and photographs you or we add for your sites, and a record of changes made to them.</p>
<h3>Why we use it</h3><p>To reply to your enquiry, to set up and run your account and passport, to send reminders and service messages, to give you support, and to keep the service secure. [LEGAL BASIS TO BE CONFIRMED.]</p>
<h3>Who can see it</h3><p>People you authorise at your company, and Tremcore staff who need access to support you. Each company can only see its own records. We use trusted providers to host the service, store files and send email: [PROVIDERS AND DATA LOCATION TO BE CONFIRMED].</p>
<h3>How long we keep it</h3><p>[RETENTION PERIOD TO BE CONFIRMED.]</p>
<h3>Your rights</h3><p>You can ask to see, correct or delete your information, or object to how we use it, by contacting {EMAIL}. You can also complain to the Information Commissioner&rsquo;s Office.</p>
</div></section>'''
terms = f'''<section class="sec"><div class="wrap narrow"><div class="eyebrow">Terms of use</div><h1 class="h2">Terms for the Self-Managed Compliance Passport</h1>{DRAFT}
<h3>What the service is</h3><p>The Compliance Passport is a record-keeping tool. It helps you store certificates, track due dates and receive reminders. It does not carry out inspections, and nothing in it is legal, health and safety or fire-safety advice.</p>
<h3>Your responsibilities</h3><p>You are responsible for deciding which checks apply to your premises, arranging them, keeping your records accurate and up to date, and for the compliance of your premises. The checks and labels shown are examples and must be confirmed for your own premises and risk assessment.</p>
<h3>Your account</h3><p>Keep your sign-in details and your authenticator app secure. 2FA is required for head-office users. Tell us straight away if you think someone else has access.</p>
<h3>Trial and charges</h3><p>[TRIAL LENGTH, PRICE AND PAYMENT TERMS TO BE CONFIRMED.] Tremcore will agree your plan with you before any charge is made.</p>
<h3>Your content</h3><p>Your records and documents remain yours. You allow us to store and process them to provide the service.</p>
<h3>Acceptable use</h3><p>Do not misuse the service, try to access other companies&rsquo; information, or upload unlawful or harmful material.</p>
<h3>Our liability and ending the agreement</h3><p>[TO BE COMPLETED WITH LEGAL ADVICE.]</p>
</div></section>'''

page('/', 'Tremcore | Compliance passports for commercial premises', 'One clear view of every certificate, due date and reminder across your commercial properties.', home, '/')
page('/passport/', 'The passport | Tremcore', 'The checks that keep a building safe, with traffic lights and reminders, in one place.', passport, '/passport/')
page('/what-you-get/', 'What you get | Tremcore', 'The Self-Managed Compliance Passport, quoted to suit your premises.', what, '/what-you-get/')
page('/how-it-works/', 'How it works | Tremcore', 'Simple to start, easy to live with. Common questions answered.', how, '/how-it-works/')
page('/contact/', 'Book a demo | Tremcore', 'Tell us about your properties and we will arrange a walkthrough.', contact, '/contact/')
print('built 5 pages')
page('/privacy/', 'Privacy notice (draft) | Tremcore', 'How Tremcore uses your information.', privacy, '/privacy/', noindex=True)
page('/terms/', 'Terms of use (draft) | Tremcore', 'Terms for the Self-Managed Compliance Passport.', terms, '/terms/', noindex=True)
