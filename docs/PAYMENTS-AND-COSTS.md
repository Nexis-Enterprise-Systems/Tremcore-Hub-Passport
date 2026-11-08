# Tremcore — costs and taking payments (8 Nov 2026)

Plain-English plan for what it costs to run Tremcore, how customers will pay, and what you need to decide. Figures come from public pricing pages and comparison sites found on 8 Nov 2026. They move often and some sources disagree (noted below), so **confirm on each provider's own pricing page before you commit**. This is not tax or legal advice: your accountant should confirm the VAT points.

## 1. What it costs to run (before any customers)

| Item | Cost | Notes |
|---|---|---|
| Supabase (database, sign-in, 2FA, file storage) | **$25 a month** (Pro) plus a small extra for the database size (about $5 more is typical) | The free plan pauses when quiet, so it is only fit for testing. Pro includes 100,000 monthly users, 8 GB database, 100 GB files. |
| Railway (runs the website and app) | About **$5 a month** to start | Figure is from our earlier plan, not re-checked today. |
| Email (reminders, sign-up links) | **Free** up to 3,000 emails a month (100 a day) with Resend, then **$20 a month**; Postmark is **$15 a month** for 10,000 | You must have a proper email service before opening sign-up, because Supabase's built-in email is for testing only. |
| Cloudflare (address, security) | Free plan | |
| Domain name | A few pounds a year | |

**Rough total: about £30 to £50 a month.** At the prices set on 8 Nov (£14.99 for the first location), that is covered by roughly 2 to 4 single-location customers. After that, each extra business costs almost nothing to host (a few certificates and some emails), so most of the price is margin. The real costs per customer are payment fees and your time on support.

Not researched yet: solicitor's fee to finish the Terms and Privacy pages, insurance (professional indemnity is worth asking a broker about for a compliance product), and accountant time.

## 2. How customers could pay

| Option | Fee | Good for | Watch out for |
|---|---|---|---|
| **Card via Stripe** | 1.5% + 20p (UK cards); 2.5% + 20p (EU cards); 3.25% + 20p (international) | Instant sign-up, no paperwork | Cards expire and fail, so more chasing. |
| **Direct Debit via Stripe** | 1%, with a 20p minimum and a cap (sources say £2 or £4; check) | Cheapest for monthly or yearly bills; fewer failures | Customer signs a mandate; takes days to settle. |
| **GoCardless (Direct Debit only)** | 1% + 20p, capped (sources say £2 or £4) | Direct Debit specialists | A second supplier to manage; no cards. |
| **Stripe Billing** (the subscription engine on top of Stripe) | **+0.7%** of what it bills | Plans, trials, renewals, failed-payment retries, receipts and a "manage your subscription" page for customers | An extra 0.7%. |

**What it costs on a sample bill** (Stripe Billing included, so it is the whole fee):

| Monthly price | Card | Direct Debit via Stripe | GoCardless |
|---|---|---|---|
| £29 | £0.84 (2.9%) | £0.49 (1.7%) | £0.49 (1.7%) |
| £49 | £1.28 (2.6%) | £0.83 (1.7%) | £0.69 (1.4%) |
| £99 | £2.38 (2.4%) | £1.68 (1.7%) | £1.19 (1.2%) |

Prices here are examples only to show the fee, not suggestions. Paying a year at once cuts fees and chasing: on £490 a year, card costs about £11 and Direct Debit about £5 to £7.

## 3. Recommendation

**Use Stripe for everything: Stripe Billing, with card and Direct Debit offered at sign-up.**

- One supplier, one dashboard, and the customer gets Stripe's ready-made "manage your subscription" page (update card, download invoices, cancel).
- It records straight into the hub, so the Revenue page fills itself in.
- It costs a little more than GoCardless on Direct Debit (about 20p to 60p a bill at these prices), but saves building and running two systems. We can add GoCardless later if volume makes it worthwhile.
- Offer **annual billing** at 15% off (decided 8 Nov). It improves cash flow and fewer payments means fewer failures.
- Start in Stripe's **test mode** against your "TREMCORE Test" project, so nobody is charged while we try it.

## 4. How it would work for a customer

1. Sign-up page (already built) creates their account as a trial.
2. During or at the end of the trial they pick a plan and pay through Stripe's secure page. **Card details never touch our system.**
3. Stripe tells us (a "webhook") when they pay, fail, change plan or cancel. The hub updates automatically: subscription status, monthly value, renewal date.
4. If a payment fails, Stripe retries and emails them; after a grace period their account becomes read-only (they can still see and download their certificates).
5. Customers manage their own subscription from a button in the passport.

## 5. VAT

- Software subscriptions are taxable at 20% in the UK. Registration is compulsory at **£90,000** turnover over any 12 months.
- Your customers are businesses, who can usually reclaim VAT, so registering early often costs them nothing and lets you reclaim VAT on your own costs. Ask your accountant whether to register voluntarily.
- Decide whether prices are shown **excluding VAT** (normal for business software). Stripe can add VAT to invoices.

## 6. What building it involves

- A small amount of new server code on Railway: start a payment, open the customer's subscription page, and receive Stripe's notices (checking each is genuinely from Stripe). It uses plain web requests, so it needs no extra packages.
- New database fields on each company (Stripe customer and subscription references, plan, trial end, renewal date) and a log of payment events so none is processed twice.
- Rules so a cancelled or unpaid account becomes read-only, enforced in the database as for everything else.
- Secret keys live only in Railway settings, never in the code.
- You need to create the Stripe account (company details, bank account and identity checks) and ask for Direct Debit to be switched on.

## 7. Decisions needed from Aaron

Decided 8 Nov: price per location, £14.99 for the first and £7.99 for each extra. Still open:

1. **Refund rule for yearly plans:** if someone cancels part-way through, keep access to the end of the year with no refund (suggested)?
2. **Trial:** how many days, and is a card or Direct Debit needed up front? (Needing none gets more sign-ups; needing one gets more real customers.)
3. **If someone stops paying:** how long before the account goes read-only, and what do we say?
4. **Supplier:** are you happy with Stripe only for now?
5. **VAT:** are you registered or will you register? Prices are set excluding VAT. Ask the accountant.

## Sources

- Stripe UK pricing: https://www.wearefounders.uk/stripe-fees-uk-2026/ · https://erpresearch.com/erp-add-ons/processing/stripe/pricing · https://expertsure.com/uk/merchant-accounts/stripe-review
- Stripe Billing 0.7%: https://www.withorb.com/blog/stripe-billing-pricing · https://erpresearch.com/erp-add-ons/billing-subscriptions/stripe-billing/pricing
- GoCardless: https://www.businessexpert.co.uk/gocardless-review/ · https://kolonell.com/en/blog/online-payment-provider-fees-service-smb-london-2026
- Supabase: https://focusreactive.com/blog/supabase-price/ · https://makerkit.dev/blog/saas/supabase-pricing
- Email: https://automationatlas.io/answers/resend-free-tier-explained-2026/ · https://www.suprsend.com/post/resend-alternatives
- VAT: https://avask.com/blog/uk-vat-threshold-2026/ · https://salarytax.uk/vat-registration-2026-27-thresholds-and-deadlines

## Update 8 Nov: prices set

First location £14.99 a month, each extra location £7.99 a month. Estimated payment fees (Stripe Billing included, approximate):

| Account | Bill | Card | Direct Debit |
|---|---|---|---|
| 1 location | £14.99 | about £0.53 (3.5%) | about £0.31 (2.1%) |
| 3 locations | £30.97 | about £0.88 (2.8%) | about £0.53 (1.7%) |
| 5 locations | £46.95 | about £1.23 (2.6%) | about £0.80 (1.7%) |

The fixed 20p per payment is a bigger share at these prices, so offering **annual billing** and **Direct Debit** matters more. Running costs of about £30 to £50 a month are covered by roughly 2 to 4 single-location customers.

## Update 8 Nov: annual billing set at 15% off

Prices exclude VAT. Yearly: £152.90 for the first location (monthly £14.99, £179.88 a year) and £81.50 for each extra (monthly £7.99, £95.88 a year). Customers choose on the sign-up page.
