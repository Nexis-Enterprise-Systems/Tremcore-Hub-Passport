# Tremcore Hub Passport

Compliance Passport app for clients and the Tremcore management hub. See `CLAUDE.md` for the rules and `docs/BUILD-PLAN.md` for the plan.

## Layout
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
