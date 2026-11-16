-- Tidy formats everywhere they are saved: names and addresses start with capitals, postcodes are capitals with a space
-- (ME3 8FX), phone numbers are 5 digits, a space, then 6 digits (01634 123456). Addresses get their own postcode box.
-- The people register (staff_members) can now be used by Toolbox Talks as well as Staff Clock In / Out.

create or replace function fmt_phone(t text) returns text language plpgsql immutable as $$
declare d text;
begin
  if t is null or btrim(t) = '' then return null; end if;
  d := regexp_replace(t, '[^0-9+]', '', 'g');
  if d like '+44%' then d := '0' || substr(d, 4); elsif d like '0044%' then d := '0' || substr(d, 5); end if;
  d := regexp_replace(d, '[^0-9]', '', 'g');
  if char_length(d) = 11 and d like '0%' then return substr(d, 1, 5) || ' ' || substr(d, 6); end if;
  return btrim(t);   -- cannot be put in the standard shape, so leave it as typed (the screens ask the person to correct it)
end $$;

create or replace function fmt_postcode(t text) returns text language plpgsql immutable as $$
declare p text;
begin
  if t is null or btrim(t) = '' then return null; end if;
  p := upper(regexp_replace(t, '\s', '', 'g'));
  if p ~ '^[A-Z]{1,2}[0-9][A-Z0-9]?[0-9][A-Z]{2}$' then return substr(p, 1, char_length(p) - 3) || ' ' || substr(p, char_length(p) - 2); end if;
  return upper(btrim(t));
end $$;

alter table companies add column postcode text check (postcode is null or char_length(postcode) <= 12);
alter table properties add column postcode text check (postcode is null or char_length(postcode) <= 12);

create or replace function tidy_company_contact() returns trigger language plpgsql as $$
begin new.contact_phone := fmt_phone(new.contact_phone); new.address := nullif(cap_words(btrim(new.address)), ''); new.postcode := fmt_postcode(new.postcode); return new; end $$;
create or replace function tidy_property_address() returns trigger language plpgsql as $$
begin new.address := nullif(cap_words(btrim(new.address)), ''); new.postcode := fmt_postcode(new.postcode); return new; end $$;
create or replace function tidy_contact_row() returns trigger language plpgsql as $$
begin new.name := cap_words(btrim(new.name)); new.role := cap_words(btrim(new.role)); new.phone := coalesce(fmt_phone(new.phone), ''); return new; end $$;
create or replace function tidy_attendee() returns trigger language plpgsql as $$
begin new.full_name := cap_words(btrim(new.full_name)); return new; end $$;
create trigger companies_tidy_contact before insert or update of contact_phone, address, postcode on companies for each row execute function tidy_company_contact();
create trigger properties_tidy_address before insert or update of address, postcode on properties for each row execute function tidy_property_address();
create trigger econ_tidy before insert or update of name, role, phone on emergency_contacts for each row execute function tidy_contact_row();
create trigger attendees_tidy before insert on talk_attendees for each row execute function tidy_attendee();
update companies set address = address, contact_phone = contact_phone;
update properties set address = address;
update emergency_contacts set name = name;

-- ───────────── saving business and site details (with postcode) ─────────────
drop function if exists update_business(text, text);
create or replace function update_business(p_phone text, p_address text, p_postcode text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_client_super() or not mfa_ok() or my_company() is null then raise exception 'not_allowed' using errcode = '42501'; end if;
  update companies set contact_phone = left(nullif(btrim(coalesce(p_phone, '')), ''), 40), address = left(nullif(btrim(coalesce(p_address, '')), ''), 300), postcode = left(nullif(btrim(coalesce(p_postcode, '')), ''), 12) where id = my_company();
end $$;
revoke all on function update_business(text, text, text) from public, anon;
grant execute on function update_business(text, text, text) to authenticated;

drop function if exists update_site(uuid, text, text);
create or replace function update_site(p_id uuid, p_name text, p_address text, p_postcode text default null) returns void
language plpgsql security definer set search_path = public as $$
declare nm text := btrim(coalesce(p_name, ''));
begin
  if not is_client_super() or not mfa_ok() or my_company() is null then raise exception 'not_allowed' using errcode = '42501'; end if;
  if nm = '' or char_length(nm) > 120 then raise exception 'invalid_details' using errcode = '22023'; end if;
  update properties set name = nm, address = left(nullif(btrim(coalesce(p_address, '')), ''), 300), postcode = left(nullif(btrim(coalesce(p_postcode, '')), ''), 12) where id = p_id and company_id = my_company();
  if not found then raise exception 'not_allowed' using errcode = '42501'; end if;
end $$;
revoke all on function update_site(uuid, text, text, text) from public, anon;
grant execute on function update_site(uuid, text, text, text) to authenticated;

drop function if exists finish_setup(text, text, text[], jsonb);
create or replace function finish_setup(p_phone text, p_address text, p_codes text[], p_sites jsonb default '[]'::jsonb, p_postcode text default null) returns int
language plpgsql security definer set search_path = public as $$
declare
  cid uuid := my_company();
  codes text[] := coalesce(p_codes, '{}');
  ph text := nullif(btrim(coalesce(p_phone, '')), '');
  ad text := nullif(btrim(coalesce(p_address, '')), '');
  pc text := nullif(btrim(coalesce(p_postcode, '')), '');
  made int := 0; s jsonb; sname text; saddr text; spc text;
begin
  if cid is null or not is_client_super() or not mfa_ok() or not company_access_ok(cid) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if char_length(coalesce(ph, '')) > 40 or char_length(coalesce(ad, '')) > 300 or char_length(coalesce(pc, '')) > 12
     or exists (select 1 from unnest(codes) c where c not in (select code from core_checks))
     or jsonb_typeof(coalesce(p_sites, '[]'::jsonb)) <> 'array' then
    raise exception 'invalid_details' using errcode = '22023';
  end if;
  for s in select * from jsonb_array_elements(coalesce(p_sites, '[]'::jsonb)) loop
    sname := cap_words(btrim(coalesce(s ->> 'name', ''))); saddr := nullif(btrim(coalesce(s ->> 'address', '')), ''); spc := nullif(btrim(coalesce(s ->> 'postcode', '')), '');
    if char_length(sname) not between 1 and 160 or char_length(coalesce(saddr, '')) > 300 or char_length(coalesce(spc, '')) > 12 then raise exception 'invalid_details' using errcode = '22023'; end if;
    update properties set name = sname, address = saddr, postcode = spc where id = (s ->> 'id')::uuid and company_id = cid;
  end loop;
  update companies set contact_phone = ph, address = ad, postcode = pc, setup_completed_at = coalesce(setup_completed_at, now()) where id = cid;
  with ins as (
    insert into compliance_items(property_id, grp, title, basis, frequency_months, created_by)
    select pr.id, cc.grp, cc.label, cc.basis, cc.frequency_months, auth.uid()
    from properties pr cross join core_checks cc
    where pr.company_id = cid and cc.code = any (codes)
      and not exists (select 1 from compliance_items ci where ci.property_id = pr.id and ci.title = cc.label)
    returning 1)
  select count(*) into made from ins;
  return made;
end $$;
revoke all on function finish_setup(text, text, text[], jsonb, text) from public, anon;
grant execute on function finish_setup(text, text, text[], jsonb, text) to authenticated;

-- ───────────── the people register is shared by Toolbox Talks and Staff Clock In / Out ─────────────
create or replace function site_has_people_extra(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select site_has_extra(pid, 'staff_signin') or site_has_extra(pid, 'toolbox_talks')
$$;
revoke all on function site_has_people_extra(uuid) from public, anon;
grant execute on function site_has_people_extra(uuid) to authenticated;
drop policy staff_read on staff_members;
drop policy staff_insert on staff_members;
drop policy staff_update on staff_members;
drop policy staff_delete on staff_members;
create policy staff_read   on staff_members for select using (can_access_property(property_id) and site_has_people_extra(property_id));
create policy staff_insert on staff_members for insert with check (can_edit_property(property_id) and site_has_people_extra(property_id));
create policy staff_update on staff_members for update using (can_edit_property(property_id) and site_has_people_extra(property_id)) with check (can_edit_property(property_id) and site_has_people_extra(property_id));
create policy staff_delete on staff_members for delete using (can_edit_property(property_id) and site_has_people_extra(property_id));
