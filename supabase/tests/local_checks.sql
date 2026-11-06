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

-- ===== 0004 followup functions =====
\echo === 0004 setup (superuser)
reset role;
delete from reminders; delete from followups;
insert into followups (id,patient_id,patient_name_raw,doctor_id,followup_date,date_source,raw_note) values
 ('f4000000-0000-0000-0000-000000000001',null,'Kamla','11111111-1111-1111-1111-111111111111',current_date + 5,'relative','Kamla 5 din baad'),
 ('f4000000-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','Sita','11111111-1111-1111-1111-111111111111',current_date + 5,'relative','Sita 5 din baad');

\echo === RECEPTIONIST cannot approve (EXPECT ERROR 42501)
set role authenticated; set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select approve_followup('f4000000-0000-0000-0000-000000000002', null, null, null, null, current_date + 5, null, 'p',
  '[{"kind":"confirmation","scheduled_for":"2030-01-01T00:00:00Z","status":"pending"}]');
reset role;

\echo === DOCTOR approve unmatched without patient (EXPECT ERROR PATIENT_NEEDS_PHONE)
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select approve_followup('f4000000-0000-0000-0000-000000000001', null, null, null, null, current_date + 5, null, 'p',
  '[{"kind":"confirmation","scheduled_for":"2030-01-01T00:00:00Z","status":"pending"}]');

\echo === DOCTOR approve with a bad plan (EXPECT ERROR INVALID_REMINDER_PLAN x3)
select approve_followup('f4000000-0000-0000-0000-000000000002', null, null, null, null, current_date + 5, null, 'p', '[]');
select approve_followup('f4000000-0000-0000-0000-000000000002', null, null, null, null, current_date + 5, null, 'p',
  '[{"kind":"missed_nudge","scheduled_for":"2030-01-01T00:00:00Z","status":"pending"}]');
select approve_followup('f4000000-0000-0000-0000-000000000002', null, null, null, null, current_date + 5, null, 'p',
  '[{"kind":"confirmation","scheduled_for":"2030-01-01T00:00:00Z","status":"sent"}]');

\echo === DOCTOR approve with a past date (EXPECT ERROR INVALID_FOLLOWUP_DATE)
select approve_followup('f4000000-0000-0000-0000-000000000002', null, null, null, null, current_date - 2, null, 'p',
  '[{"kind":"confirmation","scheduled_for":"2030-01-01T00:00:00Z","status":"pending"}]');

\echo === DOCTOR approve unmatched with newPatient: OK, creates patient, nulls raw_note
select status, patient_id is not null as has_patient, raw_note is null as note_nulled, approved_at is not null as approved
from approve_followup('f4000000-0000-0000-0000-000000000001', null, 'Kamla Devi', '+910000000099', 'hindi', current_date + 6, '17:00', 'preview',
  '[{"kind":"confirmation","scheduled_for":"2030-01-01T00:00:00Z","status":"pending"},
    {"kind":"day_before","scheduled_for":"2030-01-02T00:00:00Z","status":"pending"},
    {"kind":"morning_of","scheduled_for":"2020-01-03T00:00:00Z","status":"skipped","skip_reason":"in_past"}]');

\echo === second approve of the same followup (EXPECT ERROR NOT_DRAFT), still 3 reminders
select approve_followup('f4000000-0000-0000-0000-000000000001', null, 'Kamla Devi', '+910000000099', 'hindi', current_date + 6, null, 'p',
  '[{"kind":"confirmation","scheduled_for":"2030-01-01T00:00:00Z","status":"pending"}]');
select count(*) as reminders_after_double_approve from reminders where followup_id = 'f4000000-0000-0000-0000-000000000001';

\echo === approve matched draft: OK
select status from approve_followup('f4000000-0000-0000-0000-000000000002', null, null, null, null, current_date + 5, null, 'p',
  '[{"kind":"confirmation","scheduled_for":"2030-01-01T00:00:00Z","status":"pending"}]');
reset role;

\echo === RECEPTIONIST reschedule: pending cancelled -> replanned, sending row untouched
reset role;
update reminders set status = 'sending' where followup_id = 'f4000000-0000-0000-0000-000000000001' and kind = 'day_before';
update followups set status = 'reschedule_requested', attention_reason = 'reschedule_requested' where id = 'f4000000-0000-0000-0000-000000000001';
set role authenticated; set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select status, attention_reason, followup_date = current_date + 9 as new_date
from reschedule_followup('f4000000-0000-0000-0000-000000000001', current_date + 9, null, 'p2',
  '[{"kind":"confirmation","scheduled_for":"2031-01-01T00:00:00Z","status":"pending"},
    {"kind":"day_before","scheduled_for":"2031-01-02T00:00:00Z","status":"pending"},
    {"kind":"morning_of","scheduled_for":"2031-01-03T00:00:00Z","status":"pending"}]');
select kind, status, scheduled_for > '2030-06-01' as replanned from reminders where followup_id = 'f4000000-0000-0000-0000-000000000001' order by kind;

\echo === RECEPTIONIST marks Arrived: completed, pending reminders cancelled
select status, completed_at is not null as completed_at_set from set_followup_status('f4000000-0000-0000-0000-000000000001', 'completed');
select kind, status from reminders where followup_id = 'f4000000-0000-0000-0000-000000000001' order by kind;

\echo === completed is terminal (EXPECT ERROR ILLEGAL_TRANSITION x2), reschedule refused (EXPECT ERROR NOT_RESCHEDULABLE)
select set_followup_status('f4000000-0000-0000-0000-000000000001', 'cancelled');
select set_followup_status('f4000000-0000-0000-0000-000000000001', 'completed');
select reschedule_followup('f4000000-0000-0000-0000-000000000001', current_date + 9, null, 'p',
  '[{"kind":"confirmation","scheduled_for":"2031-01-01T00:00:00Z","status":"pending"}]');

\echo === set_followup_status rejects other statuses (EXPECT ERROR INVALID_STATUS)
select set_followup_status('f4000000-0000-0000-0000-000000000002', 'confirmed');

\echo === cancel an approved followup
select status from set_followup_status('f4000000-0000-0000-0000-000000000002', 'cancelled');
select count(*) filter (where status = 'pending') as pending_left from reminders where followup_id = 'f4000000-0000-0000-0000-000000000002';
reset role;

\echo === ANON cannot call any of them (EXPECT ERROR x3)
set role anon;
select set_followup_status('f4000000-0000-0000-0000-000000000002', 'cancelled');
select reschedule_followup('f4000000-0000-0000-0000-000000000002', current_date, null, 'p', '[]');
select approve_followup('f4000000-0000-0000-0000-000000000002', null, null, null, null, current_date, null, 'p', '[]');
reset role;

\echo === authenticated cannot call the internal helper (EXPECT ERROR)
set role authenticated;
select _write_planned_reminders('f4000000-0000-0000-0000-000000000002', '[]');
reset role;
