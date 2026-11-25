-- Migration 0036: Core / Other compliance (as in the 24 Nov prototype).
-- Each check is either Core (it counts towards the score on the home screen) or Other (tracked, but not counted).
-- Every existing check starts as Core, so nobody's score changes until they move something. Who may change it is
-- unchanged: anyone who may edit the site's checks (Self-Managed clients, Tremcore staff); Levels 2 and 3 clients stay view-only.
alter table compliance_items add column is_core boolean not null default true;

-- The two views list the columns of compliance_items, so they are rebuilt to include the new one.
drop view property_summary;
drop view compliance_status;
create view compliance_status with (security_invoker = on) as
select i.*,
  case
    when i.due_date is null then 'missing'
    when i.due_date < current_date then 'red'
    when i.due_date <= current_date + 30 then 'amber'
    else 'green'
  end as status,
  (i.due_date - current_date) as days_left
from compliance_items i;
create view property_summary with (security_invoker = on) as
select p.id as property_id, p.company_id, p.name,
  count(s.*) filter (where s.status = 'green')   as green,
  count(s.*) filter (where s.status = 'amber')   as amber,
  count(s.*) filter (where s.status = 'red')     as red,
  count(s.*) filter (where s.status = 'missing') as missing,
  count(s.*)                                     as total,
  case when count(s.*) = 0 then null
       else round(100.0 * count(s.*) filter (where s.status in ('green','amber')) / count(s.*)) end as pct_in_date
from properties p left join compliance_status s on s.property_id = p.id
group by p.id;
grant select on compliance_status, property_summary to authenticated;
