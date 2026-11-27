-- Tremcore Managed: a "managed code" opens an account as a Managed Compliance (Level 2) client with EVERY add-on open, at a price per site that Tremcore sets
-- when the code is made. Managed clients are invoiced by Tremcore directly (no card payment through the website). Codes are made by staff only.

alter table offer_codes add column managed boolean not null default false;
alter table offer_codes add column managed_price_pence int check (managed_price_pence is null or managed_price_pence between 0 and 100000);
alter table offer_codes add constraint offer_codes_managed_kind check (not managed or kind = 'free');

-- Staff: make a managed code for one prospect. p_price_pence is the price per site per month (can be changed on the next code).
create or replace function create_managed_code(p_email text, p_name text, p_days int default 30, p_price_pence int default 0)
returns offer_codes language plpgsql security definer set search_path = public as $$
declare r offer_codes; em text := lower(btrim(coalesce(p_email, '')));
begin
  if not (is_tremcore() and mfa_ok()) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if em !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or char_length(em) > 200 or coalesce(p_days, 0) not between 1 and 365 or coalesce(p_price_pence, -1) not between 0 and 100000
  then raise exception 'invalid_details' using errcode = '22023'; end if;
  insert into offer_codes(code, prospect_name, prospect_email, expires_at, created_by, kind, discount_pence, managed, managed_price_pence)
  values (offer_new_code(), nullif(left(btrim(coalesce(p_name, '')), 120), ''), em, now() + make_interval(days => p_days), auth.uid(), 'free', 0, true, p_price_pence)
  returning * into r;
  return r;
end $$;
revoke all on function create_managed_code(text, text, int, int) from public, anon;
grant execute on function create_managed_code(text, text, int, int) to authenticated;

-- Opening an account with a free code. A managed code also makes the company Level 2 (Managed Compliance), records the price, and opens every add-on.
create or replace function free_activate(p_company uuid, p_code text) returns text language plpgsql security definer set search_path = public as $$
declare o offer_codes; c companies;
begin
  select * into c from companies where id = p_company;
  select * into o from offer_codes where code = upper(btrim(coalesce(p_code, ''))) and kind = 'free' and status = 'active' and (expires_at is null or expires_at > now());
  if c.id is null or o.id is null or c.subscription <> 'trial' or c.offer_code is distinct from o.code then raise exception 'offer_invalid' using errcode = '22023'; end if;
  if o.managed then
    update companies set subscription = 'active', level = 2, free_access = false, monthly_value_pence = coalesce(o.managed_price_pence, 0) * greatest((select count(*) from properties where company_id = c.id), 1) where id = c.id;
    insert into company_extras(company_id, extra_code, status, price_pence, quantity)
      select c.id, e.code, 'active', 0, case when e.charged_per = 'site' then greatest((select count(*)::int from properties where company_id = c.id), 1) else 1 end from extras e where e.active
      on conflict (company_id, extra_code) do update set status = 'active', price_pence = 0, cancel_requested_at = null, access_ends_at = null;
  else
    update companies set subscription = 'active', monthly_value_pence = 0, free_access = true where id = c.id;
  end if;
  return 'opened';
end $$;
revoke all on function free_activate(uuid, text) from public, anon, authenticated;
grant execute on function free_activate(uuid, text) to service_role;

-- Staff: make an existing client managed (Level 2) with every add-on open, at a price per site.
create or replace function make_managed(p_company uuid, p_price_pence int) returns void language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not (is_tremcore() and mfa_ok()) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if coalesce(p_price_pence, -1) not between 0 and 100000 or not exists (select 1 from companies where id = p_company) then raise exception 'invalid_details' using errcode = '22023'; end if;
  select greatest(count(*), 1) into n from properties where company_id = p_company;
  update companies set level = 2, subscription = 'active', free_access = false, monthly_value_pence = p_price_pence * n where id = p_company;
  insert into company_extras(company_id, extra_code, status, price_pence, quantity)
    select p_company, e.code, 'active', 0, case when e.charged_per = 'site' then n else 1 end from extras e where e.active
    on conflict (company_id, extra_code) do update set status = 'active', price_pence = 0, cancel_requested_at = null, access_ends_at = null;
end $$;
revoke all on function make_managed(uuid, int) from public, anon;
grant execute on function make_managed(uuid, int) to authenticated;
