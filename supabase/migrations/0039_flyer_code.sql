-- Offer codes: (1) staff can set the first-site price on any code, (2) "flyer" codes that never expire and can be used by many sign-ups,
-- (3) the standing flyer code TREM2428 (first site GBP 12.99 a month for 12 months instead of 14.99).
-- A flyer code only ever works for a NEW sign-up (a company still on trial). It can never be put on an account that is already paying.

alter table offer_codes alter column prospect_email drop not null;
alter table offer_codes alter column expires_at drop not null;           -- null = never expires
alter table offer_codes add column reusable boolean not null default false;
alter table offer_codes add column uses int not null default 0;
alter table offer_codes add constraint offer_codes_email_needed check (reusable or prospect_email is not null);
alter table offer_codes add constraint offer_codes_expiry_needed check (reusable or expires_at is not null);

-- Staff: make a code. p_price_pence = what the first site costs a month during the offer (default 799). p_forever makes a reusable, never-expiring flyer code (email optional, custom code allowed).
drop function if exists create_offer_code(text, text, int, text);
create or replace function create_offer_code(p_email text, p_name text, p_days int default 30, p_kind text default 'discount', p_price_pence int default null, p_forever boolean default false, p_code text default null)
returns offer_codes language plpgsql security definer set search_path = public as $$
declare r offer_codes; em text := lower(btrim(coalesce(p_email, ''))); price int := coalesce(p_price_pence, 799); cd text := upper(btrim(coalesce(p_code, '')));
begin
  if not (is_tremcore() and mfa_ok()) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if coalesce(p_kind, '') not in ('discount', 'free') or price not between 1 and 1499
     or (not coalesce(p_forever, false) and (em !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or char_length(em) > 200 or coalesce(p_days, 0) not between 1 and 365))
     or (coalesce(p_forever, false) and (p_kind = 'free' or (cd <> '' and cd !~ '^[A-Z0-9-]{6,24}$') or (em <> '' and (em !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or char_length(em) > 200))))
  then raise exception 'invalid_details' using errcode = '22023'; end if;
  insert into offer_codes(code, prospect_name, prospect_email, expires_at, created_by, kind, discount_pence, reusable)
  values (case when cd <> '' then cd else offer_new_code() end, nullif(left(btrim(coalesce(p_name, '')), 120), ''), nullif(em, ''),
          case when coalesce(p_forever, false) then null else now() + make_interval(days => p_days) end, auth.uid(), p_kind,
          case when p_kind = 'free' then 0 else 1499 - price end, coalesce(p_forever, false)) returning * into r;
  return r;
end $$;
revoke all on function create_offer_code(text, text, int, text, int, boolean, text) from public, anon;
grant execute on function create_offer_code(text, text, int, text, int, boolean, text) to authenticated;

-- The checking functions now accept a code with no expiry date.
create or replace function offer_check(p_code text)
returns table (discount_pence int, months int, kind text) language sql stable security definer set search_path = public as $$
  select o.discount_pence, o.months, o.kind from offer_codes o
   where o.code = upper(btrim(coalesce(p_code, ''))) and o.status = 'active' and (o.expires_at is null or o.expires_at > now())
$$;
revoke all on function offer_check(text) from public, anon, authenticated;
grant execute on function offer_check(text) to service_role;

create or replace function offer_attach(p_company uuid, p_code text)
returns table (discount_pence int, months int, kind text) language plpgsql security definer set search_path = public as $$
declare o offer_codes; c companies;
begin
  select * into c from companies where id = p_company;
  if c.id is null or c.subscription <> 'trial' then raise exception 'not_allowed' using errcode = '42501'; end if;
  if p_code is null or btrim(p_code) = '' then update companies set offer_code = null where id = p_company; return; end if;
  select * into o from offer_codes where code = upper(btrim(p_code)) and status = 'active' and (expires_at is null or expires_at > now());
  if o.id is null or (o.kind = 'discount' and c.billing_interval <> 'monthly') then raise exception 'offer_invalid' using errcode = '22023'; end if;
  update companies set offer_code = o.code where id = p_company;
  return query select o.discount_pence, o.months, o.kind;
end $$;
revoke all on function offer_attach(uuid, text) from public, anon, authenticated;
grant execute on function offer_attach(uuid, text) to service_role;

create or replace function my_offer()
returns table (discount_pence int, months int, kind text) language sql stable security definer set search_path = public as $$
  select o.discount_pence, o.months, o.kind from companies c join offer_codes o on o.code = c.offer_code
   where c.id = my_company() and is_client_super() and c.subscription = 'trial' and o.status = 'active' and (o.expires_at is null or o.expires_at > now())
     and (o.kind = 'free' or c.billing_interval = 'monthly')
$$;
revoke all on function my_offer() from public, anon;
grant execute on function my_offer() to authenticated;

create or replace function attach_my_offer(p_code text)
returns table (discount_pence int, months int, kind text) language plpgsql security definer set search_path = public as $$
declare o offer_codes; c companies;
begin
  select * into c from companies where id = my_company();
  if c.id is null or not is_client_super() or c.subscription <> 'trial' then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into o from offer_codes where code = upper(btrim(coalesce(p_code, ''))) and status = 'active' and (expires_at is null or expires_at > now());
  if o.id is null or (o.kind = 'discount' and c.billing_interval <> 'monthly') then raise exception 'offer_invalid' using errcode = '22023'; end if;
  update companies set offer_code = o.code where id = c.id;
  return query select o.discount_pence, o.months, o.kind;
end $$;
revoke all on function attach_my_offer(text) from public, anon;
grant execute on function attach_my_offer(text) to authenticated;

create or replace function free_activate(p_company uuid, p_code text) returns text language plpgsql security definer set search_path = public as $$
declare o offer_codes; c companies;
begin
  select * into c from companies where id = p_company;
  select * into o from offer_codes where code = upper(btrim(coalesce(p_code, ''))) and kind = 'free' and status = 'active' and (expires_at is null or expires_at > now());
  if c.id is null or o.id is null or c.subscription <> 'trial' or c.offer_code is distinct from o.code then raise exception 'offer_invalid' using errcode = '22023'; end if;
  update companies set subscription = 'active', monthly_value_pence = 0, free_access = true where id = c.id;
  return 'opened';
end $$;
revoke all on function free_activate(uuid, text) from public, anon, authenticated;
grant execute on function free_activate(uuid, text) to service_role;

-- When the account opens: a one-off code is used up; a flyer code stays active and just counts the sign-up.
create or replace function companies_offer_start() returns trigger language plpgsql security definer set search_path = public as $$
declare o offer_codes;
begin
  if new.offer_code is not null and new.subscription = 'active' and new.offer_ends_at is null and old.subscription is distinct from 'active' then
    select * into o from offer_codes where code = new.offer_code;
    if o.id is not null and o.status = 'active' and o.kind = 'free' then
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

-- The standing flyer code.
insert into offer_codes(code, prospect_name, prospect_email, discount_pence, months, expires_at, reusable, kind)
values ('TREM2428', 'Flyers', null, 200, 12, null, true, 'discount') on conflict (code) do nothing;
