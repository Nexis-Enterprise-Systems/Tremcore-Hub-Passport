#!/bin/bash
# Builds ONE file that sets up a brand-new, empty Supabase project from scratch (the live one). Run from the repo root: bash supabase/tools/build-live-sql.sh > out.sql
# Newer Supabase projects no longer hand the logged-in role access to new tables automatically, so the top of the file does that, the way the old
# projects (and our tests) did. Row-level security is still what decides who sees which rows.
cat <<'SQL'
-- TREMCORE: complete set-up for a NEW, EMPTY Supabase project. Do not run on a project that holds real data: the first lines clear the "public" area.
drop schema if exists public cascade;
create schema public;
grant usage, create on schema public to postgres;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to authenticated, service_role;
alter default privileges in schema public grant all on sequences to authenticated, service_role;
alter default privileges in schema public grant execute on functions to authenticated, service_role;
SQL
for f in supabase/migrations/*.sql; do echo; echo "-- ======== $(basename "$f") ========"; cat "$f"; done
