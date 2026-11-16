-- Buying add-ons online (Toolbox Talks, Staff Clock In / Out) and the staff register for Staff Clock In / Out.

-- ───────────── who may buy, and what to charge ─────────────
-- Called by our server (with the signed-in person's token) before it sends them to Stripe.
create or replace function extra_checkout_info(p_code text)
returns table (company_id uuid, sites int, email text, stripe_customer_id text, name text, price_pence int, charged_per text, quantity int)
language plpgsql stable security definer set search_path = public as $$
declare cid uuid := my_company(); e extras; n int;
begin
  if cid is null or not is_client_super() or not mfa_ok() then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into e from extras where code = p_code and active;
  if not found then raise exception 'unknown_extra' using errcode = '22023'; end if;
  if not exists (select 1 from companies c where c.id = cid and c.level = 1 and c.subscription = 'active') then raise exception 'not_allowed' using errcode = '42501'; end if;
  if has_extra(cid, p_code) then raise exception 'already_owned' using errcode = '23505'; end if;
  select count(*)::int into n from properties where properties.company_id = cid;
  return query select cid, n, (select u.email from auth.users u where u.id = auth.uid()), (select c.stripe_customer_id from companies c where c.id = cid),
                      e.name, e.price_pence, e.charged_per, case when e.charged_per = 'site' then greatest(n, 1) else 1 end;
end $$;
revoke all on function extra_checkout_info(text) from public, anon;
grant execute on function extra_checkout_info(text) to authenticated;

-- ───────────── Stripe events: now also understands add-on payments ─────────────
-- An add-on is its own Stripe subscription. Its payments, failures and cancellation must never touch the main account,
-- so every event that names a subscription is routed by that subscription's id.
drop function if exists apply_stripe_event(text, text, uuid, text, text, text);
create or replace function apply_stripe_event(p_event_id text, p_event_type text, p_company uuid, p_customer text, p_subscription text, p_action text,
                                              p_extra text default null, p_quantity int default 1)
returns text
language plpgsql security definer set search_path = public as $$
declare c companies; n int; monthly int; fresh boolean; ex extras; xsum int; is_extra_sub boolean;
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
    insert into company_extras(company_id, extra_code, status, price_pence, quantity, started_at, access_ends_at, cancel_requested_at, stripe_item_id)
      values (c.id, ex.code, 'active', ex.price_pence, greatest(coalesce(p_quantity, 1), 1), now(), null, null, p_subscription)
      on conflict (company_id, extra_code) do update set status = 'active', price_pence = excluded.price_pence, quantity = excluded.quantity,
        started_at = now(), access_ends_at = null, cancel_requested_at = null, stripe_item_id = excluded.stripe_item_id;
    update companies set stripe_customer_id = coalesce(stripe_customer_id, p_customer) where id = c.id;
    select coalesce(sum(price_pence * quantity), 0)::int into xsum from company_extras where company_id = c.id and status = 'active';
    select count(*)::int into n from properties where company_id = c.id;
    update companies set monthly_value_pence = (case when billing_interval = 'annual' then round((15290 + 8150 * greatest(n - 1, 0)) / 12.0)::int else 1499 + 799 * greatest(n - 1, 0) end) + xsum where id = c.id;
    return 'extra_applied';
  end if;

  if p_subscription is not null then
    select exists (select 1 from company_extras where company_id = c.id and stripe_item_id = p_subscription) into is_extra_sub;
    if is_extra_sub then
      if p_action = 'cancelled' then
        update company_extras set status = 'cancelled', access_ends_at = now() where company_id = c.id and stripe_item_id = p_subscription;
        select coalesce(sum(price_pence * quantity), 0)::int into xsum from company_extras where company_id = c.id and status = 'active';
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
  select coalesce(sum(price_pence * quantity), 0)::int into xsum from company_extras where company_id = c.id and status = 'active';
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
revoke all on function apply_stripe_event(text, text, uuid, text, text, text, text, int) from public, anon, authenticated;
grant execute on function apply_stripe_event(text, text, uuid, text, text, text, text, int) to service_role;

-- ───────────── Staff register (Staff Clock In / Out) ─────────────
-- The people at each site who clock in and out. Only a business that has bought the add-on can use it.
create or replace function site_has_extra(pid uuid, code text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from properties p where p.id = pid and has_extra(p.company_id, code))
$$;
revoke all on function site_has_extra(uuid, text) from public, anon;
grant execute on function site_has_extra(uuid, text) to authenticated;

create table staff_members (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  full_name text not null check (char_length(btrim(full_name)) between 1 and 120),
  job_title text not null default '' check (char_length(job_title) <= 120),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index on staff_members(property_id);
alter table staff_members enable row level security;
create policy staff_read   on staff_members for select using (can_access_property(property_id) and site_has_extra(property_id, 'staff_signin'));
create policy staff_insert on staff_members for insert with check (can_edit_property(property_id) and site_has_extra(property_id, 'staff_signin'));
create policy staff_update on staff_members for update using (can_edit_property(property_id) and site_has_extra(property_id, 'staff_signin')) with check (can_edit_property(property_id) and site_has_extra(property_id, 'staff_signin'));
create policy staff_delete on staff_members for delete using (can_edit_property(property_id) and site_has_extra(property_id, 'staff_signin'));
create trigger staff_tidy before insert or update of full_name on staff_members for each row execute function tidy_name_full();
create trigger staff_audit after insert or update or delete on staff_members for each row execute function audit_row();
create or replace function enforce_staff_limit() returns trigger language plpgsql as $$
begin
  if (select count(*) from staff_members where property_id = new.property_id) >= 300 then raise exception 'staff_limit_reached' using errcode = '23514'; end if;
  return new;
end $$;
create trigger staff_limit before insert on staff_members for each row execute function enforce_staff_limit();
