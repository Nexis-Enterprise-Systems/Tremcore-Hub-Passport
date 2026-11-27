-- Landlord sub-hubs (invite only, not advertised). A landlord with many tenants gets a free sub-hub. Tremcore sets ONE fixed price per site when creating the landlord
-- and the landlord cannot change it. The landlord chooses which core compliance items they want to see; sites linked to them (each tenant's own company/site) are summarised
-- on their overview. Tenant invites and sign-up come in the next step; this step is the database and what staff set up in the hub.

create table landlords (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 160),
  contact_name text not null default '',
  contact_email text not null check (contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  price_per_site_pence integer not null check (price_per_site_pence between 1 and 100000),   -- the fixed price Tremcore offers tenants; set by Tremcore only
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Which core checks the landlord wants to see (and which fill into every invited tenant's Core list).
create table landlord_core (
  landlord_id uuid not null references landlords(id) on delete cascade,
  code text not null references core_checks(code) on delete cascade,
  primary key (landlord_id, code)
);

-- People who can sign in to a landlord's sub-hub.
create table landlord_users (
  user_id uuid not null references auth.users(id) on delete cascade,
  landlord_id uuid not null references landlords(id) on delete cascade,
  primary key (user_id, landlord_id)
);

-- A tenant site linked to a landlord. paid_by / managed_by are the landlord's choices when inviting.
create table landlord_sites (
  id uuid primary key default gen_random_uuid(),
  landlord_id uuid not null references landlords(id) on delete cascade,
  property_id uuid references properties(id) on delete set null,
  site_name text not null default '' check (char_length(site_name) <= 160),
  tenant_email text check (tenant_email is null or char_length(tenant_email) <= 200),
  paid_by text not null default 'tenant' check (paid_by in ('landlord','tenant')),
  managed_by text not null default 'tenant' check (managed_by in ('landlord','tenant')),
  status text not null default 'invited' check (status in ('invited','active','cancelled')),
  created_at timestamptz not null default now(),
  unique (property_id)
);
create index on landlord_sites(landlord_id);

alter table landlords enable row level security;
alter table landlord_core enable row level security;
alter table landlord_users enable row level security;
alter table landlord_sites enable row level security;

create or replace function landlord_aal2() returns boolean language sql stable as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
$$;
create or replace function my_landlords() returns setof uuid language sql stable security definer set search_path = public as $$
  select lu.landlord_id from landlord_users lu join landlords l on l.id = lu.landlord_id where lu.user_id = auth.uid() and l.active and landlord_aal2()
$$;
revoke all on function my_landlords() from public, anon;
grant execute on function my_landlords() to authenticated;

-- Tremcore staff (2FA) run everything.
create policy landlords_staff on landlords for all using (is_tremcore() and mfa_ok()) with check (is_tremcore() and mfa_ok());
create policy landlord_core_staff on landlord_core for all using (is_tremcore() and mfa_ok()) with check (is_tremcore() and mfa_ok());
create policy landlord_users_staff on landlord_users for all using (is_tremcore() and mfa_ok()) with check (is_tremcore() and mfa_ok());
create policy landlord_sites_staff on landlord_sites for all using (is_tremcore() and mfa_ok()) with check (is_tremcore() and mfa_ok());
-- A landlord can READ their own record (including the price, never change it), and their own sites and people; and choose their core items.
create policy landlords_own_read on landlords for select using (id in (select my_landlords()));
create policy landlord_users_own_read on landlord_users for select using (landlord_id in (select my_landlords()));
create policy landlord_sites_own_read on landlord_sites for select using (landlord_id in (select my_landlords()));
create policy landlord_core_own_read on landlord_core for select using (landlord_id in (select my_landlords()));
create policy landlord_core_own_add on landlord_core for insert with check (landlord_id in (select my_landlords()));
create policy landlord_core_own_remove on landlord_core for delete using (landlord_id in (select my_landlords()));
grant select on landlords, landlord_users, landlord_sites, landlord_core to authenticated;
grant insert, delete on landlord_core to authenticated;

-- Staff: create a landlord with its fixed price per site.
create or replace function create_landlord(p_name text, p_contact_name text, p_email text, p_price_pence integer) returns uuid
language plpgsql security definer set search_path = public as $$
declare nid uuid;
begin
  if not (is_tremcore() and mfa_ok()) then raise exception 'not_allowed' using errcode = '42501'; end if;
  insert into landlords(name, contact_name, contact_email, price_per_site_pence) values (btrim(p_name), btrim(coalesce(p_contact_name, '')), lower(btrim(p_email)), p_price_pence) returning id into nid;
  return nid;
end $$;
revoke all on function create_landlord(text, text, text, integer) from public, anon;
grant execute on function create_landlord(text, text, text, integer) to authenticated;

-- Staff: let an existing signed-up person sign in to a landlord's sub-hub (by email).
create or replace function add_landlord_login(p_landlord uuid, p_email text) returns boolean
language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if not (is_tremcore() and mfa_ok()) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select id into uid from auth.users where lower(email) = lower(btrim(p_email));
  if uid is null then return false; end if;
  insert into landlord_users(user_id, landlord_id) values (uid, p_landlord) on conflict do nothing;
  return true;
end $$;
revoke all on function add_landlord_login(uuid, text) from public, anon;
grant execute on function add_landlord_login(uuid, text) to authenticated;

-- The landlord's overview: one row per linked site with the traffic-light counts of ONLY the core items the landlord chose (missing counts against the total).
create or replace function landlord_overview(p_landlord uuid) returns table (
  landlord_site_id uuid, property_id uuid, site_name text, tenant text, status text, paid_by text, managed_by text, green bigint, amber bigint, red bigint, missing bigint, total bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not ((is_tremcore() and mfa_ok()) or p_landlord in (select my_landlords())) then raise exception 'not_allowed' using errcode = '42501'; end if;
  return query
    select ls.id, ls.property_id, coalesce(nullif(ls.site_name, ''), pr.name, ''), c.name, ls.status, ls.paid_by, ls.managed_by,
      count(s.*) filter (where s.status = 'green'), count(s.*) filter (where s.status = 'amber'), count(s.*) filter (where s.status = 'red'),
      count(s.*) filter (where s.status = 'missing'), count(s.*)
    from landlord_sites ls
    left join properties pr on pr.id = ls.property_id
    left join companies c on c.id = pr.company_id
    left join compliance_status s on s.property_id = ls.property_id and s.is_core
      and s.title in (select cc.label from core_checks cc join landlord_core lc on lc.code = cc.code where lc.landlord_id = ls.landlord_id)
    where ls.landlord_id = p_landlord and ls.status <> 'cancelled'
    group by ls.id, pr.name, c.name
    order by 3;
end $$;
revoke all on function landlord_overview(uuid) from public, anon;
grant execute on function landlord_overview(uuid) to authenticated;
