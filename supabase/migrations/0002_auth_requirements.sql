-- Migration 0002: lets the sign-in pages ask "who am I and do I need 2FA?" BEFORE the user has passed 2FA.
-- (Normal tables are locked until 2FA is passed for staff and super users, so the sign-in screen needs this one narrow door.)
-- It only ever returns the caller's OWN row, and nothing sensitive.

create or replace function auth_requirements()
returns table (role_name user_role, full_name text, company_id uuid, level smallint, mfa_required boolean)
language sql stable security definer set search_path = public as $$
  select p.role, p.full_name, p.company_id, c.level,
         (p.role in ('tremcore_admin', 'tremcore_staff', 'client_super') or coalesce(c.require_mfa, false))
  from profiles p left join companies c on c.id = p.company_id
  where p.id = auth.uid() and p.active
$$;

revoke all on function auth_requirements() from public, anon;
grant execute on function auth_requirements() to authenticated;
