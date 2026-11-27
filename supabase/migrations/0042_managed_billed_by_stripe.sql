-- Tremcore Managed clients are billed through Stripe. A managed code is now a paid-sign-up code (kind 'discount') that carries a price PER SITE.
-- The client pays through Stripe at that price (monthly, all sites); when the payment clears the company becomes Level 2 with EVERY add-on open.
-- Run 0041 first.

alter table offer_codes drop constraint offer_codes_managed_kind;
alter table offer_codes add constraint offer_codes_managed_kind check (not managed or kind = 'discount');
update offer_codes set kind = 'discount' where managed and kind = 'free';   -- any managed code made before this update

create or replace function create_managed_code(p_email text, p_name text, p_days int default 30, p_price_pence int default 0)
returns offer_codes language plpgsql security definer set search_path = public as $$
declare r offer_codes; em text := lower(btrim(coalesce(p_email, '')));
begin
  if not (is_tremcore() and mfa_ok()) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if em !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or char_length(em) > 200 or coalesce(p_days, 0) not between 1 and 365 or coalesce(p_price_pence, -1) not between 1 and 100000
  then raise exception 'invalid_details' using errcode = '22023'; end if;
  insert into offer_codes(code, prospect_name, prospect_email, expires_at, created_by, kind, discount_pence, managed, managed_price_pence)
  values (offer_new_code(), nullif(left(btrim(coalesce(p_name, '')), 120), ''), em, now() + make_interval(days => p_days), auth.uid(), 'discount', 0, true, p_price_pence)
  returning * into r;
  return r;
end $$;
revoke all on function create_managed_code(text, text, int, int) from public, anon;
grant execute on function create_managed_code(text, text, int, int) to authenticated;

-- The server asks: is this a live managed code, and what is the price per site? (null if it is not a managed code)
create or replace function offer_managed(p_code text) returns int language sql stable security definer set search_path = public as $$
  select o.managed_price_pence from offer_codes o
   where o.code = upper(btrim(coalesce(p_code, ''))) and o.managed and o.status = 'active' and (o.expires_at is null or o.expires_at > now())
$$;
revoke all on function offer_managed(text) from public, anon, authenticated;
grant execute on function offer_managed(text) to service_role;

-- When the account opens (payment cleared): a managed code makes the company Level 2, records price x sites, opens every add-on and is used up.
create or replace function companies_offer_start() returns trigger language plpgsql security definer set search_path = public as $$
declare o offer_codes; n int;
begin
  if new.offer_code is not null and new.subscription = 'active' and new.offer_ends_at is null and old.subscription is distinct from 'active' then
    select * into o from offer_codes where code = new.offer_code;
    if o.id is not null and o.status = 'active' and o.managed then
      select greatest(count(*), 1) into n from properties where company_id = new.id;
      new.level := 2; new.free_access := false; new.monthly_value_pence := coalesce(o.managed_price_pence, 0) * n;
      update offer_codes set status = 'used', used_at = now(), used_company = new.id where id = o.id;
      insert into company_extras(company_id, extra_code, status, price_pence, quantity)
        select new.id, e.code, 'active', 0, case when e.charged_per = 'site' then n else 1 end from extras e where e.active
        on conflict (company_id, extra_code) do update set status = 'active', price_pence = 0, cancel_requested_at = null, access_ends_at = null;
    elsif o.id is not null and o.status = 'active' and o.kind = 'free' then
      update offer_codes set status = 'used', used_at = now(), used_company = new.id where id = o.id;
    elsif o.id is not null and o.status = 'active' then
      new.offer_ends_at := now() + make_interval(months => o.months);
      new.monthly_value_pence := greatest(coalesce(new.monthly_value_pence, 0) - o.discount_pence, 0);
      if o.reusable then update offer_codes set uses = uses + 1, used_at = now() where id = o.id;
      else update offer_codes set status = 'used', used_at = now(), used_company = new.id where id = o.id; end if;
    else
      new.offer_code := null;
    end if;
  end if;
  return new;
end $$;
