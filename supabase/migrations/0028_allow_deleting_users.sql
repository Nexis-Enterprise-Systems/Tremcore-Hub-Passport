-- Deleting a user in Supabase failed ("Database error deleting user") whenever that person had created or uploaded anything:
-- several columns pointed at the person with no rule for what to do when they are deleted. From now on the record stays and the
-- "created by / uploaded by" column is simply cleared. This changes every such column found, so new ones are covered too.
do $$
declare r record; cols text; refcols text; cname text;
begin
  for r in
    select c.conname, c.conrelid::regclass as tbl, c.confrelid::regclass as ref, c.conkey, c.confkey, c.conrelid, c.confrelid as refid
      from pg_constraint c
     where c.contype = 'f' and c.confdeltype = 'a'                       -- no rule on delete
       and c.confrelid in ('public.profiles'::regclass, 'auth.users'::regclass)
       and c.connamespace = 'public'::regnamespace
       and array_length(c.conkey, 1) = 1
       and not (select a.attnotnull from pg_attribute a where a.attrelid = c.conrelid and a.attnum = c.conkey[1])   -- only columns that may be empty
  loop
    select a.attname into cols from pg_attribute a where a.attrelid = r.conrelid and a.attnum = r.conkey[1];
    select a.attname into refcols from pg_attribute a where a.attrelid = r.refid and a.attnum = r.confkey[1];
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
    execute format('alter table %s add constraint %I foreign key (%I) references %s (%I) on delete set null', r.tbl, r.conname, cols, r.ref, refcols);
  end loop;
end $$;
