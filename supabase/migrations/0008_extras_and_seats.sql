-- Migration 0008: what is included in the price (users), and the paid extras (Toolbox Talks, Staff Sign In/Out).
--
-- Self-Managed price: £14.99/month covers 1 site, 1 super admin and 1 manager (2 sign-in users).
-- Every additional site is £7.99/month and adds 1 more sign-in user. So a Level 1 company may have (sites + 1) sign-in users,
-- plus any goodwill seats Tremcore grants (companies.extra_seats). Staff who only sign in/out on site are NOT sign-in users.
-- Extras are flat monthly prices per company: Toolbox Talks £3.99, Staff Sign In/Out £4.99, whatever the number of users.
-- An extra is switched on only by the payment confirmation (server side) or by Tremcore staff. Clients can read theirs, never write.

alter table companies add column extra_seats int not null default 0 check (extra_seats >= 0);

create or replace function enforce_seat_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare lvl smallint; sites int; used int; allowed int;
begin
  if new.company_id is null or not new.active or new.role not in ('client_super', 'client_site') then return new; end if;
  select c.level, c.extra_seats into lvl, allowed from companies c where c.id = new.company_id;
  if lvl is distinct from 1 then return new; end if;
  select count(*) into sites from properties where company_id = new.company_id;
  select count(*) into used from profiles
   where company_id = new.company_id and active and role in ('client_super', 'client_site') and id <> new.id;
  if used + 1 > greatest(sites, 1) + 1 + allowed then
    raise exception 'user_limit_reached' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger profiles_seat_limit before insert or update of company_id, active, role on profiles
  for each row execute function enforce_seat_limit();

create table extras (
  code text primary key,
  name text not null,
  description text not null default '',
  price_pence int not null check (price_pence >= 0),
  active boolean not null default true
);
insert into extras(code, name, description, price_pence) values
  ('toolbox_talks', 'Toolbox Talks', '30 core toolbox talks plus up to 10 of your own, with digital employee acknowledgement and signature, saved as downloadable PDFs.', 399),
  ('staff_signin', 'Staff Sign In/Out', 'Staff sign in and out of site; a live and historic record of who was on site.', 499);

create table company_extras (
  company_id uuid not null references companies(id) on delete cascade,
  extra_code text not null references extras(code),
  status text not null default 'active' check (status in ('active', 'cancelling', 'cancelled')),
  price_pence int not null check (price_pence >= 0),
  started_at timestamptz not null default now(),
  cancel_requested_at timestamptz,
  access_ends_at timestamptz,
  stripe_item_id text,
  primary key (company_id, extra_code)
);

alter table extras enable row level security;
alter table company_extras enable row level security;
create policy extras_read on extras for select using (auth.uid() is not null and active);
create policy extras_write on extras for all using (mfa_ok() and is_tremcore_admin()) with check (mfa_ok() and is_tremcore_admin());
create policy company_extras_read on company_extras for select
  using (mfa_ok() and (is_tremcore() or (company_id = my_company() and company_access_ok(company_id))));
create policy company_extras_write on company_extras for all
  using (mfa_ok() and is_tremcore()) with check (mfa_ok() and is_tremcore());

-- Does this company have this extra right now? (A cancelling extra stays on until its end date.)
create or replace function has_extra(cid uuid, code text) returns boolean
language sql stable security definer set search_path = public as $$
  select company_access_ok(cid) and exists (
    select 1 from company_extras e where e.company_id = cid and e.extra_code = code
      and (e.status = 'active' or (e.status = 'cancelling' and e.access_ends_at > now())))
$$;
revoke all on function has_extra(uuid, text) from public, anon;
grant execute on function has_extra(uuid, text) to authenticated;
