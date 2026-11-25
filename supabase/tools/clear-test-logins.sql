-- CLEAR TEST LOGINS AND CLIENT DATA. Run ONCE in the Supabase SQL editor (Live), after taking a backup if you want one.
-- Keeps only these two logins:
--   info@tremcore.co.uk
--   aaron@nexissystems.ae
-- Deletes every other login, and every client company with its sites, checks, documents records, tasks, jobs,
-- staff, shifts, toolbox talks and add-ons. THIS CANNOT BE UNDONE.
-- It stops without deleting anything if either email below is not found as a login, or if neither has a Tremcore admin profile.
-- It does not remove uploaded files from Storage (certificates, photos); those can be emptied in Storage > buckets.

do $$
declare
  keep_emails text[] := array['info@tremcore.co.uk', 'aaron@nexissystems.ae'];
  found int; admins int; n_users int; n_comp int;
begin
  select count(*) into found from auth.users where lower(email) = any (keep_emails);
  if found <> 2 then
    raise exception 'Stopped: expected to find both keep logins in Authentication > Users, found %. Nothing was deleted.', found;
  end if;
  select count(*) into admins from public.profiles p join auth.users u on u.id = p.id
   where lower(u.email) = any (keep_emails) and p.role = 'tremcore_admin' and p.active;
  if admins < 1 then
    raise exception 'Stopped: neither keep login is an active Tremcore admin. Nothing was deleted.';
  end if;

  -- 1) all client companies (this also removes their sites, checks, tasks, jobs, staff, talks and the client profiles)
  select count(*) into n_comp from public.companies;
  delete from public.companies;

  -- 2) offer codes remember who made them; unlink so the logins can be removed
  update public.offer_codes set created_by = null where created_by is not null;

  -- 3) every other login (profiles go with them)
  select count(*) into n_users from auth.users where lower(email) <> all (keep_emails) or email is null;
  delete from auth.users where lower(email) <> all (keep_emails) or email is null;

  raise notice 'Done. Removed % companies and % logins.', n_comp, n_users;
end $$;

-- Check: should list only the two logins.
select u.email, p.role, p.active from auth.users u left join public.profiles p on p.id = u.id order by u.email;
