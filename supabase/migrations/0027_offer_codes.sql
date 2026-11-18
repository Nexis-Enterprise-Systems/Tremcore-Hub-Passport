-- Introductory offer codes for Self-Managed (Level 1).
-- Tremcore staff make one code per prospect in the hub and email it. The prospect types it in (or follows the link) at sign-up.
-- The offer: £7.00 a month off the first site for the first 12 months (so £7.99 instead of £14.99). Extra sites stay at the normal £7.99.
-- After 12 months the discount simply stops and the normal price applies. Monthly billing only. Each code works once and can expire or be switched off.
create table offer_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9-]{6,24}$'),
  prospect_name text check (char_length(prospect_name) <= 120),
  prospect_email text not null check (char_length(prospect_email) <= 200),
  discount_pence int not null default 700 check (discount_pence between 1 and 1498),
  months int not null default 12 check (months between 1 and 36),
  expires_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'used', 'cancelled')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  used_at timestamptz,
  used_company uuid references companies(id) on delete set null
);
alter table offer_codes enable row level security;
create policy offer_codes_staff_read on offer_codes for select using (mfa_ok() and is_tremcore());
-- no insert/update/delete policies: staff go through the functions below, so a code can never be edited into something else.

alter table companies add column offer_code text, add column offer_ends_at timestamptz;

create or replace function offer_new_code() returns text language plpgsql as $$
declare c text; chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; i int;
begin
  loop
    c := 'TC-';
    for i in 1..6 loop c := c || substr(chars, 1 + floor(random() * length(chars))::int, 1); end loop;
    exit when not exists (select 1 from offer_codes where code = c);
  end loop;
  return c;
end $$;

-- Staff: make a code for one prospect.
create or replace function create_offer_code(p_email text, p_name text, p_days int default 30)
returns offer_codes language plpgsql security definer set search_path = public as $$
declare r offer_codes; em text := lower(btrim(coalesce(p_email, '')));
begin
  if not (is_tremcore() and mfa_ok()) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if em !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or char_length(em) > 200 or coalesce(p_days, 0) not between 1 and 365 then raise exception 'invalid_details' using errcode = '22023'; end if;
  insert into offer_codes(code, prospect_name, prospect_email, expires_at, created_by)
  values (offer_new_code(), nullif(left(btrim(coalesce(p_name, '')), 120), ''), em, now() + make_interval(days => p_days), auth.uid()) returning * into r;
  return r;
end $$;
revoke all on function create_offer_code(text, text, int) from public, anon;
grant execute on function create_offer_code(text, text, int) to authenticated;

-- Staff: switch a code off (only while it is still unused).
create or replace function cancel_offer_code(p_id uuid) returns text language plpgsql security definer set search_path = public as $$
begin
  if not (is_tremcore() and mfa_ok()) then raise exception 'not_allowed' using errcode = '42501'; end if;
  update offer_codes set status = 'cancelled' where id = p_id and status = 'active';
  return case when found then 'cancelled' else 'not_active' end;
end $$;
revoke all on function cancel_offer_code(uuid) from public, anon;
grant execute on function cancel_offer_code(uuid) to authenticated;

-- Staff: note that the email went out.
create or replace function mark_offer_sent(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not (is_tremcore() and mfa_ok()) then raise exception 'not_allowed' using errcode = '42501'; end if;
  update offer_codes set sent_at = now() where id = p_id;
end $$;
revoke all on function mark_offer_sent(uuid) from public, anon;
grant execute on function mark_offer_sent(uuid) to authenticated;

-- Server (service key): is this code good? Returns the discount, or nothing.
create or replace function offer_check(p_code text)
returns table (discount_pence int, months int) language sql stable security definer set search_path = public as $$
  select o.discount_pence, o.months from offer_codes o
   where o.code = upper(btrim(coalesce(p_code, ''))) and o.status = 'active' and o.expires_at > now()
$$;
revoke all on function offer_check(text) from public, anon, authenticated;
grant execute on function offer_check(text) to service_role;

-- Server (service key): tie a valid code to the company being signed up. Pass a null code to clear it again. Monthly billing only.
create or replace function offer_attach(p_company uuid, p_code text)
returns table (discount_pence int, months int) language plpgsql security definer set search_path = public as $$
declare o offer_codes; c companies;
begin
  select * into c from companies where id = p_company;
  if c.id is null or c.subscription <> 'trial' then raise exception 'not_allowed' using errcode = '42501'; end if;
  if p_code is null or btrim(p_code) = '' then update companies set offer_code = null where id = p_company; return; end if;
  select * into o from offer_codes where code = upper(btrim(p_code)) and status = 'active' and expires_at > now();
  if o.id is null or c.billing_interval <> 'monthly' then raise exception 'offer_invalid' using errcode = '22023'; end if;
  update companies set offer_code = o.code where id = p_company;
  return query select o.discount_pence, o.months;
end $$;
revoke all on function offer_attach(uuid, text) from public, anon, authenticated;
grant execute on function offer_attach(uuid, text) to service_role;

-- The signed-in head-office user's own pending offer (used when they press Pay now).
create or replace function my_offer()
returns table (discount_pence int, months int) language sql stable security definer set search_path = public as $$
  select o.discount_pence, o.months from companies c join offer_codes o on o.code = c.offer_code
   where c.id = my_company() and is_client_super() and c.subscription = 'trial' and c.billing_interval = 'monthly' and o.status = 'active' and o.expires_at > now()
$$;
revoke all on function my_offer() from public, anon;
grant execute on function my_offer() to authenticated;

-- The signed-in head-office user attaches a code to their own unpaid company (used when email confirmation is off and sign-up carries straight on).
create or replace function attach_my_offer(p_code text)
returns table (discount_pence int, months int) language plpgsql security definer set search_path = public as $$
declare o offer_codes; c companies;
begin
  select * into c from companies where id = my_company();
  if c.id is null or not is_client_super() or c.subscription <> 'trial' then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into o from offer_codes where code = upper(btrim(coalesce(p_code, ''))) and status = 'active' and expires_at > now();
  if o.id is null or c.billing_interval <> 'monthly' then raise exception 'offer_invalid' using errcode = '22023'; end if;
  update companies set offer_code = o.code where id = c.id;
  return query select o.discount_pence, o.months;
end $$;
revoke all on function attach_my_offer(text) from public, anon;
grant execute on function attach_my_offer(text) to authenticated;

-- When the first payment is confirmed: the code is used up, the 12 months start, and the recorded monthly value drops by the discount.
create or replace function companies_offer_start() returns trigger language plpgsql security definer set search_path = public as $$
declare o offer_codes;
begin
  if new.offer_code is not null and new.subscription = 'active' and new.offer_ends_at is null and old.subscription is distinct from 'active' then
    select * into o from offer_codes where code = new.offer_code;
    if o.id is not null and o.status = 'active' then
      new.offer_ends_at := now() + make_interval(months => o.months);
      new.monthly_value_pence := greatest(coalesce(new.monthly_value_pence, 0) - o.discount_pence, 0);
      update offer_codes set status = 'used', used_at = now(), used_company = new.id where id = o.id;
    else
      new.offer_code := null;     -- the code was switched off or used elsewhere in the meantime: no discount
    end if;
  end if;
  return new;
end $$;
create trigger companies_offer_start before update of subscription on companies for each row execute function companies_offer_start();
