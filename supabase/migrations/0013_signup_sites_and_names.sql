-- Migration 0013: sign-up asks for the NUMBER of sites (not their names); names are tidied to start each word with a capital;
-- sites are named later, in the first-run set-up.

-- Capitalise the first letter of every word (after a space, hyphen or apostrophe) without touching the other letters, so "ABC Ltd" and "McDonald" stay as typed.
create or replace function cap_words(t text) returns text
language plpgsql immutable as $$
declare out text := ''; prev text := ' '; ch text; i int;
begin
  if t is null then return null; end if;
  for i in 1..char_length(t) loop
    ch := substr(t, i, 1);
    out := out || case when prev in (' ', '-', '''', E'\t') then upper(ch) else ch end;
    prev := ch;
  end loop;
  return out;
end $$;

drop function signup_company(text, text, text, text, text);
create or replace function signup_company(p_company text, p_full_name text, p_sites int default 1, p_billing text default 'monthly')
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  cid uuid;
  nm text := cap_words(btrim(coalesce(p_company, '')));
  fn text := cap_words(btrim(coalesce(p_full_name, '')));
  bi text := coalesce(nullif(btrim(coalesce(p_billing, '')), ''), 'monthly');
  n int := coalesce(p_sites, 0);
  mail text;
  confirmed timestamptz;
begin
  if uid is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  if not signup_open() then raise exception 'signup_closed' using errcode = '42501'; end if;
  select u.email, u.email_confirmed_at into mail, confirmed from auth.users u where u.id = uid;
  if confirmed is null then raise exception 'email_not_confirmed' using errcode = '42501'; end if;
  if exists (select 1 from profiles where id = uid) then raise exception 'already_set_up' using errcode = '23505'; end if;
  if char_length(nm) not between 1 and 160 or char_length(fn) not between 1 and 120
     or n not between 1 and 100 or bi not in ('monthly', 'annual') then
    raise exception 'invalid_details' using errcode = '22023';
  end if;
  insert into companies(name, level, subscription, monthly_value_pence, require_mfa, contact_name, contact_email, source, billing_interval, trial_ends_at)
  values (nm, 1, 'trial', 0, false, fn, mail, 'self_signup', bi, now()) returning id into cid;
  insert into profiles(id, full_name, role, company_id, perm) values (uid, fn, 'client_super', cid, 'full');
  insert into properties(company_id, name) select cid, 'Site ' || g from generate_series(1, n) g;
  return cid;
end $$;
revoke all on function signup_company(text, text, int, text) from public, anon;
grant execute on function signup_company(text, text, int, text) to authenticated;

-- First-run set-up now also names the sites and gives their addresses.
drop function finish_setup(text, text, text[]);
create or replace function finish_setup(p_phone text, p_address text, p_codes text[], p_sites jsonb default '[]'::jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare
  cid uuid := my_company();
  codes text[] := coalesce(p_codes, '{}');
  ph text := nullif(btrim(coalesce(p_phone, '')), '');
  ad text := nullif(btrim(coalesce(p_address, '')), '');
  made int := 0; s jsonb; sname text; saddr text;
begin
  if cid is null or not is_client_super() or not mfa_ok() or not company_access_ok(cid) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if char_length(coalesce(ph, '')) > 40 or char_length(coalesce(ad, '')) > 300
     or exists (select 1 from unnest(codes) c where c not in (select code from core_checks))
     or jsonb_typeof(coalesce(p_sites, '[]'::jsonb)) <> 'array' then
    raise exception 'invalid_details' using errcode = '22023';
  end if;
  for s in select * from jsonb_array_elements(coalesce(p_sites, '[]'::jsonb)) loop
    sname := cap_words(btrim(coalesce(s ->> 'name', ''))); saddr := nullif(btrim(coalesce(s ->> 'address', '')), '');
    if char_length(sname) not between 1 and 160 or char_length(coalesce(saddr, '')) > 300 then raise exception 'invalid_details' using errcode = '22023'; end if;
    update properties set name = sname, address = saddr where id = (s ->> 'id')::uuid and company_id = cid;
  end loop;
  update companies set contact_phone = ph, address = ad, setup_completed_at = coalesce(setup_completed_at, now()) where id = cid;
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
revoke all on function finish_setup(text, text, text[], jsonb) from public, anon;
grant execute on function finish_setup(text, text, text[], jsonb) to authenticated;

-- Names are tidied wherever they are saved (people, businesses, sites, invitations), so the hub and the passport always agree.
create or replace function tidy_name_company() returns trigger language plpgsql as $$
begin new.name := cap_words(btrim(new.name)); new.contact_name := cap_words(btrim(new.contact_name)); return new; end $$;
create or replace function tidy_name_full() returns trigger language plpgsql as $$
begin new.full_name := cap_words(btrim(new.full_name)); return new; end $$;
create or replace function tidy_name_plain() returns trigger language plpgsql as $$
begin new.name := cap_words(btrim(new.name)); return new; end $$;
create trigger companies_tidy_names before insert or update of name, contact_name on companies for each row execute function tidy_name_company();
create trigger properties_tidy_names before insert or update of name on properties for each row execute function tidy_name_plain();
create trigger profiles_tidy_names before insert or update of full_name on profiles for each row execute function tidy_name_full();
create trigger invitations_tidy_names before insert or update of full_name on invitations for each row execute function tidy_name_full();
-- Tidy what is already saved.
update companies set name = name;
update properties set name = name;
update profiles set full_name = full_name;
