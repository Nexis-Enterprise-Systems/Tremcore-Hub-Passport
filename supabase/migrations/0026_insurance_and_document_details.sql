-- Migration 0026: business insurance in the core checks, and certificate details on each check.
-- * Three insurance checks are added to the first-run list (Employers' Liability, Public Liability, Buildings & contents).
--   The "basis" wording is illustrative and needs professional review.
-- * Each compliance item can now hold the certificate / policy number and who issued it (the company that did the work, or the insurer).
--   These are filled in from an uploaded document (the person checks and saves them), or typed in by hand.
alter table compliance_items add column certificate_number text check (certificate_number is null or char_length(certificate_number) <= 100);
alter table compliance_items add column provider text check (provider is null or char_length(provider) <= 160);

-- The two views list the columns of compliance_items, so they are rebuilt to include the new ones.
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

insert into core_checks(code, label, grp, basis, frequency_months, sort) values
  ('ins_el',  'Employers'' Liability Insurance',            'Insurance', 'legal',         12, 11),
  ('ins_pl',  'Public Liability Insurance',                 'Insurance', 'best_practice', 12, 12),
  ('ins_bld', 'Business Insurance (buildings and contents)', 'Insurance', 'best_practice', 12, 13)
on conflict (code) do nothing;
