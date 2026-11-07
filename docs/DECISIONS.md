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

## Open
- Onboarding flow style (client invite and setup / guided first run / Tremcore's sales-to-signed process).
- Email provider for reminders and job alerts.
- Billing: manual subscription records first; Stripe later.
- Professional review of compliance rules (`supabase/seed.sql` and the legal / standard / best-practice labels).
- Website placeholders: phone, email, address, company number, privacy and terms pages, working contact form.
