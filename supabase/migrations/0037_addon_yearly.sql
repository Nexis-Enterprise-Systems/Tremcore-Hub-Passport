-- Migration 0037: add-ons can be paid yearly upfront (12 months in one payment, 15% off), 26 Nov 2026.
-- Monthly stays the default. The yearly price is worked out from the monthly price, so changing a monthly price changes the yearly one with it:
--   yearly = monthly x 12 x 0.85, rounded to the nearest 10p   (Toolbox Talks 2.99 -> 30.50, Staff Clock In / Out 5.99 -> 61.10, per site)
-- A yearly add-on is its own Stripe subscription that renews every 12 months (the "12-month rolling contract").
-- The account's monthly value counts a yearly add-on as one twelfth of what was paid, so the hub's recurring-revenue figure stays a monthly figure.

alter table extras add column yearly_pence int generated always as ((round(price_pence * 12 * 0.85 / 10.0)::int) * 10) stored;
alter table company_extras add column billing_interval text not null default 'month' check (billing_interval in ('month', 'year'));

-- What an add-on is worth per month, whichever way it is paid.
create or replace function extra_monthly_value(p_price int, p_interval text) returns int
language sql immutable as $$
  select case when p_interval = 'year' then round(((round(p_price * 12 * 0.85 / 10.0)::int) * 10) / 12.0)::int else p_price end
$$;

-- ───────────── what is on offer (now with the yearly price) ─────────────
drop function if exists my_extras();
create or replace function my_extras()
returns table (code text, name text, description text, price_pence int, charged_per text, owned boolean, yearly_pence int, billing_interval text)
language sql stable security definer set search_path = public as $$
  select e.code, e.name, e.description, e.price_pence, e.charged_per, coalesce(my_company() is not null and has_extra(my_company(), e.code), false), e.yearly_pence,
         (select ce.billing_interval from company_extras ce where ce.company_id = my_company() and ce.extra_code = e.code and ce.status = 'active')
  from extras e where e.active order by e.code
$$;
revoke all on function my_extras() from public, anon;
grant execute on function my_extras() to authenticated;

-- ───────────── who may buy, and what to charge ─────────────
-- price_pence is still the monthly list price. unit_pence is what Stripe charges each time for the chosen way of paying
-- (monthly: the monthly price; yearly: the yearly price), per site where the add-on is charged per site.
drop function if exists extra_checkout_info(text);
create or replace function extra_checkout_info(p_code text, p_interval text default 'month')
returns table (company_id uuid, sites int, email text, stripe_customer_id text, name text, price_pence int, charged_per text, quantity int, unit_pence int, billing_interval text)
language plpgsql stable security definer set search_path = public as $$
declare cid uuid := my_company(); e extras; n int;
begin
  if cid is null or not is_client_super() or not mfa_ok() then raise exception 'not_allowed' using errcode = '42501'; end if;
  if p_interval is null or p_interval not in ('month', 'year') then raise exception 'invalid_details' using errcode = '22023'; end if;
  select * into e from extras where code = p_code and active;
  if not found then raise exception 'unknown_extra' using errcode = '22023'; end if;
  if not exists (select 1 from companies c where c.id = cid and c.level = 1 and c.subscription = 'active') then raise exception 'not_allowed' using errcode = '42501'; end if;
  if has_extra(cid, p_code) then raise exception 'already_owned' using errcode = '23505'; end if;
  select count(*)::int into n from properties where properties.company_id = cid;
  return query select cid, n, (select u.email from auth.users u where u.id = auth.uid()), (select c.stripe_customer_id from companies c where c.id = cid),
                      e.name, e.price_pence, e.charged_per, case when e.charged_per = 'site' then greatest(n, 1) else 1 end,
                      case when p_interval = 'year' then e.yearly_pence else e.price_pence end, p_interval;
end $$;
revoke all on function extra_checkout_info(text, text) from public, anon;
grant execute on function extra_checkout_info(text, text) to authenticated;

-- ───────────── Stripe events: add-on payments now know monthly from yearly ─────────────
drop function if exists apply_stripe_event(text, text, uuid, text, text, text, text, int);
create or replace function apply_stripe_event(p_event_id text, p_event_type text, p_company uuid, p_customer text, p_subscription text, p_action text,
                                              p_extra text default null, p_quantity int default 1, p_interval text default 'month')
returns text
language plpgsql security definer set search_path = public as $$
declare c companies; n int; monthly int; fresh boolean; ex extras; xsum int; is_extra_sub boolean; per text := case when p_interval = 'year' then 'year' else 'month' end;
begin
  if p_action not in ('paid', 'failed', 'cancelled', 'extra_paid') then raise exception 'invalid_details' using errcode = '22023'; end if;
  insert into stripe_events(id, event_type) values (p_event_id, p_event_type) on conflict do nothing;
  get diagnostics n = row_count;
  fresh := n = 1;
  if not fresh then return 'duplicate'; end if;
  if p_company is not null then select * into c from companies where id = p_company;
  elsif p_customer is not null then select * into c from companies where stripe_customer_id = p_customer;
  end if;
  if c.id is null then return 'unknown_company'; end if;

  if p_action = 'extra_paid' then
    select * into ex from extras where code = p_extra and active;
    if not found or p_subscription is null then return 'unknown_extra'; end if;
    insert into company_extras(company_id, extra_code, status, price_pence, quantity, started_at, access_ends_at, cancel_requested_at, stripe_item_id, billing_interval)
      values (c.id, ex.code, 'active', ex.price_pence, greatest(coalesce(p_quantity, 1), 1), now(), null, null, p_subscription, per)
      on conflict (company_id, extra_code) do update set status = 'active', price_pence = excluded.price_pence, quantity = excluded.quantity,
        started_at = now(), access_ends_at = null, cancel_requested_at = null, stripe_item_id = excluded.stripe_item_id, billing_interval = excluded.billing_interval;
    update companies set stripe_customer_id = coalesce(stripe_customer_id, p_customer) where id = c.id;
    select coalesce(sum(extra_monthly_value(price_pence, billing_interval) * quantity), 0)::int into xsum from company_extras where company_id = c.id and status = 'active';
    select count(*)::int into n from properties where company_id = c.id;
    update companies set monthly_value_pence = (case when billing_interval = 'annual' then round((15290 + 8150 * greatest(n - 1, 0)) / 12.0)::int else 1499 + 799 * greatest(n - 1, 0) end) + xsum where id = c.id;
    return 'extra_applied';
  end if;

  if p_subscription is not null then
    select exists (select 1 from company_extras where company_id = c.id and stripe_item_id = p_subscription) into is_extra_sub;
    if is_extra_sub then
      if p_action = 'cancelled' then
        update company_extras set status = 'cancelled', access_ends_at = now() where company_id = c.id and stripe_item_id = p_subscription;
        select coalesce(sum(extra_monthly_value(price_pence, billing_interval) * quantity), 0)::int into xsum from company_extras where company_id = c.id and status = 'active';
        select count(*)::int into n from properties where company_id = c.id;
        update companies set monthly_value_pence = (case when billing_interval = 'annual' then round((15290 + 8150 * greatest(n - 1, 0)) / 12.0)::int else 1499 + 799 * greatest(n - 1, 0) end) + xsum where id = c.id;
        return 'extra_cancelled';
      end if;
      return 'extra_ignored';
    elsif c.stripe_subscription_id is not null and c.stripe_subscription_id <> p_subscription then
      return 'other_subscription';   -- an add-on's first invoice can arrive before we know about it; it is not the main account
    end if;
  end if;

  select count(*)::int into n from properties where company_id = c.id;
  select coalesce(sum(extra_monthly_value(price_pence, billing_interval) * quantity), 0)::int into xsum from company_extras where company_id = c.id and status = 'active';
  if c.billing_interval = 'annual' then monthly := round((15290 + 8150 * greatest(n - 1, 0)) / 12.0)::int;
  else monthly := 1499 + 799 * greatest(n - 1, 0); end if;
  monthly := monthly + xsum;
  if p_action = 'paid' then
    update companies set subscription = 'active', monthly_value_pence = monthly,
           stripe_customer_id = coalesce(p_customer, stripe_customer_id), stripe_subscription_id = coalesce(p_subscription, stripe_subscription_id)
     where id = c.id;
  elsif p_action = 'failed' then
    if c.subscription in ('active', 'past_due') then update companies set subscription = 'past_due' where id = c.id; end if;
  else
    update companies set subscription = 'cancelled', access_ends_at = coalesce(access_ends_at, now()) where id = c.id;
  end if;
  return 'applied';
end $$;
revoke all on function apply_stripe_event(text, text, uuid, text, text, text, text, int, text) from public, anon, authenticated;
grant execute on function apply_stripe_event(text, text, uuid, text, text, text, text, int, text) to service_role;
