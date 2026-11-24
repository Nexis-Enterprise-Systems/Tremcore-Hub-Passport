-- 0034: weekly shifts for the people on the Staff Clock In / Out list.
-- One shift per person per weekday (1 = Monday ... 7 = Sunday). A day with no row is a day off.
-- If the end time is earlier than the start time the shift runs past midnight (for example 22:00 to 06:00).
-- The report compares each clock-in and clock-out with the shift. Same rules as the people list: only people who may edit the site, and only
-- where the Staff Clock In / Out add-on is on. The site is copied from the person by the database, so it can never be pointed at another site.

create table staff_shifts (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references staff_members(id) on delete cascade,
  property_id uuid not null references properties(id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7),
  start_time time not null,
  end_time time not null,
  created_at timestamptz not null default now(),
  unique (member_id, weekday),
  check (start_time <> end_time)
);
create index on staff_shifts(property_id);
alter table staff_shifts enable row level security;
create policy shifts_read   on staff_shifts for select using (can_access_property(property_id) and site_has_extra(property_id, 'staff_signin'));
create policy shifts_insert on staff_shifts for insert with check (can_edit_property(property_id) and site_has_extra(property_id, 'staff_signin'));
create policy shifts_update on staff_shifts for update using (can_edit_property(property_id) and site_has_extra(property_id, 'staff_signin'))
  with check (can_edit_property(property_id) and site_has_extra(property_id, 'staff_signin'));
create policy shifts_delete on staff_shifts for delete using (can_edit_property(property_id) and site_has_extra(property_id, 'staff_signin'));

create or replace function staff_shifts_site() returns trigger language plpgsql security definer set search_path = public as $$
begin
  select property_id into new.property_id from staff_members where id = new.member_id;
  if new.property_id is null then raise exception 'unknown_member' using errcode = '22023'; end if;
  return new;
end $$;
create trigger staff_shifts_site before insert or update of member_id on staff_shifts for each row execute function staff_shifts_site();
