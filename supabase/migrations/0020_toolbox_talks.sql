-- Toolbox Talks: a library of core talks (Tremcore's, the same for everyone who has bought the add-on), up to 10 of a company's own,
-- and a permanent record of each talk that is delivered, with who attended and their on-screen signatures.

create table toolbox_talks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,   -- null = Tremcore's core library
  code text,                                                     -- core talks only
  category text not null check (category in ('Health & Safety', 'Fire Safety', 'Wellbeing', 'Workplace Responsibilities', 'Industry Specific')),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  summary text not null default '' check (char_length(summary) <= 500),
  points text[] not null default '{}' check (coalesce(array_length(points, 1), 0) <= 12),
  discuss text[] not null default '{}' check (coalesce(array_length(discuss, 1), 0) <= 8),
  minutes smallint not null default 10 check (minutes between 1 and 120),
  sort int not null default 0,
  active boolean not null default true,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (company_id is null or code is null)
);
create unique index toolbox_talks_code on toolbox_talks(code) where company_id is null;
create index on toolbox_talks(company_id);
alter table toolbox_talks enable row level security;

create or replace function talks_visible(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_tremcore() or (my_company() is not null and has_extra(my_company(), 'toolbox_talks') and (cid is null or cid = my_company()))
$$;
revoke all on function talks_visible(uuid) from public, anon;
grant execute on function talks_visible(uuid) to authenticated;

create policy talks_read on toolbox_talks for select using (mfa_ok() and active and talks_visible(company_id));
-- Only a company's head-office user writes its own talks; only Tremcore admins write the core library.
create policy talks_write_own on toolbox_talks for all
  using (mfa_ok() and company_id is not null and company_id = my_company() and is_client_super() and has_extra(company_id, 'toolbox_talks'))
  with check (mfa_ok() and company_id is not null and company_id = my_company() and is_client_super() and has_extra(company_id, 'toolbox_talks'));
create policy talks_write_core on toolbox_talks for all
  using (mfa_ok() and is_tremcore_admin()) with check (mfa_ok() and is_tremcore_admin());

create or replace function enforce_own_talk_limit() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is not null and new.active and (select count(*) from toolbox_talks t where t.company_id = new.company_id and t.active and t.id <> new.id) >= 10 then
    raise exception 'talk_limit_reached' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger talks_own_limit before insert or update on toolbox_talks for each row execute function enforce_own_talk_limit();

-- ───────────── records of talks given ─────────────
create table talk_sessions (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  talk_id uuid references toolbox_talks(id) on delete set null,
  talk_title text not null,                      -- kept as it was on the day, even if the talk is later edited or removed
  talk_category text not null default '',
  talk_points text[] not null default '{}',
  delivered_on date not null default current_date,
  presenter text not null check (char_length(btrim(presenter)) between 1 and 120),
  notes text not null default '' check (char_length(notes) <= 2000),
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on talk_sessions(property_id, delivered_on desc);
create table talk_attendees (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references talk_sessions(id) on delete cascade,
  full_name text not null check (char_length(btrim(full_name)) between 1 and 120),
  signature jsonb not null check (jsonb_typeof(signature) = 'array' and jsonb_array_length(signature) between 1 and 60 and octet_length(signature::text) <= 40000),
  signed_at timestamptz not null default now()
);
create index on talk_attendees(session_id);
alter table talk_sessions enable row level security;
alter table talk_attendees enable row level security;
-- Records can be read by anyone who can see the site, and added by people who can edit it. Nobody on the client side can change or delete one.
create policy sessions_read   on talk_sessions for select using (can_access_property(property_id) and site_has_extra(property_id, 'toolbox_talks'));
create policy sessions_insert on talk_sessions for insert with check (can_edit_property(property_id) and site_has_extra(property_id, 'toolbox_talks'));
create policy attendees_read   on talk_attendees for select using (exists (select 1 from talk_sessions s where s.id = session_id and can_access_property(s.property_id) and site_has_extra(s.property_id, 'toolbox_talks')));
create policy attendees_insert on talk_attendees for insert with check (exists (select 1 from talk_sessions s where s.id = session_id and can_edit_property(s.property_id) and site_has_extra(s.property_id, 'toolbox_talks')));
create trigger sessions_audit after insert on talk_sessions for each row execute function audit_row();

-- Record a talk with everyone who signed, in one go. Runs as the caller, so the row rules above apply.
create or replace function record_talk(p_property uuid, p_talk uuid, p_date date, p_presenter text, p_notes text, p_attendees jsonb)
returns uuid
language plpgsql security invoker set search_path = public as $$
declare t toolbox_talks; sid uuid; a jsonb;
begin
  if p_attendees is null or jsonb_typeof(p_attendees) <> 'array' or jsonb_array_length(p_attendees) not between 1 and 100 then raise exception 'invalid_details' using errcode = '22023'; end if;
  select * into t from toolbox_talks where id = p_talk;
  if not found then raise exception 'unknown_talk' using errcode = '22023'; end if;
  insert into talk_sessions(property_id, talk_id, talk_title, talk_category, talk_points, delivered_on, presenter, notes, created_by)
    values (p_property, t.id, t.title, t.category, t.points, coalesce(p_date, current_date), btrim(coalesce(p_presenter, '')), left(coalesce(p_notes, ''), 2000), (select id from profiles where id = auth.uid()))
    returning id into sid;
  for a in select * from jsonb_array_elements(p_attendees) loop
    insert into talk_attendees(session_id, full_name, signature) values (sid, btrim(coalesce(a ->> 'name', '')), coalesce(a -> 'signature', '[]'::jsonb));
  end loop;
  return sid;
end $$;
revoke all on function record_talk(uuid, uuid, date, text, text, jsonb) from public, anon;
grant execute on function record_talk(uuid, uuid, date, text, text, jsonb) to authenticated;
