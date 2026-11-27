-- My Tasks become calendar-style events: time, location, link, priority, repeats (day/week/month/year, custom, end date) and email alerts.
-- Existing tasks carry over unchanged: "repeat every N months" becomes a custom monthly repeat.

alter table tasks
  add column location text not null default '' check (char_length(location) <= 200),
  add column all_day boolean not null default true,
  add column due_time time,
  add column repeat_freq text not null default 'none' check (repeat_freq in ('none','day','weekday','week','2week','month','quarter','6month','year','custom')),
  add column repeat_n smallint not null default 1 check (repeat_n between 1 and 120),
  add column repeat_unit text not null default 'week' check (repeat_unit in ('day','week','month','year')),
  add column repeat_until date,
  add column repeat_start date,
  add column priority text not null default 'routine' check (priority in ('routine','urgent')),
  add column url text not null default '' check (char_length(url) <= 300),
  add column alert_minutes int check (alert_minutes is null or alert_minutes in (0,15,30,60,120,1440,2880,10080,43200)),
  add column alert2_minutes int check (alert2_minutes is null or alert2_minutes in (0,15,30,60,120,1440,2880,10080,43200)),
  add column alert_sent_at timestamptz,
  add column alert2_sent_at timestamptz;

update tasks set repeat_freq = 'custom', repeat_unit = 'month', repeat_n = repeat_months, repeat_start = due_date where repeat_months is not null;

-- Older versions of the app still send "repeat_months": turn it into the new columns so nothing is lost.
create or replace function tasks_compat() returns trigger language plpgsql as $$
begin
  if new.repeat_months is not null then
    new.repeat_freq := 'custom'; new.repeat_unit := 'month'; new.repeat_n := new.repeat_months; new.repeat_months := null;
  end if;
  if new.repeat_freq <> 'none' and new.repeat_start is null then new.repeat_start := new.due_date; end if;
  if new.repeat_freq = 'none' then new.repeat_until := null; new.repeat_start := null; end if;
  if new.alert_minutes is null then new.alert2_minutes := null; end if;
  if tg_op = 'INSERT' or new.due_date is distinct from old.due_date or new.due_time is distinct from old.due_time or new.all_day is distinct from old.all_day
     or new.alert_minutes is distinct from old.alert_minutes then new.alert_sent_at := null; end if;
  if tg_op = 'INSERT' or new.due_date is distinct from old.due_date or new.due_time is distinct from old.due_time or new.all_day is distinct from old.all_day
     or new.alert2_minutes is distinct from old.alert2_minutes then new.alert2_sent_at := null; end if;
  return new;
end $$;
create trigger tasks_a_compat before insert or update on tasks for each row execute function tasks_compat();

-- Up to 10 repeating tasks per company, as before.
create or replace function enforce_repeat_limit() returns trigger language plpgsql security definer set search_path = public as $$
declare cid uuid; n int;
begin
  if new.repeat_freq = 'none' or new.status <> 'pending' then return new; end if;
  select company_id into cid from properties where id = new.property_id;
  select count(*) into n from tasks t join properties p on p.id = t.property_id
    where p.company_id = cid and t.status = 'pending' and t.repeat_freq <> 'none' and t.id <> new.id;
  if n >= custom_task_limit() then raise exception 'repeat_limit_reached' using errcode = '23514'; end if;
  return new;
end $$;

-- The date after p_day in a repeating series (keeps the 31st on month-ends by counting from the start date).
create or replace function next_task_date(p_day date, p_freq text, p_n int, p_unit text, p_start date) returns date
language plpgsql immutable as $$
declare ms int; base date; k int := 1; nx date; d date := p_day;
begin
  ms := case p_freq when 'month' then 1 when 'quarter' then 3 when '6month' then 6 when 'year' then 12
        when 'custom' then case p_unit when 'month' then greatest(1, p_n) when 'year' then 12 * greatest(1, p_n) else null end else null end;
  if ms is not null then
    base := coalesce(p_start, p_day);
    loop nx := (base + make_interval(months => k * ms))::date; exit when nx > p_day or k > 3000; k := k + 1; end loop;
    return nx;
  end if;
  case p_freq
    when 'day' then return p_day + 1;
    when 'weekday' then loop d := d + 1; exit when extract(isodow from d) < 6; end loop; return d;
    when 'week' then return p_day + 7;
    when '2week' then return p_day + 14;
    when 'custom' then return p_day + (case p_unit when 'day' then 1 else 7 end) * greatest(1, p_n);
    else return null;
  end case;
end $$;

-- Tick a task off. A repeating task creates its next one (never in the past, and not after its end date). Runs as the caller, so the row rules apply.
create or replace function complete_task(p_id uuid) returns uuid
language plpgsql security invoker set search_path = public as $$
declare t tasks; nxt date; newid uuid; guard int := 0;
begin
  update tasks set status = 'done', completed_at = now(), completed_by = (select id from profiles where id = auth.uid())
    where id = p_id and status = 'pending' returning * into t;
  if not found then raise exception 'task_not_found' using errcode = 'P0002'; end if;
  if t.repeat_freq <> 'none' then
    nxt := next_task_date(coalesce(t.due_date, current_date), t.repeat_freq, t.repeat_n, t.repeat_unit, t.repeat_start);
    while nxt is not null and nxt < current_date and guard < 500 loop nxt := next_task_date(nxt, t.repeat_freq, t.repeat_n, t.repeat_unit, t.repeat_start); guard := guard + 1; end loop;
    if nxt is not null and (t.repeat_until is null or nxt <= t.repeat_until) then
      insert into tasks(property_id, title, notes, due_date, location, all_day, due_time, repeat_freq, repeat_n, repeat_unit, repeat_until, repeat_start, priority, url, alert_minutes, alert2_minutes, created_by)
        values (t.property_id, t.title, t.notes, nxt, t.location, t.all_day, t.due_time, t.repeat_freq, t.repeat_n, t.repeat_unit, t.repeat_until, t.repeat_start, t.priority, t.url, t.alert_minutes, t.alert2_minutes, (select id from profiles where id = auth.uid()))
        returning id into newid;
    end if;
  end if;
  return newid;
end $$;
revoke all on function complete_task(uuid) from public, anon;
grant execute on function complete_task(uuid) to authenticated;

-- Skip this one: the series moves on to its next date. If that was the last one, the task is removed. Returns the new date (null if the series ended).
create or replace function skip_task(p_id uuid) returns date
language plpgsql security invoker set search_path = public as $$
declare t tasks; nxt date;
begin
  select * into t from tasks where id = p_id and status = 'pending' and repeat_freq <> 'none';
  if not found then raise exception 'task_not_found' using errcode = 'P0002'; end if;
  nxt := next_task_date(coalesce(t.due_date, current_date), t.repeat_freq, t.repeat_n, t.repeat_unit, t.repeat_start);
  if nxt is null or (t.repeat_until is not null and nxt > t.repeat_until) then delete from tasks where id = p_id; return null; end if;
  update tasks set due_date = nxt where id = p_id;
  return nxt;
end $$;
revoke all on function skip_task(uuid) from public, anon;
grant execute on function skip_task(uuid) to authenticated;

-- Email alerts: who needs an alert now. Times are UK time; an all-day task alerts relative to 09:00. Nothing older than a day is sent.
create or replace function task_alerts_pending() returns jsonb
language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  with a as (
    select t.id as task_id, w.which, t.title, t.due_date, t.due_time, t.all_day, t.location, t.priority, pr.name as site, pr.company_id, c.name as company, c.level,
           (((t.due_date + (case when t.all_day or t.due_time is null then time '09:00' else t.due_time end))::timestamp at time zone 'Europe/London') - make_interval(mins => w.mins)) as fire_at, w.mins
    from tasks t
    join properties pr on pr.id = t.property_id
    join companies c on c.id = pr.company_id
    cross join lateral (values (1, t.alert_minutes, t.alert_sent_at), (2, t.alert2_minutes, t.alert2_sent_at)) as w(which, mins, sent)
    where t.status = 'pending' and t.due_date is not null and w.mins is not null and w.sent is null
      and c.subscription in ('trial', 'active', 'past_due') and (c.access_ends_at is null or c.access_ends_at > now())
  ),
  due as (select * from a where fire_at <= now() and fire_at > now() - interval '1 day'),
  people as (
    select pf.id, u.email, pf.full_name, pf.company_id, pf.role
    from profiles pf join auth.users u on u.id = pf.id
    where pf.active and u.email is not null and u.email_confirmed_at is not null
      and pf.role in ('client_super', 'client_site') and (pf.role = 'client_super' or pf.perm in ('update', 'full'))
  ),
  hits as (
    select p.email, p.full_name, d.company, d.level, d.task_id, d.which, d.title, d.site, d.due_date, d.due_time, d.all_day, d.location, d.priority, d.mins
    from people p join due d on d.company_id = p.company_id
      and (p.role = 'client_super' or (d.level = 1 and exists (select 1 from profile_properties pp where pp.profile_id = p.id and pp.property_id = (select property_id from tasks where id = d.task_id))))
  )
  select coalesce(jsonb_agg(person order by person ->> 'email'), '[]'::jsonb) into result from (
    select jsonb_build_object('email', email, 'name', full_name, 'company', company,
             'items', jsonb_agg(jsonb_build_object('task_id', task_id, 'which', which, 'title', title, 'site', site, 'due_date', due_date, 'due_time', due_time, 'all_day', all_day, 'location', location, 'priority', priority, 'minutes', mins) order by due_date, title)) as person
    from hits group by email, full_name, company
  ) x;
  return result;
end $$;
revoke all on function task_alerts_pending() from public, anon, authenticated;
grant execute on function task_alerts_pending() to service_role;

create or replace function task_alerts_mark(p_items jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; r record;
begin
  for r in select (x ->> 'task_id')::uuid as id, (x ->> 'which')::int as which from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x loop
    if r.which = 1 then update tasks set alert_sent_at = now() where id = r.id and alert_sent_at is null;
    else update tasks set alert2_sent_at = now() where id = r.id and alert2_sent_at is null; end if;
    if found then n := n + 1; end if;
  end loop;
  return n;
end $$;
revoke all on function task_alerts_mark(jsonb) from public, anon, authenticated;
grant execute on function task_alerts_mark(jsonb) to service_role;
