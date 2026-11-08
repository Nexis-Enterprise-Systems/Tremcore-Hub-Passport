-- Migration 0005: monthly or annual billing choice.
-- A business picks monthly or annual billing when it signs up (annual is 15% cheaper). For now this is only recorded so Tremcore can see it
-- in the hub; taking payment comes later. The sign-up function still fixes level, status and value itself: the caller only chooses the interval.

alter table companies add column billing_interval text not null default 'monthly' check (billing_interval in ('monthly', 'annual'));

-- Replace the 4-argument sign-up function with one that also takes the billing choice (defaults to monthly, so older callers still work).
drop function signup_company(text, text, text, text);

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

  insert into companies(name, level, subscription, monthly_value_pence, require_mfa, contact_name, contact_email, source, billing_interval)
  values (nm, 1, 'trial', 0, false, fn, mail, 'self_signup', bi) returning id into cid;
  insert into profiles(id, full_name, role, company_id, perm) values (uid, fn, 'client_super', cid, 'full');
  insert into properties(company_id, name, address) values (cid, sn, ad);
  return cid;
end $$;
revoke all on function signup_company(text, text, text, text, text) from public, anon;
grant execute on function signup_company(text, text, text, text, text) to authenticated;
