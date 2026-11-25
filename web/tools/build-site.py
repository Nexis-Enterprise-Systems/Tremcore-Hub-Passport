#!/usr/bin/env python3
"""Generates the static website pages in web/public from the copy below.
Run:  python3 web/tools/build-site.py     (the generated pages are committed, so Railway needs no build step)
Placeholders in [SQUARE BRACKETS] must be replaced before launch (see docs/DECISIONS.md)."""
import os
OUT = os.path.join(os.path.dirname(__file__), '..', 'public')
PHONE, EMAIL, HOURS, CO = '', 'info@tremcore.co.uk', '', '17507064'
# No postal address is shown anywhere (the old one was a personal address). Add a business address here later if one is wanted.
ADDR = ''
# Phone and opening hours are left out of the pages until they are filled in above (no placeholder text on the live site).
PHONE_P = f'<p>{PHONE}</p>' if PHONE else ''
OR_CALL = f'{OR_CALL}' if PHONE else ''
PHONE_DT = f'<div><dt>Phone</dt><dd>{PHONE}</dd></div>' if PHONE else ''
HOURS_DT = f'<div><dt>Opening hours</dt><dd>{HOURS}</dd></div>' if HOURS else ''
ARROW = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h9M8.5 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
PLAY = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 1.5v11l9-5.5z" fill="currentColor"/></svg>'
LOCK = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5" fill="none" stroke="#d4af55" stroke-width="1.4"/><path d="M5.2 7V5.2a2.8 2.8 0 0 1 5.6 0V7" fill="none" stroke="#d4af55" stroke-width="1.4"/></svg>'
NAV = [('/', 'Home'), ('/passport/', 'The passport'), ('/what-you-get/', 'What you get'), ('/how-it-works/', 'How it works'), ('/media/', 'Media'), ('/contact/', 'Contact')]

# The passport is not open to the public yet (Nov 2026): every "Sign up" button becomes "Register your interest", which opens the interest-list form.
# When the passport goes live, set PASSPORT_OPEN = True and rebuild: the buttons go back to the real sign-up.
PASSPORT_OPEN = False
SIGNUP_HREF = '/app/?signup=1' if PASSPORT_OPEN else '/register/'
SIGNUP_LABEL = 'Sign up' if PASSPORT_OPEN else 'Register your interest'
SIGNUP = f'<a class="btn solid" href="{SIGNUP_HREF}">{SIGNUP_LABEL}</a>'

def ask_menu(cls=''):
    # "Ask us a question" drop-down: pick a subject and the contact form opens with it already chosen.
    return ('<details class="askdd %s"><summary class="btn ghost btn-ghost">Ask us a question <span class="car" aria-hidden="true">&#9662;</span></summary>'
            '<ul class="askmenu"><li><a href="/contact/?topic=multisite">Free multi-site hub</a></li>'
            '<li><a href="/contact/?topic=website">Website</a></li>'
            '<li><a href="/contact/?topic=social">Social media management</a></li>'
            '<li><a href="/contact/?topic=other">Other</a></li></ul></details>') % cls

def page(path, title, desc, body, current, noindex=False, extra_css=''):
    nav = ''.join('<a href="%s"%s>%s</a>' % (h, ' aria-current="page"' if h == current else '', l) for h, l in NAV)
    foot = ''.join('<a href="%s">%s</a>' % (h, l) for h, l in NAV)
    css = f'<link rel="stylesheet" href="/{extra_css}">' if extra_css else ''
    html = f'''<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{title}</title>
<meta name="description" content="{desc}">
<meta name="theme-color" content="#000000">{'<meta name="robots" content="noindex">' if noindex else ''}
<meta property="og:title" content="{title}"><meta property="og:description" content="{desc}"><meta property="og:type" content="website">
<link rel="icon" href="/img/favicon.png"><link rel="apple-touch-icon" href="/img/icon-180.png">
<link rel="preload" href="/fonts/tcserif-700.ttf" as="font" type="font/ttf" crossorigin><link rel="preload" href="/fonts/tcsans-400.ttf" as="font" type="font/ttf" crossorigin>
<link rel="stylesheet" href="/site.css">{css}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="top"><div class="wrap">
  <nav class="main" id="nav" aria-label="Main">{nav}</nav>
  <div class="hdr-actions"><a class="btn ghost" href="/app/?login=1">Login</a><a class="btn solid" href="{SIGNUP_HREF}">{SIGNUP_LABEL}</a><button class="btn ghost menu" type="button" aria-expanded="false" aria-controls="nav">Menu</button></div>
</div></header>
<div class="masthead"><a href="/" aria-label="Tremcore Ltd home"><img class="mast-logo" src="/img/masthead-logo.jpg" alt="Tremcore Ltd" width="300" height="233"></a><p class="slogan gt">The smart way to stay compliant</p></div>
<div class="skyline" aria-hidden="true"><svg class="sky sd" viewBox="0 0 2200 169" preserveAspectRatio="xMidYMax meet" aria-hidden="true" focusable="false"><defs><linearGradient id="gsd" gradientUnits="userSpaceOnUse" x1="0" x2="2200" y1="0" y2="0"><stop offset="0" stop-color="#CF9A3E"/><stop offset=".5" stop-color="#E2C484"/><stop offset="1" stop-color="#DEAA45"/></linearGradient></defs><path d="M0 149 L168.4 147.3 L421.0 147.3 L421.0 150.7 L168.4 150.7 Z" fill="url(#gsd)"/><path d="M2200 149 L2031.6 147.3 L1779.0 147.3 L1779.0 150.7 L2031.6 150.7 Z" fill="url(#gsd)"/><path class="link" d="M740.0 147.3 L1027.5 147.3 L1090.6 149.0 L1027.5 150.7 L740.0 150.7 Z M1460.0 147.3 L1172.5 147.3 L1109.4 149.0 L1172.5 150.7 L1460.0 150.7 Z" fill="url(#gsd)"/><path d="M421.0 149.0 L421.0 117.0 L453.0 117.0 L453.0 149.0 L486.0 149.0 L486.0 102.0 L513.0 102.0 L518.0 110.0 L530.0 110.0 L530.0 125.0 L553.0 125.0 L553.0 49.0 L568.0 49.0 L583.0 7.0 L598.0 35.0 L612.0 35.0 L612.0 125.0 L640.0 125.0 L640.0 75.0 L683.0 75.0 L683.0 135.0 L706.0 135.0 L706.0 112.0 L740.0 112.0 L740.0 149.0" fill="none" stroke="url(#gsd)" stroke-width="3.4" stroke-linejoin="miter"/><path d="M1779.0 149.0 L1779.0 117.0 L1747.0 117.0 L1747.0 149.0 L1714.0 149.0 L1714.0 102.0 L1687.0 102.0 L1682.0 110.0 L1670.0 110.0 L1670.0 125.0 L1647.0 125.0 L1647.0 49.0 L1632.0 49.0 L1617.0 7.0 L1602.0 35.0 L1588.0 35.0 L1588.0 125.0 L1560.0 125.0 L1560.0 75.0 L1517.0 75.0 L1517.0 135.0 L1494.0 135.0 L1494.0 112.0 L1460.0 112.0 L1460.0 149.0" fill="none" stroke="url(#gsd)" stroke-width="3.4" stroke-linejoin="miter"/><path class="gem" d="M1100.0 132 L1117.0 149 L1100.0 166 L1083.0 149 Z" fill="#E2C484"/></svg><svg class="sky sm" viewBox="0 0 1100 174" preserveAspectRatio="xMidYMax meet" aria-hidden="true" focusable="false"><defs><linearGradient id="gsm" gradientUnits="userSpaceOnUse" x1="0" x2="1100" y1="0" y2="0"><stop offset="0" stop-color="#CF9A3E"/><stop offset=".5" stop-color="#E2C484"/><stop offset="1" stop-color="#DEAA45"/></linearGradient></defs><path d="M0 149 L40.4 147.3 L101.0 147.3 L101.0 150.7 L40.4 150.7 Z" fill="url(#gsm)"/><path d="M1100 149 L1059.6 147.3 L999.0 147.3 L999.0 150.7 L1059.6 150.7 Z" fill="url(#gsm)"/><path class="link" d="M420.0 147.3 L516.7 147.3 L537.9 149.0 L516.7 150.7 L420.0 150.7 Z M680.0 147.3 L583.3 147.3 L562.1 149.0 L583.3 150.7 L680.0 150.7 Z" fill="url(#gsm)"/><path d="M101.0 149.0 L101.0 117.0 L133.0 117.0 L133.0 149.0 L166.0 149.0 L166.0 102.0 L193.0 102.0 L198.0 110.0 L210.0 110.0 L210.0 125.0 L233.0 125.0 L233.0 49.0 L248.0 49.0 L263.0 7.0 L278.0 35.0 L292.0 35.0 L292.0 125.0 L320.0 125.0 L320.0 75.0 L363.0 75.0 L363.0 135.0 L386.0 135.0 L386.0 112.0 L420.0 112.0 L420.0 149.0" fill="none" stroke="url(#gsm)" stroke-width="3.4" stroke-linejoin="miter"/><path d="M999.0 149.0 L999.0 117.0 L967.0 117.0 L967.0 149.0 L934.0 149.0 L934.0 102.0 L907.0 102.0 L902.0 110.0 L890.0 110.0 L890.0 125.0 L867.0 125.0 L867.0 49.0 L852.0 49.0 L837.0 7.0 L822.0 35.0 L808.0 35.0 L808.0 125.0 L780.0 125.0 L780.0 75.0 L737.0 75.0 L737.0 135.0 L714.0 135.0 L714.0 112.0 L680.0 112.0 L680.0 149.0" fill="none" stroke="url(#gsm)" stroke-width="3.4" stroke-linejoin="miter"/><path class="gem" d="M550.0 127 L572.0 149 L550.0 171 L528.0 149 Z" fill="#E2C484"/></svg></div>
<main id="main">
{body}
</main>
<div class="rule"></div>
<footer><div class="wrap fcenter">
  <a href="/" aria-label="Tremcore Ltd home"><img class="foot-logo" src="/img/masthead-logo.jpg" alt="Tremcore Ltd" width="190" height="147" loading="lazy"></a>
  <p class="f-slogan gt">The smart way to stay compliant</p>
  <p class="f-sub">Compliance passports for commercial premises.</p>
  <div class="f-rule"></div>
  <nav class="f-nav" aria-label="Footer">{foot}<a href="/app/?login=1">Login</a></nav>
  <a class="f-mail" href="mailto:{EMAIL}">{EMAIL}</a>
  <p class="legal">&copy; 2026 Tremcore Ltd &middot; Company number {CO}</p>
</div></footer>
<script src="/site.js"></script>
</body>
</html>
'''
    d = os.path.join(OUT, path.strip('/'))
    os.makedirs(d, exist_ok=True)
    open(os.path.join(d, 'index.html'), 'w').write(html)

def cta(h, p):
    return f'<section class="sec alt"><div class="wrap cta"><h2 class="h2">{h}</h2><p>{p}</p><div class="row">{SIGNUP}{ask_menu("up")}{OR_CALL}</div></div></section>'

ITEMS = [('g','Fire risk assessment','Mar 2027','In date'),('a','Fire alarm service and test','in 12 days','Due in 12d'),('r','Portable appliance testing','4 days ago','Overdue 4d'),('m','Kitchen extract cleaning','Not entered','No date'),('g','Legionella risk assessment','Jan 2027','In date'),('g','Emergency lighting test','Feb 2027','In date')]
items = ''.join(f'<li{" class=fade" if i==5 else ""}><span class="dot {c}"></span><span>{t}</span><span class="lab">{l}</span></li>' for i,(c,t,d,l) in enumerate(ITEMS))
home = '''<div class="hm"><!-- HERO -->
  <div class="hero">
    <div class="wrap hero-grid">
      <div>
        <h1>Commercial property compliance at your fingertips</h1>
        <p class="lead">Tremcore gives every commercial property a compliance passport, so you can see exactly where each site stands.</p>
        <div class="ctas">
          <a href="/register/" class="btn btn-primary">Register your interest</a>
          <a href="#passport-video" class="btn btn-ghost">▶ Watch the video</a>
        </div>
        <p class="cats">Fire safety · Electrical · Water hygiene · Building services · and more</p>
      </div>

      <div class="hero-right">
      <div class="pricecard">
        <p class="pc-kick">Compliance Passport</p>
        <div class="pc-main"><span class="pc-num">&pound;14.99</span><span class="pc-per">per month<br>+ VAT</span></div>
        <p class="pc-line">Your first site, with a head-office user and one manager.</p>
        <div class="pc-multi"><b>More than one site?</b> <a href="/contact/">Click here for a multi-site discount</a></div>
        <p class="pc-small">Pay yearly and save 15%.</p>
      </div>
      <div class="phone-wrap">
        <div class="phone" role="img" aria-label="Tremcore app home screen showing core compliance, site scores and items needing attention">
          <span class="btn-side l1"></span><span class="btn-side l2"></span><span class="btn-side l3"></span><span class="btn-side r1"></span>
          <div class="bezel"><div class="screen">
            <div class="status"><span>9:41</span><span class="punch"></span><span class="icons"><svg width="12" height="8" viewBox="0 0 18 12"><rect x="0" y="8" width="3" height="4" rx="1" fill="#f3eee4"/><rect x="5" y="5.5" width="3" height="6.5" rx="1" fill="#f3eee4"/><rect x="10" y="3" width="3" height="9" rx="1" fill="#f3eee4"/><rect x="15" y="0" width="3" height="12" rx="1" fill="#f3eee4"/></svg> <svg width="11" height="8" viewBox="0 0 16 12"><path d="M8 11.5l2.4-2.6a3.4 3.4 0 0 0-4.8 0z" fill="#f3eee4"/><path d="M3.8 7.1a6 6 0 0 1 8.4 0" fill="none" stroke="#f3eee4" stroke-width="1.7" stroke-linecap="round"/><path d="M1.3 4.4a9.6 9.6 0 0 1 13.4 0" fill="none" stroke="#f3eee4" stroke-width="1.7" stroke-linecap="round"/></svg> <svg width="18" height="8" viewBox="0 0 27 13"><rect x="0.5" y="0.5" width="23" height="12" rx="3.5" fill="none" stroke="#f3eee4" stroke-opacity="0.45"/><rect x="2.5" y="2.5" width="17" height="8" rx="2" fill="#f3eee4"/></svg></span></div>
            <img src="/img/home-phone-2.jpg" width="640" height="1385" alt="">
            <div class="glare"></div>
          </div></div>
        </div>
      </div>
      <div class="hero-video"><p class="explore">Explore the app</p><div class="vidwrap"><video id="passport-video" controls preload="metadata" playsinline poster="/media/img/sm-poster-2.jpg" width="720" height="1280" aria-label="Tremcore Compliance Passport video, about 90 seconds"><source src="/media/tremcore-self-managed-showcase-2.mp4" type="video/mp4">Your browser can&rsquo;t play this video.</video></div></div>
      </div>
    </div>

    <div class="wrap addons" id="add-ons">
      <div class="head center-head">
        <p class="kicker">Add-ons</p>
        <h2>Unlock extra tools for your team</h2>
        <p>Add them on their own, or get them at a lower monthly price when you have the Tremcore app.</p>
      </div>
      <div class="grid g2">
        <article class="addon">
          <div class="addon-top"><div class="icon lg"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/><path d="M8.5 12h.01M12 12h.01M15.5 12h.01" stroke-width="2.6"/></svg></div><div><h3>Toolbox Talks</h3><p class="addon-sub">Short, ready-to-deliver safety briefings for your team, written for UK workplaces.</p></div></div>
          <ul class="ticks">
            <li>A library of 30 talks across Health &amp; Safety, Fire Safety, Wellbeing, Workplace Responsibilities and industry-specific topics</li>
            <li>Each talk shows its running time, typically 6 to 15 minutes</li>
            <li>Record who delivered it and who attended, so you have a dated record</li>
            <li>Bespoke talks written for your business, your site and your tasks, at £1.99 each (allow up to 48 hours)</li>
            <li>New talks added to the library as regulations change</li>
          </ul>
          <div class="pricing">
            <div class="p-col"><small>On its own</small><div class="p-std">£4.99<span> pcm</span></div></div>
            <div class="p-col best"><span class="badge">With the Tremcore app</span><div class="p-app">£2.99<span> pcm</span></div><small class="save">Save £2 a month</small></div>
          </div>
          <a href="/register/" class="btn btn-primary full">Register your interest</a>
        </article>
        <article class="addon">
          <div class="addon-top"><div class="icon lg"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></div><div><h3>Staff Clock In / Out</h3><p class="addon-sub">Know who is on site at any moment, which matters for fire roll calls and payroll.</p></div></div>
          <ul class="ticks">
            <li>A printable A4 QR poster for your entrance. Staff scan it, tap their name, then clock in or out</li>
            <li>Live attendance log showing who is on site right now</li>
            <li>Manual clock in / out for staff without a phone</li>
            <li>Shift rota, plus a staff hours report showing early and late times</li>
            <li>A daily record you can check against timesheets</li>
          </ul>
          <div class="pricing">
            <div class="p-col"><small>On its own</small><div class="p-std">£7.99<span> pcm</span></div></div>
            <div class="p-col best"><span class="badge">With the Tremcore app</span><div class="p-app">£5.99<span> pcm</span></div><small class="save">Save £2 a month</small></div>
          </div>
          <a href="/register/" class="btn btn-primary full">Register your interest</a>
        </article>
      </div>
    </div>

    <div class="wrap features">
      <div class="grid g4">
        <div class="card"><div class="icon">●</div><h3>Clear at a glance</h3><p>Green, amber and red show what's fine, what's coming up and what needs action.</p></div>
        <div class="card"><div class="icon">⌂</div><h3>Yours to run</h3><p>Your records belong to you, not your contractors.</p></div>
        <div class="card"><div class="icon">?</div><h3>Honest about gaps</h3><p>Missing certificates and dates are shown plainly, never hidden.</p></div>
        <div class="card"><div class="icon">▢</div><h3>Phone, tablet or desktop</h3><p>Check any site from wherever you are.</p></div>
      </div>
    </div>
  </div>

  <!-- PROBLEM -->
  <section class="alt">
    <div class="wrap">
      <div class="head">
        <p class="kicker">Sound familiar?</p>
        <h2>Compliance has a way of getting scattered</h2>
      </div>
      <div class="grid g3">
        <div class="card"><div class="icon">✉</div><h3>Certificates in inboxes</h3><p>Paperwork buried in old emails or sitting with whichever contractor did the job.</p></div>
        <div class="card"><div class="icon">◷</div><h3>Dates in someone's head</h3><p>Renewals tracked from memory, until that person is off or moves on.</p></div>
        <div class="card"><div class="icon">◎</div><h3>No clear picture</h3><p>No single place to see what's current across all your sites.</p></div>
      </div>
      <p class="closing">The Tremcore passport brings it all together in one place.</p>
    </div>
  </section>

  <!-- PASSPORT -->
  <section>
    <div class="wrap">
      <div class="head">
        <p class="kicker">The passport</p>
        <h2>Your premises, in your hands</h2>
        <p>Each site gets its own passport: every record and every renewal, kept together.</p>
      </div>
      <div class="grid g2">
        <a href="/passport/" class="card"><div class="icon">▤</div><h3>Your records</h3><p>Every certificate stored against the right site and check.</p><span class="more">Learn more →</span></a>
        <a href="/passport/" class="card"><div class="icon">◷</div><h3>Your reminders</h3><p>Get a nudge before something falls due, not after.</p><span class="more">Learn more →</span></a>
      </div>
    </div>
  </section>

  <!-- INSIDE THE APP -->
  <section class="alt">
    <div class="wrap">
      <div class="head">
        <p class="kicker">Inside the app</p>
        <h2>There's a lot more behind the passport</h2>
        <p>Built for people who look after commercial premises, whether that's one site or a whole estate.</p>
      </div>
      <div class="grid g3">
        <div class="card"><div class="icon">◫</div><h3>Your whole estate</h3><p>Every site's status side by side.</p></div>
        <div class="card"><div class="icon">!</div><h3>What matters most</h3><p>Clearly labelled priorities, so you know where to start.</p></div>
        <div class="card"><div class="icon">◷</div><h3>Reminders</h3><p>Timely alerts before renewals fall due.</p></div>
        <div class="card"><div class="icon">⚿</div><h3>Protected records</h3><p>Private by default, with control over who sees what.</p></div>
        <div class="card"><div class="icon">✎</div><h3>Tailored checks</h3><p>Add custom checks that suit your premises.</p></div>
      </div>
    </div>
  </section>

  <!-- WARNING -->
  <div class="wrap warn-wrap">
    <div class="alarm">
      <div class="al-bar"></div>
      <div class="al-body">
        <p class="al-kick"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg> Don't get caught out</p>
        <h2 class="al-h">If the worst happens, your insurer will want proof. <span>Make sure you can give it.</span></h2>
        <p class="al-p">An expired certificate or a missing record is all it takes to put a claim in doubt. Tremcore keeps your business’s compliance up to date and on file, so your paperwork stands up when it matters most.</p>
        <ul class="risks">
          <li><b>✕</b>A claim put in doubt</li>
          <li><b>✕</b>Enforcement notices and fines</li>
          <li><b>✕</b>Premises closed until it's put right</li>
        </ul>
      </div>
    </div>
  </div>

  <!-- WEBSITE & MEDIA -->
  <section id="websites">
    <div class="wrap">
      <div class="head center-head">
        <p class="kicker">Websites &amp; media</p>
        <h2>Get your business online and winning customers.</h2>
        <p>A bespoke website, designed around your business.</p>
      </div>

      <div class="web-offer">
        <span class="badge-l">Bespoke website design</span>
        <div class="wo-price">
          <div class="wo-num">£400</div>
          <span class="pill-green">Fixed price</span>
        </div>
        <div class="wo-div"></div>
        <ul class="wo-list">
          <li><span class="tk"></span>Up to 4 pages, built from scratch</li>
          <li><span class="tk"></span>Designed to bring in new customers</li>
          <li><span class="tk"></span>One price. No surprises.</li>
        </ul>
      </div>

      <div class="divider-title"><span></span><b>Then keep the customers coming</b><span></span></div>

      <div class="grid g2 media">
        <div class="mcard">
          <h3>Social Media Management</h3>
          <div class="m-price"><b>£99</b> per month</div>
          <p>A ready-made post every day for your chosen platforms. Just click send, or edit.</p>
          <small>Fixed price · 12-month rolling contract</small>
        </div>
        <div class="mcard">
          <span class="free-tag">Free with Social</span>
          <h3>Customer Review Management</h3>
          <div class="m-price"><b>£9.99</b> per month</div>
          <p>A QR code linked to Google and TripAdvisor. 4 and 5 star reviews go live; 1 to 3 star come to you first.</p>
          <small>12-month rolling contract · or free with Social</small>
        </div>
        <div class="mcard">
          <span class="free-tag">Free with Social</span>
          <h3>Poster Design Studio</h3>
          <div class="m-price"><b>£4.99</b> per month</div>
          <p>Create professional posters in minutes. Print them for your premises or share them straight to your socials.</p>
          <small>Or free with Social</small>
        </div>
      </div>
      <div class="center" style="text-align:center;margin-top:34px;display:flex;gap:12px;justify-content:center;flex-wrap:wrap"><a href="/contact/" class="btn btn-primary">Get started today</a> <a href="/media/" class="btn btn-ghost">See our work</a></div>
    </div>
  </section>

  <!-- MEDIA VIDEO -->
  <section id="media-video">
    <div class="wrap">
      <div class="head center-head">
        <p class="kicker">Tremcore Media</p>
        <h2>Ninety seconds, start to finish</h2>
        <p>See how a website, a set of posters and the review replies come together for one example pub. Best with the sound on.</p>
      </div>
      <div class="vidwrap"><video controls preload="metadata" playsinline poster="/media/img/video-poster.jpg" width="720" height="1280" aria-label="Tremcore Media showcase video, 90 seconds"><source src="/media/tremcore-media-showcase.mp4" type="video/mp4">Your browser can&rsquo;t play this video.</video></div>
    </div>
  </section>

  <!-- CTA -->
  <section>
    <div class="wrap">
      <div class="cta">
        <h2>Ready to get your premises in order?</h2>
        <p>Sign up, add your first site and start adding certificates.</p>
        <div class="ctas">
          <a href="/register/" class="btn btn-primary">Register your interest</a>
          @@ASKUP@@
        </div>
      </div>
    </div>
  </section></div>'''

def cat(t, p, lis):
    ul = '<ul>' + ''.join(f'<li>{x}</li>' for x in lis) + '</ul>' if lis else ''
    return f'<div class="tile"><span class="rule"></span><div class="h3">{t}</div><p>{p}</p>{ul}</div>'
passport = f'''<section class="sec alt"><div class="wrap"><div class="center-head"><div class="eyebrow">See it in action</div><h2 class="h2">The passport, start to finish</h2><p class="lead">Ninety seconds on a phone: compliance at a glance, certificates and dates, sites, toolbox talks, staff clock in and out. Best with the sound on.</p></div><div class="vidwrap"><video id="passport-video" controls preload="metadata" playsinline poster="/media/img/sm-poster-2.jpg" width="720" height="1280" aria-label="Tremcore Compliance Passport video, about 90 seconds"><source src="/media/tremcore-self-managed-showcase-2.mp4" type="video/mp4">Your browser can&rsquo;t play this video.</video></div></div></section>
<section class="sec"><div class="wrap"><div class="eyebrow">What it covers</div><h2 class="h2">The checks that keep a building safe, in one place</h2><p class="lead">Each property&rsquo;s passport holds the checks that apply to it, and you can add your own for anything particular to your premises.</p>
<div class="grid3">''' + cat('Fire safety','Assessments, alarms, lighting and equipment.',['Fire risk assessments','Fire alarm servicing','Emergency lighting','and more']) + cat('Electrical','Installation and equipment testing.',['Installation condition reports','Portable appliance testing','and more']) + cat('Water hygiene','Keeping water systems safe.',['Legionella risk assessments','Temperature monitoring','and more']) + cat('Building and services','The wider fabric and plant.',['Asbestos management','Gas and heating','Air conditioning','and more']) + cat('Made for your premises','Add a title for anything specific to you, from kitchen extract cleaning to a particular piece of equipment.',[]) + f'''</div>
<p class="small" style="margin-top:28px;max-width:70ch">These are examples. Which checks apply, and how often, depends on the premises, the equipment, current legislation and guidance, and your risk assessment. Nothing here is legal advice.</p></div></section>
<section class="sec alt"><div class="wrap"><div class="grid2" style="align-items:center"><div><div class="eyebrow">Traffic lights</div><h2 class="h2">See where you stand in a second</h2><p class="lead">Every check has a due date and a colour. If a date hasn&rsquo;t been recorded, the passport says so rather than showing green.</p>
<div class="lights"><div><span class="dot g"></span><span><b>In date.</b> More than 30 days to go.</span></div><div><span class="dot a"></span><span><b>Due soon.</b> Due within 30 days.</span></div><div><span class="dot r"></span><span><b>Overdue.</b> Past the due date.</span></div><div><span class="dot m"></span><span><b>No date.</b> Never shown as green.</span></div></div></div>
<div class="card"><div class="bar" aria-hidden="true"></div><div style="margin-top:20px"><b>Your score, across every site</b><p style="color:var(--mute);margin:6px 0 14px">We&rsquo;ll show you how your own properties would look.</p>{SIGNUP}</div></div></div></div></section>
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
<ul><li>Your own digital compliance passport</li><li>Traffic-light view of every property</li><li>Reminders before anything lapses</li><li>Upload and keep your certificates safe</li><li>Add your own checks for your premises</li></ul>
<div class="quote">Tailored to your premises. Ask for a quote.<div class="row" style="margin-top:16px">{SIGNUP}<a class="btn ghost" href="#demo-player">{PLAY} Watch the preview</a><a class="btn ghost" href="/contact/?package=1">Ask a question</a></div></div></article>
{managed_html if SHOW_MANAGED else ""}{row_close}<div id="demo" class="demo-video"><div class="center-head"><div class="eyebrow">See it in action</div><h2 class="h2">The passport, start to finish</h2></div><div class="vidwrap"><video id="passport-video" controls preload="metadata" playsinline poster="/media/img/sm-poster-2.jpg" width="720" height="1280" aria-label="Tremcore Compliance Passport video, about 90 seconds"><source src="/media/tremcore-self-managed-showcase-2.mp4" type="video/mp4">Your browser can&rsquo;t play this video.</video></div></div></div></section>''' + cta('Want to see it around your premises?','Tell us about your premises and we&rsquo;ll show you how it would work.')
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
<dl class="cd">{PHONE_DT}<div><dt>Email</dt><dd>{EMAIL}</dd></div>{HOURS_DT}</dl></div>
<form class="f card" id="enquiry" method="post" action="/api/enquiry"><div class="two"><div><label class="lbl" for="f-name">Your name</label><input class="fld" id="f-name" name="name" type="text" autocomplete="name" required maxlength="120"></div><div><label class="lbl" for="f-company">Company</label><input class="fld" id="f-company" name="company" type="text" autocomplete="organization" maxlength="160"></div></div>
<div class="two"><div><label class="lbl" for="f-email">Email</label><input class="fld" id="f-email" name="email" type="email" autocomplete="email" required maxlength="200"></div><div><label class="lbl" for="f-phone">Phone</label><input class="fld" id="f-phone" name="phone" type="tel" autocomplete="tel" maxlength="40"></div></div>
<div class="two"><div><label class="lbl" for="f-sites">Number of properties</label><select class="fld" id="f-sites" name="sites"><option value="1">1</option><option value="2-5">2 to 5</option><option value="6-20">6 to 20</option><option value="20+">More than 20</option></select></div><div><label class="lbl" for="f-topic">Subject</label><select class="fld" id="f-topic" name="topic"><option value="">Not sure yet</option><option value="multisite">Free multi-site hub</option><option value="website">Website</option><option value="social">Social media management</option><option value="other">Other</option></select></div></div>
<div><label class="lbl" for="f-msg">What would you most like to see?</label><textarea class="fld" id="f-msg" name="message" rows="4" maxlength="2000"></textarea></div>
<div class="hp" aria-hidden="true"><label>Leave this empty <input name="website" type="text" tabindex="-1" autocomplete="off"></label></div>
<button class="btn solid" id="f-go" type="submit">Send my question</button><div id="f-out" role="status"></div>
<p class="small" style="margin:0">We only use your details to reply to this enquiry.</p></form></div></section>'''


register = f'''<section class="sec"><div class="wrap contact"><div><div class="eyebrow">Coming soon</div><h1 class="h2">Register your interest</h1><p class="lead">The Self-Managed Compliance Passport is opening soon. Tell us about your business and we will email you the moment you can sign up. There is no payment now and no obligation.</p>
<dl class="cd"><div><dt>Email</dt><dd>{EMAIL}</dd></div></dl></div>
<form class="f card" id="interest" method="post" action="/api/interest"><div class="two"><div><label class="lbl" for="r-name">Your name</label><input class="fld" id="r-name" name="name" type="text" autocomplete="name" required maxlength="120"></div><div><label class="lbl" for="r-email">Email address</label><input class="fld" id="r-email" name="email" type="email" autocomplete="email" required maxlength="200"></div></div>
<div><label class="lbl" for="r-biz">Business name</label><input class="fld" id="r-biz" name="business_name" type="text" autocomplete="organization" required maxlength="160"></div>
<div><label class="lbl" for="r-addr">Business address</label><textarea class="fld" id="r-addr" name="business_address" rows="3" autocomplete="street-address" required maxlength="400"></textarea></div>
<div><label class="lbl" for="r-sites">Number of sites</label><input class="fld" id="r-sites" name="sites" type="number" min="1" max="100" step="1" value="1" inputmode="numeric" required></div>
<div class="hp" aria-hidden="true"><label>Leave this empty <input name="website" type="text" tabindex="-1" autocomplete="off"></label></div>
<label class="chk"><input id="r-consent" name="consent" type="checkbox" required> <span>Yes, email me when the Compliance Passport opens. I can ask to be taken off the list at any time. <a href="/privacy/">Privacy notice</a>.</span></label>
<button class="btn solid" id="r-go" type="submit">Register my interest</button><div id="r-out" role="status"></div>
<p class="small" style="margin:0">We only use these details to tell you when the passport opens and to answer your questions.</p></form></div></section>'''

DRAFT = '<div class="quote" role="note"><b>Draft for review.</b> This page is a working draft and has not been checked by a solicitor. It is not in force until Tremcore Ltd has reviewed and finalised it. Items in [SQUARE BRACKETS] are still to be completed.</div>'
privacy = f'''<section class="sec"><div class="wrap narrow"><div class="eyebrow">Privacy notice</div><h1 class="h2">How Tremcore uses your information</h1>{DRAFT}
<h3>Who we are</h3><p>Tremcore Ltd, company number {CO}. Questions about your information: {EMAIL}. [ICO REGISTRATION NUMBER TO BE ADDED.]</p>
<h3>Two roles: your data and our own</h3>
<p><b>Your records are yours.</b> The compliance records, dates, notes, certificates, photographs, site details and the names of your own colleagues that you put into the passport belong to your company. For that information your company is the <i>controller</i> and Tremcore is your <i>processor</i>: we only handle it to run the service for you, on your instructions, as set out in our <a href="/terms/">Terms</a> and the data processing terms within them.</p>
<p>For our own account, billing and sales information (who you are, how to contact you, what you pay) Tremcore is the controller.</p>
<h3>What we collect</h3><p>If you register your interest, we keep your name, email address, business name, business address and number of sites, and the date you agreed to be emailed, so that we can tell you when the passport opens. You can ask us to remove you at any time. When you enquire or create an account: your name, work email, phone number (if you give one), business name and the names and addresses of your sites. When you use the passport: the records, certificates and photographs you add, a record of changes made to them, and basic security information such as sign-in times. When you pay: payment details are collected and held by our payment provider, not by us .</p>
<h3>Why we use it</h3><p>To run your account and passport (to carry out our contract with you), to send reminders and service messages, to take payment and keep financial records (to meet our legal obligations), to protect the service (our legitimate interest in keeping it secure and fair), and to answer your enquiries. [LEGAL BASES TO BE CONFIRMED BY SOLICITOR.]</p>
<h3>We do not share or sell your data</h3><p>We do not sell your data, use it for advertising, or show it to other customers. Each company can only see its own records; this is enforced by the database itself. Tremcore staff only look at your records to support you. We only use a small number of service providers, strictly to run the service, under written contracts: hosting and database (Supabase), web hosting (Railway), email delivery ([EMAIL PROVIDER]), payments ([STRIPE]) and reading uploaded certificates (Anthropic, which makes the Claude AI model). When you upload a PDF or photo of a certificate or insurance document, a copy is sent to that provider only to read the dates and numbers on it, so we can suggest them to you; nothing is saved until you check and confirm it. [WHETHER THE AI PROVIDER KEEPS THE DOCUMENT, AND ITS TERMS, TO BE CONFIRMED.] Where a provider is outside the UK we rely on approved transfer safeguards. [PROVIDERS, LOCATIONS AND SAFEGUARDS TO BE CONFIRMED.]</p>
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


def shot(src, alt, w, h, cap=''):
    c = f'<figcaption>{cap}</figcaption>' if cap else ''
    return f'<figure class="shot"><img src="/media/img/{src}" alt="{alt}" width="{w}" height="{h}" loading="lazy">{c}</figure>'
def feat(eyebrow, title, lead, bullets, fig, flip=False):
    ul = '<ul class="ticks">' + ''.join(f'<li>{b}</li>' for b in bullets) + '</ul>'
    txt = f'<div><div class="eyebrow">{eyebrow}</div><h2 class="h2">{title}</h2><p class="lead">{lead}</p>{ul}</div>'
    return f'<div class="feat{" flip" if flip else ""}">{txt}<div>{fig}</div></div>'
posters4 = ''.join(f'<img src="/media/img/{n}.jpg" alt="{a}" width="346" height="346" loading="lazy">' for n, a in [('poster-happy-hour','Example Happy Hour poster'),('poster-live-music','Example Live Music poster'),('poster-sunday-roast','Example Sunday Roast poster'),('poster-live-sport','Example Live Sport poster')])
media = f'''<section class="sec hero"><div class="wrap">
<div><div class="eyebrow">Tremcore Media</div>
<h1 class="h1">Websites, posters and reviews, <span class="gold">looked after.</span></h1>
<p class="lead">For pubs, restaurants, shops and other local businesses: a website that looks the part, posters you can change in minutes, and a calm way to answer your customers&rsquo; reviews.</p>
<div class="row" style="margin-top:32px"><a class="btn solid" href="/contact/">Ask about Tremcore Media</a><a class="btn ghost" href="/media/red-lion/">See an example website {ARROW}</a></div>
<p class="small" style="margin-top:24px">Websites &middot; Social media &middot; Poster design &middot; Review replies</p></div>
{shot('builder-preview.jpg','A new website for an example pub, The Red Lion, shown in the Tremcore website builder',1400,875)}
</div></section>
<div class="strip"><div class="wrap"><div><b>Made for you</b><p>Your name, your colours, your words.</p></div><div><b>Quick to change</b><p>New offer? New poster in minutes.</p></div><div><b>Easy to look at</b><p>Clear on a phone, a tablet and a computer.</p></div><div><b>Looked after</b><p>We keep it up to date, so you don&rsquo;t have to.</p></div></div></div>
<section class="sec alt" id="video"><div class="wrap"><div class="feat flip"><div><div class="eyebrow">Watch</div><h2 class="h2">Ninety seconds, start to finish</h2><p class="lead">See how a website, a set of posters and the review replies come together for one example pub. Best with the sound on.</p>
<div class="row" style="margin-top:28px"><a class="btn solid" href="/contact/">Ask about Tremcore Media</a></div></div>
<div class="vidwrap"><video controls preload="metadata" playsinline poster="/media/img/video-poster.jpg" width="720" height="1280" aria-label="Tremcore Media showcase video, 90 seconds"><source src="/media/tremcore-media-showcase.mp4" type="video/mp4">Your browser can&rsquo;t play this video.</video></div></div></div></section>
<section class="sec"><div class="wrap"><div class="center-head"><div class="eyebrow">What we do</div><h2 class="h2">Everything your business shows the world</h2><p class="lead">Four things, one team, one look.</p></div>
<div class="grid4"><div class="tile"><span class="rule"></span><div class="h3">Your website</div><p>A site built around your business: who you are, what you offer and how to book or get in touch.</p></div><div class="tile"><span class="rule"></span><div class="h3">Social media</div><p>Posts and stories that match your brand, planned ahead so your pages never go quiet.</p></div><div class="tile"><span class="rule"></span><div class="h3">Posters</div><p>Event and offer posters from a set of ready-made designs, with your branding and a QR code on every one.</p></div><div class="tile"><span class="rule"></span><div class="h3">Customer reviews</div><p>Every review in one place, with a suggested reply in the tone you choose, ready for you to check and send.</p></div></div></div></section>
<section class="sec" id="prices"><div class="wrap"><div class="center-head"><div class="eyebrow">Prices</div><h2 class="h2">Get your business online, then keep the customers coming</h2><p class="lead">A bespoke website designed around your business, with simple monthly extras to bring customers through the door.</p></div>
<div class="bespoke"><span class="btag">Bespoke website design</span><div class="bprice"><b>&pound;400</b><span class="fixed">Fixed price</span></div><ul class="ticks"><li>Up to 4 pages, built from scratch</li><li>Designed to bring in new customers</li><li>One price. No surprises.</li></ul></div>
<p class="then">Then keep the customers coming</p>
<div class="pgrid"><div class="pcard"><div class="h3">Social Media Management</div><div class="pprice"><b>&pound;99</b> <span>per month</span></div><p>A ready-made post every day for your chosen platforms. Just click send, or edit.</p><p class="pfoot">Fixed price &middot; 12-month rolling contract</p></div><div class="pcard"><span class="freebadge">Free with Social</span><div class="h3">Customer Review Management</div><div class="pprice"><b>&pound;9.99</b> <span>per month</span></div><p>A QR code linked to Google and TripAdvisor. 4 and 5 star reviews go live; 1 to 3 star come to you first.</p><p class="pfoot">12-month rolling contract &middot; or free with Social</p></div><div class="pcard"><span class="freebadge">Free with Social</span><div class="h3">Poster Design Studio</div><div class="pprice"><b>&pound;4.99</b> <span>per month</span></div><p>Create professional posters in minutes. Print them for your premises or share them straight to your socials.</p><p class="pfoot">Or free with Social</p></div></div>
<div class="row" style="justify-content:center;margin-top:32px"><a class="btn solid" href="/contact/">Ask about Tremcore Media</a></div></div></section>
<section class="sec alt"><div class="wrap">{feat('Your website','A few questions, then you see your new site',
'We ask about your business, show you a first design to look at on a computer and on a phone, and take your feedback section by section until you are happy.',
['Answer a few simple questions about your business','See the design on a desktop and on a phone before anything goes live','Tell us what you love and what to change, part by part'],
shot('builder-start.jpg','The start screen of the Tremcore website builder',1400,875))}</div></section>
<section class="sec"><div class="wrap">{feat('Posters','Event posters, ready when you are',
'Pick a design, fill in the details and download it. Your branding is already in place, and each poster can carry a QR code that links to your booking page or menu.',
['Ready-made designs for quiz nights, happy hours, roasts, live music and more','Change the headline, the date and the details as you type','Download and print, or share it online'],
shot('posters-choose.jpg','Choosing a poster design in the Tremcore poster studio',1400,875), flip=True)}
<div class="posters" role="group" aria-label="Example posters">{posters4}</div>
<p class="small" style="margin-top:14px">Example posters for a made-up pub. Names, prices and phone numbers are illustrative.</p></div></section>
<section class="sec alt"><div class="wrap">{feat('Reviews and social','Keep up with what people say about you',
'Reviews from your listings arrive in one inbox. Each one comes with a suggested reply written in the tone you pick, which you can edit before you send it. Social posts and stories follow the same look as your website and posters.',
['One inbox for your reviews, with the lowest ratings at the top','A suggested reply for every review, in a friendly, apologetic or formal tone','A QR code on a poster or table card that asks happy customers to leave a review'],
shot('posters-edit.jpg','Editing a poster headline and details in the Tremcore poster studio',1400,875))}</div></section>
<section class="sec"><div class="wrap"><div class="grid2" style="align-items:center"><div><div class="eyebrow">An example</div><h2 class="h2">The Red Lion, Rochester</h2><p class="lead">This is the kind of website we build. The Red Lion is a made-up pub, so the menu, prices and reviews are only an illustration, but you can open it and scroll around it like any other site.</p>
<div class="row" style="margin-top:28px"><a class="btn solid" href="/media/red-lion/">Open the example website {ARROW}</a></div></div>
<div class="devices">{shot('redlion-desktop.jpg','The example Red Lion website on a computer',1400,850)}{shot('redlion-mobile.jpg','The example Red Lion website on a phone',500,1062)}</div></div></div></section>
<section class="sec alt"><div class="wrap cta"><h2 class="h2">Want to see what it could look like for you?</h2><p>Tell us a little about your business and we&rsquo;ll get back to you.</p><div class="row"><a class="btn solid" href="/contact/">Ask about Tremcore Media</a><a class="btn ghost" href="/">Tremcore Compliance Passport</a></div></div></section>'''

home = home.replace('@@ASKUP@@', ask_menu('up'))
page('/', 'Tremcore | Compliance passports for commercial premises', 'One clear view of certificates, due dates and reminders across your commercial properties.', home, '/', extra_css='home.css')
page('/passport/', 'The passport | Tremcore', 'The checks that keep a building safe, with traffic lights and reminders, in one place.', passport, '/passport/')
page('/what-you-get/', 'What you get | Tremcore', 'The Self-Managed Compliance Passport, quoted to suit your premises.', what, '/what-you-get/')
page('/how-it-works/', 'How it works | Tremcore', 'Simple to start, easy to live with. Common questions answered.', how, '/how-it-works/')
page('/contact/', 'Contact us | Tremcore', 'Ask us a question about the Compliance Passport.', contact, '/contact/')
page('/media/', 'Tremcore Media | Websites, posters and reviews', 'Websites, event posters and customer review replies for pubs, restaurants and local businesses, from Tremcore Media.', media, '/media/')
print('built 6 pages')
page('/privacy/', 'Privacy notice (draft) | Tremcore', 'How Tremcore uses your information.', privacy, '/privacy/', noindex=True)
page('/register/', 'Register your interest | Tremcore', 'Be first to know when the Tremcore Compliance Passport opens.', register, '/register/')
page('/terms/', 'Terms of use (draft) | Tremcore', 'Terms for the Self-Managed Compliance Passport.', terms, '/terms/', noindex=True)
