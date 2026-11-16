-- The app-style passport: My Tasks, Emergency Information, business and site details, and what extras a business owns.

-- ───────────── My Tasks ─────────────
-- Simple to-dos per site, one-off or repeating. A business may have up to 10 repeating ("customised") tasks live at a time.
create or replace function custom_task_limit() returns int language sql immutable as $$ select 10 $$;

create table tasks (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  notes text not null default '' check (char_length(notes) <= 2000),
  due_date date,
  repeat_months smallint check (repeat_months is null or repeat_months between 1 and 120),
  status text not null default 'pending' check (status in ('pending', 'done')),
  completed_at timestamptz,
  completed_by uuid references profiles(id) on delete set null,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on tasks(property_id, status);
alter table tasks enable row level security;
-- Anyone who can see the site sees its tasks; people who can edit the site's records (Level 1 update/full/head office, or Tremcore) change them.
create policy tasks_read   on tasks for select using (can_access_property(property_id));
create policy tasks_insert on tasks for insert with check (can_edit_property(property_id));
create policy tasks_update on tasks for update using (can_edit_property(property_id)) with check (can_edit_property(property_id));
create policy tasks_delete on tasks for delete using (can_edit_property(property_id));
create trigger tasks_audit after insert or update or delete on tasks for each row execute function audit_row();

create or replace function enforce_repeat_limit() returns trigger language plpgsql security definer set search_path = public as $$
declare cid uuid; n int;
begin
  if new.repeat_months is null or new.status <> 'pending' then return new; end if;
  select company_id into cid from properties where id = new.property_id;
  select count(*) into n from tasks t join properties p on p.id = t.property_id
    where p.company_id = cid and t.status = 'pending' and t.repeat_months is not null and t.id <> new.id;
  if n >= custom_task_limit() then raise exception 'repeat_limit_reached' using errcode = '23514'; end if;
  return new;
end $$;
create trigger tasks_repeat_limit before insert or update on tasks for each row execute function enforce_repeat_limit();

-- Tick a task off. A repeating task creates its next one (from its due date, never in the past). Runs as the caller, so the row rules apply.
create or replace function complete_task(p_id uuid) returns uuid
language plpgsql security invoker set search_path = public as $$
declare t tasks; base date; nxt date; newid uuid;
begin
  update tasks set status = 'done', completed_at = now(), completed_by = (select id from profiles where id = auth.uid())
    where id = p_id and status = 'pending' returning * into t;
  if not found then raise exception 'task_not_found' using errcode = 'P0002'; end if;
  if t.repeat_months is not null then
    base := coalesce(t.due_date, current_date);
    nxt := (base + make_interval(months => t.repeat_months))::date;
    if nxt < current_date then nxt := (current_date + make_interval(months => t.repeat_months))::date; end if;
    insert into tasks(property_id, title, notes, due_date, repeat_months, created_by)
      values (t.property_id, t.title, t.notes, nxt, t.repeat_months, (select id from profiles where id = auth.uid()))
      returning id into newid;
  end if;
  return newid;
end $$;
revoke all on function complete_task(uuid) from public, anon;
grant execute on function complete_task(uuid) to authenticated;

-- ───────────── Emergency Information ─────────────
create table site_emergency (
  property_id uuid primary key references properties(id) on delete cascade,
  assembly_point text not null default '' check (char_length(assembly_point) <= 300),
  gas_shutoff text not null default '' check (char_length(gas_shutoff) <= 300),
  water_shutoff text not null default '' check (char_length(water_shutoff) <= 300),
  electric_shutoff text not null default '' check (char_length(electric_shutoff) <= 300),
  notes text not null default '' check (char_length(notes) <= 2000),
  updated_at timestamptz not null default now()
);
create table emergency_contacts (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  role text not null default '' check (char_length(role) <= 120),
  phone text not null default '' check (char_length(phone) <= 40),
  created_at timestamptz not null default now()
);
create index on emergency_contacts(property_id);
alter table site_emergency enable row level security;
alter table emergency_contacts enable row level security;
create policy emerg_read   on site_emergency for select using (can_access_property(property_id));
create policy emerg_insert on site_emergency for insert with check (can_edit_property(property_id));
create policy emerg_update on site_emergency for update using (can_edit_property(property_id)) with check (can_edit_property(property_id));
create policy econ_read    on emergency_contacts for select using (can_access_property(property_id));
create policy econ_insert  on emergency_contacts for insert with check (can_edit_property(property_id));
create policy econ_update  on emergency_contacts for update using (can_edit_property(property_id)) with check (can_edit_property(property_id));
create policy econ_delete  on emergency_contacts for delete using (can_edit_property(property_id));
create trigger emerg_touch before update on site_emergency for each row execute function touch_updated_at();
create trigger emerg_audit after insert or update on site_emergency for each row execute function audit_row();
create or replace function enforce_contact_limit() returns trigger language plpgsql as $$
begin
  if (select count(*) from emergency_contacts where property_id = new.property_id) >= 10 then raise exception 'contact_limit_reached' using errcode = '23514'; end if;
  return new;
end $$;
create trigger econ_limit before insert on emergency_contacts for each row execute function enforce_contact_limit();

-- ───────────── Settings: business details and sites (head office only) ─────────────
create or replace function update_business(p_phone text, p_address text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_client_super() or not mfa_ok() or my_company() is null then raise exception 'not_allowed' using errcode = '42501'; end if;
  update companies set contact_phone = left(nullif(btrim(coalesce(p_phone, '')), ''), 40), address = left(nullif(btrim(coalesce(p_address, '')), ''), 300) where id = my_company();
end $$;
revoke all on function update_business(text, text) from public, anon;
grant execute on function update_business(text, text) to authenticated;

create or replace function update_site(p_id uuid, p_name text, p_address text) returns void
language plpgsql security definer set search_path = public as $$
declare nm text := btrim(coalesce(p_name, ''));
begin
  if not is_client_super() or not mfa_ok() or my_company() is null then raise exception 'not_allowed' using errcode = '42501'; end if;
  if nm = '' or char_length(nm) > 120 then raise exception 'invalid_details' using errcode = '22023'; end if;
  update properties set name = nm, address = left(nullif(btrim(coalesce(p_address, '')), ''), 300) where id = p_id and company_id = my_company();
  if not found then raise exception 'not_allowed' using errcode = '42501'; end if;
end $$;
revoke all on function update_site(uuid, text, text) from public, anon;
grant execute on function update_site(uuid, text, text) to authenticated;

-- ───────────── Extras: what exists and what this business owns ─────────────
create or replace function my_extras()
returns table (code text, name text, description text, price_pence int, charged_per text, owned boolean)
language sql stable security definer set search_path = public as $$
  select e.code, e.name, e.description, e.price_pence, e.charged_per, coalesce(my_company() is not null and has_extra(my_company(), e.code), false)
  from extras e where e.active order by e.code
$$;
revoke all on function my_extras() from public, anon;
grant execute on function my_extras() to authenticated;
