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
insert into companies(id,name,level,require_mfa) values
 ('10000000-0000-0000-0000-00000000000a','Company A (L1)',1,false),
 ('10000000-0000-0000-0000-00000000000b','Company B (L2)',2,false),
 ('10000000-0000-0000-0000-00000000000c','Company C (L3)',3,false);
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
