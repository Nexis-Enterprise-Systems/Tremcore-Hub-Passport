-- Staff Clock In / Out: a unique QR code (secret link) per site, a public clock-in page with no login, and an attendance record.
-- The public page never talks to the database directly. Our server calls the two clock functions with the service key, and they are
-- NOT available to signed-in or anonymous users, so nobody can call them from a browser and skip the server's rate limit.

-- 1. One secret token per site (122 random bits). It is the QR code's link. Only the regenerate function may change it.
alter table properties add column clock_token text;
update properties set clock_token = replace(gen_random_uuid()::text, '-', '') where clock_token is null;
alter table properties alter column clock_token set not null;
alter table properties alter column clock_token set default replace(gen_random_uuid()::text, '-', '');
create unique index properties_clock_token_key on properties(clock_token);

create or replace function properties_lock_token() returns trigger language plpgsql as $$
begin
  if new.clock_token is distinct from old.clock_token and coalesce(current_setting('tc.regen', true), '') <> 'on' then
    raise exception 'clock_token_locked' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger properties_lock_token before update of clock_token on properties for each row execute function properties_lock_token();

-- 2. The attendance record. Rows are created only by the clock function; managers can only close one that is still open.
create table staff_attendance (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  member_id uuid references staff_members(id) on delete set null,
  member_name text not null,                       -- kept as written at the time, so the record survives a person being removed
  clocked_in timestamptz not null default now(),
  clocked_out timestamptz,
  no_clock_out boolean not null default false,     -- the person never clocked out; closed off when they next clocked in
  closed_by text check (closed_by in ('person', 'manager')),
  check (clocked_out is null or clocked_out >= clocked_in)
);
create index on staff_attendance(property_id, clocked_in desc);
create unique index staff_attendance_one_open on staff_attendance(member_id) where clocked_out is null and not no_clock_out;
alter table staff_attendance enable row level security;
create policy attendance_read on staff_attendance for select using (can_access_property(property_id) and site_has_extra(property_id, 'staff_signin'));
create policy attendance_close on staff_attendance for update
  using (can_edit_property(property_id) and site_has_extra(property_id, 'staff_signin') and clocked_out is null)
  with check (can_edit_property(property_id) and site_has_extra(property_id, 'staff_signin'));
create or replace function attendance_guard() returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('tc.clock', true), '') = 'on' then return new; end if;   -- the clock function itself (server only)
  if new.property_id is distinct from old.property_id or new.member_id is distinct from old.member_id or new.member_name is distinct from old.member_name
     or new.clocked_in is distinct from old.clocked_in or new.no_clock_out is distinct from old.no_clock_out then
    raise exception 'attendance_locked' using errcode = '42501';
  end if;
  if old.clocked_out is not null then raise exception 'attendance_locked' using errcode = '42501'; end if;
  if new.clocked_out is null or new.clocked_out > now() + interval '1 minute' then raise exception 'attendance_bad_time' using errcode = '23514'; end if;
  new.closed_by := 'manager';
  return new;
end $$;
create trigger attendance_guard before update on staff_attendance for each row execute function attendance_guard();
create trigger attendance_audit after update on staff_attendance for each row execute function audit_row();

-- 3. The public clock page. Returns the site name and the active people with whether each is in right now.
--    The same answer for a wrong token and for a site whose Staff Clock In / Out has stopped, so a token cannot be tested for existence.
create or replace function clock_site_info(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pr properties%rowtype;
begin
  if p_token is null or char_length(p_token) <> 32 then return null; end if;
  select * into pr from properties where clock_token = p_token;
  if not found or not site_has_extra(pr.id, 'staff_signin') then return null; end if;
  return jsonb_build_object('site', pr.name, 'people', coalesce((
    select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.full_name,
      'in', exists (select 1 from staff_attendance a where a.member_id = m.id and a.clocked_out is null and not a.no_clock_out)) order by m.full_name)
    from staff_members m where m.property_id = pr.id and m.active), '[]'::jsonb));
end $$;

-- 4. Clock in or out. A double tap is harmless: it reports "already in" / "already out" instead of making a second record.
create or replace function clock_action(p_token text, p_member uuid, p_action text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pr properties%rowtype; m staff_members%rowtype; a staff_attendance%rowtype; t timestamptz := now();
begin
  if p_action not in ('in', 'out') or p_token is null or char_length(p_token) <> 32 then return null; end if;
  select * into pr from properties where clock_token = p_token;
  if not found or not site_has_extra(pr.id, 'staff_signin') then return null; end if;
  select * into m from staff_members where id = p_member and property_id = pr.id and active;
  if not found then return null; end if;
  perform set_config('tc.clock', 'on', true);
  select * into a from staff_attendance where member_id = m.id and clocked_out is null and not no_clock_out for update;
  if p_action = 'in' then
    if found then
      if a.clocked_in > t - interval '18 hours' then perform set_config('tc.clock', 'off', true); return jsonb_build_object('status', 'already_in', 'name', m.full_name, 'at', a.clocked_in); end if;
      update staff_attendance set no_clock_out = true where id = a.id;   -- forgot to clock out yesterday: say so honestly, do not invent a time
    end if;
    insert into staff_attendance(property_id, member_id, member_name, clocked_in) values (pr.id, m.id, m.full_name, t);
    perform set_config('tc.clock', 'off', true);
    return jsonb_build_object('status', 'in', 'name', m.full_name, 'at', t);
  end if;
  if not found then perform set_config('tc.clock', 'off', true); return jsonb_build_object('status', 'already_out', 'name', m.full_name); end if;
  update staff_attendance set clocked_out = t, closed_by = 'person' where id = a.id;
  perform set_config('tc.clock', 'off', true);
  return jsonb_build_object('status', 'out', 'name', m.full_name, 'at', t, 'since', a.clocked_in);
end $$;
revoke all on function clock_site_info(text) from public, anon, authenticated;
revoke all on function clock_action(text, uuid, text) from public, anon, authenticated;
grant execute on function clock_site_info(text) to service_role;
grant execute on function clock_action(text, uuid, text) to service_role;

-- 5. A manager can replace a site's QR code (for example if the poster was photographed or taken away). The old code stops working at once.
create or replace function regen_clock_token(p_property uuid) returns text
language plpgsql security definer set search_path = public as $$
declare tok text := replace(gen_random_uuid()::text, '-', '');
begin
  if not (can_manage_property(p_property) and mfa_ok() and site_has_extra(p_property, 'staff_signin')) then raise exception 'not_allowed' using errcode = '42501'; end if;
  perform set_config('tc.regen', 'on', true);
  update properties set clock_token = tok where id = p_property;
  perform set_config('tc.regen', 'off', true);
  return tok;
end $$;
revoke all on function regen_clock_token(uuid) from public, anon;
grant execute on function regen_clock_token(uuid) to authenticated;
