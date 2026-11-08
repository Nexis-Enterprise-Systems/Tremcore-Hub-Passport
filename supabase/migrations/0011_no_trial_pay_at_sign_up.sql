-- Migration 0011: there is NO free trial. A business signs up and pays; nothing opens until the payment is confirmed.
--
-- * A new sign-up is created unpaid (subscription 'trial' is now used only to mean "signed up, not yet paid"), with no access at all.
--   Payment confirmation (Stripe, built later) sets subscription = 'active', which opens the account.
-- * The one-trial-per-domain check is no longer needed (nothing is free), so it is removed. Two people at the same company can each sign up.
-- * The 7-day grace after a FAILED payment and the 1-month cancellation notice are unchanged.

update app_settings set value = '0'::jsonb where key = 'trial_days';

create or replace function my_access()
returns table (state text, ends_at timestamptz, days_left int, is_head boolean)
language sql stable security definer set search_path = public as $$
  select
    case
      when p.role in ('tremcore_admin','tremcore_staff') then 'ok'
      when c.subscription = 'trial' and not company_access_ok(c.id) then 'awaiting_payment'
      when not company_access_ok(c.id) then 'stopped'
      when c.access_ends_at is not null then 'cancelling'
      when c.subscription = 'past_due' then 'payment_failed'
      else 'ok'
    end,
    case
      when p.role in ('tremcore_admin','tremcore_staff') then null
      when c.access_ends_at is not null then c.access_ends_at
      when c.subscription = 'past_due' then c.payment_failed_at + make_interval(days => setting_int('payment_grace_days', 7))
    end,
    case
      when p.role in ('tremcore_admin','tremcore_staff') then null
      when c.access_ends_at is not null then greatest(0, ceil(extract(epoch from (c.access_ends_at - now())) / 86400)::int)
      when c.subscription = 'past_due' then greatest(0, ceil(extract(epoch from (c.payment_failed_at + make_interval(days => setting_int('payment_grace_days', 7)) - now())) / 86400)::int)
    end,
    p.role = 'client_super'
  from profiles p left join companies c on c.id = p.company_id
  where p.id = auth.uid() and p.active
$$;

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
  -- Unpaid until the payment is confirmed: trial_ends_at = now() means no access yet.
  insert into companies(name, level, subscription, monthly_value_pence, require_mfa, contact_name, contact_email, source, billing_interval, trial_ends_at)
  values (nm, 1, 'trial', 0, false, fn, mail, 'self_signup', bi, now()) returning id into cid;
  insert into profiles(id, full_name, role, company_id, perm) values (uid, fn, 'client_super', cid, 'full');
  insert into properties(company_id, name, address) values (cid, sn, ad);
  return cid;
end $$;
