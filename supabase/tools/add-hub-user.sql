-- Give a login access to the Tremcore Hub.
-- 1. In Supabase: Authentication > Users > Add user > Create new user. Type the email and a password and tick "Auto Confirm User".
-- 2. Change the three values on the "declare" lines below, then press Run.
--    Role: 'tremcore_admin' (can do everything, including Settings) or 'tremcore_staff' (everything except Settings).
-- 3. To stop an old login (for example the Gmail one) using the Hub, put its email in old_email. Leave it as '' to skip.
do $$
declare
  v_email text := 'PUT-THE-NEW-EMAIL-HERE';
  v_name  text := 'PUT THE PERSON''S NAME HERE';
  v_role  user_role := 'tremcore_admin';
  old_email text := '';
  v_id uuid;
begin
  select id into v_id from auth.users where lower(email) = lower(btrim(v_email));
  if v_id is null then
    raise exception 'No login found for "%". Create it first under Authentication > Users > Add user, then run this again.', v_email;
  end if;
  insert into profiles(id, full_name, role, company_id, perm, active) values (v_id, v_name, v_role, null, 'full', true)
  on conflict (id) do update set full_name = excluded.full_name, role = excluded.role, company_id = null, perm = 'full', active = true;
  if btrim(old_email) <> '' then
    update profiles set active = false where id = (select id from auth.users where lower(email) = lower(btrim(old_email))) and id <> v_id;
  end if;
  raise notice 'Done: % now has Hub access as %.', v_email, v_role;
end $$;
