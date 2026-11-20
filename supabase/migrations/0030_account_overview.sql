-- "Who is who": one table in Supabase (Table Editor > account_overview) listing every login with what it is for:
-- a Tremcore Hub login (administrator or staff) or a customer account (head office or a site user), with the company, plan and status.
-- Read-only, and for you in the Supabase dashboard only: the app and the public cannot read it (it shows email addresses).
create or replace view account_overview as
select
  u.email,
  coalesce(nullif(p.full_name, ''), '(no name)') as name,
  case
    when p.id is null then 'NO ACCESS: login has no profile'
    when p.role = 'tremcore_admin' then 'HUB: administrator'
    when p.role = 'tremcore_staff' then 'HUB: staff'
    when p.role = 'client_super' then 'CUSTOMER: head office'
    when p.role = 'client_site' then 'CUSTOMER: site user (' || p.perm || ')'
  end as account_type,
  c.name as company,
  case c.level when 1 then 'Self-Managed' when 2 then 'Managed Compliance' when 3 then 'Property & Compliance Managed' end as plan,
  c.subscription::text as subscription,
  case when p.id is null then null when p.active then 'active' else 'switched off' end as access,
  case when u.email_confirmed_at is null then 'not confirmed' else 'confirmed' end as email_status,
  u.last_sign_in_at as last_signed_in,
  u.created_at as created,
  u.id as user_id
from auth.users u
left join profiles p on p.id = u.id
left join companies c on c.id = p.company_id
order by (case when p.role in ('tremcore_admin', 'tremcore_staff') then 0 when p.id is null then 2 else 1 end), c.name nulls first, u.email;
revoke all on account_overview from anon, authenticated;
