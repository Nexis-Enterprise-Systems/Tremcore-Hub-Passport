-- The "register your interest" list. While the passport is not open to the public, the website collects name, email, business name, address and number of
-- sites. Anyone on the internet may ADD themselves; only Tremcore staff (with 2FA, when switched on) can see or manage the list.
-- Status: registered -> invited (the launch link was sent) -> signed_up (they became a paying customer). 'removed' = asked off the list.
create table interest_list (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null check (char_length(name) between 1 and 120),
  email text not null check (char_length(email) between 3 and 200 and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  business_name text not null check (char_length(business_name) between 1 and 160),
  business_address text not null check (char_length(business_address) between 1 and 400),
  sites int not null check (sites between 1 and 100),
  consent_at timestamptz not null default now(),              -- they ticked the box agreeing to be emailed about the launch
  status text not null default 'registered' check (status in ('registered', 'invited', 'signed_up', 'removed')),
  invited_at timestamptz,
  signed_up_at timestamptz,
  company_id uuid references companies(id) on delete set null,
  notes text not null default '' check (char_length(notes) <= 2000)
);
create unique index interest_list_email_once on interest_list (lower(email));
alter table interest_list enable row level security;

create policy interest_public_insert on interest_list for insert to anon, authenticated
  with check (status = 'registered' and invited_at is null and signed_up_at is null and company_id is null and notes = '');
create policy interest_staff_all on interest_list for all to authenticated
  using (is_tremcore() and mfa_ok()) with check (is_tremcore() and mfa_ok());
revoke all on interest_list from anon, authenticated;
grant insert on interest_list to anon, authenticated;
grant select, update, delete on interest_list to authenticated;

-- Staff: note that the launch link was sent to these people (only those still waiting).
create or replace function mark_interest_invited(p_ids uuid[]) returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not (is_tremcore() and mfa_ok()) then raise exception 'not_allowed' using errcode = '42501'; end if;
  update interest_list set status = 'invited', invited_at = now() where id = any(p_ids) and status = 'registered';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function mark_interest_invited(uuid[]) from public, anon;
grant execute on function mark_interest_invited(uuid[]) to authenticated;

-- When a company becomes a paying customer, the person on the list with the same email moves to "signed up".
create or replace function interest_follow_signup() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.subscription in ('active', 'past_due') and new.contact_email is not null then
    update interest_list set status = 'signed_up', signed_up_at = coalesce(signed_up_at, now()), company_id = new.id
     where lower(email) = lower(btrim(new.contact_email)) and status <> 'signed_up';
  end if;
  return new;
end $$;
create trigger companies_interest_follow after insert or update of subscription, contact_email on companies for each row execute function interest_follow_signup();
