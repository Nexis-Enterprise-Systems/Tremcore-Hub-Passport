-- Floor plans: one set of drawings per site (all floors), drawn by Tremcore staff in the hub. Each floor has a "published" copy (made when the floor is Finished);
-- only the published copies are ever shown to visitors, through the QR code page at /f/<public_key>.

create table floor_plans (
  property_id uuid primary key references properties(id) on delete cascade,
  data jsonb not null default '[]'::jsonb check (jsonb_typeof(data) = 'array' and pg_column_size(data) < 8000000),
  public_key text not null unique default replace(gen_random_uuid()::text, '-', ''),
  updated_by uuid references profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table floor_plans enable row level security;
-- Tremcore staff (with 2FA) can read and change every plan. A client can only READ the plans of their own company's sites.
create policy floor_plans_staff on floor_plans for all using (is_tremcore() and mfa_ok()) with check (is_tremcore() and mfa_ok());
create policy floor_plans_client_read on floor_plans for select
  using (mfa_ok() and exists (select 1 from properties p where p.id = floor_plans.property_id and p.company_id = my_company() and company_access_ok(p.company_id)));

create or replace function floor_plans_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); new.updated_by := auth.uid(); return new; end $$;
create trigger floor_plans_touch before insert or update on floor_plans for each row execute function floor_plans_touch();

-- What the QR page shows: the site name and ONLY the published copy of each floor (never drafts). Only the server (service key) can ask, with the secret key from the QR code.
create or replace function floor_plan_public(p_key text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  select jsonb_build_object('site', pr.name, 'plans', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.value ->> 'id', 'floor', e.value -> 'floor', 'name', e.value ->> 'name', 'published', e.value -> 'published') order by (e.value ->> 'floor')::int nulls last)
        from jsonb_array_elements(f.data) e where jsonb_typeof(e.value -> 'published') = 'object'), '[]'::jsonb))
    into r from floor_plans f join properties pr on pr.id = f.property_id where f.public_key = p_key;
  return r;
end $$;
revoke all on function floor_plan_public(text) from public, anon, authenticated;
grant execute on function floor_plan_public(text) to service_role;
