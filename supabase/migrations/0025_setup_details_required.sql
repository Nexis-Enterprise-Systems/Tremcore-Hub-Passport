-- Migration 0025: the first-run set-up now REQUIRES the business phone, address and postcode,
-- and the name, address and postcode of every site. Enforced here in the database, not only on the page.
-- Why: Self-Managed clients may later move to the Managed Service, so Tremcore needs complete contact and site details from day one.
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
  -- required: business phone, address and postcode
  if ph is null or ad is null or pc is null then raise exception 'details_required' using errcode = '22023'; end if;
  for s in select * from jsonb_array_elements(coalesce(p_sites, '[]'::jsonb)) loop
    sname := cap_words(btrim(coalesce(s ->> 'name', ''))); saddr := nullif(btrim(coalesce(s ->> 'address', '')), ''); spc := nullif(btrim(coalesce(s ->> 'postcode', '')), '');
    if char_length(sname) not between 1 and 160 or char_length(coalesce(saddr, '')) > 300 or char_length(coalesce(spc, '')) > 12 then raise exception 'invalid_details' using errcode = '22023'; end if;
    update properties set name = sname, address = saddr, postcode = spc where id = (s ->> 'id')::uuid and company_id = cid;
  end loop;
  -- required: every site of this company has a real name (not the "Site 1" placeholder), an address and a postcode
  if exists (select 1 from properties pr where pr.company_id = cid
               and (btrim(coalesce(pr.name, '')) = '' or pr.name ~ '^Site [0-9]+$' or btrim(coalesce(pr.address, '')) = '' or btrim(coalesce(pr.postcode, '')) = '')) then
    raise exception 'details_required' using errcode = '22023';
  end if;
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
