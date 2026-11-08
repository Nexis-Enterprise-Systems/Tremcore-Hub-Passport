-- Migration 0010: the super admin runs their own team (Level 1 companies).
-- No secret key is needed: the super admin invites an email address, and the invited person creates their own login at /app/?invite=1.
-- When they confirm their email and sign in, accept_invitation() matches the confirmed email to the invitation and sets them up with
-- exactly the permission and sites the super admin chose. Everything is limited to the caller's own company and checked in the database.

create table invitations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  email text not null,
  full_name text not null,
  perm text not null check (perm in ('view', 'update', 'full')),
  property_ids uuid[] not null default '{}',
  invited_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz
);
create unique index invitations_one_open on invitations (company_id, lower(email)) where accepted_at is null;
alter table invitations enable row level security;
revoke all on invitations from anon, authenticated;   -- only the functions below touch it

create or replace function team_allowed_seats(cid uuid) returns int
language sql stable security definer set search_path = public as $$
  select greatest((select count(*) from properties where company_id = cid), 1) + 1 + c.extra_seats from companies c where c.id = cid
$$;
revoke all on function team_allowed_seats(uuid) from public, anon, authenticated;

create or replace function team_members()
returns table (user_id uuid, full_name text, email text, role user_role, perm text, active boolean, property_ids uuid[], is_me boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, u.email, p.role, p.perm::text, p.active,
         coalesce((select array_agg(pp.property_id) from profile_properties pp where pp.profile_id = p.id), '{}'), p.id = auth.uid()
  from profiles p left join auth.users u on u.id = p.id
  where is_client_super() and mfa_ok() and company_access_ok(my_company()) and p.company_id = my_company()
  order by (p.role = 'client_super') desc, p.full_name
$$;
revoke all on function team_members() from public, anon;
grant execute on function team_members() to authenticated;

create or replace function team_pending()
returns table (id uuid, full_name text, email text, perm text, property_ids uuid[], expires_at timestamptz)
language sql stable security definer set search_path = public as $$
  select i.id, i.full_name, i.email, i.perm, i.property_ids, i.expires_at from invitations i
  where is_client_super() and mfa_ok() and company_access_ok(my_company()) and i.company_id = my_company() and i.accepted_at is null and i.expires_at > now()
  order by i.created_at
$$;
revoke all on function team_pending() from public, anon;
grant execute on function team_pending() to authenticated;

-- Seats used / allowed, and the company-wide 2FA switch, for the Team page header.
create or replace function team_summary() returns table (used int, allowed int, require_mfa boolean)
language sql stable security definer set search_path = public as $$
  select (select count(*)::int from profiles p where p.company_id = c.id and p.active and p.role in ('client_super','client_site'))
       + (select count(*)::int from invitations i where i.company_id = c.id and i.accepted_at is null and i.expires_at > now()),
         team_allowed_seats(c.id), c.require_mfa
  from companies c where c.id = my_company() and is_client_super() and mfa_ok() and company_access_ok(c.id)
$$;
revoke all on function team_summary() from public, anon;
grant execute on function team_summary() to authenticated;

create or replace function team_invite(p_email text, p_full_name text, p_perm text, p_property_ids uuid[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid := my_company(); em text := lower(btrim(coalesce(p_email, ''))); fn text := btrim(coalesce(p_full_name, '')); n int; iid uuid; sel uuid[] := coalesce(p_property_ids, '{}');
begin
  if cid is null or not is_client_super() or not mfa_ok() or not company_access_ok(cid) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if em !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or char_length(em) > 200 or char_length(fn) not between 1 and 120 or p_perm not in ('view', 'update', 'full') or cardinality(sel) = 0 then
    raise exception 'invalid_details' using errcode = '22023';
  end if;
  select count(*) into n from properties where company_id = cid and id = any (sel);
  if n <> cardinality(sel) then raise exception 'invalid_details' using errcode = '22023'; end if;
  if exists (select 1 from profiles p join auth.users u on u.id = p.id where p.company_id = cid and lower(u.email) = em) then raise exception 'already_member' using errcode = '23505'; end if;
  if (select used from team_summary()) + 1 > team_allowed_seats(cid) then raise exception 'user_limit_reached' using errcode = '42501'; end if;
  delete from invitations where company_id = cid and lower(email) = em and accepted_at is null;
  insert into invitations(company_id, email, full_name, perm, property_ids, invited_by) values (cid, em, fn, p_perm, sel, auth.uid()) returning id into iid;
  return iid;
end $$;
revoke all on function team_invite(text, text, text, uuid[]) from public, anon;
grant execute on function team_invite(text, text, text, uuid[]) to authenticated;

create or replace function team_cancel_invite(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_client_super() or not mfa_ok() then raise exception 'not_allowed' using errcode = '42501'; end if;
  delete from invitations where id = p_id and company_id = my_company() and accepted_at is null;
end $$;
revoke all on function team_cancel_invite(uuid) from public, anon;
grant execute on function team_cancel_invite(uuid) to authenticated;

-- Change a site user's permission, their sites, or switch them off/on. The super admin cannot be edited this way.
create or replace function team_set_access(p_user uuid, p_perm text, p_property_ids uuid[], p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
declare cid uuid := my_company(); sel uuid[] := coalesce(p_property_ids, '{}'); n int;
begin
  if cid is null or not is_client_super() or not mfa_ok() or not company_access_ok(cid) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if not exists (select 1 from profiles where id = p_user and company_id = cid and role = 'client_site') then raise exception 'not_allowed' using errcode = '42501'; end if;
  if p_perm not in ('view', 'update', 'full') then raise exception 'invalid_details' using errcode = '22023'; end if;
  select count(*) into n from properties where company_id = cid and id = any (sel);
  if n <> cardinality(sel) then raise exception 'invalid_details' using errcode = '22023'; end if;
  update profiles set perm = p_perm::site_perm, active = coalesce(p_active, active) where id = p_user;   -- the seat limit trigger applies if switching on
  delete from profile_properties where profile_id = p_user;
  insert into profile_properties(profile_id, property_id) select p_user, x from unnest(sel) x;
end $$;
revoke all on function team_set_access(uuid, text, uuid[], boolean) from public, anon;
grant execute on function team_set_access(uuid, text, uuid[], boolean) to authenticated;

create or replace function team_set_require_mfa(p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_client_super() or not mfa_ok() or my_company() is null then raise exception 'not_allowed' using errcode = '42501'; end if;
  update companies set require_mfa = coalesce(p_on, false) where id = my_company();
end $$;
revoke all on function team_set_require_mfa(boolean) from public, anon;
grant execute on function team_set_require_mfa(boolean) to authenticated;

-- The invited person, once signed in with a CONFIRMED email, is set up with what the super admin chose. Returns false if there is no invitation.
create or replace function accept_invitation(p_full_name text default null) returns boolean
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); mail text; confirmed timestamptz; inv invitations;
begin
  if uid is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  if exists (select 1 from profiles where id = uid) then return false; end if;
  select u.email, u.email_confirmed_at into mail, confirmed from auth.users u where u.id = uid;
  if confirmed is null then raise exception 'email_not_confirmed' using errcode = '42501'; end if;
  select * into inv from invitations where lower(email) = lower(mail) and accepted_at is null and expires_at > now() order by created_at desc limit 1;
  if not found then return false; end if;
  if not company_access_ok(inv.company_id) then raise exception 'not_allowed' using errcode = '42501'; end if;
  insert into profiles(id, full_name, role, company_id, perm) values (uid, coalesce(nullif(btrim(p_full_name), ''), inv.full_name), 'client_site', inv.company_id, inv.perm::site_perm);
  insert into profile_properties(profile_id, property_id) select uid, x from unnest(inv.property_ids) x where exists (select 1 from properties pr where pr.id = x and pr.company_id = inv.company_id);
  update invitations set accepted_at = now() where id = inv.id;
  return true;
end $$;
revoke all on function accept_invitation(text) from public, anon;
grant execute on function accept_invitation(text) to authenticated;
