-- Toolbox Talks is charged per site (like Staff Clock In / Out): £3.99 per site per month. Add-ons are monthly; there is no yearly discount.
update extras set charged_per = 'site' where code = 'toolbox_talks';

-- Same checks as before, but each refusal now says WHY, so the person is told exactly what to fix.
create or replace function extra_checkout_info(p_code text)
returns table (company_id uuid, sites int, email text, stripe_customer_id text, name text, price_pence int, charged_per text, quantity int)
language plpgsql stable security definer set search_path = public as $$
declare cid uuid := my_company(); e extras; n int; c companies;
begin
  if cid is null or not is_client_super() then raise exception 'not_head' using errcode = '42501'; end if;
  if not mfa_ok() then raise exception 'two_factor_needed' using errcode = '42501'; end if;
  select * into e from extras where code = p_code and active;
  if not found then raise exception 'unknown_extra' using errcode = '22023'; end if;
  select * into c from companies where id = cid;
  if c.level <> 1 then raise exception 'not_self_managed' using errcode = '42501'; end if;
  if c.subscription <> 'active' then raise exception 'not_active' using errcode = '42501'; end if;
  if has_extra(cid, p_code) then raise exception 'already_owned' using errcode = '23505'; end if;
  select count(*)::int into n from properties where properties.company_id = cid;
  return query select cid, n, (select u.email from auth.users u where u.id = auth.uid()), c.stripe_customer_id,
                      e.name, e.price_pence, e.charged_per, case when e.charged_per = 'site' then greatest(n, 1) else 1 end;
end $$;
revoke all on function extra_checkout_info(text) from public, anon;
grant execute on function extra_checkout_info(text) to authenticated;
