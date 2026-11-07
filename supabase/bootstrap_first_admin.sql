-- Make the first Tremcore administrator. Run ONCE in the Supabase SQL Editor, after the migration.
-- 1) In Supabase: Authentication > Users > Add user > Create new user (tick "Auto Confirm User").
--    Use your own email and a strong password.
-- 2) Put that SAME email below, then run this script.
insert into public.profiles (id, full_name, role, company_id, perm)
select id, 'Aaron Loveday', 'tremcore_admin', null, 'full'
from auth.users
where email = 'REPLACE-WITH-YOUR-EMAIL'
on conflict (id) do update set role = 'tremcore_admin', active = true;

-- Check it worked (should show one row with role tremcore_admin):
select p.full_name, p.role, u.email from public.profiles p join auth.users u on u.id = p.id;
