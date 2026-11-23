-- Migration 0032: (1) cancelling in the app also has to stop the Stripe subscription, and (2) "free access" codes.
--
-- (1) my_billing_link(): the server asks this, with the signed-in head-office user's own token, to learn WHICH Stripe subscription belongs to their
--     company. Only a head-office user (with 2FA, when 2FA is switched on) of a company that still has access gets an answer, so nobody can
--     ask the server to cancel or un-cancel somebody else's subscription.
create or replace function my_billing_link() returns table (company_id uuid, stripe_subscription_id text)
language plpgsql stable security definer set search_path = public as $$
declare cid uuid := my_company();
begin
  if cid is null or not is_client_super() or not mfa_ok() or not company_access_ok(cid) then raise exception 'not_allowed' using errcode = '42501'; end if;
  return query select c.id, c.stripe_subscription_id from companies c where c.id = cid;
end $$;
revoke all on function my_billing_link() from public, anon;
grant execute on function my_billing_link() to authenticated;

-- (2) Free access codes: made in the hub like the introductory offer codes, but signing up with one opens the account with no payment.
--     Used to give someone access (a tester, a partner, a friendly first customer). Single use, expiring, can be switched off, same as the others.
alter table offer_codes add column kind text not null default 'discount' check (kind in ('discount', 'free'));
alter table offer_codes drop constraint offer_codes_discount_pence_check;
alter table offer_codes add constraint offer_codes_discount_pence_check check (discount_pence between 0 and 1498);
alter table companies add column free_access boolean not null default false;

drop function if exists create_offer_code(text, text, int);
create or replace function create_offer_code(p_email text, p_name text, p_days int default 30, p_kind text default 'discount')
returns offer_codes language plpgsql security definer set search_path = public as $$
declare r offer_codes; em text := lower(btrim(coalesce(p_email, '')));
begin
  if not (is_tremcore() and mfa_ok()) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if em !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or char_length(em) > 200 or coalesce(p_days, 0) not between 1 and 365 or coalesce(p_kind, '') not in ('discount', 'free') then raise exception 'invalid_details' using errcode = '22023'; end if;
  insert into offer_codes(code, prospect_name, prospect_email, expires_at, created_by, kind, discount_pence)
  values (offer_new_code(), nullif(left(btrim(coalesce(p_name, '')), 120), ''), em, now() + make_interval(days => p_days), auth.uid(), p_kind, case when p_kind = 'free' then 0 else 700 end) returning * into r;
  return r;
end $$;
revoke all on function create_offer_code(text, text, int, text) from public, anon;
grant execute on function create_offer_code(text, text, int, text) to authenticated;

-- The checking functions now also say what KIND of code it is.
drop function if exists offer_check(text);
create or replace function offer_check(p_code text)
returns table (discount_pence int, months int, kind text) language sql stable security definer set search_path = public as $$
  select o.discount_pence, o.months, o.kind from offer_codes o
   where o.code = upper(btrim(coalesce(p_code, ''))) and o.status = 'active' and o.expires_at > now()
$$;
revoke all on function offer_check(text) from public, anon, authenticated;
grant execute on function offer_check(text) to service_role;

drop function if exists offer_attach(uuid, text);
create or replace function offer_attach(p_company uuid, p_code text)
returns table (discount_pence int, months int, kind text) language plpgsql security definer set search_path = public as $$
declare o offer_codes; c companies;
begin
  select * into c from companies where id = p_company;
  if c.id is null or c.subscription <> 'trial' then raise exception 'not_allowed' using errcode = '42501'; end if;
  if p_code is null or btrim(p_code) = '' then update companies set offer_code = null where id = p_company; return; end if;
  select * into o from offer_codes where code = upper(btrim(p_code)) and status = 'active' and expires_at > now();
  if o.id is null or (o.kind = 'discount' and c.billing_interval <> 'monthly') then raise exception 'offer_invalid' using errcode = '22023'; end if;
  update companies set offer_code = o.code where id = p_company;
  return query select o.discount_pence, o.months, o.kind;
end $$;
revoke all on function offer_attach(uuid, text) from public, anon, authenticated;
grant execute on function offer_attach(uuid, text) to service_role;

drop function if exists my_offer();
create or replace function my_offer()
returns table (discount_pence int, months int, kind text) language sql stable security definer set search_path = public as $$
  select o.discount_pence, o.months, o.kind from companies c join offer_codes o on o.code = c.offer_code
   where c.id = my_company() and is_client_super() and c.subscription = 'trial' and o.status = 'active' and o.expires_at > now()
     and (o.kind = 'free' or c.billing_interval = 'monthly')
$$;
revoke all on function my_offer() from public, anon;
grant execute on function my_offer() to authenticated;

drop function if exists attach_my_offer(text);
create or replace function attach_my_offer(p_code text)
returns table (discount_pence int, months int, kind text) language plpgsql security definer set search_path = public as $$
declare o offer_codes; c companies;
begin
  select * into c from companies where id = my_company();
  if c.id is null or not is_client_super() or c.subscription <> 'trial' then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into o from offer_codes where code = upper(btrim(coalesce(p_code, ''))) and status = 'active' and expires_at > now();
  if o.id is null or (o.kind = 'discount' and c.billing_interval <> 'monthly') then raise exception 'offer_invalid' using errcode = '22023'; end if;
  update companies set offer_code = o.code where id = c.id;
  return query select o.discount_pence, o.months, o.kind;
end $$;
revoke all on function attach_my_offer(text) from public, anon;
grant execute on function attach_my_offer(text) to authenticated;

-- Server (service key): open the account for a company that holds a valid FREE code. Nothing is charged and no Stripe subscription exists.
create or replace function free_activate(p_company uuid, p_code text) returns text language plpgsql security definer set search_path = public as $$
declare o offer_codes; c companies;
begin
  select * into c from companies where id = p_company;
  select * into o from offer_codes where code = upper(btrim(coalesce(p_code, ''))) and kind = 'free' and status = 'active' and expires_at > now();
  if c.id is null or o.id is null or c.subscription <> 'trial' or c.offer_code is distinct from o.code then raise exception 'offer_invalid' using errcode = '22023'; end if;
  update companies set subscription = 'active', monthly_value_pence = 0, free_access = true where id = c.id;
  return 'opened';
end $$;
revoke all on function free_activate(uuid, text) from public, anon, authenticated;
grant execute on function free_activate(uuid, text) to service_role;

-- When the account opens: a free code is used up with no offer period and no price change; a discount code works as before.
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
      update offer_codes set status = 'used', used_at = now(), used_company = new.id where id = o.id;
    else
      new.offer_code := null;
    end if;
  end if;
  return new;
end $$;
