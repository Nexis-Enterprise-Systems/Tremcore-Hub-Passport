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
  begin perform signup_company('Acme','Pat','Main site'); raise exception 'sign-up worked while closed';
  exception when insufficient_privilege then null; end;
  reset role;
end $$;
select 'signup: refused while switched off' as test, true as ok;
do $$ begin
  set local role anon;
  begin perform count(*) from app_settings; raise exception 'anon read settings'; exception when insufficient_privilege then null; end;
  begin perform signup_company('X','Y','Z'); raise exception 'anon signed up'; exception when insufficient_privilege then null; end;
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
  perform signup_company('  Acme Cafes Ltd ','Pat Jones','Acme High Street','1 High Street');
  reset role;
end $$;
select 'signup: creates a Level 1 trial company with no charge, no matter what is asked' as test,
  exists (select 1 from companies where name='Acme Cafes Ltd' and level=1 and subscription='trial' and monthly_value_pence=0 and source='self_signup' and contact_email='new1@acme.test') as ok;
select 'signup: person becomes the head-office user with full rights' as test,
  exists (select 1 from profiles p join companies c on c.id=p.company_id where p.id='00000000-0000-0000-0000-0000000000d1' and p.role='client_super' and p.perm='full' and c.name='Acme Cafes Ltd') as ok;
select 'signup: first site is created under that company' as test,
  exists (select 1 from properties pr join companies c on c.id=pr.company_id where c.name='Acme Cafes Ltd' and pr.name='Acme High Street' and pr.address='1 High Street') as ok;
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
  begin perform signup_company('Second','Pat','Site'); raise exception 'second sign-up worked'; exception when unique_violation then null; end;
  -- email not confirmed
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d2', true);
  begin perform signup_company('Ghost Ltd','Ghost','Site'); raise exception 'unconfirmed email worked'; exception when insufficient_privilege then null; end;
  -- bad details
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d3', true);
  begin perform signup_company('','Pat','Site'); raise exception 'empty company worked'; exception when invalid_parameter_value then null; end;
  begin perform signup_company('Co','','Site'); raise exception 'empty name worked'; exception when invalid_parameter_value then null; end;
  begin perform signup_company('Co','Pat',''); raise exception 'empty site worked'; exception when invalid_parameter_value then null; end;
  begin perform signup_company(repeat('x',161),'Pat','Site'); raise exception 'long company worked'; exception when invalid_parameter_value then null; end;
  begin perform signup_company('Co','Pat','Site',null,'weekly'); raise exception 'odd billing choice worked'; exception when invalid_parameter_value then null; end;
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
  perform signup_company('Annual Co','Sam','Annual Site',null,'annual');
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
  perform signup_company('BigCo','Owner','HQ');
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
  perform signup_company('BigCo Second Site','Other','HQ2');
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000e3', true);
  perform signup_company('Jo Trading','Jo','Shop');
  reset role;
end $$;
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
select 'extras: Toolbox Talks is 3.99 per company; Staff Sign In/Out is 6.99 per site' as test,
  (select price_pence=399 and charged_per='company' from extras where code='toolbox_talks') and (select price_pence=699 and charged_per='site' from extras where code='staff_signin') as ok;
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
select * from chk('setup: super admin ticks three checks; they go onto both sites (6 items)', :'superA', 'aal2',
  $$select finish_setup('01634 000000','1 High St, Rochester', array['fra','pat','legionella']) = 6$$);
select 'setup: the new items have no date, so they show as missing, never green' as test,
  (select count(*)=6 and bool_and(due_date is null) from compliance_items where title in ('Fire Risk Assessment','PAT Testing','Legionella (water) Risk Management') and created_by='00000000-0000-0000-0000-0000000000a2') as ok;
select 'setup: marked done, with the contact details saved' as test,
  (select setup_completed_at is not null and contact_phone='01634 000000' and address like '1 High St%' from companies where id='10000000-0000-0000-0000-00000000000a') as ok;
select * from chk('setup: running it again does not duplicate anything', :'superA', 'aal2',
  $$select finish_setup(null,null,array['fra','pat']) = 0$$);
do $$ begin
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a2', true);
  perform set_config('request.jwt.claims','{"aal":"aal2"}', true);
  set local role authenticated;
  begin perform finish_setup(null,null,array['not_a_check']); raise exception 'odd code accepted'; exception when invalid_parameter_value then null; end;
  reset role;
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a3', true);
  perform set_config('request.jwt.claims','{"aal":"aal1"}', true);
  set local role authenticated;
  begin perform finish_setup(null,null,array['fra']); raise exception 'site user finished set-up'; exception when insufficient_privilege then null; end;
  reset role;
end $$;
select 'setup: an unknown check is refused, and a site user cannot run the set-up' as test, true as ok;
select 'setup: another company got nothing' as test, (select count(*)=0 from compliance_items where property_id='20000000-0000-0000-0000-0000000000b1' and title='Fire Risk Assessment') as ok;
rollback;
