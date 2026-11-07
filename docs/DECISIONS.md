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

## Open
- Onboarding flow style (client invite and setup / guided first run / Tremcore's sales-to-signed process).
- Email provider for reminders and job alerts.
- Billing: manual subscription records first; Stripe later.
- Professional review of compliance rules (`supabase/seed.sql` and the legal / standard / best-practice labels).
- Website: self-host the brand fonts (Barlow Condensed, Public Sans); email alert to Tremcore on a new enquiry (needs email provider).
- Website placeholders: phone, email, address, company number, privacy and terms pages, working contact form.
- Pin and add an integrity hash (SRI) to the supabase-js script once packages can be downloaded, or serve a copy from our own server.
- Meaning of 'areas we stipulate' for Managed Service (places vs types of compliance).
- Admin screen to reset a client's 2FA and to invite users (needs a server-side secret key).
