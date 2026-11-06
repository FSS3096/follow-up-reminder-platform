-- Local RLS + state-machine checks. Run by supabase/tests/run_local.sh against a throwaway
-- Postgres 15/16 (NOT against the real project: it inserts fixture rows).
-- Every line marked EXPECT ERROR must print an ERROR; everything else must succeed.
\set ON_ERROR_STOP 0
insert into auth.users values ('11111111-1111-1111-1111-111111111111'),('22222222-2222-2222-2222-222222222222'),('33333333-3333-3333-3333-333333333333');
insert into staff values ('11111111-1111-1111-1111-111111111111','Dr Test','doctor'),('22222222-2222-2222-2222-222222222222','Rita','receptionist');
insert into patients (id,name,phone_e164) values ('aaaaaaaa-0000-0000-0000-000000000001','Sita Fake','+910000000001');
insert into followups (id,patient_id,patient_name_raw,doctor_id,followup_date,date_source,raw_note) values
 ('f0000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Sita','11111111-1111-1111-1111-111111111111','2026-11-11','relative','Sita 5 din baad');
insert into reminders (followup_id,kind,scheduled_for) values
 ('f0000000-0000-0000-0000-000000000001','confirmation',now()-interval '1 min'),
 ('f0000000-0000-0000-0000-000000000001','day_before',now()-interval '1 min'),
 ('f0000000-0000-0000-0000-000000000001','morning_of',now()+interval '1 day');

\echo === ANON: every select must be permission denied
set role anon;
select 'staff', count(*) from staff;
select 'patients', count(*) from patients;
select 'followups', count(*) from followups;
select 'reminders', count(*) from reminders;
select claim_due_reminders(1);  -- EXPECT ERROR
reset role;

\echo === AUTHENTICATED NON-STAFF: zero rows
set role authenticated; set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select 'patients', count(*) from patients; select 'followups', count(*) from followups; select 'staff', count(*) from staff;
reset role;

\echo === RECEPTIONIST: sees rows, own staff row only, cannot approve, cannot write reminders, cannot claim
set role authenticated; set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select 'followups', count(*) from followups; select 'staff', count(*) from staff;
update followups set status='approved', raw_note=null where id='f0000000-0000-0000-0000-000000000001';
update reminders set status='sent';
select claim_due_reminders(1);
insert into followups (patient_name_raw,doctor_id,followup_date,date_source,status) values ('X','11111111-1111-1111-1111-111111111111','2026-11-11','default','approved');
reset role;

\echo === DOCTOR: approve without nulling raw_note fails, with null succeeds, illegal jump fails
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
update followups set status='approved' where id='f0000000-0000-0000-0000-000000000001';
update followups set status='approved', raw_note=null, approved_at=now() where id='f0000000-0000-0000-0000-000000000001';
update followups set status='draft' where id='f0000000-0000-0000-0000-000000000001';
update followups set doctor_id='22222222-2222-2222-2222-222222222222' where id='f0000000-0000-0000-0000-000000000001';
select status, raw_note is null as note_nulled from followups;
reset role;

\echo === SERVICE ROLE: claim returns only due reminders, second claim returns nothing
set role service_role;
select kind, status, attempts from claim_due_reminders(25) order by kind;
select count(*) as second_claim from claim_due_reminders(25);
reset role;
