-- Permission tests. Run after 00_stubs.sql + migration + seed, as a superuser. Every row must print ok = t.
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on

-- Fixtures (superuser) -------------------------------------------------------
insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-0000000000a1','staff@t'),
 ('00000000-0000-0000-0000-0000000000a2','superA@t'),
 ('00000000-0000-0000-0000-0000000000a3','siteA_update@t'),
 ('00000000-0000-0000-0000-0000000000a4','siteA_view@t'),
 ('00000000-0000-0000-0000-0000000000b1','superB@t'),
 ('00000000-0000-0000-0000-0000000000c1','superC@t'),
 ('00000000-0000-0000-0000-0000000000a5','siteA_full@t');
insert into companies(id,name,level,require_mfa,extra_seats) values
 ('10000000-0000-0000-0000-00000000000a','Company A (L1)',1,false,5),
 ('10000000-0000-0000-0000-00000000000b','Company B (L2)',2,false,0),
 ('10000000-0000-0000-0000-00000000000c','Company C (L3)',3,false,0);
insert into properties(id,company_id,name) values
 ('20000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-00000000000a','A site 1'),
 ('20000000-0000-0000-0000-0000000000a2','10000000-0000-0000-0000-00000000000a','A site 2'),
 ('20000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-00000000000b','B site 1'),
 ('20000000-0000-0000-0000-0000000000c1','10000000-0000-0000-0000-00000000000c','C site 1');
insert into profiles(id,full_name,role,company_id,perm) values
 ('00000000-0000-0000-0000-0000000000a1','Staff','tremcore_admin',null,'full'),
 ('00000000-0000-0000-0000-0000000000a2','Super A','client_super','10000000-0000-0000-0000-00000000000a','full'),
 ('00000000-0000-0000-0000-0000000000a3','Site A update','client_site','10000000-0000-0000-0000-00000000000a','update'),
 ('00000000-0000-0000-0000-0000000000a4','Site A view','client_site','10000000-0000-0000-0000-00000000000a','view'),
 ('00000000-0000-0000-0000-0000000000a5','Site A full','client_site','10000000-0000-0000-0000-00000000000a','full'),
 ('00000000-0000-0000-0000-0000000000b1','Super B','client_super','10000000-0000-0000-0000-00000000000b','full'),
 ('00000000-0000-0000-0000-0000000000c1','Super C','client_super','10000000-0000-0000-0000-00000000000c','full');
insert into profile_properties values
 ('00000000-0000-0000-0000-0000000000a3','20000000-0000-0000-0000-0000000000a1'),
 ('00000000-0000-0000-0000-0000000000a4','20000000-0000-0000-0000-0000000000a1'),
 ('00000000-0000-0000-0000-0000000000a5','20000000-0000-0000-0000-0000000000a1');
insert into compliance_items(id,property_id,title,due_date) values
 ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-0000000000a1','Missing date',null),
 ('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-0000000000a1','Overdue',current_date-3),
 ('30000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-0000000000a1','Amber',current_date+10),
 ('30000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-0000000000a1','Green',current_date+45),
 ('30000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-0000000000a2','A2 item',current_date+90),
 ('30000000-0000-0000-0000-000000000006','20000000-0000-0000-0000-0000000000b1','B item',current_date+90);
insert into jobs(id,property_id,issue_type,location,description) values
 ('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-0000000000c1','Leak','Kitchen','Drip');
insert into job_internal(job_id,notes) values ('40000000-0000-0000-0000-000000000001','secret');

-- Helper: run a check as a given user. Usage: select * from chk('label', uid, aal, 'sql returning boolean');
create function chk(label text, uid uuid, aal text, q text) returns table(test text, ok boolean)
language plpgsql as $$
declare r boolean;
begin
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claims', json_build_object('aal', aal)::text, true);
  set local role authenticated;
  execute q into r;
  reset role;
  return query select label, coalesce(r,false);
end $$;
grant execute on function chk to public;

-- expect-failure helper: statement must raise an RLS/privilege error.
create function deny(label text, uid uuid, aal text, stmt text) returns table(test text, ok boolean)
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claims', json_build_object('aal', aal)::text, true);
  set local role authenticated;
  begin
    execute stmt;
    reset role;
    return query select label, false;   -- statement unexpectedly succeeded
  exception when others then
    reset role;
    return query select label, true;
  end;
end $$;

-- Tests -----------------------------------------------------------------------
\set staff   '00000000-0000-0000-0000-0000000000a1'
\set superA  '00000000-0000-0000-0000-0000000000a2'
\set siteAu  '00000000-0000-0000-0000-0000000000a3'
\set siteAv  '00000000-0000-0000-0000-0000000000a4'
\set siteAf  '00000000-0000-0000-0000-0000000000a5'
\set superB  '00000000-0000-0000-0000-0000000000b1'
\set superC  '00000000-0000-0000-0000-0000000000c1'

begin;
-- Visibility / 2FA
select * from chk('staff with 2FA sees all 4 properties', :'staff', 'aal2', 'select count(*)=4 from properties');
select * from chk('staff WITHOUT 2FA sees nothing', :'staff', 'aal1', 'select count(*)=0 from properties');
select * from chk('client super WITHOUT 2FA sees nothing', :'superA', 'aal1', 'select count(*)=0 from properties');
select * from chk('client super with 2FA sees only own 2 sites', :'superA', 'aal2', 'select count(*)=2 from properties');
select * from chk('site user sees only assigned site (no 2FA needed by default)', :'siteAu', 'aal1', 'select count(*)=1 from properties');
select * from chk('super A cannot see company B items', :'superA', 'aal2', $$select count(*)=0 from compliance_items where property_id='20000000-0000-0000-0000-0000000000b1'$$);
select * from chk('site user cannot see other site (A2) items', :'siteAu', 'aal1', $$select count(*)=0 from compliance_items where property_id='20000000-0000-0000-0000-0000000000a2'$$);
select * from chk('site user cannot read other users profiles', :'siteAu', 'aal1', 'select count(*)=1 from profiles');
select * from chk('super A can read own company users', :'superA', 'aal2', 'select count(*)=4 from profiles');

-- Level 1 editing
select * from chk('L1 update-perm site user can edit an item', :'siteAu', 'aal1',
  $$with u as (update compliance_items set notes='x' where id='30000000-0000-0000-0000-000000000002' returning 1) select count(*)=1 from u$$);
select * from chk('L1 view-perm site user cannot edit', :'siteAv', 'aal1',
  $$with u as (update compliance_items set notes='y' where id='30000000-0000-0000-0000-000000000002' returning 1) select count(*)=0 from u$$);
select * from deny('L1 update-perm user cannot add a category', :'siteAu', 'aal1',
  $$insert into compliance_items(property_id,title) values ('20000000-0000-0000-0000-0000000000a1','New')$$);
select * from chk('L1 update-perm user cannot delete', :'siteAu', 'aal1',
  $$with d as (delete from compliance_items where id='30000000-0000-0000-0000-000000000004' returning 1) select count(*)=0 from d$$);
select * from chk('L1 full-perm user can add a category', :'siteAf', 'aal1',
  $$with i as (insert into compliance_items(property_id,title) values ('20000000-0000-0000-0000-0000000000a1','Custom title') returning 1) select count(*)=1 from i$$);
select * from chk('L1 super user can add category at any own site', :'superA', 'aal2',
  $$with i as (insert into compliance_items(property_id,title) values ('20000000-0000-0000-0000-0000000000a2','Custom2') returning 1) select count(*)=1 from i$$);

-- Levels 2 and 3 are view-only for clients, enforced by the database
select * from chk('L2 client cannot edit items', :'superB', 'aal2',
  $$with u as (update compliance_items set notes='z' where id='30000000-0000-0000-0000-000000000006' returning 1) select count(*)=0 from u$$);
select * from deny('L2 client cannot add items', :'superB', 'aal2',
  $$insert into compliance_items(property_id,title) values ('20000000-0000-0000-0000-0000000000b1','Nope')$$);
select * from deny('L2 client cannot raise a job', :'superB', 'aal2',
  $$insert into jobs(property_id,reported_by,issue_type,location,description) values ('20000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000b1','x','y','z')$$);
select * from deny('L1 client cannot raise a job', :'superA', 'aal2',
  $$insert into jobs(property_id,reported_by,issue_type,location,description) values ('20000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a2','x','y','z')$$);
select * from chk('L3 client can raise a job', :'superC', 'aal2',
  $$with i as (insert into jobs(property_id,reported_by,issue_type,location,description) values ('20000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000c1','Leak','Hall','Wet') returning 1) select count(*)=1 from i$$);
select * from chk('L3 client cannot change job status', :'superC', 'aal2',
  $$with u as (update jobs set status='closed_cancelled' returning 1) select count(*)=0 from u$$);
select * from chk('client cannot read Tremcore internal job notes', :'superC', 'aal2', 'select count(*)=0 from job_internal');
select * from chk('staff can read internal job notes', :'staff', 'aal2', 'select count(*)=1 from job_internal');
select * from chk('Tremcore edits L2 client items', :'staff', 'aal2',
  $$with u as (update compliance_items set notes='by tremcore' where id='30000000-0000-0000-0000-000000000006' returning 1) select count(*)=1 from u$$);
select * from chk('client cannot change their own subscription level (0 rows updated)', :'superA', 'aal2',
  $$with u as (update companies set level=3 where id='10000000-0000-0000-0000-00000000000a' returning 1) select count(*)=0 from u$$);
select * from chk('client company level unchanged after attempt', :'superA', 'aal2', $$select level=1 from companies where id='10000000-0000-0000-0000-00000000000a'$$);
select * from chk('client cannot promote own profile', :'siteAu', 'aal1',
  $$with u as (update profiles set perm='full' where id='00000000-0000-0000-0000-0000000000a3' returning 1) select count(*)=0 from u$$);

select * from chk('changes are written to the audit log', :'staff', 'aal2', $$select count(*)>=1 from audit_log where table_name='compliance_items'$$);
rollback;  -- discard edits made above so the traffic-light fixtures are clean
begin;
-- Sign-in helper (works before 2FA is passed, returns only the caller's own row)
select * from chk('auth_requirements: staff must use 2FA', :'staff', 'aal1', $$select count(*)=1 and bool_and(mfa_required) and bool_and(role_name='tremcore_admin') from auth_requirements()$$);
select * from chk('auth_requirements: client super must use 2FA', :'superA', 'aal1', $$select bool_and(mfa_required) from auth_requirements()$$);
select * from chk('auth_requirements: site user 2FA optional by default', :'siteAu', 'aal1', $$select count(*)=1 and not bool_or(mfa_required) and bool_and(level=1) from auth_requirements()$$);
select * from chk('auth_requirements returns nothing for an anonymous caller', '00000000-0000-0000-0000-0000000000ff', 'aal1', $$select count(*)=0 from auth_requirements()$$);
-- Traffic light + summary
select * from chk('status: missing date is never green', :'staff', 'aal2', $$select status='missing' from compliance_status where id='30000000-0000-0000-0000-000000000001'$$);
select * from chk('status: past due is red', :'staff', 'aal2', $$select status='red' from compliance_status where id='30000000-0000-0000-0000-000000000002'$$);
select * from chk('status: due in 10 days is amber', :'staff', 'aal2', $$select status='amber' from compliance_status where id='30000000-0000-0000-0000-000000000003'$$);
select * from chk('status: due in 45 days is green', :'staff', 'aal2', $$select status='green' from compliance_status where id='30000000-0000-0000-0000-000000000004'$$);
select * from chk('summary counts every item incl. missing in the total', :'staff', 'aal2',
  $$select green=1 and amber=1 and red=1 and missing=1 and total>=4 from property_summary where property_id='20000000-0000-0000-0000-0000000000a1'$$);

commit;

-- Website enquiries: the public can add, never read; staff can manage with 2FA
begin;
set local role anon;
insert into enquiries(name,email) values ('Visitor','v@example.com');
do $$ begin
  begin perform count(*) from enquiries; raise exception 'anon could read enquiries';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'anon cannot read enquiries back' as test, true as ok;
select 'anon can submit an enquiry' as test, count(*)=1 as ok from enquiries;
select * from chk('enquiries: staff with 2FA can read', :'staff', 'aal2', 'select count(*)>=1 from enquiries');
select * from chk('enquiries: staff without 2FA cannot read', :'staff', 'aal1', 'select count(*)=0 from enquiries');
select * from chk('enquiries: client cannot read', :'superA', 'aal2', 'select count(*)=0 from enquiries');
select * from chk('enquiries: client cannot change', :'superA', 'aal2', $$with u as (update enquiries set status='won' returning 1) select count(*)=0 from u$$);
select * from chk('enquiries: staff can update status', :'staff', 'aal2', $$with u as (update enquiries set status='contacted' returning 1) select count(*)>=1 from u$$);
do $$ begin
  set local role anon;
  begin insert into enquiries(name,email) values ('X','not-an-email'); raise exception 'bad email was accepted';
  exception when check_violation then null; end;
  begin insert into enquiries(name,email,status) values ('X','x@example.com','won'); raise exception 'visitor set status';
  exception when insufficient_privilege or check_violation or others then if sqlerrm like '%accepted%' or sqlerrm like '%visitor set%' then raise; end if; end;
  reset role;
end $$;
select 'enquiries: database rejects a bad email and a visitor-set status' as test, true as ok;
rollback;

-- Self-Managed sign-up (migration 0004) --------------------------------------
begin;
insert into auth.users(id,email,email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000000d1','new1@acme.test', now()),
 ('00000000-0000-0000-0000-0000000000d2','unconfirmed@t', null),
 ('00000000-0000-0000-0000-0000000000d3','new3@t', now()),
 ('00000000-0000-0000-0000-0000000000d4','new4@annual.test', now());
select 'sign-up is closed by default' as test, signup_open() = false as ok;
do $$ begin
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1', true);
  perform set_config('request.jwt.claims','{"aal":"aal1"}', true);
  set local role authenticated;
  begin perform signup_company('Acme','Pat',1); raise exception 'sign-up worked while closed';
  exception when insufficient_privilege then null; end;
  reset role;
end $$;
select 'signup: refused while switched off' as test, true as ok;
do $$ begin
  set local role anon;
  begin perform count(*) from app_settings; raise exception 'anon read settings'; exception when insufficient_privilege then null; end;
  begin perform signup_company('X','Y',1); raise exception 'anon signed up'; exception when insufficient_privilege then null; end;
  reset role;
end $$;
select 'signup: anonymous visitors cannot read settings or call sign-up' as test, true as ok;
select * from chk('settings: client cannot read', :'superA', 'aal2', 'select count(*)=0 from app_settings');
select * from chk('settings: client cannot switch sign-up on', :'superA', 'aal2', $$with u as (update app_settings set value='true'::jsonb where key='self_signup_open' returning 1) select count(*)=0 from u$$);
select * from chk('settings: staff without 2FA cannot switch sign-up on', :'staff', 'aal1', $$with u as (update app_settings set value='true'::jsonb where key='self_signup_open' returning 1) select count(*)=0 from u$$);
select * from chk('settings: administrator with 2FA can switch sign-up on', :'staff', 'aal2', $$with u as (update app_settings set value='true'::jsonb where key='self_signup_open' returning 1) select count(*)=1 from u$$);
select 'signup: now open to everyone' as test, signup_open() as ok;

-- open: happy path
do $$ begin
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1', true);
  perform set_config('request.jwt.claims','{"aal":"aal1"}', true);
  set local role authenticated;
  perform signup_company('  acme cafes Ltd ','pat jones',1);
  reset role;
end $$;
select 'signup: creates a Level 1 trial company with no charge, no matter what is asked' as test,
  exists (select 1 from companies where name='Acme Cafes Ltd' and level=1 and subscription='trial' and monthly_value_pence=0 and source='self_signup' and contact_email='new1@acme.test') as ok;
select 'signup: person becomes the head-office user with full rights' as test,
  exists (select 1 from profiles p join companies c on c.id=p.company_id where p.id='00000000-0000-0000-0000-0000000000d1' and p.role='client_super' and p.perm='full' and c.name='Acme Cafes Ltd') as ok;
select 'signup: names are tidied so every word starts with a capital' as test,
  exists (select 1 from profiles where id='00000000-0000-0000-0000-0000000000d1' and full_name='Pat Jones') as ok;
select 'signup: the chosen number of sites is created unnamed (Site 1), to be named later' as test,
  exists (select 1 from properties pr join companies c on c.id=pr.company_id where c.name='Acme Cafes Ltd' and pr.name='Site 1' and pr.address is null) as ok;
update companies set subscription='active' where name='Acme Cafes Ltd';   -- payment confirmed (Stripe, later)
select * from chk('signup: new customer sees their own company and site after 2FA', '00000000-0000-0000-0000-0000000000d1', 'aal2', $$select (select count(*) from companies)=1 and (select count(*) from properties)=1$$);
select * from chk('signup: new customer cannot see anyone else', '00000000-0000-0000-0000-0000000000d1', 'aal2', $$select count(*)=0 from properties where company_id<>my_company()$$);
select * from chk('signup: new customer is held to 2FA like any head-office user', '00000000-0000-0000-0000-0000000000d1', 'aal1', $$select count(*)=0 from properties$$);
select * from chk('signup: new customer can edit their own Level 1 records', '00000000-0000-0000-0000-0000000000d1', 'aal2', $$select can_edit_property((select id from properties limit 1))$$);
select 'signup: billing defaults to monthly when none is chosen' as test,
  exists (select 1 from companies where name='Acme Cafes Ltd' and billing_interval='monthly') as ok;
select * from chk('signup: new customer cannot change their own billing choice', '00000000-0000-0000-0000-0000000000d1', 'aal2', $$with u as (update companies set billing_interval='annual' returning 1) select count(*)=0 from u$$);
select * from chk('signup: new customer still cannot change their own package or price', '00000000-0000-0000-0000-0000000000d1', 'aal2', $$with u as (update companies set level=3, monthly_value_pence=1 returning 1) select count(*)=0 from u$$);

-- refusals
do $$
declare r text;
begin
  perform set_config('request.jwt.claims','{"aal":"aal1"}', true);
  -- again, same person
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1', true);
  set local role authenticated;
  begin perform signup_company('Second','Pat',1); raise exception 'second sign-up worked'; exception when unique_violation then null; end;
  -- email not confirmed
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d2', true);
  begin perform signup_company('Ghost Ltd','Ghost',1); raise exception 'unconfirmed email worked'; exception when insufficient_privilege then null; end;
  -- bad details
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d3', true);
  begin perform signup_company('','Pat',1); raise exception 'empty company worked'; exception when invalid_parameter_value then null; end;
  begin perform signup_company('Co','',1); raise exception 'empty name worked'; exception when invalid_parameter_value then null; end;
  begin perform signup_company('Co','Pat',0); raise exception 'empty site worked'; exception when invalid_parameter_value then null; end;
  begin perform signup_company(repeat('x',161),'Pat',1); raise exception 'long company worked'; exception when invalid_parameter_value then null; end;
  begin perform signup_company('Co','Pat',1,'weekly'); raise exception 'odd billing choice worked'; exception when invalid_parameter_value then null; end;
  reset role;
end $$;
select 'signup: refuses a second company, an unconfirmed email and empty or oversized details' as test, true as ok;
select 'signup: nothing half-created after refusals' as test,
  (select count(*) from companies where source='self_signup') = 1 and not exists (select 1 from profiles where id in ('00000000-0000-0000-0000-0000000000d2','00000000-0000-0000-0000-0000000000d3')) as ok;

-- annual choice is recorded, and still carries no price or package of its own
do $$ begin
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d4', true);
  perform set_config('request.jwt.claims','{"aal":"aal1"}', true);
  set local role authenticated;
  perform signup_company('Annual Co','Sam',1,'annual');
  reset role;
end $$;
select 'signup: annual billing choice is recorded, still a Level 1 trial with no charge' as test,
  exists (select 1 from companies where name='Annual Co' and billing_interval='annual' and level=1 and subscription='trial' and monthly_value_pence=0) as ok;
rollback;

-- Managed Service area (migration 0006) -------------------------------------------
begin;
select 'managed area: starts at Medway, 30 miles' as test,
  exists (select 1 from managed_area() where label='Medway (ME)' and radius_miles=30) as ok;
do $$ declare n int; begin
  set local role anon;
  select count(*) into n from managed_area();
  if n <> 1 then raise exception 'anon cannot read the managed area'; end if;
  begin perform count(*) from app_settings; raise exception 'anon read settings'; exception when insufficient_privilege then null; end;
  reset role;
end $$;
select 'managed area: visitors can read the area but not the settings table' as test, true as ok;
select * from chk('managed area: a client cannot move the area', :'superA', 'aal2', $$with u as (update app_settings set value='500'::jsonb where key='managed_radius_miles' returning 1) select count(*)=0 from u$$);
select * from chk('managed area: an administrator with 2FA can change the distance', :'staff', 'aal2', $$with u as (update app_settings set value='20'::jsonb where key='managed_radius_miles' returning 1) select count(*)=1 from u$$);
select 'managed area: the change is seen by the public function' as test, exists (select 1 from managed_area() where radius_miles=20) as ok;
do $$ begin
  set local role anon;
  insert into enquiries(name,email,package_interest) values ('Sam','sam@example.com','managed_service');
  begin insert into enquiries(name,email,package_interest) values ('Sam','sam@example.com','free_stuff'); raise exception 'odd package accepted'; exception when check_violation then null; end;
  reset role;
end $$;
select 'managed area: enquiries may ask about Managed Service and nothing unknown' as test, true as ok;
rollback;

-- Trial, repeat-trial block, payment failure, cancellation (migration 0007) -------------
begin;
update app_settings set value='true'::jsonb where key='self_signup_open';
insert into auth.users(id,email,email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000000e1','owner@bigco.co.uk', now()),
 ('00000000-0000-0000-0000-0000000000e2','other.person@BigCo.co.uk', now()),
 ('00000000-0000-0000-0000-0000000000e3','Jo.Smith+one@gmail.com', now()),
 ('00000000-0000-0000-0000-0000000000e4','josmith@gmail.com', now()),
 ('00000000-0000-0000-0000-0000000000e5','someone.else@gmail.com', now());
do $$ begin
  perform set_config('request.jwt.claims','{"aal":"aal1"}', true);
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000e1', true);
  perform signup_company('BigCo','Owner',1);
  reset role;
end $$;
select 'sign-up: there is no free trial; a new company starts unpaid with nothing open' as test,
  (select subscription='trial' and trial_ends_at <= now() from companies where name='BigCo') as ok;
select * from chk('sign-up: before payment the new customer sees nothing and is told payment is awaited', '00000000-0000-0000-0000-0000000000e1', 'aal2',
  $$select (select count(*)=0 from properties) and (select count(*)=0 from companies) and (select state='awaiting_payment' and is_head from my_access())$$);
select * from chk('sign-up: an unpaid company cannot edit anything', '00000000-0000-0000-0000-0000000000e1', 'aal2',
  $$select not can_edit_property((select id from properties where company_id=(select id from companies where name='BigCo') limit 1))$$);
do $$ begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000e2', true);
  perform signup_company('BigCo Second Site','Other',1);
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000e3', true);
  perform signup_company('Jo Trading','Jo',1);
  reset role;
end $$;
do $$ begin
  insert into auth.users(id,email,email_confirmed_at) values ('00000000-0000-0000-0000-0000000000ea','multi@multi.test', now()),('00000000-0000-0000-0000-0000000000eb','bad@multi.test', now());
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000ea', true);
  set local role authenticated;
  perform signup_company('multi co','Mia',3);
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000eb', true);
  begin perform signup_company('Bad','Bo',0); raise exception 'zero sites'; exception when invalid_parameter_value then null; end;
  begin perform signup_company('Bad','Bo',101); raise exception 'too many sites'; exception when invalid_parameter_value then null; end;
  reset role;
end $$;
select 'sign-up: the number of sites chosen is created (3 unnamed sites); 0 or 101 is refused' as test,
  (select count(*)=3 and string_agg(name, ',' order by name)='Site 1,Site 2,Site 3' from properties where company_id=(select id from companies where name='Multi Co')) as ok;
select 'sign-up: two people at the same company domain, or two Gmail users, can each sign up (nothing is free to abuse)' as test, true as ok;
update companies set subscription='active' where name='BigCo';
select 'billing: confirming payment opens the account and clears the unpaid marker' as test, (select trial_ends_at is null and payment_failed_at is null from companies where name='BigCo') as ok;
select * from chk('billing: a paid company is open', '00000000-0000-0000-0000-0000000000e1', 'aal2', $$select (select count(*)=1 from properties) and (select state='ok' from my_access())$$);

-- payment failure: warning first, then a full stop after 7 days
update companies set subscription='past_due' where name='BigCo';
select 'billing: a failed payment records the date' as test, (select payment_failed_at is not null from companies where name='BigCo') as ok;
select * from chk('billing: during the 7 days the head-office user is warned and still has access', '00000000-0000-0000-0000-0000000000e1', 'aal2',
  $$select (select count(*)=1 from properties) and (select state='payment_failed' and is_head and days_left between 6 and 7 from my_access())$$);
update companies set payment_failed_at = now() - interval '8 days' where name='BigCo';
select * from chk('billing: 7 days after a failed payment the account is stopped, nothing visible', '00000000-0000-0000-0000-0000000000e1', 'aal2',
  $$select (select count(*)=0 from properties) and (select count(*)=0 from compliance_items) and (select state='stopped' from my_access())$$);
update companies set subscription='active' where name='BigCo';
select * from chk('billing: paying up reopens it straight away', '00000000-0000-0000-0000-0000000000e1', 'aal2', $$select (select count(*)=1 from properties)$$);

-- Tremcore staff are never locked out, and other companies are untouched
update companies set subscription='past_due', payment_failed_at = now() - interval '30 days' where name='BigCo';
select * from chk('stop: Tremcore staff can still see a stopped company', :'staff', 'aal2', $$select count(*)=1 from properties where company_id=(select id from companies where name='BigCo')$$);
select * from chk('stop: another company is not affected', :'superA', 'aal2', $$select count(*)=2 from properties$$);
update companies set subscription='active' where name='BigCo';

-- cancellation notice
do $$ begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
  perform set_config('request.jwt.claims','{"aal":"aal1"}', true);
  set local role authenticated;
  begin perform request_cancellation(); raise exception 'site user cancelled'; exception when insufficient_privilege then null; end;
  reset role;
end $$;
select 'cancel: a site user cannot give notice (checked by calling the function)' as test, true as ok;
do $$ begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', true);
  perform set_config('request.jwt.claims','{"aal":"aal1"}', true);
  set local role authenticated;
  begin perform request_cancellation(); raise exception 'cancelled without 2FA'; exception when insufficient_privilege then null; end;
  reset role;
end $$;
select 'cancel: giving notice needs 2FA' as test, true as ok;
select * from chk('cancel: head office gives notice and gets one month', '00000000-0000-0000-0000-0000000000e1', 'aal2',
  $$select request_cancellation() between now() + interval '27 days' and now() + interval '32 days'$$);
select * from chk('cancel: during the notice they keep access and are told when it ends', '00000000-0000-0000-0000-0000000000e1', 'aal2',
  $$select (select count(*)=1 from properties) and (select state='cancelling' and is_head from my_access())$$);
select 'cancel: data removal is scheduled shortly after the notice ends' as test,
  (select delete_after > access_ends_at and delete_after <= access_ends_at + interval '15 days' from companies where name='BigCo') as ok;
select * from chk('cancel: asking twice does not extend the notice', '00000000-0000-0000-0000-0000000000e1', 'aal2',
  $$select (select request_cancellation() < now() + interval '32 days')$$);
select * from chk('cancel: notice can be withdrawn before it ends', '00000000-0000-0000-0000-0000000000e1', 'aal2',
  $$select (select (withdraw_cancellation() is null) is not null)$$);
select * from chk('cancel: after withdrawing, the account is back to normal', '00000000-0000-0000-0000-0000000000e1', 'aal2',
  $$select (select state='ok' from my_access())$$);
-- after the notice ends the account is stopped, nothing visible
select * from chk('cancel: give notice again', '00000000-0000-0000-0000-0000000000e1', 'aal2', $$select (select request_cancellation() is not null)$$);
update companies set access_ends_at = now() - interval '1 minute' where name='BigCo';
select * from chk('cancel: when the notice ends the account sees nothing at all', '00000000-0000-0000-0000-0000000000e1', 'aal2',
  $$select (select count(*)=0 from properties) and (select count(*)=0 from companies) and (select state='stopped' from my_access())$$);
do $$ begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', true);
  perform set_config('request.jwt.claims','{"aal":"aal2"}', true);
  set local role authenticated;
  begin perform withdraw_cancellation(); raise exception 'stopped account withdrew notice'; exception when insufficient_privilege then null; end;
  reset role;
end $$;
select 'cancel: a stopped account cannot withdraw the notice' as test, true as ok;
-- annual, paid up front: notice runs to the later of one month or the end of the paid year
update companies set access_ends_at=null, cancel_requested_at=null, delete_after=null, billing_interval='annual', paid_until = now() + interval '200 days' where name='BigCo';
select * from chk('cancel: annual customer keeps access to the end of the paid year', '00000000-0000-0000-0000-0000000000e1', 'aal2',
  $$select (select request_cancellation() > now() + interval '199 days')$$);
-- clients cannot set these dates themselves
select * from chk('billing: a client cannot edit trial or payment dates', '00000000-0000-0000-0000-0000000000e1', 'aal2',
  $$with u as (update companies set trial_ends_at = now() + interval '5 years', access_ends_at=null returning 1) select count(*)=0 from u$$);
rollback;

-- Included users and paid extras (migration 0008) -----------------------------------
begin;
insert into companies(id,name,level,require_mfa) values ('10000000-0000-0000-0000-0000000000f1','Seats Co',1,false);
insert into properties(id,company_id,name) values ('20000000-0000-0000-0000-0000000000f1','10000000-0000-0000-0000-0000000000f1','Seats site 1');
insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-0000000000f1','s1@seats.test'),('00000000-0000-0000-0000-0000000000f2','s2@seats.test'),
 ('00000000-0000-0000-0000-0000000000f3','s3@seats.test'),('00000000-0000-0000-0000-0000000000f4','s4@seats.test');
insert into profiles(id,full_name,role,company_id,perm) values
 ('00000000-0000-0000-0000-0000000000f1','Admin','client_super','10000000-0000-0000-0000-0000000000f1','full'),
 ('00000000-0000-0000-0000-0000000000f2','Manager','client_site','10000000-0000-0000-0000-0000000000f1','full');
select 'seats: the price includes one site, a super admin and a manager' as test, true as ok;
do $$ begin
  begin insert into profiles(id,full_name,role,company_id,perm) values ('00000000-0000-0000-0000-0000000000f3','Third','client_site','10000000-0000-0000-0000-0000000000f1','view'); raise exception 'third user allowed on one site'; exception when insufficient_privilege then null; end;
end $$;
select 'seats: a third sign-in user is refused on a one-site company' as test, true as ok;
insert into properties(company_id,name) values ('10000000-0000-0000-0000-0000000000f1','Seats site 2');
insert into profiles(id,full_name,role,company_id,perm) values ('00000000-0000-0000-0000-0000000000f3','Third','client_site','10000000-0000-0000-0000-0000000000f1','view');
select 'seats: each extra site adds one more user' as test, true as ok;
do $$ begin
  begin insert into profiles(id,full_name,role,company_id,perm) values ('00000000-0000-0000-0000-0000000000f4','Fourth','client_site','10000000-0000-0000-0000-0000000000f1','view'); raise exception 'fourth allowed'; exception when insufficient_privilege then null; end;
end $$;
update companies set extra_seats=1 where id='10000000-0000-0000-0000-0000000000f1';
insert into profiles(id,full_name,role,company_id,perm) values ('00000000-0000-0000-0000-0000000000f4','Fourth','client_site','10000000-0000-0000-0000-0000000000f1','view');
select 'seats: a goodwill seat granted by Tremcore allows one more' as test, true as ok;
select 'extras: Toolbox Talks is 3.99 per site; Staff Sign In/Out is 6.99 per site' as test,
  (select price_pence=399 and charged_per='site' from extras where code='toolbox_talks') and (select price_pence=699 and charged_per='site' from extras where code='staff_signin') as ok;
insert into company_extras(company_id,extra_code,price_pence) values ('10000000-0000-0000-0000-00000000000a','toolbox_talks',399);
select * from chk('extras: a client sees its own extras', :'superA', 'aal2', $$select count(*)=1 from company_extras$$);
select * from chk('extras: another company sees none of them', :'superB', 'aal2', $$select count(*)=0 from company_extras$$);
select * from deny('extras: a client cannot switch an extra on for itself', :'superA', 'aal2', $$insert into company_extras(company_id,extra_code,price_pence) values ('10000000-0000-0000-0000-00000000000a','staff_signin',0)$$);
rollback;

-- Team management (migration 0010) ---------------------------------------------------
begin;
insert into companies(id,name,level,require_mfa) values ('10000000-0000-0000-0000-0000000000e9','Team Co',1,false);
insert into properties(id,company_id,name) values
 ('20000000-0000-0000-0000-0000000000e1','10000000-0000-0000-0000-0000000000e9','Team site 1'),
 ('20000000-0000-0000-0000-0000000000e2','10000000-0000-0000-0000-0000000000e9','Team site 2');
insert into auth.users(id,email,email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000000f9','boss@team.test', now()),
 ('00000000-0000-0000-0000-0000000000fa','mgr@team.test', now());
insert into profiles(id,full_name,role,company_id,perm) values
 ('00000000-0000-0000-0000-0000000000f9','Boss','client_super','10000000-0000-0000-0000-0000000000e9','full');
\set boss '00000000-0000-0000-0000-0000000000f9'
\set mgr  '00000000-0000-0000-0000-0000000000fa'
select * from chk('team: super admin sees the team page numbers (2 sites = 3 users)', :'boss', 'aal2', $$select (select allowed=3 and used=1 from team_summary())$$);
select * from chk('team: super admin invites a manager for site 1 with update', :'boss', 'aal2',
  $$select team_invite('Mgr@Team.test','Manager','update', array['20000000-0000-0000-0000-0000000000e1']::uuid[]) is not null$$);
select * from chk('team: the invite counts towards the seats', :'boss', 'aal2', $$select (select used=2 from team_summary()) and (select count(*)=1 from team_pending())$$);
select * from chk('team: inviting the same person again just replaces the invite', :'boss', 'aal2',
  $$select team_invite('mgr@team.test','Manager','view', array['20000000-0000-0000-0000-0000000000e1']::uuid[]) is not null and (select count(*)=1 from team_pending())$$);
do $$ begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f9', true);
  perform set_config('request.jwt.claims','{"aal":"aal2"}', true);
  set local role authenticated;
  begin perform team_invite('x@team.test','X','view', array['20000000-0000-0000-0000-0000000000a1']::uuid[]); raise exception 'foreign site accepted'; exception when invalid_parameter_value then null; end;
  begin perform team_invite('bad','X','view', array['20000000-0000-0000-0000-0000000000e1']::uuid[]); raise exception 'bad email accepted'; exception when invalid_parameter_value then null; end;
  begin perform team_invite('x@team.test','X','admin', array['20000000-0000-0000-0000-0000000000e1']::uuid[]); raise exception 'odd permission accepted'; exception when invalid_parameter_value then null; end;
  perform team_invite('third@team.test','Third','view', array['20000000-0000-0000-0000-0000000000e2']::uuid[]);
  begin perform team_invite('fourth@team.test','Fourth','view', array['20000000-0000-0000-0000-0000000000e2']::uuid[]); raise exception 'over the user limit'; exception when insufficient_privilege then null; end;
  perform team_cancel_invite((select id from team_pending() where email='third@team.test'));
  reset role;
end $$;
select 'team: foreign sites, bad emails, odd permissions and going over the user limit are all refused' as test, true as ok;
-- the manager signs up and accepts
do $$ begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000fa', true);
  perform set_config('request.jwt.claims','{"aal":"aal1"}', true);
  set local role authenticated;
  if not accept_invitation('Mo Manager') then raise exception 'invite not accepted'; end if;
  if accept_invitation() then raise exception 'accepted twice'; end if;
  reset role;
end $$;
select 'team: the invited person is set up with the chosen permission and site only' as test,
  exists (select 1 from profiles p join profile_properties pp on pp.profile_id=p.id where p.id=:'mgr' and p.role='client_site' and p.perm='view' and pp.property_id='20000000-0000-0000-0000-0000000000e1' and p.company_id='10000000-0000-0000-0000-0000000000e9')
  and (select count(*) from profile_properties where profile_id=:'mgr')=1 as ok;
select * from chk('team: the manager can see their one site, and not the other', :'mgr', 'aal1', $$select (select count(*)=1 from properties)$$);
select * from chk('team: a site user cannot see or use the team tools', :'mgr', 'aal1', $$select (select count(*)=0 from team_members()) and (select count(*)=0 from team_summary())$$);
do $$ begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000fa', true);
  perform set_config('request.jwt.claims','{"aal":"aal1"}', true);
  set local role authenticated;
  begin perform team_invite('x@team.test','X','full', array['20000000-0000-0000-0000-0000000000e1']::uuid[]); raise exception 'site user invited'; exception when insufficient_privilege then null; end;
  begin perform team_set_access('00000000-0000-0000-0000-0000000000fa'::uuid, 'full', array['20000000-0000-0000-0000-0000000000e1']::uuid[], true); raise exception 'site user raised own access'; exception when insufficient_privilege then null; end;
  begin perform team_set_require_mfa(true); raise exception 'site user changed 2FA rule'; exception when insufficient_privilege then null; end;
  reset role;
end $$;
select 'team: a site user cannot invite, raise their own access or change the 2FA rule' as test, true as ok;
select * from chk('team: super admin lists the team with the manager', :'boss', 'aal2', $$select count(*)=2 from team_members()$$);
select * from chk('team: super admin gives the manager update on both sites', :'boss', 'aal2',
  $$select (select team_set_access('00000000-0000-0000-0000-0000000000fa','update', array['20000000-0000-0000-0000-0000000000e1','20000000-0000-0000-0000-0000000000e2']::uuid[], true) is null) is not null$$);
select * from chk('team: the manager now sees both sites and can edit', :'mgr', 'aal1', $$select (select count(*)=2 from properties) and can_edit_property('20000000-0000-0000-0000-0000000000e1')$$);
select * from chk('team: super admin switches the manager off, and they see nothing', :'boss', 'aal2', $$select (select team_set_access('00000000-0000-0000-0000-0000000000fa','update', array['20000000-0000-0000-0000-0000000000e1']::uuid[], false) is null) is not null$$);
select * from chk('team: a switched-off user sees nothing', :'mgr', 'aal1', $$select (select count(*)=0 from properties)$$);
select * from chk('team: super admin can make 2FA compulsory for the company', :'boss', 'aal2', $$select (select team_set_require_mfa(true) is null) is not null$$);
select 'team: 2FA rule is now on for the company' as test, (select require_mfa from companies where id='10000000-0000-0000-0000-0000000000e9') as ok;
do $$ begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f9', true);
  perform set_config('request.jwt.claims','{"aal":"aal2"}', true);
  set local role authenticated;
  begin perform team_set_access('00000000-0000-0000-0000-0000000000a3', 'full', array['20000000-0000-0000-0000-0000000000e1']::uuid[], true); raise exception 'edited another company user'; exception when insufficient_privilege then null; end;
  begin perform team_set_access('00000000-0000-0000-0000-0000000000f9', 'view', array['20000000-0000-0000-0000-0000000000e1']::uuid[], true); raise exception 'edited the super admin'; exception when insufficient_privilege then null; end;
  reset role;
end $$;
select 'team: the super admin cannot edit other companies'' users or themselves through the team tools' as test, true as ok;
-- an uninvited, confirmed person gets nothing
insert into auth.users(id,email,email_confirmed_at) values ('00000000-0000-0000-0000-0000000000fb','stranger@team.test', now());
do $$ begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000fb', true);
  perform set_config('request.jwt.claims','{"aal":"aal1"}', true);
  set local role authenticated;
  if accept_invitation('Stranger') then raise exception 'stranger accepted'; end if;
  reset role;
end $$;
select 'team: someone nobody invited gets no access' as test, not exists (select 1 from profiles where id='00000000-0000-0000-0000-0000000000fb') as ok;
rollback;

-- First-run set-up: tick the core checks (migration 0012) -----------------------------
begin;
select 'setup: the core list has the ten checks the owner chose' as test, (select count(*)=10 from core_checks) as ok;
select * from chk('setup: a signed-in client can read the list', :'superA', 'aal2', $$select count(*)=10 from core_checks$$);
select * from chk('setup: a client cannot change the list', :'superA', 'aal2', $$with u as (update core_checks set label='x' returning 1) select count(*)=0 from u$$);
do $$ begin
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a2', true);
  perform set_config('request.jwt.claims','{"aal":"aal2"}', true);
  set local role authenticated;
  begin perform finish_setup(null,'1 High St','{}'::text[],'[{"id":"20000000-0000-0000-0000-0000000000a1","name":"high street shop","address":"1 High St","postcode":"ME4 4TE"},{"id":"20000000-0000-0000-0000-0000000000a2","name":"Rear Yard","address":"2 High St","postcode":"ME1 1AA"}]'::jsonb,'ME4 4TE'); raise exception 'set-up accepted without a phone'; exception when invalid_parameter_value then null; end;
  begin perform finish_setup('01634 000000',null,'{}'::text[],'[{"id":"20000000-0000-0000-0000-0000000000a1","name":"high street shop","address":"1 High St","postcode":"ME4 4TE"},{"id":"20000000-0000-0000-0000-0000000000a2","name":"Rear Yard","address":"2 High St","postcode":"ME1 1AA"}]'::jsonb,'ME4 4TE'); raise exception 'set-up accepted without an address'; exception when invalid_parameter_value then null; end;
  begin perform finish_setup('01634 000000','1 High St','{}'::text[],'[{"id":"20000000-0000-0000-0000-0000000000a1","name":"high street shop","address":"1 High St","postcode":"ME4 4TE"},{"id":"20000000-0000-0000-0000-0000000000a2","name":"Rear Yard","address":"2 High St","postcode":"ME1 1AA"}]'::jsonb,null); raise exception 'set-up accepted without a postcode'; exception when invalid_parameter_value then null; end;
  begin perform finish_setup('01634 000000','1 High St','{}'::text[],'[{"id":"20000000-0000-0000-0000-0000000000a1","name":"high street shop","address":"1 High St","postcode":"ME4 4TE"}]'::jsonb,'ME4 4TE'); raise exception 'set-up accepted with a site left blank'; exception when invalid_parameter_value then null; end;
  begin perform finish_setup('01634 000000','1 High St','{}'::text[],'[{"id":"20000000-0000-0000-0000-0000000000a1","name":"high street shop","address":"1 High St"},{"id":"20000000-0000-0000-0000-0000000000a2","name":"Rear Yard","address":"2 High St","postcode":"ME1 1AA"}]'::jsonb,'ME4 4TE'); raise exception 'set-up accepted with a site missing its postcode'; exception when invalid_parameter_value then null; end;
  reset role;
end $$;
select 'setup: refused without the business phone, address or postcode, or with any site missing its name, address or postcode' as test, true as ok;
select 'setup: the refused attempts saved nothing' as test, (select setup_completed_at is null from companies where id='10000000-0000-0000-0000-00000000000a') as ok;
select * from chk('setup: super admin ticks three checks; they go onto both sites (6 items)', :'superA', 'aal2',
  $$select finish_setup('01634 000000','1 High St, Rochester', array['fra','pat','legionella'], '[{"id":"20000000-0000-0000-0000-0000000000a1","name":"high street shop","address":"1 High St","postcode":"ME4 4TE"},{"id":"20000000-0000-0000-0000-0000000000a2","name":"Rear Yard","address":"2 High St","postcode":"ME1 1AA"}]'::jsonb, 'ME4 4TE') = 6$$);
select 'setup: the new items have no date, so they show as missing, never green' as test,
  (select count(*)=6 and bool_and(due_date is null) from compliance_items where title in ('Fire Risk Assessment','PAT Testing','Legionella (water) Risk Management') and created_by='00000000-0000-0000-0000-0000000000a2') as ok;
select 'setup: marked done, with the contact details saved' as test,
  (select setup_completed_at is not null and contact_phone='01634 000000' and address like '1 High St%' from companies where id='10000000-0000-0000-0000-00000000000a') as ok;
select * from chk('setup: running it again does not duplicate anything', :'superA', 'aal2',
  $$select finish_setup('01634 000000','1 High St, Rochester',array['fra','pat'],'[{"id":"20000000-0000-0000-0000-0000000000a1","name":"high street shop","address":"1 High St","postcode":"ME4 4TE"},{"id":"20000000-0000-0000-0000-0000000000a2","name":"Rear Yard","address":"2 High St","postcode":"ME1 1AA"}]'::jsonb,'ME4 4TE') = 0$$);
do $$ begin
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a2', true);
  perform set_config('request.jwt.claims','{"aal":"aal2"}', true);
  set local role authenticated;
  begin perform finish_setup('01634 000000','1 High St',array['not_a_check'],'[{"id":"20000000-0000-0000-0000-0000000000a1","name":"high street shop","address":"1 High St","postcode":"ME4 4TE"},{"id":"20000000-0000-0000-0000-0000000000a2","name":"Rear Yard","address":"2 High St","postcode":"ME1 1AA"}]'::jsonb,'ME4 4TE'); raise exception 'odd code accepted'; exception when invalid_parameter_value then null; end;
  reset role;
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a3', true);
  perform set_config('request.jwt.claims','{"aal":"aal1"}', true);
  set local role authenticated;
  begin perform finish_setup(null,null,array['fra']); raise exception 'site user finished set-up'; exception when insufficient_privilege then null; end;
  reset role;
end $$;
select 'setup: an unknown check is refused, and a site user cannot run the set-up' as test, true as ok;
select * from chk('setup: sites are named and given addresses in the first-run set-up, tidied to capitals', :'superA', 'aal2',
  $$select finish_setup('01634 000000','1 High St, Rochester',array[]::text[],'[{"id":"20000000-0000-0000-0000-0000000000a1","name":"high street shop","address":"1 High St","postcode":"ME4 4TE"},{"id":"20000000-0000-0000-0000-0000000000a2","name":"Rear Yard","address":"2 High St","postcode":"ME1 1AA"}]'::jsonb,'ME4 4TE')=0$$);
select 'setup: the site was renamed' as test, exists (select 1 from properties where id='20000000-0000-0000-0000-0000000000a1' and name='High Street Shop' and address='1 High St') as ok;
select 'setup: another company got nothing' as test, (select count(*)=0 from compliance_items where property_id='20000000-0000-0000-0000-0000000000b1' and title='Fire Risk Assessment') as ok;
rollback;

-- Names are tidied wherever they are saved (migration 0013) --------------------------
begin;
insert into companies(id,name,contact_name) values ('10000000-0000-0000-0000-0000000000cc','  tidy builders ltd','sam o''brien-smith');
select 'names: business and contact names get a capital on every word' as test,
  (select name='Tidy Builders Ltd' and contact_name='Sam O''Brien-Smith' from companies where id='10000000-0000-0000-0000-0000000000cc') as ok;
insert into properties(company_id,name) values ('10000000-0000-0000-0000-0000000000cc','west  yard');
select 'names: site names too, and letters already capital are left alone' as test,
  (select name='West  Yard' from properties where company_id='10000000-0000-0000-0000-0000000000cc') and cap_words('ABC services') = 'ABC Services' as ok;
rollback;

-- Stripe payments (migration 0014) ----------------------------------------------------
begin;
update app_settings set value='true'::jsonb where key='self_signup_open';
insert into auth.users(id,email,email_confirmed_at) values ('00000000-0000-0000-0000-0000000000b9','pay@pay.test', now());
do $$ begin
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b9', true);
  perform set_config('request.jwt.claims','{"aal":"aal1"}', true);
  set local role authenticated;
  perform signup_company('Pay Co','Pam',3,'annual');
  reset role;
end $$;
select * from chk('stripe: the Pay now page gets company, number of sites, interval and email', '00000000-0000-0000-0000-0000000000b9', 'aal1',
  $$select (select sites=3 and billing_interval='annual' and email='pay@pay.test' and subscription='trial' from billing_info())$$);
select * from chk('stripe: another company''s head office cannot see it', :'superA', 'aal2', $$select (select count(*)=1 from billing_info()) and (select sites=2 from billing_info())$$);
select * from chk('stripe: a site user gets no billing information', :'siteAu', 'aal1', $$select count(*)=0 from billing_info()$$);
do $$ declare r text; begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b9', true);
  begin perform apply_stripe_event('evt_x','checkout.session.completed',null,null,null,'paid'); raise exception 'a client applied a payment'; exception when insufficient_privilege then null; end;
  reset role;
  set local role anon;
  begin perform apply_stripe_event('evt_x','checkout.session.completed',null,null,null,'paid'); raise exception 'anon applied a payment'; exception when insufficient_privilege then null; end;
  reset role;
end $$;
select 'stripe: neither a client nor a visitor can tell the system a payment was made' as test, true as ok;
select 'stripe: before payment the company is unpaid with nothing open' as test, (select subscription='trial' from companies where name='Pay Co') as ok;
do $$ declare r text; cid uuid; begin
  select id into cid from companies where name='Pay Co';
  set local role service_role;
  r := apply_stripe_event('evt_1','checkout.session.completed',cid,'cus_1','sub_1','paid');
  if r <> 'applied' then raise exception 'not applied: %', r; end if;
  r := apply_stripe_event('evt_1','checkout.session.completed',cid,'cus_1','sub_1','paid');
  if r <> 'duplicate' then raise exception 'duplicate processed: %', r; end if;
  reset role;
end $$;
select 'stripe: a verified payment opens the account, records the Stripe ids and the monthly value (yearly 3 sites: 315.90 / 12)' as test,
  (select subscription='active' and stripe_customer_id='cus_1' and stripe_subscription_id='sub_1' and monthly_value_pence=2633 from companies where name='Pay Co') as ok;
select * from chk('stripe: the paid company is now open', '00000000-0000-0000-0000-0000000000b9', 'aal2', $$select (select count(*)=3 from properties) and (select state='ok' from my_access())$$);
do $$ declare r text; cid uuid; begin
  select id into cid from companies where name='Pay Co';
  set local role service_role;
  r := apply_stripe_event('evt_2','invoice.payment_failed',null,'cus_1',null,'failed');
  if r <> 'applied' then raise exception 'failed not applied %', r; end if;
  reset role;
end $$;
select 'stripe: a failed payment on a paid account starts the 7-day warning' as test, (select subscription='past_due' and payment_failed_at is not null from companies where name='Pay Co') as ok;
do $$ declare r text; cid uuid; begin
  set local role service_role;
  r := apply_stripe_event('evt_3','invoice.paid',null,'cus_1',null,'paid');
  reset role;
end $$;
select 'stripe: paying the overdue invoice clears the warning' as test, (select subscription='active' and payment_failed_at is null from companies where name='Pay Co') as ok;
do $$ declare r text; begin
  set local role service_role;
  r := apply_stripe_event('evt_4','x',gen_random_uuid(),null,null,'paid');
  if r <> 'unknown_company' then raise exception 'unknown company accepted %', r; end if;
  begin perform apply_stripe_event('evt_5','x',null,'cus_1',null,'refund'); raise exception 'odd action accepted'; exception when invalid_parameter_value then null; end;
  reset role;
end $$;
select 'stripe: an unknown company or an unknown kind of event is not accepted' as test, true as ok;
update companies set subscription='trial', trial_ends_at = now(), payment_failed_at=null where name='Pay Co';
do $$ begin set local role service_role; perform apply_stripe_event('evt_6','invoice.payment_failed',null,'cus_1',null,'failed'); reset role; end $$;
select 'stripe: a failed FIRST payment leaves the sign-up unpaid, not past due' as test, (select subscription='trial' from companies where name='Pay Co') as ok;
-- passport rights (which buttons the screen shows; the real rules are the row-level policies above)
select * from chk('rights: a Level 1 head-office user can edit and manage', '00000000-0000-0000-0000-0000000000a2', 'aal2', $$select (select can_edit and can_manage from passport_rights())$$);
select * from chk('rights: a site user with update can edit but not manage', '00000000-0000-0000-0000-0000000000a3', 'aal1', $$select (select can_edit and not can_manage from passport_rights())$$);
select * from chk('rights: a site user with full can edit and manage', '00000000-0000-0000-0000-0000000000a5', 'aal1', $$select (select can_edit and can_manage from passport_rights())$$);
select * from chk('rights: a site user with view can do neither', '00000000-0000-0000-0000-0000000000a4', 'aal1', $$select (select not can_edit and not can_manage from passport_rights())$$);
select * from chk('rights: a Level 2 client is view-only even as head office', '00000000-0000-0000-0000-0000000000b1', 'aal2', $$select (select not can_edit and not can_manage from passport_rights())$$);
select * from chk('rights: a Level 3 client is view-only even as head office', '00000000-0000-0000-0000-0000000000c1', 'aal2', $$select (select not can_edit and not can_manage from passport_rights())$$);
select * from chk('rights: a Level 2 client cannot edit a record even by calling the database directly', '00000000-0000-0000-0000-0000000000b1', 'aal2', $$with u as (update compliance_items set notes='x' where id='30000000-0000-0000-0000-000000000006' returning 1) select count(*)=0 from u$$);
-- tasks, emergency information, settings, extras
select * from chk('tasks: a Level 1 head-office user can add a task', '00000000-0000-0000-0000-0000000000a2', 'aal2', $$with i as (insert into tasks(property_id,title,due_date) values ('20000000-0000-0000-0000-0000000000a1','Check fire exit signage',current_date) returning 1) select count(*)=1 from i$$);
select * from chk('tasks: a site user with update can add a task at their site', '00000000-0000-0000-0000-0000000000a3', 'aal1', $$with i as (insert into tasks(property_id,title) values ('20000000-0000-0000-0000-0000000000a1','Review COSHH sheets') returning 1) select count(*)=1 from i$$);
select * from deny('tasks: a view-only site user cannot add a task', '00000000-0000-0000-0000-0000000000a4', 'aal1', $$insert into tasks(property_id,title) values ('20000000-0000-0000-0000-0000000000a1','Nope')$$);
select * from deny('tasks: a site user cannot add a task at a site that is not theirs', '00000000-0000-0000-0000-0000000000a3', 'aal1', $$insert into tasks(property_id,title) values ('20000000-0000-0000-0000-0000000000a2','Nope')$$);
select * from deny('tasks: a Level 2 client cannot add a task', '00000000-0000-0000-0000-0000000000b1', 'aal2', $$insert into tasks(property_id,title) values ('20000000-0000-0000-0000-0000000000b1','Nope')$$);
select * from chk('tasks: a view-only user can read their site tasks but not another site''s', '00000000-0000-0000-0000-0000000000a4', 'aal1', $$select (select count(*)=2 from tasks) and (select count(*)=0 from tasks where property_id='20000000-0000-0000-0000-0000000000a2')$$);
select * from chk('tasks: a Level 2 client sees none of Company A tasks', '00000000-0000-0000-0000-0000000000b1', 'aal2', $$select (select count(*)=0 from tasks)$$);
select * from chk('tasks: a view-only user cannot change a task even directly', '00000000-0000-0000-0000-0000000000a4', 'aal1', $$with u as (update tasks set title='x' where property_id='20000000-0000-0000-0000-0000000000a1' returning 1) select count(*)=0 from u$$);
-- repeating tasks: next one is created on completion; at most 10 live at once
do $$ declare tid uuid; nid uuid; begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true); perform set_config('request.jwt.claims', '{"aal":"aal2"}', true);
  set local role authenticated;
  insert into tasks(property_id,title,due_date,repeat_months) values ('20000000-0000-0000-0000-0000000000a1','Annual alarm test',current_date-5,3) returning id into tid;
  nid := complete_task(tid);
  reset role;
  if nid is null then raise exception 'no next task'; end if;
  if not exists (select 1 from tasks where id=tid and status='done' and completed_at is not null) then raise exception 'not done'; end if;
  if not exists (select 1 from tasks where id=nid and status='pending' and repeat_months=3 and due_date >= current_date) then raise exception 'next task wrong'; end if;
end $$;
select 'tasks: completing a repeating task finishes it and creates the next one, never in the past' as test, true as ok;
do $$ declare n int := 0; ok boolean := false; begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true); perform set_config('request.jwt.claims', '{"aal":"aal2"}', true);
  set local role authenticated;
  while (select count(*) from tasks t join properties p on p.id=t.property_id where p.company_id='10000000-0000-0000-0000-00000000000a' and t.status='pending' and t.repeat_months is not null) < 10 loop
    insert into tasks(property_id,title,repeat_months) values ('20000000-0000-0000-0000-0000000000a1','Repeat '||n,1); n := n + 1;
  end loop;
  begin insert into tasks(property_id,title,repeat_months) values ('20000000-0000-0000-0000-0000000000a1','One too many',1); exception when check_violation then ok := true; end;
  reset role;
  if not ok then raise exception 'limit not enforced'; end if;
end $$;
select 'tasks: a business cannot have more than 10 repeating tasks live at once' as test, true as ok;
select * from chk('tasks: one-off tasks are not limited by the repeating limit', '00000000-0000-0000-0000-0000000000a2', 'aal2', $$with i as (insert into tasks(property_id,title) values ('20000000-0000-0000-0000-0000000000a1','One-off') returning 1) select count(*)=1 from i$$);
-- emergency information
select * from chk('emergency: head office can save a site''s emergency details and contacts', '00000000-0000-0000-0000-0000000000a2', 'aal2', $$with a as (insert into site_emergency(property_id,assembly_point,gas_shutoff) values ('20000000-0000-0000-0000-0000000000a1','Car park','Back store') returning 1), b as (insert into emergency_contacts(property_id,name,phone) values ('20000000-0000-0000-0000-0000000000a1','Sam Keyholder','07000 000000') returning 1) select (select count(*) from a)=1 and (select count(*) from b)=1$$);
select * from deny('emergency: a view-only user cannot change emergency details', '00000000-0000-0000-0000-0000000000a4', 'aal1', $$insert into site_emergency(property_id,assembly_point) values ('20000000-0000-0000-0000-0000000000a2','x')$$);
select * from chk('emergency: a view-only user can read their site''s emergency details', '00000000-0000-0000-0000-0000000000a4', 'aal1', $$select (select count(*)=1 from site_emergency) and (select count(*)=1 from emergency_contacts)$$);
select * from chk('emergency: another company cannot read them', '00000000-0000-0000-0000-0000000000b1', 'aal2', $$select (select count(*)=0 from site_emergency) and (select count(*)=0 from emergency_contacts)$$);
do $$ declare ok boolean := false; begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true); perform set_config('request.jwt.claims', '{"aal":"aal2"}', true);
  set local role authenticated;
  for i in 1..9 loop insert into emergency_contacts(property_id,name) values ('20000000-0000-0000-0000-0000000000a1','C'||i); end loop;
  begin insert into emergency_contacts(property_id,name) values ('20000000-0000-0000-0000-0000000000a1','Eleventh'); exception when check_violation then ok := true; end;
  reset role;
  if not ok then raise exception 'contact limit not enforced'; end if;
end $$;
select 'emergency: at most 10 contacts per site' as test, true as ok;
-- settings
do $$ begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true); perform set_config('request.jwt.claims', '{"aal":"aal2"}', true);
  set local role authenticated; perform update_business('01634 111111','1 High St'); reset role;
end $$;
select 'settings: head office can change the business phone and address' as test, (select contact_phone='01634 111111' and address='1 High St' from companies where id='10000000-0000-0000-0000-00000000000a') as ok;
select * from deny('settings: a site user cannot change the business details', '00000000-0000-0000-0000-0000000000a3', 'aal1', $$select update_business('x','y')$$);
do $$ begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true); perform set_config('request.jwt.claims', '{"aal":"aal2"}', true);
  set local role authenticated; perform update_site('20000000-0000-0000-0000-0000000000a1','north  road shop','2 North Rd'); reset role;
end $$;
select 'settings: head office can rename a site (tidied to capital letters)' as test, (select name ilike 'north%road%shop' and name <> lower(name) and address='2 North Rd' from properties where id='20000000-0000-0000-0000-0000000000a1') as ok;
select * from deny('settings: head office cannot rename another company''s site', '00000000-0000-0000-0000-0000000000a2', 'aal2', $$select update_site('20000000-0000-0000-0000-0000000000b1','Hacked','x')$$);
-- extras
select * from chk('extras: a business that has bought nothing owns no extras but can see what is on offer', '00000000-0000-0000-0000-0000000000a2', 'aal2', $$select (select count(*)=2 from my_extras()) and (select count(*)=0 from my_extras() where owned)$$);
-- buying add-ons, and keeping an add-on's payments away from the main account
update companies set subscription='active', stripe_customer_id='cus_A', stripe_subscription_id='sub_main', access_ends_at=null, billing_interval='monthly' where id='10000000-0000-0000-0000-00000000000a';
delete from company_extras where company_id='10000000-0000-0000-0000-00000000000a';
select * from chk('extras buy: head office of an active Level 1 account gets the checkout details (staff sign in is per site)', '00000000-0000-0000-0000-0000000000a2', 'aal2', $$select (select quantity=(select count(*) from properties where company_id='10000000-0000-0000-0000-00000000000a') and price_pence=699 and stripe_customer_id='cus_A' from extra_checkout_info('staff_signin'))$$);
select * from chk('extras buy: toolbox talks is also charged per site (£3.99 each)', '00000000-0000-0000-0000-0000000000a2', 'aal2', $$select (select quantity=(select count(*) from properties where company_id='10000000-0000-0000-0000-00000000000a') and price_pence=399 from extra_checkout_info('toolbox_talks'))$$);
select * from deny('extras buy: a site user cannot buy an add-on', '00000000-0000-0000-0000-0000000000a3', 'aal1', $$select * from extra_checkout_info('toolbox_talks')$$);
select * from deny('extras buy: a Level 2 client cannot buy an add-on', '00000000-0000-0000-0000-0000000000b1', 'aal2', $$select * from extra_checkout_info('toolbox_talks')$$);
select * from deny('extras buy: an unknown add-on is refused', '00000000-0000-0000-0000-0000000000a2', 'aal2', $$select * from extra_checkout_info('nonsense')$$);
select * from deny('extras buy: head office without 2FA is refused', '00000000-0000-0000-0000-0000000000a2', 'aal1', $$select * from extra_checkout_info('toolbox_talks')$$);
do $$ declare r text; begin
  set local role service_role;
  r := apply_stripe_event('evt_x1','checkout.session.completed','10000000-0000-0000-0000-00000000000a','cus_A','sub_tt','paid_dummy');
exception when others then reset role; end $$;
do $$ declare r text; begin
  set local role service_role;
  r := apply_stripe_event('evt_x2','checkout.session.completed','10000000-0000-0000-0000-00000000000a','cus_A','sub_tt','extra_paid','toolbox_talks',2);
  if r <> 'extra_applied' then raise exception 'got %', r; end if;
  r := apply_stripe_event('evt_x2','checkout.session.completed','10000000-0000-0000-0000-00000000000a','cus_A','sub_tt','extra_paid','toolbox_talks',2);
  if r <> 'duplicate' then raise exception 'not idempotent: %', r; end if;
  reset role;
end $$;
select 'extras buy: a confirmed payment switches the add-on on, once (a repeated message changes nothing)' as test, (select count(*)=1 and bool_and(status='active' and stripe_item_id='sub_tt') from company_extras where company_id='10000000-0000-0000-0000-00000000000a' and extra_code='toolbox_talks') as ok;
select 'extras buy: the account value now includes the add-on' as test, (select monthly_value_pence = 1499 + 799*(select count(*)-1 from properties where company_id='10000000-0000-0000-0000-00000000000a') + 399*2 from companies where id='10000000-0000-0000-0000-00000000000a') as ok;
select * from chk('extras buy: the business now owns Toolbox Talks and not Staff Clock In', '00000000-0000-0000-0000-0000000000a2', 'aal2', $$select (select owned from my_extras() where code='toolbox_talks') and not (select owned from my_extras() where code='staff_signin')$$);
select * from deny('extras buy: an add-on already owned cannot be bought twice', '00000000-0000-0000-0000-0000000000a2', 'aal2', $$select * from extra_checkout_info('toolbox_talks')$$);
do $$ declare r text; begin
  set local role service_role;
  r := apply_stripe_event('evt_x3','invoice.payment_failed','10000000-0000-0000-0000-00000000000a','cus_A','sub_tt','failed');
  if r <> 'extra_ignored' then raise exception 'got %', r; end if;
  r := apply_stripe_event('evt_x4','invoice.paid','10000000-0000-0000-0000-00000000000a','cus_A','sub_new_extra','paid');
  if r <> 'other_subscription' then raise exception 'got %', r; end if;
  reset role;
end $$;
select 'extras buy: an add-on payment failure, or an unknown subscription''s invoice, never touches the main account' as test, (select subscription='active' and stripe_subscription_id='sub_main' from companies where id='10000000-0000-0000-0000-00000000000a') as ok;
do $$ declare r text; begin
  set local role service_role;
  r := apply_stripe_event('evt_x5','customer.subscription.deleted','10000000-0000-0000-0000-00000000000a','cus_A','sub_tt','cancelled');
  if r <> 'extra_cancelled' then raise exception 'got %', r; end if;
  reset role;
end $$;
select 'extras buy: cancelling an add-on switches only it off; the account stays active' as test, (select subscription='active' from companies where id='10000000-0000-0000-0000-00000000000a') and (select status='cancelled' from company_extras where company_id='10000000-0000-0000-0000-00000000000a' and extra_code='toolbox_talks') and (select monthly_value_pence = 1499 + 799*(select count(*)-1 from properties where company_id='10000000-0000-0000-0000-00000000000a') from companies where id='10000000-0000-0000-0000-00000000000a') as ok;
-- staff register
select * from deny('staff: nobody can add staff before buying Staff Clock In', '00000000-0000-0000-0000-0000000000a2', 'aal2', $$insert into staff_members(property_id,full_name) values ('20000000-0000-0000-0000-0000000000a1','Jo Bloggs')$$);
insert into company_extras(company_id, extra_code, status, price_pence, quantity, stripe_item_id) values ('10000000-0000-0000-0000-00000000000a','staff_signin','active',699,2,'sub_ss') on conflict (company_id, extra_code) do update set status='active';
select * from chk('staff: head office can add staff at a site once the add-on is bought (names tidied)', '00000000-0000-0000-0000-0000000000a2', 'aal2', $$with i as (insert into staff_members(property_id,full_name,job_title) values ('20000000-0000-0000-0000-0000000000a1','jo bloggs','Cleaner') returning full_name) select (select full_name from i)='Jo Bloggs'$$);
select * from chk('staff: a site user with update can add staff at their site', '00000000-0000-0000-0000-0000000000a3', 'aal1', $$with i as (insert into staff_members(property_id,full_name) values ('20000000-0000-0000-0000-0000000000a1','Al Smith') returning 1) select count(*)=1 from i$$);
select * from deny('staff: a view-only user cannot add staff', '00000000-0000-0000-0000-0000000000a4', 'aal1', $$insert into staff_members(property_id,full_name) values ('20000000-0000-0000-0000-0000000000a1','Nope')$$);
select * from deny('staff: nobody can add staff at a site that is not theirs', '00000000-0000-0000-0000-0000000000a3', 'aal1', $$insert into staff_members(property_id,full_name) values ('20000000-0000-0000-0000-0000000000a2','Nope')$$);
select * from chk('staff: a view-only user can read the register, another company cannot', '00000000-0000-0000-0000-0000000000a4', 'aal1', $$select (select count(*)=2 from staff_members)$$);
select * from chk('staff: a Level 2 client sees no staff of Company A', '00000000-0000-0000-0000-0000000000b1', 'aal2', $$select (select count(*)=0 from staff_members)$$);
do $$ declare ok boolean := false; begin
  update company_extras set status='cancelled', access_ends_at=now() where company_id='10000000-0000-0000-0000-00000000000a' and extra_code='staff_signin';
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true); perform set_config('request.jwt.claims', '{"aal":"aal2"}', true);
  set local role authenticated;
  if (select count(*) from staff_members) <> 0 then raise exception 'register still readable after the add-on stopped'; end if;
  reset role;
end $$;
select 'staff: when the add-on stops, the register can no longer be read or changed' as test, true as ok;
-- toolbox talks
select 'talks: the core library has 30 talks across the 5 categories' as test, (select count(*)=30 and count(distinct category)=5 from toolbox_talks where company_id is null) as ok;
select 'talks: every core talk has key points and discussion questions' as test, (select bool_and(coalesce(array_length(points,1),0) >= 5 and coalesce(array_length(discuss,1),0) >= 2 and char_length(summary) > 10) from toolbox_talks where company_id is null) as ok;
select * from chk('talks: a business that has not bought Toolbox Talks sees no talks', '00000000-0000-0000-0000-0000000000a2', 'aal2', $$select count(*)=0 from toolbox_talks$$);
insert into company_extras(company_id, extra_code, status, price_pence, quantity, stripe_item_id) values ('10000000-0000-0000-0000-00000000000a','toolbox_talks','active',399,2,'sub_tt2') on conflict (company_id, extra_code) do update set status='active', access_ends_at=null;
select * from chk('talks: once bought, head office sees all 30 core talks', '00000000-0000-0000-0000-0000000000a2', 'aal2', $$select count(*)=30 from toolbox_talks$$);
select * from chk('talks: a Level 2 client without the add-on still sees none', '00000000-0000-0000-0000-0000000000b1', 'aal2', $$select count(*)=0 from toolbox_talks$$);
select * from chk('talks: a client cannot even see that a core talk was changed (no rows touched)', '00000000-0000-0000-0000-0000000000a2', 'aal2', $$with u as (update toolbox_talks set title='x' where company_id is null returning 1) select count(*)=0 from u$$);
select * from chk('talks: head office can write its own talk', '00000000-0000-0000-0000-0000000000a2', 'aal2', $$with i as (insert into toolbox_talks(company_id,category,title,points) values ('10000000-0000-0000-0000-00000000000a','Health & Safety','Our forklift rules',array['Keep clear']) returning 1) select count(*)=1 from i$$);
select * from deny('talks: a site user cannot write a company talk', '00000000-0000-0000-0000-0000000000a3', 'aal1', $$insert into toolbox_talks(company_id,category,title) values ('10000000-0000-0000-0000-00000000000a','Health & Safety','Nope')$$);
select * from deny('talks: head office cannot write a talk for another company', '00000000-0000-0000-0000-0000000000a2', 'aal2', $$insert into toolbox_talks(company_id,category,title) values ('10000000-0000-0000-0000-00000000000b','Health & Safety','Nope')$$);
select * from chk('talks: a site user sees the core library and their own company talk', '00000000-0000-0000-0000-0000000000a4', 'aal1', $$select count(*)=31 from toolbox_talks$$);
do $$ declare ok boolean := false; begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true); perform set_config('request.jwt.claims', '{"aal":"aal2"}', true);
  set local role authenticated;
  for i in 2..10 loop insert into toolbox_talks(company_id,category,title) values ('10000000-0000-0000-0000-00000000000a','Wellbeing','Own '||i); end loop;
  begin insert into toolbox_talks(company_id,category,title) values ('10000000-0000-0000-0000-00000000000a','Wellbeing','Eleventh'); exception when check_violation then ok := true; end;
  reset role;
  if not ok then raise exception 'own talk limit not enforced'; end if;
end $$;
select 'talks: a business can have at most 10 of its own talks' as test, true as ok;
-- recording a talk
select * from chk('talks record: a site user with update records a talk with two signed attendees', '00000000-0000-0000-0000-0000000000a3', 'aal1', $$select record_talk('20000000-0000-0000-0000-0000000000a1', (select id from toolbox_talks where code='tt01'), current_date, 'Leah', 'Went well', '[{"name":"Jo Bloggs","signature":[[[10,10],[50,80]]]},{"name":"Al Smith","signature":[[[5,5],[9,9]]]}]'::jsonb) is not null$$);
select 'talks record: the record keeps the talk title and points as they were, and both signatures' as test,
  (select count(*)=1 and bool_and(talk_title='Slips, Trips and Falls' and presenter='Leah' and array_length(talk_points,1) >= 5) from talk_sessions) and (select count(*)=2 from talk_attendees) as ok;
select * from deny('talks record: a view-only user cannot record a talk', '00000000-0000-0000-0000-0000000000a4', 'aal1', $$select record_talk('20000000-0000-0000-0000-0000000000a1', (select id from toolbox_talks where code='tt01'), current_date, 'X', '', '[{"name":"Jo","signature":[[[1,1],[2,2]]]}]'::jsonb)$$);
select * from deny('talks record: nobody can record at a site that is not theirs', '00000000-0000-0000-0000-0000000000a3', 'aal1', $$select record_talk('20000000-0000-0000-0000-0000000000a2', (select id from toolbox_talks where code='tt01'), current_date, 'X', '', '[{"name":"Jo","signature":[[[1,1],[2,2]]]}]'::jsonb)$$);
select * from deny('talks record: a Level 2 client cannot record a talk', '00000000-0000-0000-0000-0000000000b1', 'aal2', $$select record_talk('20000000-0000-0000-0000-0000000000b1', (select id from toolbox_talks where code='tt01'), current_date, 'X', '', '[{"name":"Jo","signature":[[[1,1],[2,2]]]}]'::jsonb)$$);
select * from deny('talks record: an attendee without a signature is refused', '00000000-0000-0000-0000-0000000000a3', 'aal1', $$select record_talk('20000000-0000-0000-0000-0000000000a1', (select id from toolbox_talks where code='tt01'), current_date, 'X', '', '[{"name":"Jo","signature":[]}]'::jsonb)$$);
select * from deny('talks record: no attendees is refused', '00000000-0000-0000-0000-0000000000a3', 'aal1', $$select record_talk('20000000-0000-0000-0000-0000000000a1', (select id from toolbox_talks where code='tt01'), current_date, 'X', '', '[]'::jsonb)$$);
select * from deny('talks record: a nameless attendee is refused', '00000000-0000-0000-0000-0000000000a3', 'aal1', $$select record_talk('20000000-0000-0000-0000-0000000000a1', (select id from toolbox_talks where code='tt01'), current_date, 'X', '', '[{"name":" ","signature":[[[1,1],[2,2]]]}]'::jsonb)$$);
select * from chk('talks record: a view-only user can read the records, another company cannot', '00000000-0000-0000-0000-0000000000a4', 'aal1', $$select (select count(*)=1 from talk_sessions) and (select count(*)=2 from talk_attendees)$$);
select * from chk('talks record: a Level 2 client sees none of them', '00000000-0000-0000-0000-0000000000b1', 'aal2', $$select (select count(*)=0 from talk_sessions) and (select count(*)=0 from talk_attendees)$$);
select * from chk('talks record: head office cannot change or delete a record (it is permanent)', '00000000-0000-0000-0000-0000000000a2', 'aal2', $$with u as (update talk_sessions set presenter='Changed' returning 1), d as (delete from talk_attendees returning 1), d2 as (delete from talk_sessions returning 1) select (select count(*) from u)=0 and (select count(*) from d)=0 and (select count(*) from d2)=0$$);
do $$ begin
  update company_extras set status='cancelled', access_ends_at=now() where company_id='10000000-0000-0000-0000-00000000000a' and extra_code='toolbox_talks';
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true); perform set_config('request.jwt.claims', '{"aal":"aal2"}', true);
  set local role authenticated;
  if (select count(*) from toolbox_talks) <> 0 or (select count(*) from talk_sessions) <> 0 then raise exception 'talks or records still readable after the add-on stopped'; end if;
  reset role;
end $$;
select 'talks: when the add-on stops, the talks and records can no longer be read' as test, true as ok;
-- standard formats
select 'formats: phone numbers become 5 digits, a space, 6 digits (also from +44 and with odd spacing)' as test,
  fmt_phone('01634123456')='01634 123456' and fmt_phone('+44 1634 123456')='01634 123456' and fmt_phone('07700 900 123')='07700 900123' and fmt_phone('(01634) 123-456')='01634 123456' and fmt_phone('')  is null as ok;
select 'formats: a number that cannot be put in that shape is left as typed, not changed' as test, fmt_phone('12345')='12345' and fmt_phone('0800 111 999')='0800 111 999' as ok;
select 'formats: postcodes become capitals with a space before the last 3 characters' as test,
  fmt_postcode('me3 8fx')='ME3 8FX' and fmt_postcode('ME38FX')='ME3 8FX' and fmt_postcode('  sw1a1aa ')='SW1A 1AA' and fmt_postcode('m11ae')='M1 1AE' and fmt_postcode('')  is null and fmt_postcode('bad')='BAD' as ok;
do $$ begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true); perform set_config('request.jwt.claims', '{"aal":"aal2"}', true);
  set local role authenticated;
  perform update_business('01634123456','goldfinch grove, rochester','me38fx');
  perform update_site('20000000-0000-0000-0000-0000000000a1','north road','12 high street, chatham','me4 4tl');
  insert into emergency_contacts(property_id,name,role,phone) values ('20000000-0000-0000-0000-0000000000a2','sam keyholder','key holder','07700900123');
  reset role;
end $$;
select 'formats: business phone, address and postcode are tidied when saved' as test,
  (select contact_phone='01634 123456' and address='Goldfinch Grove, Rochester' and postcode='ME3 8FX' from companies where id='10000000-0000-0000-0000-00000000000a') as ok;
select 'formats: a site address and postcode are tidied when saved' as test, (select address='12 High Street, Chatham' and postcode='ME4 4TL' from properties where id='20000000-0000-0000-0000-0000000000a1') as ok;
select 'formats: an emergency contact name, role and phone are tidied' as test, (select name='Sam Keyholder' and role='Key Holder' and phone='07700 900123' from emergency_contacts where property_id='20000000-0000-0000-0000-0000000000a2' and phone='07700 900123') as ok;
-- the people register works with either add-on
update company_extras set status='active', access_ends_at=null where company_id='10000000-0000-0000-0000-00000000000a' and extra_code='toolbox_talks';
update company_extras set status='cancelled', access_ends_at=now() where company_id='10000000-0000-0000-0000-00000000000a' and extra_code='staff_signin';
select * from chk('people: with only Toolbox Talks bought, head office can add and see people', '00000000-0000-0000-0000-0000000000a2', 'aal2', $$with i as (insert into staff_members(property_id,full_name) values ('20000000-0000-0000-0000-0000000000a1','pat jones') returning full_name) select (select full_name from i)='Pat Jones'$$);
update company_extras set status='cancelled', access_ends_at=now() where company_id='10000000-0000-0000-0000-00000000000a' and extra_code='toolbox_talks';
select * from chk('people: with neither add-on, the register cannot be read', '00000000-0000-0000-0000-0000000000a2', 'aal2', $$select count(*)=0 from staff_members$$);

-- ===== Staff Clock In / Out: QR token per site, public clock functions, attendance =====
update company_extras set status='active', access_ends_at=null where company_id='10000000-0000-0000-0000-00000000000a' and extra_code='staff_signin';
delete from staff_members where property_id in ('20000000-0000-0000-0000-0000000000a1','20000000-0000-0000-0000-0000000000a2');
insert into staff_members(id, property_id, full_name) values
 ('90000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-0000000000a1','Jo Bloggs'),
 ('90000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-0000000000a1','Al Smith'),
 ('90000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-0000000000a2','Other Site');
select 'clock: every site has its own 32-character token, all different' as test,
  (select count(*) = count(distinct clock_token) and bool_and(char_length(clock_token) = 32) from properties) as ok;
select * from chk('clock: a client cannot set a site token directly', :'superA', 'aal2', $$with u as (update properties set clock_token = repeat('a', 32) where id = '20000000-0000-0000-0000-0000000000a1' returning 1) select count(*) = 0 from u$$);
select * from deny('clock: even Tremcore staff cannot set a token by hand (only the replace function can)', :'staff', 'aal2', $$update properties set clock_token = repeat('a', 32) where id = '20000000-0000-0000-0000-0000000000a1'$$);
do $$ begin set local role service_role;
  if clock_site_info('nonsense') is not null or clock_site_info(repeat('0', 32)) is not null then raise exception 'bad token answered'; end if; reset role; end $$;
select 'clock: a wrong token gets no answer' as test, true as ok;
select 'clock: the page info lists the site and active people, nobody in yet' as test, (
  with t as (select clock_token tk from properties where id = '20000000-0000-0000-0000-0000000000a1')
  select (j ->> 'site') = (select name from properties where id = '20000000-0000-0000-0000-0000000000a1') and jsonb_array_length(j -> 'people') = 2 and not (j -> 'people' -> 0 ->> 'in')::boolean
  from (select clock_site_info(tk) j from t) x) as ok;
create temp table clk(r jsonb, step text);
grant all on clk to public;
do $$ declare tk text; begin
  select clock_token into tk from properties where id = '20000000-0000-0000-0000-0000000000a1';
  set local role service_role;
  insert into clk select clock_action(tk, '90000000-0000-0000-0000-000000000001', 'in'), 'in1';
  insert into clk select clock_action(tk, '90000000-0000-0000-0000-000000000001', 'in'), 'in2';
  insert into clk select clock_action(tk, '90000000-0000-0000-0000-000000000003', 'in'), 'wrongsite';
  insert into clk select clock_action(tk, '90000000-0000-0000-0000-000000000002', 'out'), 'outfirst';
  insert into clk select clock_action(tk, '90000000-0000-0000-0000-000000000001', 'sideways'), 'badaction';
  insert into clk select clock_action(tk, '90000000-0000-0000-0000-000000000002', 'in'), 'in_al';
  reset role;
end $$;
select 'clock: clocking in works, and a second tap says already in without a second record' as test,
  (select r ->> 'status' from clk where step = 'in1') = 'in' and (select r ->> 'status' from clk where step = 'in2') = 'already_in'
  and (select count(*) from staff_attendance where member_id = '90000000-0000-0000-0000-000000000001') = 1 as ok;
select 'clock: someone from another site, a bad action, or clocking out when not in, is refused or harmless' as test,
  (select r is null from clk where step = 'wrongsite') and (select r is null from clk where step = 'badaction') and (select r ->> 'status' from clk where step = 'outfirst') = 'already_out'
  and (select count(*) from staff_attendance where member_id = '90000000-0000-0000-0000-000000000003') = 0 as ok;
select 'clock: the page info now shows who is in' as test, (
  select (select (p ->> 'in')::boolean from jsonb_array_elements(j -> 'people') p where p ->> 'name' = 'Jo Bloggs')
  from (select clock_site_info(clock_token) j from properties where id = '20000000-0000-0000-0000-0000000000a1') x) as ok;
do $$ declare tk text; r jsonb; begin
  select clock_token into tk from properties where id = '20000000-0000-0000-0000-0000000000a1';
  set local role service_role; r := clock_action(tk, '90000000-0000-0000-0000-000000000001', 'out'); reset role;
  if r ->> 'status' <> 'out' then raise exception 'clock out failed %', r; end if;
  insert into clk values (r, 'out1');
end $$;
select 'clock: clocking out closes the record' as test, (select clocked_out is not null and closed_by = 'person' from staff_attendance where member_id = '90000000-0000-0000-0000-000000000001') as ok;
-- forgot to clock out yesterday: marked honestly, no time invented, and today's clock-in works
do $$ declare tk text; begin
  select clock_token into tk from properties where id = '20000000-0000-0000-0000-0000000000a1';
  alter table staff_attendance disable trigger attendance_guard;
  update staff_attendance set clocked_in = now() - interval '20 hours' where member_id = '90000000-0000-0000-0000-000000000002';
  alter table staff_attendance enable trigger attendance_guard;
  set local role service_role; perform clock_action(tk, '90000000-0000-0000-0000-000000000002', 'in'); reset role;
end $$;
select 'clock: a forgotten clock-out is flagged, not invented, and the new clock-in is recorded' as test,
  (select count(*) = 1 from staff_attendance where member_id = '90000000-0000-0000-0000-000000000002' and no_clock_out and clocked_out is null)
  and (select count(*) = 1 from staff_attendance where member_id = '90000000-0000-0000-0000-000000000002' and not no_clock_out and clocked_out is null) as ok;
-- who can call the clock functions, and who can read the record
do $$ declare tk text; begin
  select clock_token into tk from properties where id = '20000000-0000-0000-0000-0000000000a1';
  begin set local role anon; perform clock_action(tk, '90000000-0000-0000-0000-000000000001', 'in'); reset role; raise exception 'anon could clock'; exception when insufficient_privilege then reset role; end;
  begin set local role authenticated; perform clock_site_info(tk); reset role; raise exception 'user could read page info'; exception when insufficient_privilege then reset role; end;
end $$;
select 'clock: signed-in and anonymous users cannot call the clock functions (only our server can)' as test, true as ok;
select * from chk('attendance: head office can read its own site''s record', :'superA', 'aal2', $$select count(*) >= 3 from staff_attendance$$);
select * from chk('attendance: another company sees nothing', :'superB', 'aal2', $$select count(*) = 0 from staff_attendance$$);
select * from deny('attendance: nobody can add a record by hand', :'superA', 'aal2', $$insert into staff_attendance(property_id, member_name) values ('20000000-0000-0000-0000-0000000000a1', 'Fake')$$);
select * from chk('attendance: a view-only site user cannot close a record', :'siteAv', 'aal2', $$with u as (update staff_attendance set clocked_out = now() where member_id = '90000000-0000-0000-0000-000000000002' and clocked_out is null returning 1) select count(*) = 0 from u$$);
select * from deny('attendance: the start time of a record cannot be changed', :'superA', 'aal2', $$update staff_attendance set clocked_in = clocked_in - interval '1 hour' where member_id = '90000000-0000-0000-0000-000000000002'$$);
select * from deny('attendance: a clock-out cannot be set in the future', :'superA', 'aal2', $$update staff_attendance set clocked_out = now() + interval '2 days' where member_id = '90000000-0000-0000-0000-000000000002' and clocked_out is null$$);
select * from chk('attendance: head office can close a record that was left open', :'superA', 'aal2', $$with u as (update staff_attendance set clocked_out = now() where member_id = '90000000-0000-0000-0000-000000000002' and clocked_out is null and not no_clock_out returning closed_by) select count(*) = 1 and bool_and(closed_by = 'manager') from u$$);
select * from chk('attendance: a closed record cannot be altered again', :'superA', 'aal2', $$with u as (update staff_attendance set clocked_out = now() where member_id = '90000000-0000-0000-0000-000000000001' returning 1) select count(*) = 0 from u$$);
-- replacing the QR code
select * from deny('clock: a view-only site user cannot replace the QR code', :'siteAv', 'aal2', $$select regen_clock_token('20000000-0000-0000-0000-0000000000a1')$$);
select * from deny('clock: another company cannot replace our QR code', :'superB', 'aal2', $$select regen_clock_token('20000000-0000-0000-0000-0000000000a1')$$);
select * from deny('clock: replacing the QR code needs 2FA', :'superA', 'aal1', $$select regen_clock_token('20000000-0000-0000-0000-0000000000a1')$$);
do $$ declare old text; new text; begin
  select clock_token into old from properties where id = '20000000-0000-0000-0000-0000000000a1';
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true); perform set_config('request.jwt.claims', '{"aal":"aal2"}', true);
  set local role authenticated; new := regen_clock_token('20000000-0000-0000-0000-0000000000a1'); reset role;
  if new = old or char_length(new) <> 32 then raise exception 'token not replaced'; end if;
  set local role service_role;
  if clock_site_info(old) is not null then raise exception 'old token still works'; end if;
  if clock_site_info(new) is null then raise exception 'new token does not work'; end if;
  reset role;
end $$;
select 'clock: head office can replace the QR code; the old one stops working at once' as test, true as ok;
update company_extras set status='cancelled', access_ends_at=now() where company_id='10000000-0000-0000-0000-00000000000a' and extra_code='staff_signin';
do $$ declare tk text; begin select clock_token into tk from properties where id = '20000000-0000-0000-0000-0000000000a1'; set local role service_role;
  if clock_site_info(tk) is not null then raise exception 'page still works after stop'; end if; reset role; end $$;
select 'clock: when the add-on stops, the public page stops answering' as test, true as ok;

-- ===== Pay before the email is confirmed =====
insert into auth.users(id, email, email_confirmed_at) values ('00000000-0000-0000-0000-0000000000d1', 'new@pay.test', null), ('00000000-0000-0000-0000-0000000000d2', 'done@pay.test', now());
insert into auth.users(id, email, email_confirmed_at, created_at) values ('00000000-0000-0000-0000-0000000000d3', 'old@pay.test', null, now() - interval '3 hours');
create temp table pp(company_id uuid, sites int, billing_interval text, email text); grant all on pp to public;
do $$ begin
  begin set local role authenticated; perform signup_prepare('new@pay.test', 'x', 'y', 1, 'monthly'); reset role; raise exception 'user could call it'; exception when insufficient_privilege then reset role; end;
  begin set local role anon; perform signup_prepare('new@pay.test', 'x', 'y', 1, 'monthly'); reset role; raise exception 'anon could call it'; exception when insufficient_privilege then reset role; end;
end $$;
select 'pay first: signed-in and anonymous users cannot call the prepare function (only our server can)' as test, true as ok;
do $$ declare e text; begin
  set local role service_role;
  begin perform signup_prepare('done@pay.test', 'Z Ltd', 'Zed', 1, 'monthly'); e := 'allowed'; exception when others then e := sqlstate; end;
  if e <> '42501' then raise exception 'confirmed account not refused: %', e; end if;
  begin perform signup_prepare('old@pay.test', 'Z Ltd', 'Zed', 1, 'monthly'); e := 'allowed'; exception when others then e := sqlstate; end;
  if e <> '42501' then raise exception 'old login not refused: %', e; end if;
  begin perform signup_prepare('nobody@pay.test', 'Z Ltd', 'Zed', 1, 'monthly'); e := 'allowed'; exception when others then e := sqlstate; end;
  if e <> '42501' then raise exception 'unknown email not refused: %', e; end if;
  begin perform signup_prepare('new@pay.test', 'Z Ltd', 'Zed', 101, 'monthly'); e := 'allowed'; exception when others then e := sqlstate; end;
  if e <> '22023' then raise exception 'bad site count not refused: %', e; end if;
  begin perform signup_prepare('new@pay.test', 'Z Ltd', 'Zed', 1, 'weekly'); e := 'allowed'; exception when others then e := sqlstate; end;
  if e <> '22023' then raise exception 'bad billing not refused: %', e; end if;
  reset role;
end $$;
select 'pay first: a confirmed account, an old login, an unknown email and bad details are all refused' as test, true as ok;
do $$ begin set local role service_role; insert into pp select * from signup_prepare('NEW@pay.test', '  zed trading ltd ', 'zed jones', 3, 'annual'); reset role; end $$;
select 'pay first: a new unconfirmed sign-up gets an unpaid company, its head-office user and its sites (names tidied)' as test,
  (select sites = 3 and billing_interval = 'annual' and email = 'new@pay.test' from pp)
  and (select name = 'Zed Trading Ltd' and subscription = 'trial' and not company_access_ok(id) and billing_interval = 'annual' and source = 'self_signup' from companies where name = 'Zed Trading Ltd')
  and (select count(*) = 3 from properties where company_id = (select id from companies where name = 'Zed Trading Ltd'))
  and (select role = 'client_super' and full_name = 'Zed Jones' from profiles where id = '00000000-0000-0000-0000-0000000000d1') as ok;
select 'pay first: nothing opens until payment: the new account is awaiting payment' as test,
  (select state = 'awaiting_payment' from (select (case when c.subscription = 'trial' and not company_access_ok(c.id) then 'awaiting_payment' else 'ok' end) as state from companies c where c.name = 'Zed Trading Ltd') x) as ok;
do $$ begin set local role service_role; delete from pp; insert into pp select * from signup_prepare('new@pay.test', 'Zed Trading Ltd', 'Zed Jones', 2, 'monthly'); reset role; end $$;
select 'pay first: coming back from the Stripe page re-uses the same company with the new details, no duplicates' as test,
  (select count(*) = 1 from companies where name = 'Zed Trading Ltd') and (select billing_interval = 'monthly' from companies where name = 'Zed Trading Ltd')
  and (select count(*) = 2 from properties where company_id = (select id from companies where name = 'Zed Trading Ltd')) as ok;
update companies set subscription = 'active' where name = 'Zed Trading Ltd';
do $$ declare e text; begin set local role service_role;
  begin perform signup_prepare('new@pay.test', 'Zed Trading Ltd', 'Zed Jones', 2, 'monthly'); e := 'allowed'; exception when others then e := sqlstate; end;
  reset role; if e <> '23505' then raise exception 'paid account could be re-prepared: %', e; end if; end $$;
select 'pay first: once paid, the sign-up cannot be re-prepared or re-priced' as test, true as ok;
rollback;
