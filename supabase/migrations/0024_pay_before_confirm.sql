-- Pay at sign-up, BEFORE the email is confirmed. The sign-up page creates the login (unconfirmed), then our server calls this function
-- (service key only) to make the unpaid company, and sends the person straight to Stripe. The login still cannot be used until the
-- email is confirmed, and nothing opens until Stripe confirms the payment, so there is no way in without both.
create or replace function signup_prepare(p_email text, p_company text, p_full_name text, p_sites int, p_billing text)
returns table (company_id uuid, sites int, billing_interval text, email text)
language plpgsql security definer set search_path = public as $$
declare
  u auth.users%rowtype;
  nm text := cap_words(btrim(coalesce(p_company, '')));
  fn text := cap_words(btrim(coalesce(p_full_name, '')));
  bi text := coalesce(nullif(btrim(coalesce(p_billing, '')), ''), 'monthly');
  n int := coalesce(p_sites, 0);
  pf profiles%rowtype;
  cid uuid;
begin
  if not signup_open() then raise exception 'signup_closed' using errcode = '42501'; end if;
  select * into u from auth.users a where lower(a.email) = lower(btrim(coalesce(p_email, ''))) order by a.created_at desc limit 1;
  -- only a brand-new login whose email has not been confirmed yet (an existing account can never be re-pointed or re-priced from here)
  if not found or u.email_confirmed_at is not null or u.created_at < now() - interval '2 hours' then raise exception 'not_allowed' using errcode = '42501'; end if;
  if char_length(nm) not between 1 and 160 or char_length(fn) not between 1 and 120 or n not between 1 and 100 or bi not in ('monthly', 'annual') then
    raise exception 'invalid_details' using errcode = '22023';
  end if;
  select * into pf from profiles p where p.id = u.id;
  if found then
    -- Coming back after leaving the Stripe page: use the same company, with the details they have now.
    if pf.role <> 'client_super' or not exists (select 1 from companies c where c.id = pf.company_id and c.subscription = 'trial' and c.source = 'self_signup') then
      raise exception 'already_paid' using errcode = '23505';
    end if;
    cid := pf.company_id;
    update companies c set name = nm, contact_name = fn, billing_interval = bi, trial_ends_at = now() where c.id = cid;
    update profiles p set full_name = fn where p.id = u.id;
    delete from properties pr where pr.company_id = cid;      -- nobody has been able to sign in yet, so these are only placeholders
  else
    insert into companies(name, level, subscription, monthly_value_pence, require_mfa, contact_name, contact_email, source, billing_interval, trial_ends_at)
    values (nm, 1, 'trial', 0, false, fn, u.email, 'self_signup', bi, now()) returning id into cid;
    insert into profiles(id, full_name, role, company_id, perm) values (u.id, fn, 'client_super', cid, 'full');
  end if;
  insert into properties(company_id, name) select cid, 'Site ' || g from generate_series(1, n) g;
  return query select cid, n, bi, u.email::text;
end $$;
revoke all on function signup_prepare(text, text, text, int, text) from public, anon, authenticated;
grant execute on function signup_prepare(text, text, text, int, text) to service_role;
