-- Give logins access to the Tremcore Hub (one or several people at once).
-- 1. In Supabase: Authentication > Users > Add user > Create new user, once per person. Type the email and a password and tick "Auto Confirm User".
-- 2. Edit the list under "the people" below (one line per person), then press Run.
--    Role: 'tremcore_admin' (everything, including Settings) or 'tremcore_staff' (everything except Settings).
-- 3. To stop an old login (for example a Gmail one) using the Hub, put its email in old_emails. Leave it as an empty list to skip.
do $$
declare
  r record; v_id uuid; old text;
  old_emails text[] := array[]::text[];            -- for example: array['me@gmail.com']
begin
  for r in select * from (values
    -- the people:  (email, name, role)
    ('PUT-FIRST-EMAIL-HERE', 'PUT FIRST NAME HERE', 'tremcore_admin'),
    ('PUT-SECOND-EMAIL-HERE', 'PUT SECOND NAME HERE', 'tremcore_staff')
  ) as t(email, name, role) loop
    select id into v_id from auth.users where lower(email) = lower(btrim(r.email));
    if v_id is null then
      raise exception 'No login found for "%". Create it first under Authentication > Users > Add user (tick Auto Confirm User), then run this again.', r.email;
    end if;
    insert into profiles(id, full_name, role, company_id, perm, active) values (v_id, r.name, r.role::user_role, null, 'full', true)
    on conflict (id) do update set full_name = excluded.full_name, role = excluded.role, company_id = null, perm = 'full', active = true;
    raise notice 'Done: % now has Hub access as %.', r.email, r.role;
  end loop;
  foreach old in array old_emails loop
    update profiles set active = false where id = (select id from auth.users where lower(email) = lower(btrim(old)));
    raise notice 'Switched off Hub access for %.', old;
  end loop;
end $$;
