-- Migration 0007: 7-day free trial (no card), one trial per organisation, payment-failure grace and account stop, and cancellation notice.
--
-- The rules live in the database so they cannot be skipped by calling the API directly:
--   * A new sign-up gets a 7-day trial. No card is ever taken or stored for the trial.
--   * An email domain (e.g. acme.co.uk) can only ever start ONE trial. Free webmail (gmail, outlook...) is checked by the exact address instead.
--     Only a one-way fingerprint of the domain is kept, so it still works after a company's data is deleted.
--   * Trial over and not paying  -> account stopped.   Payment failed and not fixed in 7 days -> account stopped.
--   * Cancelling needs 1 month's notice. When the notice ends the account is stopped, then the data is removed after a short delay.
--   * "Stopped" means client users see NOTHING (properties, records, documents, jobs). Tremcore staff are never affected.

alter table companies
  add column trial_ends_at       timestamptz,
  add column payment_failed_at   timestamptz,
  add column paid_until          timestamptz,
  add column cancel_requested_at timestamptz,
  add column access_ends_at      timestamptz,
  add column delete_after        timestamptz;

insert into app_settings(key, value) values
  ('trial_days', '7'::jsonb),
  ('payment_grace_days', '7'::jsonb),
  ('cancel_notice_months', '1'::jsonb),
  ('data_removal_days_after_end', '14'::jsonb),
  ('webmail_domains', '["gmail.com","googlemail.com","outlook.com","hotmail.com","hotmail.co.uk","live.com","live.co.uk","msn.com","yahoo.com","yahoo.co.uk","icloud.com","me.com","aol.com","btinternet.com","sky.com","talktalk.net","virginmedia.com","proton.me","protonmail.com"]'::jsonb)
on conflict (key) do nothing;

create or replace function setting_int(k text, d int) returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select (value #>> '{}')::int from app_settings where key = k), d)
$$;
revoke all on function setting_int(text, int) from public, anon, authenticated;

-- One row per organisation that has ever started a trial. Fingerprint only, no readable address. Nobody can read this table directly.
create table trial_registry (
  key_hash text primary key,
  created_at timestamptz not null default now()
);
alter table trial_registry enable row level security;
revoke all on trial_registry from anon, authenticated;

create or replace function trial_key(mail text) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  m text := lower(btrim(coalesce(mail, '')));
  loc text; dom text; free boolean;
begin
  loc := split_part(m, '@', 1); dom := split_part(m, '@', 2);
  if dom = '' or loc = '' then return null; end if;
  if dom = 'googlemail.com' then dom := 'gmail.com'; end if;
  free := exists (select 1 from app_settings s where s.key = 'webmail_domains' and s.value ? dom);
  if free then
    loc := split_part(loc, '+', 1);
    if dom = 'gmail.com' then loc := replace(loc, '.', ''); end if;
    return encode(sha256(convert_to('mail:' || loc || '@' || dom, 'UTF8')), 'hex');
  end if;
  return encode(sha256(convert_to('domain:' || dom, 'UTF8')), 'hex');
end $$;
revoke all on function trial_key(text) from public, anon, authenticated;

-- Is this company allowed in? Staff are checked separately; this is only about a client company.
create or replace function company_access_ok(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (
    select 1 from companies c where c.id = cid and (
         (c.subscription = 'trial'     and c.trial_ends_at is not null and c.trial_ends_at <= now())
      or (c.subscription = 'past_due'  and c.payment_failed_at is not null
            and c.payment_failed_at + make_interval(days => setting_int('payment_grace_days', 7)) <= now())
      or (c.subscription = 'cancelled' and (c.access_ends_at is null or c.access_ends_at <= now()))
      or (c.access_ends_at is not null and c.access_ends_at <= now())
    )
  )
$$;
revoke all on function company_access_ok(uuid) from public, anon;
grant execute on function company_access_ok(uuid) to authenticated;

-- A stopped account sees nothing: the property check is the one door every record, document and job goes through.
create or replace function can_access_property(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select mfa_ok() and exists (
    select 1 from profiles p join properties pr on pr.id = pid
    where p.id = auth.uid() and p.active
      and (
        p.role in ('tremcore_admin','tremcore_staff')
        or (company_access_ok(pr.company_id) and (
              (p.role = 'client_super' and pr.company_id = p.company_id)
           or (p.role = 'client_site' and pr.company_id = p.company_id
               and exists (select 1 from profile_properties pp where pp.profile_id = p.id and pp.property_id = pid))))
      )
  )
$$;

-- The company record itself is hidden from a stopped client too. The app asks my_access() instead, which gives only a state and dates.
drop policy companies_read on companies;
create policy companies_read on companies for select
  using (mfa_ok() and (is_tremcore() or (id = my_company() and company_access_ok(id))));

-- What the app should show the signed-in person: ok / trial / payment_failed / cancelling / stopped.
create or replace function my_access()
returns table (state text, ends_at timestamptz, days_left int, is_head boolean)
language sql stable security definer set search_path = public as $$
  select
    case
      when p.role in ('tremcore_admin','tremcore_staff') then 'ok'
      when not company_access_ok(c.id) then 'stopped'
      when c.access_ends_at is not null then 'cancelling'
      when c.subscription = 'past_due' then 'payment_failed'
      when c.subscription = 'trial' and c.trial_ends_at is not null then 'trial'
      else 'ok'
    end,
    case
      when p.role in ('tremcore_admin','tremcore_staff') then null
      when c.access_ends_at is not null then c.access_ends_at
      when c.subscription = 'past_due' then c.payment_failed_at + make_interval(days => setting_int('payment_grace_days', 7))
      when c.subscription = 'trial' then c.trial_ends_at
    end,
    case
      when p.role in ('tremcore_admin','tremcore_staff') then null
      else greatest(0, ceil(extract(epoch from (
        case when c.access_ends_at is not null then c.access_ends_at
             when c.subscription = 'past_due' then c.payment_failed_at + make_interval(days => setting_int('payment_grace_days', 7))
             else c.trial_ends_at end - now())) / 86400)::int)
    end,
    p.role = 'client_super'
  from profiles p left join companies c on c.id = p.company_id
  where p.id = auth.uid() and p.active
$$;
revoke all on function my_access() from public, anon;
grant execute on function my_access() to authenticated;

-- Payment status changes keep the dates in step. The payment provider (or Tremcore in the hub) only has to set companies.subscription.
create or replace function companies_billing_dates() returns trigger
language plpgsql as $$
begin
  if new.subscription = 'past_due' and (tg_op = 'INSERT' or old.subscription is distinct from 'past_due') then
    new.payment_failed_at := now();
  elsif new.subscription = 'active' then
    new.payment_failed_at := null;
    new.trial_ends_at := null;
  end if;
  return new;
end $$;
create trigger companies_billing_dates before insert or update of subscription on companies
  for each row execute function companies_billing_dates();

-- A head-office user gives notice. Monthly: 1 month from now. Annual (paid up front): the later of 1 month or the end of the paid year.
create or replace function request_cancellation() returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  cid uuid := my_company();
  c companies;
  endt timestamptz;
begin
  if not is_client_super() or cid is null then raise exception 'not_allowed' using errcode = '42501'; end if;
  if not mfa_ok() then raise exception 'mfa_required' using errcode = '42501'; end if;
  select * into c from companies where id = cid;
  if not company_access_ok(cid) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if c.cancel_requested_at is not null then return c.access_ends_at; end if;
  endt := now() + make_interval(months => setting_int('cancel_notice_months', 1));
  if c.billing_interval = 'annual' and c.paid_until is not null and c.paid_until > endt then endt := c.paid_until; end if;
  update companies set cancel_requested_at = now(), access_ends_at = endt,
         delete_after = endt + make_interval(days => setting_int('data_removal_days_after_end', 14))
   where id = cid;
  return endt;
end $$;
revoke all on function request_cancellation() from public, anon;
grant execute on function request_cancellation() to authenticated;

-- Changed their mind before the notice ran out.
create or replace function withdraw_cancellation() returns void
language plpgsql security definer set search_path = public as $$
declare cid uuid := my_company();
begin
  if not is_client_super() or cid is null or not mfa_ok() then raise exception 'not_allowed' using errcode = '42501'; end if;
  if not company_access_ok(cid) then raise exception 'not_allowed' using errcode = '42501'; end if;
  update companies set cancel_requested_at = null, access_ends_at = null, delete_after = null where id = cid;
end $$;
revoke all on function withdraw_cancellation() from public, anon;
grant execute on function withdraw_cancellation() to authenticated;

-- Sign-up: now also starts the 7-day clock and refuses a second trial for the same organisation.
create or replace function signup_company(p_company text, p_full_name text, p_site_name text, p_site_address text default null, p_billing text default 'monthly')
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  cid uuid;
  nm text := btrim(coalesce(p_company, ''));
  fn text := btrim(coalesce(p_full_name, ''));
  sn text := btrim(coalesce(p_site_name, ''));
  ad text := nullif(btrim(coalesce(p_site_address, '')), '');
  bi text := coalesce(nullif(btrim(coalesce(p_billing, '')), ''), 'monthly');
  mail text;
  confirmed timestamptz;
  k text;
begin
  if uid is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  if not signup_open() then raise exception 'signup_closed' using errcode = '42501'; end if;
  select u.email, u.email_confirmed_at into mail, confirmed from auth.users u where u.id = uid;
  if confirmed is null then raise exception 'email_not_confirmed' using errcode = '42501'; end if;
  if exists (select 1 from profiles where id = uid) then raise exception 'already_set_up' using errcode = '23505'; end if;
  if char_length(nm) not between 1 and 160 or char_length(fn) not between 1 and 120
     or char_length(sn) not between 1 and 160 or char_length(coalesce(ad, '')) > 300
     or bi not in ('monthly', 'annual') then
    raise exception 'invalid_details' using errcode = '22023';
  end if;
  k := trial_key(mail);
  if k is null then raise exception 'invalid_details' using errcode = '22023'; end if;
  begin
    insert into trial_registry(key_hash) values (k);
  exception when unique_violation then
    raise exception 'trial_already_used' using errcode = '42501';
  end;

  insert into companies(name, level, subscription, monthly_value_pence, require_mfa, contact_name, contact_email, source, billing_interval, trial_ends_at)
  values (nm, 1, 'trial', 0, false, fn, mail, 'self_signup', bi,
          now() + make_interval(days => setting_int('trial_days', 7))) returning id into cid;
  insert into profiles(id, full_name, role, company_id, perm) values (uid, fn, 'client_super', cid, 'full');
  insert into properties(company_id, name, address) values (cid, sn, ad);
  return cid;
end $$;
