-- Migration 0014: taking payment with Stripe. The database never decides that someone has paid: it only records what Stripe tells the server.
--   * billing_info(): what the Pay now page needs (company, number of sites, monthly/yearly, email). Head-office user only.
--   * apply_stripe_event(): called ONLY by the server (service role key, never the browser) when a verified Stripe message arrives.
--     Each Stripe event is processed once (duplicates are ignored), so a repeated message can never double-open or double-charge anything.
--     paid -> account Active; failed (on an account that was paid) -> Past due (7-day warning, then stop); cancelled -> Cancelled.

alter table companies add column stripe_customer_id text unique, add column stripe_subscription_id text unique;

create table stripe_events (
  id text primary key,
  event_type text not null,
  received_at timestamptz not null default now()
);
alter table stripe_events enable row level security;
revoke all on stripe_events from anon, authenticated;

create or replace function billing_info() returns table (company_id uuid, sites int, billing_interval text, email text, subscription sub_status)
language sql stable security definer set search_path = public as $$
  select c.id, (select count(*)::int from properties pr where pr.company_id = c.id), c.billing_interval,
         (select u.email from auth.users u where u.id = auth.uid()), c.subscription
  from companies c
  where c.id = my_company() and is_client_super()
$$;
revoke all on function billing_info() from public, anon;
grant execute on function billing_info() to authenticated;

create or replace function apply_stripe_event(p_event_id text, p_event_type text, p_company uuid, p_customer text, p_subscription text, p_action text)
returns text
language plpgsql security definer set search_path = public as $$
declare c companies; n int; monthly int; fresh boolean;
begin
  if p_action not in ('paid', 'failed', 'cancelled') then raise exception 'invalid_details' using errcode = '22023'; end if;
  insert into stripe_events(id, event_type) values (p_event_id, p_event_type) on conflict do nothing;
  get diagnostics n = row_count;
  fresh := n = 1;
  if not fresh then return 'duplicate'; end if;
  if p_company is not null then select * into c from companies where id = p_company;
  elsif p_customer is not null then select * into c from companies where stripe_customer_id = p_customer;
  end if;
  if c.id is null then return 'unknown_company'; end if;
  select count(*)::int into n from properties where company_id = c.id;
  if c.billing_interval = 'annual' then monthly := round((15290 + 8150 * greatest(n - 1, 0)) / 12.0)::int;
  else monthly := 1499 + 799 * greatest(n - 1, 0); end if;
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
revoke all on function apply_stripe_event(text, text, uuid, text, text, text) from public, anon, authenticated;
grant execute on function apply_stripe_event(text, text, uuid, text, text, text) to service_role;
