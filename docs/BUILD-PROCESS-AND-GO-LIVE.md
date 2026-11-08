# Tremcore — build process and go-live checklist (8 Nov 2026)

Covers **Self-Managed (Level 1) going live on the web**. Tick items off as we go: change `[ ]` to `[x]`.

## 1. Pricing model (agreed 8 Nov)

- One price for the first **business unit**, plus an extra price for each additional unit.
- **Assumption to confirm:** a "business unit" = one **site / location** (what the passport calls a property). If you mean something else (a separate company, say), tell me before billing is built.
- **Prices (set 8 Nov):** first location £14.99 a month; each additional location £7.99 a month. Both exclude VAT.
- **Yearly billing (set 8 Nov): 15% off.** £152.90 a year for the first location and £81.50 a year for each extra. Customers choose monthly or yearly on the sign-up page (built; recorded in the hub).
- Examples: 1 site £14.99, 3 sites £30.97, 5 sites £46.95, 10 sites £86.90 a month.
- How it works in the system: Stripe holds one product with a "first unit" price and an "each extra unit" price. The number of sites on the account is the quantity. Adding a site raises the bill, so the app will show the new price and ask the customer to confirm first. Removing a site lowers it from the next bill.
- Sign-up trial: covers the first unit only (to be confirmed).

## 2. Build process (what happens, in order)

Each stage is built on its own branch, tested (website checks plus database permission checks), pushed to `setup` for you to try on the staging page, then you confirm before the next one.

| # | Stage | What you get | Needs from you |
|---|---|---|---|
| 1 | **Passport: records** | Site switcher, traffic-light dashboard with per-site percentage, list of compliance items, add/edit/delete, custom titles, "missing is never green", Call Tremcore button on every screen | Look at it, say what feels wrong |
| 2 | **Passport: certificates** | Upload a PDF or photo to an item, open it again; private storage only | Nothing |
| 3 | **Passport: sites and people** | Add/remove sites (shows the price change), head-office super user, site logins with view/update/full, invites | Email provider set up (checklist C) |
| 4 | **Reminders** | Emails before and after due dates, sent daily | Email provider and sender address |
| 5 | **Look and feel pass** | Colours, wording, phone/tablet layout, first-run guide for a new customer, empty states | Your feedback in chat |
| 6 | **Billing** | Stripe checkout, trial to paid, add/remove site changes the bill, failed payment then read-only, customer "manage subscription" button, hub Revenue fills itself in | Stripe account, prices (checklist D) |
| 7 | **Hub extras** | Upload certificates for clients, invite/reset users, delete client | Server secret key put in Railway |
| 8 | **Checks before launch** | Security review, backup test, legal pages reviewed, trial run with 2–3 friendly businesses | Accountant, solicitor, test customers |

Stages 1 to 3 are the heart of it. 5 comes after you've seen 1 to 3 working, as you asked.

## 3. Go-live checklist

### A. Accounts and hosting
- [ ] Production Supabase project created (separate from "TREMCORE Test"), on the Pro plan
- [ ] Database migrations 0001 to 0005 (and any new ones) run on staging and checked
- [ ] Same migrations run on production, then permission tests passed there
- [ ] Railway production service set up from GitHub, deploying from `main` only after your review
- [ ] Domain name bought and pointed at the site (via Cloudflare)
- [ ] Cloudflare set up (security, HTTPS only)
- [ ] Secret keys stored only in Railway and Supabase settings, none in the code
- [ ] Automatic daily backups switched on and one restore tested

### B. Sign-in and security
- [ ] Email sign-ups switched on in Supabase, with "Confirm email" on
- [ ] Redirect web addresses added in Supabase for the real domain
- [ ] 2FA enrolment tried by you on a real phone (authenticator app)
- [ ] First Tremcore admin account created and 2FA set
- [ ] A client user confirmed unable to see another company's data (tested on production)
- [ ] Level 2 test client confirmed unable to edit (tested on production)
- [ ] Security review done (keys, headers, storage rules)

### C. Email
- [ ] Email service chosen (Resend or Postmark) and account created
- [ ] Sending domain verified (SPF, DKIM records added) so emails don't land in spam
- [ ] Sender address chosen (for example `hello@` or `reminders@` your domain)
- [ ] Sign-up confirmation, password reset and reminder emails read through and approved
- [ ] Emails tested to Gmail and Outlook inboxes

### D. Money
- [ ] Stripe account opened (company details, bank account, identity checks)
- [ ] Direct Debit switched on in Stripe
- [x] Decision: price for the first business unit (£14.99 a month)
- [x] Decision: price for each additional unit (£7.99 a month)
- [x] Decision: prices exclude VAT
- [x] Decision: yearly billing offered at 15% off (£152.90 and £81.50)
- [ ] Decision: refund rule if someone cancels part-way through a year (suggest: keep access to year end, no refund; solicitor to check wording)
- [ ] Decision: trial length, and whether payment details are needed to start
- [ ] Decision: how long after a missed payment before an account goes read-only
- [ ] VAT: registered, or decision to register (ask your accountant); prices shown ex-VAT
- [ ] Stripe test mode run end to end: sign up, pay, add a site, fail a payment, cancel
- [ ] Stripe switched to live mode

### E. Legal and company
- [ ] Terms of use reviewed by a solicitor (draft exists at `/terms/`)
- [ ] Privacy policy reviewed by a solicitor (draft exists at `/privacy/`)
- [ ] Registered with the ICO (UK data protection fee) if required; ask your accountant or the ICO website
- [ ] Legal-basis wording on compliance items reviewed by someone qualified (never presented as legal advice)
- [ ] Professional indemnity insurance quote requested
- [ ] Real company number, registered address, phone and email put on the website (placeholders today)

### F. Website
- [ ] Phone number, email, address and company number replaced (no placeholders left)
- [ ] Self-Managed "Sign up" button tried on a phone and a computer
- [ ] "Ask a question" form delivers to the right inbox
- [ ] Page titles and descriptions checked; site added to Google Search Console
- [ ] Cookie wording checked (only essential cookies used at the moment)

### G. Product ready
- [ ] Stage 1 to 4 built, tested and approved by you
- [ ] Look and feel pass approved
- [ ] Billing built and approved
- [ ] Hub shows new sign-ups, trials and revenue correctly with real test data
- [ ] Support route decided: who answers the phone and email, and in what hours
- [ ] Trial run with 2 to 3 friendly businesses, feedback fixed

### H. Launch day
- [ ] Sign-up switched on in hub Settings
- [ ] First real sign-up watched end to end
- [ ] Revenue page checked against Stripe's dashboard
- [ ] Hub dashboard checked daily for the first fortnight
