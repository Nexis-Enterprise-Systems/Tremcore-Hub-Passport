-- Migration 0012: first-run set-up for a Self-Managed company. After signing up and paying, the head-office user completes their profile
-- and ticks which of the core compliance checks apply. Each ticked check is added to every one of their sites with NO date entered,
-- so it shows as "missing" (never green) until they add a date or certificate.
-- The legal / standard / best-practice labels and frequencies are illustrative and need professional review.

alter table companies add column setup_completed_at timestamptz;

create table core_checks (
  code text primary key,
  label text not null,
  grp text not null,
  basis basis_type not null default 'standard',
  frequency_months smallint,
  sort smallint not null
);
alter table core_checks enable row level security;
create policy core_checks_read on core_checks for select using (auth.uid() is not null);
create policy core_checks_write on core_checks for all using (mfa_ok() and is_tremcore_admin()) with check (mfa_ok() and is_tremcore_admin());

insert into core_checks(code, label, grp, basis, frequency_months, sort) values
  ('fra',        'Fire Risk Assessment',                              'Fire safety',           'legal',         12, 1),
  ('fire_alarm', 'Fire Alarm Testing & Maintenance',                  'Fire safety',           'standard',       6, 2),
  ('extinguish', 'Fire Extinguisher Maintenance',                     'Fire safety',           'standard',      12, 3),
  ('emerg_light','Emergency Light Testing',                           'Fire safety',           'standard',      12, 4),
  ('eicr',       'Electrical Installation Condition Reporting (EICR)','Electrical',            'standard',      60, 5),
  ('pat',        'PAT Testing',                                       'Electrical',            'best_practice', 12, 6),
  ('asbestos',   'Asbestos Management Survey / Register',             'Building and services', 'legal',         12, 7),
  ('legionella', 'Legionella (water) Risk Management',                'Water hygiene',         'legal',         24, 8),
  ('gas',        'Gas Safety Inspection & Maintenance',               'Building and services', 'legal',         12, 9),
  ('fgas',       'F-Gas',                                             'Building and services', 'standard',      12, 10);

-- Finish set-up: save the contact details, add the ticked checks to every site, and mark set-up done. Returns how many checks were added.
create or replace function finish_setup(p_phone text, p_address text, p_codes text[]) returns int
language plpgsql security definer set search_path = public as $$
declare
  cid uuid := my_company();
  codes text[] := coalesce(p_codes, '{}');
  ph text := nullif(btrim(coalesce(p_phone, '')), '');
  ad text := nullif(btrim(coalesce(p_address, '')), '');
  made int := 0;
begin
  if cid is null or not is_client_super() or not mfa_ok() or not company_access_ok(cid) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if char_length(coalesce(ph, '')) > 40 or char_length(coalesce(ad, '')) > 300
     or exists (select 1 from unnest(codes) c where c not in (select code from core_checks)) then
    raise exception 'invalid_details' using errcode = '22023';
  end if;
  update companies set contact_phone = ph, address = ad, setup_completed_at = coalesce(setup_completed_at, now()) where id = cid;
  with ins as (
    insert into compliance_items(property_id, grp, title, basis, frequency_months, created_by)
    select pr.id, cc.grp, cc.label, cc.basis, cc.frequency_months, auth.uid()
    from properties pr cross join core_checks cc
    where pr.company_id = cid and cc.code = any (codes)
      and not exists (select 1 from compliance_items ci where ci.property_id = pr.id and ci.title = cc.label)
    returning 1)
  select count(*) into made from ins;
  return made;
end $$;
revoke all on function finish_setup(text, text, text[]) from public, anon;
grant execute on function finish_setup(text, text, text[]) to authenticated;
