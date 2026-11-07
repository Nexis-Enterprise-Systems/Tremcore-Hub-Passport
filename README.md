# Tremcore Hub Passport

Compliance Passport app for clients and the Tremcore management hub. See `CLAUDE.md` for the rules and `docs/BUILD-PLAN.md` for the plan.

## Layout
- `web/` — the web app (no build step; plain pages + a tiny Node server). `web/public/` is what browsers get.
- `prototype/` — clickable design prototypes (reference only)
- `supabase/migrations/` — database schema, permissions (row-level security) and 2FA rules
- `supabase/seed.sql` — starter library of compliance titles (needs professional review)
- `supabase/tests/` — permission tests that run on a plain local Postgres
- `docs/` — build plan and decisions

## Apply the schema to the staging project ("TREMCORE Test")
In the Supabase dashboard open **SQL Editor**, paste `supabase/migrations/0001_core.sql`, run it, then paste and run `supabase/seed.sql`.
(Later, once the Supabase command-line tool is set up, this becomes `supabase db push`.)

## Run the permission tests locally
`bash supabase/tests/run.sh`

## Run the web app
`npm start` (needs `SUPABASE_URL` and `SUPABASE_ANON_KEY` set; see `.env.example`). Test: `npm run test:web` and `npm run test:db`.

## Deploy on Railway
1. New project > Deploy from GitHub repo > `Tremcore-Hub-Passport`.
2. Variables: `SUPABASE_URL` and `SUPABASE_ANON_KEY` (Supabase > Project Settings > API). Do **not** add the service-role key yet; nothing needs it.
3. Railway runs `npm start` and checks `/healthz`.

## Supabase settings the sign-in needs
- Authentication > Providers > Email: on. Turn **off** "Allow new users to sign up" (clients are invited by Tremcore, not self-registered).
- Authentication > Multi-Factor: **TOTP** enabled.
- Authentication > Password: minimum length 12; turn on leaked-password protection if your plan has it.
- Authentication > URL Configuration: add your Railway address (and later your own domain) as the **Site URL** and a Redirect URL, so reset emails link back to the app.
