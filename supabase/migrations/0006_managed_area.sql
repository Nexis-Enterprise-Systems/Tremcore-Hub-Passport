-- Migration 0006: Managed Service is only offered near Tremcore.
-- The base point and the distance (in miles) are settings that a Tremcore administrator can change in the hub.
-- Starting point: Medway (ME postcodes), 30 miles. Anyone (the website's postcode checker) may ask where the area is, nothing more.

insert into app_settings(key, value) values
  ('managed_base', '{"label":"Medway (ME)","lat":51.385,"lng":0.52}'::jsonb),
  ('managed_radius_miles', '30'::jsonb);

create or replace function managed_area() returns table(label text, lat double precision, lng double precision, radius_miles integer)
language sql stable security definer set search_path = public as $$
  select b.value->>'label', (b.value->>'lat')::double precision, (b.value->>'lng')::double precision, (r.value #>> '{}')::integer
  from app_settings b, app_settings r
  where b.key = 'managed_base' and r.key = 'managed_radius_miles'
$$;
revoke all on function managed_area() from public;
grant execute on function managed_area() to anon, authenticated;

-- Website enquiries can now also say they are interested in the Managed Service.
alter table enquiries drop constraint enquiries_package_interest_check;
alter table enquiries add constraint enquiries_package_interest_check check (package_interest in ('self_managed', 'managed_service'));
