-- Website enquiries ("Book a demo" form). Anyone on the internet may ADD one; only Tremcore staff (with 2FA) may read or manage them.
create table enquiries (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null check (char_length(name) between 1 and 120),
  company text not null default '' check (char_length(company) <= 160),
  email text not null check (char_length(email) between 3 and 200 and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  phone text not null default '' check (char_length(phone) <= 40),
  sites text check (sites in ('1','2-5','6-20','20+')),
  package_interest text check (package_interest in ('self_managed')),
  message text not null default '' check (char_length(message) <= 2000),
  status text not null default 'new' check (status in ('new','contacted','demo_booked','won','lost')),
  notes text not null default ''
);
alter table enquiries enable row level security;

-- Visitors: insert only, and only a brand-new row (they cannot set the status or notes).
create policy enquiries_public_insert on enquiries for insert to anon, authenticated
  with check (status = 'new' and notes = '');
-- Tremcore staff: full management, 2FA required.
create policy enquiries_staff_all on enquiries for all to authenticated
  using (is_tremcore() and mfa_ok()) with check (is_tremcore() and mfa_ok());

revoke all on enquiries from anon, authenticated;
grant insert on enquiries to anon, authenticated;
grant select, update, delete on enquiries to authenticated;
