-- 0033: certificate reminder emails (Level 1) and the "Tremcore is managing this" notice (Levels 2 and 3).
-- The server asks for who needs an email today (reminders_pending), sends it, then records it (reminders_mark) so nobody gets the same one twice.
-- Both functions are for the server only (service key). No signed-in user can call them, and the log table has no policies at all.
--
-- When (Level 1, per item, counted from the due date on the record):
--   30 to 8 days before   -> one "due soon" reminder
--   7 to 1 days before    -> one "due in a week" reminder
--   on the due date       -> one "due today" reminder
--   overdue               -> weekly, up to 8 reminders per due date (a new due date starts the count again)
-- Levels 2 and 3: one notice per item when it comes within 30 days, saying Tremcore is managing the renewal.
-- Items with no date entered never trigger an email. Stopped or ended accounts get nothing.

create table if not exists reminder_log (
  id bigserial primary key,
  item_id uuid not null references compliance_items(id) on delete cascade,
  stage text not null check (stage in ('d30', 'd7', 'due', 'overdue', 'managed')),
  due_date date not null,
  sent_at timestamptz not null default now()
);
create index if not exists reminder_log_item on reminder_log(item_id, stage, due_date);
alter table reminder_log enable row level security;     -- no policies: only the service key can touch it
revoke all on reminder_log from public, anon, authenticated;
grant all on reminder_log to service_role;
grant usage, select on sequence reminder_log_id_seq to service_role;

create or replace function reminders_pending() returns jsonb
language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  with due as (
    select i.id as item_id, i.title, i.due_date, (i.due_date - current_date) as days_left, i.property_id, pr.name as site,
           pr.company_id, c.name as company, c.level,
           case when i.due_date < current_date then 'overdue' when i.due_date = current_date then 'due'
                when i.due_date <= current_date + 7 then 'd7' else 'd30' end as stage
    from compliance_items i
    join properties pr on pr.id = i.property_id
    join companies c on c.id = pr.company_id
    where i.due_date is not null and i.due_date <= current_date + 30
      and c.subscription in ('trial', 'active', 'past_due')
      and (c.access_ends_at is null or c.access_ends_at > now())
  ),
  trig as (
    select d.*, case when d.level > 1 then 'managed' else d.stage end as mark_stage from due d
    where case
      when d.level > 1 then d.stage in ('d30', 'd7')
           and not exists (select 1 from reminder_log l where l.item_id = d.item_id and l.stage = 'managed' and l.due_date = d.due_date)
      when d.stage in ('d30', 'd7', 'due') then
           not exists (select 1 from reminder_log l where l.item_id = d.item_id and l.stage = d.stage and l.due_date = d.due_date)
      else (select count(*) from reminder_log l where l.item_id = d.item_id and l.stage = 'overdue' and l.due_date = d.due_date) < 8
           and not exists (select 1 from reminder_log l where l.item_id = d.item_id and l.stage = 'overdue' and l.due_date = d.due_date and l.sent_at > now() - interval '7 days')
    end
  ),
  people as (   -- who may be emailed: the head-office user, and Level 1 site users who can update their site
    select pf.id, u.email, pf.full_name, pf.company_id, pf.role
    from profiles pf join auth.users u on u.id = pf.id
    where pf.active and u.email is not null and u.email_confirmed_at is not null
      and pf.role in ('client_super', 'client_site') and (pf.role = 'client_super' or pf.perm in ('update', 'full'))
  ),
  hits as (   -- one row per person per item that is due soon or overdue
    select p.id as profile_id, p.email, p.full_name, d.company_id, d.company, d.level, d.item_id, d.title, d.site, d.due_date, d.days_left,
           d.stage, (t.item_id is not null) as triggered, t.mark_stage
    from people p
    join due d on d.company_id = p.company_id
      and (p.role = 'client_super' or (d.level = 1 and exists (select 1 from profile_properties pp where pp.profile_id = p.id and pp.property_id = d.property_id)))
    left join trig t on t.item_id = d.item_id
    where d.level = 1 or p.role = 'client_super'
  )
  select coalesce(jsonb_agg(person order by person ->> 'email'), '[]'::jsonb) into result from (
    select jsonb_build_object('profile_id', profile_id, 'email', email, 'name', full_name, 'company_id', company_id, 'company', company, 'level', level,
             'items', jsonb_agg(jsonb_build_object('item_id', item_id, 'title', title, 'site', site, 'due_date', due_date, 'days_left', days_left,
                       'stage', stage, 'triggered', triggered, 'mark_stage', mark_stage) order by days_left, title)) as person
    from hits
    where level = 1 or triggered     -- Levels 2 and 3 only ever list the items being announced
    group by profile_id, email, full_name, company_id, company, level
    having bool_or(triggered)        -- nobody is emailed unless at least one item is newly due for a reminder
  ) x;
  return result;
end $$;

create or replace function reminders_mark(p_items jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  insert into reminder_log(item_id, stage, due_date)
  select (x ->> 'item_id')::uuid, x ->> 'stage', (x ->> 'due_date')::date
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x
  where exists (select 1 from compliance_items i where i.id = (x ->> 'item_id')::uuid);
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function reminders_pending() from public, anon, authenticated;
revoke all on function reminders_mark(jsonb) from public, anon, authenticated;
grant execute on function reminders_pending() to service_role;
grant execute on function reminders_mark(jsonb) to service_role;
