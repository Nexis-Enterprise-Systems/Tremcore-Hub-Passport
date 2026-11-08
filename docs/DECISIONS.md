# Decisions log

| Date | Decision |
|---|---|
| 2026-11-04 | Public website shows Level 1 only; Levels 2 and 3 stay built but hidden. Website is dark-only. |
| 2026-11-04 | Multi-site: head-office super user plus per-site logins with view / update / full permission. |
| 2026-11-07 | Stack: Supabase (database, auth, storage), Railway (hosting, scheduled jobs), Cloudflare (DNS and protection), GitHub (code). Installable web app first; store apps later. |
| 2026-11-07 | 2FA compulsory for Tremcore staff and client super users; per-company option for site users. Authenticator app first, email-code fallback, backup codes, passkeys later. |
| 2026-11-07 | Permissions enforced by row-level security in the database. Level 1 clients edit; Level 2 and 3 clients are view-only; only Level 3 can raise jobs. |
| 2026-11-07 | Staging Supabase project is "TREMCORE Test". Production project to be created later. |
| 2026-11-07 | App Store name placeholder "Tremcore Passport", icon = gold T-in-circle logo. |
| 2026-11-07 | Launch scope: Self-Managed (Level 1) and a low-level Managed Service (Level 2, limited to areas Aaron stipulates). Level 3 deferred; its tables stay unused. |
| 2026-11-07 | Web app built with no build step (plain pages + dependency-free Node server) because the workspace blocks npm. Installable as a phone/desktop app (PWA); store wrappers later. |
| 2026-11-07 | 2FA recovery: Supabase TOTP has no backup codes, so a lost phone is handled by a Tremcore admin resetting the factor after identity checks. |
| 2026-11-07 | Website lives at the main address (`/`); the passport sign-in moved to `/app/`. Website uses system fonts for now (no third-party requests); enquiries are saved to the `enquiries` table and read in the hub. |
| 2026-11-07 | Management hub stage 1 lives inside `/app/` for Tremcore staff only (`hub.js`): dashboard, clients, sites, compliance items, manual subscriptions, enquiries. Package picker offers Levels 1 and 2 only. Every read and write goes through Supabase as the signed-in staff member, so row-level security decides what is allowed. No database change was needed. |
| 2026-11-08 | Self-Managed sign-up (migration 0004). Anyone can create an account only as a **Level 1 trial** at no charge; package, price and 2FA settings are fixed by the database, never chosen by the person. It is **closed by default** and Tremcore administrators switch it on or off in the hub under Settings. Email must be confirmed first. Sign-up details are kept with the login until the emailed link is used, then the first sign-in creates the company, head-office user and first site. Self sign-ups are marked in the hub; Tremcore agrees the plan and sets the subscription to Active by hand. The public site shows "Create an account" buttons only while sign-up is open. |
| 2026-11-08 | Terms and Privacy pages exist at `/terms/` and `/privacy/` as clearly marked **drafts for legal review** (not indexed, not linked from the footer). Sign-up must not be opened to the public until they are reviewed and finished. |

## Open
- Before opening sign-up: in Supabase switch on email sign-ups and Confirm email, add the live address to the allowed redirect URLs, and choose an email provider (Supabase's built-in email is rate-limited and only for testing). Review the Terms and Privacy drafts. Decide trial length, price wording and what happens when a trial ends.
- What a self-signed client sees after sign-in is a holding page until the Level 1 passport (records, certificates, reminders) is built: that is the next build.
- Onboarding flow style (client invite and setup / guided first run / Tremcore's sales-to-signed process).
- Email provider for reminders and job alerts.
- Billing: manual subscription records first; Stripe later.
- Professional review of compliance rules (`supabase/seed.sql` and the legal / standard / best-practice labels).
- Website: self-host the brand fonts (Barlow Condensed, Public Sans); email alert to Tremcore on a new enquiry (needs email provider).
- Website placeholders: phone, email, address, company number, privacy and terms pages, working contact form.
- Pin and add an integrity hash (SRI) to the supabase-js script once packages can be downloaded, or serve a copy from our own server.
- Meaning of 'areas we stipulate' for Managed Service (places vs types of compliance).
- Admin screen to reset a client's 2FA and to invite users (needs a server-side secret key). The hub's client page shows the people list read-only until this exists.
- Hub stage 2: certificate upload and download on compliance items, renewal task stages (due soon, booking required, booked, completed), audit history view, delete or archive a client, Level 2 "areas we stipulate" once Aaron defines it.

- **8 Nov 2026 — Pricing shape:** one price for the first business unit plus an extra price per additional unit (assumed: a unit = a site). Prices, trial length and non-payment rules still to be set. See `docs/PAYMENTS-AND-COSTS.md` and `docs/BUILD-PROCESS-AND-GO-LIVE.md`.
