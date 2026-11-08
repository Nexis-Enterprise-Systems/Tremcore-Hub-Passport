-- Migration 0004: Self-Managed sign-up.
-- A business can create its own account, but ONLY as a Level 1 (Self-Managed) trial, and ONLY while Tremcore has sign-up switched on.
-- Normal tables stay locked: a new user cannot create companies directly. They call signup_company(), which does exactly three things
-- (company, head-office profile, first site) and cannot be talked into anything else.

-- ───────────── on/off switch Tremcore controls from the hub ─────────────
create table app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table app_settings enable row level security;
-- Only a Tremcore administrator who has passed 2FA can read or change settings directly.
create policy app_settings_admin on app_settings for all
  using (mfa_ok() and is_tremcore_admin()) with check (mfa_ok() and is_tremcore_admin());
revoke all on app_settings from anon, authenticated;
grant select, insert, update on app_settings to authenticated;

insert into app_settings(key, value) values ('self_signup_open', 'false'::jsonb);   -- closed until Aaron opens it

-- Public yes/no: is sign-up open? (The website and sign-up page use this; it reveals nothing else.)
create or replace function signup_open() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select value = 'true'::jsonb from app_settings where key = 'self_signup_open'), false)
$$;
revoke all on function signup_open() from public;
grant execute on function signup_open() to anon, authenticated;

-- Where a company came from, so Tremcore can see which clients signed themselves up and need a follow-up.
alter table companies add column source text not null default 'staff' check (source in ('staff', 'self_signup'));

-- ───────────── the sign-up function ─────────────
create or replace function signup_company(p_company text, p_full_name text, p_site_name text, p_site_address text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  cid uuid;
  nm text := btrim(coalesce(p_company, ''));
  fn text := btrim(coalesce(p_full_name, ''));
  sn text := btrim(coalesce(p_site_name, ''));
  ad text := nullif(btrim(coalesce(p_site_address, '')), '');
  mail text;
  confirmed timestamptz;
begin
  if uid is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  if not signup_open() then raise exception 'signup_closed' using errcode = '42501'; end if;
  select u.email, u.email_confirmed_at into mail, confirmed from auth.users u where u.id = uid;
  if confirmed is null then raise exception 'email_not_confirmed' using errcode = '42501'; end if;   -- real, owned email address only
  if exists (select 1 from profiles where id = uid) then raise exception 'already_set_up' using errcode = '23505'; end if;
  if char_length(nm) not between 1 and 160 or char_length(fn) not between 1 and 120
     or char_length(sn) not between 1 and 160 or char_length(coalesce(ad, '')) > 300 then
    raise exception 'invalid_details' using errcode = '22023';
  end if;

  -- Level, subscription, value and 2FA settings are fixed here; the caller has no say in them.
  insert into companies(name, level, subscription, monthly_value_pence, require_mfa, contact_name, contact_email, source)
  values (nm, 1, 'trial', 0, false, fn, mail, 'self_signup') returning id into cid;
  insert into profiles(id, full_name, role, company_id, perm) values (uid, fn, 'client_super', cid, 'full');
  insert into properties(company_id, name, address) values (cid, sn, ad);
  return cid;
end $$;
revoke all on function signup_company(text, text, text, text) from public, anon;
grant execute on function signup_company(text, text, text, text) to authenticated;
