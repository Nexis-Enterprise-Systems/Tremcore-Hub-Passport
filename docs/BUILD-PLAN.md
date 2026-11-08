# Tremcore — handover and build plan (7 Nov 2026)

## Where we are
Clickable prototypes only. Nothing is saved to a server; data lives in memory and is lost on refresh.

| Item | Version | Where |
|---|---|---|
| Client app + hub prototype | App v17 | Claude artifact (Compliance Passport) · file `claude/versions/app-v17-2026-11-04.html` |
| Website (Level 1 only, dark, 5 pages) | Website v28 | Claude Design artifact · file `claude/versions/website-v28-2026-11-04.html` |
| App Store / Google Play preview | v6 | Claude Design artifact "Tremcore App Store Preview" |

Prototype already covers: three subscription levels with permission rules, hub (clients, properties, subcontractors, create client, subscriptions), traffic-light dashboard, filter-responsive donuts (legal / standard / best practice), site plans and 3D walkthrough with numbered safety markers and photos, PDF floor-plan import, multi-site clients with head-office super user and per-site logins.

## Build status (updated 7 Nov 2026)
Done in the real app (8 Nov): monthly or yearly billing choice at sign-up (run migration 0005), Self-Managed sign-up, closed until switched on in the hub. Before that: database and permission tests, sign-in with 2FA, public website with enquiry form, **management hub stage 1** (dashboard, clients, sites, compliance items, subscriptions, enquiries). Next: certificates and renewals in the hub, user invites (needs the server key), then the Self-Managed passport and the Managed Service view for clients.

## Decisions made
- Website shows **Level 1 only** for now. Levels 2 and 3 stay built in the prototype but hidden publicly.
- Website stays dark-only.
- Traffic light: green >30 days, amber within 30 days, red overdue, grey/"not entered" never shown as green.
- Compliance % must be based on real records and treat missing data clearly.
- Legal-basis labels (BRULES) are from Claude's own knowledge and **need professional review** before clients rely on them.
- 2FA required: compulsory for Tremcore staff and head-office super users; site users strongly encouraged or per-client setting. Authenticator app (TOTP) first, email code fallback, backup codes, trusted-device option, passkeys later. Enforce on the server.
- App name and logo for stores: "Tremcore Passport" with the gold T-in-circle logo (placeholder name).

## Recommended stack (costs from research, USD ex-VAT, check before committing)
- **Supabase**: database, auth (incl. TOTP 2FA), private file storage, row-level security. Free tier pauses; Pro from $25/mo.
- **Railway** (Hobby from $5/mo incl. usage): small API / scheduled jobs (reminder emails, renewals) if needed beyond Supabase functions.
- **Cloudflare** Free: DNS, SSL, CDN, basic protection.
- Email: transactional provider (Resend / Postmark or similar) — to choose.
- Billing: Stripe later; manual subscription records to start.
- Mobile: installable web app first; wrap for iOS/Android when there are paying clients. Apple Developer ~$99/yr, Google Play ~$25 one-off.

## Build phases (rough, small team or one developer using Claude)
1. **Foundations (3–5 wks):** schema (companies, properties, users, categories, records, documents, jobs, audit log), auth + 2FA, row-level security so permissions are enforced by the system not the screen, private storage.
2. **Level 1 web app (4–6 wks):** passport, traffic-light dashboard, certificates, custom categories, email reminders, multi-site users.
3. **Management hub (4–6 wks):** clients, properties, subscriptions (manual), then Levels 2/3 (renewal tasks, jobs, subcontractors).
4. **Onboarding (2–3 wks):** invites, company/sites/users setup, guided first-run checklist.
5. **Site plans and 3D (3–5 wks):** saved plans, PDF import, photos on safety items.
6. **Billing + store apps (4–7 wks):** Stripe, push notifications, store listings.
7. **Testing, security review, legal review (2–3 wks).**
Launch target for Level 1 on the web: about 8–12 weeks. Full build: about 5–7 months.

## Next actions (suggested order)
1. Confirm stack and create the Supabase project.
2. Write the data schema and permission rules from the prototype's `state` shape (clients, properties, items, users, plans).
3. Build sign-in + 2FA first, then Level 1 passport against real data.
4. Onboarding flow (client sign-up/invite → company, sites, users → first passport setup).
5. Professional review of the compliance rules and legal pages (privacy, terms), company details on the website.

## Open items
- Onboarding style not yet chosen (client invite and setup vs guided first-run vs Tremcore's own sales-to-signed process).
- Website: real contact-form route, legal pages, phone/email/address/company number still placeholders.
- Optional: restore Level 2/3 pages on a private website copy; strip unreachable Level 2/3 code from the public site.
- Prototype caveats: plans, photos, users not persisted; invites simulated; PDF import untested; no collision or stairs when walking inside 3D; 3D needs internet.
- Store preview has only listing + 2 screenshots; plan, 3D, reminders screenshots not made.
