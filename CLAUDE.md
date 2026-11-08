# Tremcore Compliance Passport and Management Hub

Owner: Aaron Loveday (Tremcore Ltd). Two connected parts: the **client app** (compliance passport) and the **Tremcore hub** (internal management). One system; the hub controls the data and permissions behind the client app. Branding: black and gold, clean and corporate, works on phone, tablet and desktop.

## Read first
- `docs/BUILD-PLAN.md` — state, decisions, stack, phases, open items
- `docs/DECISIONS.md` — decisions that must not be silently changed
- `prototype/` — the clickable prototypes that define look, behaviour and copy (`app-v17.html`, `website-v28.dc.html`). Treat them as the design reference, not as production code.

## Product rules (do not change without asking Aaron)
- **Level 1 Self-Managed**: client edits their own records, categories, titles, dates, certificates; gets email reminders.
- **Level 2 Managed Compliance**: client is **view-only**; Tremcore maintains everything in the hub; no reactive jobs.
- **Level 3 Property & Compliance Managed**: Level 2 plus "Raise a Job" (priority, issue type incl. Other, location, description, photos). A new job emails Tremcore and is tracked in the hub.
- Every client screen has a **Call Tremcore** button at the top.
- **Traffic light**: green > 30 days to the due date; amber within 30 days; red past due; **missing/not entered is never green**. Percentages count missing items against the total.
- Compliance items carry a basis: legal / standard / best practice. The legal-basis wording is illustrative and **needs professional review**; never present it as legal advice.
- Multi-site clients: a head-office **super user** sees all sites and a dashboard split by site; each site gets its own login with `view` / `update` / `full` permission limited to assigned sites.
- The public website sells **Level 1 (sign-up)** and shows the **Managed Service (Level 2)** by enquiry only, and only within the set distance of the base point (Medway, 30 miles, changeable in hub Settings). Level 3 is not offered. Keep it dark-only.

## Security rules
- Permissions are enforced by the **database (row-level security)**, never only by hiding UI. A Level 2 client must fail to edit or raise a job even by calling the API directly. `supabase/tests/01_permissions.sql` proves this; keep it passing and extend it with every new table or rule.
- 2FA (authenticator app codes, TOTP) is **compulsory** for Tremcore staff and client super users, optional per company for site users (`companies.require_mfa`). Enforced in the database through `mfa_ok()` (aal2).
- Private storage buckets only. Paths are `{property_id}/...` and policies key off that first folder.
- Never commit secrets. Real keys live in Supabase and Railway settings; `.env.example` lists names only. The Supabase **service role key** is for server code only and must never reach the browser.
- Keep an audit trail of changes to compliance records, documents, renewals and jobs (triggers already do this).

## Environments
- Supabase **staging** project: "TREMCORE Test". A separate production project will be created later. Never run experiments against production.
- Deploys: Railway, from GitHub. Work on a branch, open a pull request, Aaron reviews and merges. Do not push straight to `main`.

## Working method
- The web app in `web/` has **no build step and no npm packages** (the cloud workspace blocks package downloads). Browser code uses `supabase-js` from a pinned jsdelivr URL. The CSP in `web/server.js` allows only that CDN, so any new external script must be added there on purpose.
- Web changes: run `npm run test:web` (Playwright, uses a pretend Supabase in `web/tests/mock-supabase.js`). The real sign-in can only be proven on a real Supabase project.
- Aaron works from several computers; everything must be in this repo, none only on one machine.
- Schema changes go in new numbered files in `supabase/migrations/` (never edit an applied migration). Run the tests locally before committing:
  `bash supabase/tests/run.sh` (needs a local Postgres; see the script).
- Keep numbered, dated versions of the prototypes in `prototype/` when they change, and tell Aaron the version number.
- Plain, friendly English for Aaron; he is not a developer. Say what changed and what he needs to do, no jargon.
