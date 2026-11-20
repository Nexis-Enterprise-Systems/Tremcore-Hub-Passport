-- A switch for the compulsory 2FA rule. Until now Tremcore staff and customer head-office users ALWAYS needed an authenticator code.
-- The setting 'enforce_2fa' (Hub > Settings, administrators only) turns that rule on or off for everyone at once.
-- Aaron chose to switch it OFF for testing (20 Nov 2026). It must be switched back ON before real customers use the system.
-- A company that has asked for 2FA for its own site users (companies.require_mfa) still gets it either way.
insert into app_settings(key, value) values ('enforce_2fa', 'false'::jsonb) on conflict (key) do nothing;

create or replace function mfa_enforced() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select value = 'true'::jsonb from app_settings where key = 'enforce_2fa'), true)   -- no setting means the strict rule
$$;
revoke all on function mfa_enforced() from public, anon;
grant execute on function mfa_enforced() to authenticated;

create or replace function mfa_ok() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when p.role in ('tremcore_admin','tremcore_staff','client_super') and mfa_enforced() then coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
      when c.require_mfa then coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
      else true
    end
    from profiles p left join companies c on c.id = p.company_id
    where p.id = auth.uid() and p.active
  ), false)
$$;

create or replace function auth_requirements()
returns table (role_name user_role, full_name text, company_id uuid, level smallint, mfa_required boolean)
language sql stable security definer set search_path = public as $$
  select p.role, p.full_name, p.company_id, c.level,
         ((p.role in ('tremcore_admin', 'tremcore_staff', 'client_super') and mfa_enforced()) or coalesce(c.require_mfa, false))
  from profiles p left join companies c on c.id = p.company_id
  where p.id = auth.uid() and p.active
$$;
