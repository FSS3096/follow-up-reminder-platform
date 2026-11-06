-- 0004_followup_functions.sql : transactional followup writes (Brief B4).
-- supabase-js has no client-side transactions, so approve / reschedule / status change run
-- as single SQL functions. The reminder plan itself is computed in TypeScript (lib/reminders/plan.ts,
-- pure and tested) and passed in as JSON; these functions validate it and write atomically.
--
-- Errors use custom SQLSTATEs that lib/http maps to HTTP:
--   QN404 -> 404 NOT_FOUND, QN409 -> 409 CONFLICT, QN422 -> 422 (message = error code), 42501 -> 403

-- Validates and writes planned reminders for a followup. Internal helper (not granted).
create or replace function _write_planned_reminders(p_followup_id uuid, p_reminders jsonb)
returns void
language plpgsql set search_path = public as $$
declare
  r record;
begin
  if p_reminders is null or jsonb_typeof(p_reminders) <> 'array' or jsonb_array_length(p_reminders) = 0 then
    raise exception using errcode = 'QN422', message = 'INVALID_REMINDER_PLAN';
  end if;

  for r in
    select * from jsonb_to_recordset(p_reminders)
      as x(kind reminder_kind, scheduled_for timestamptz, status reminder_status, skip_reason text)
  loop
    if r.kind is null or r.scheduled_for is null or r.status is null
       or r.kind = 'missed_nudge'
       or r.status not in ('pending', 'skipped')
       or (r.status = 'skipped' and r.skip_reason is distinct from 'in_past')
       or (r.status = 'pending' and r.skip_reason is not null) then
      raise exception using errcode = 'QN422', message = 'INVALID_REMINDER_PLAN';
    end if;

    insert into reminders (followup_id, kind, scheduled_for, status, skip_reason)
    values (p_followup_id, r.kind, r.scheduled_for, r.status, r.skip_reason)
    on conflict (followup_id, kind) do update
      set scheduled_for = excluded.scheduled_for,
          status = excluded.status,
          skip_reason = excluded.skip_reason,
          attempts = 0,
          provider = null,
          provider_message_sid = null,
          last_error = null,
          claimed_at = null,
          sent_at = null
      -- never touch a row a tick is sending right now
      where reminders.status <> 'sending';
  end loop;
end;
$$;
revoke all on function _write_planned_reminders(uuid, jsonb) from public, anon, authenticated;

create or replace function _ist_today()
returns date
language sql stable set search_path = public as $$
  select (now() at time zone 'Asia/Kolkata')::date;
$$;

-- ---------------------------------------------------------------------------
-- approve: the doctor's one tap
-- ---------------------------------------------------------------------------
create or replace function approve_followup(
  p_followup_id uuid,
  p_patient_id uuid,
  p_new_patient_name text,
  p_new_patient_phone text,
  p_new_patient_language text,
  p_followup_date date,
  p_followup_time time,
  p_message_preview text,
  p_reminders jsonb
)
returns followups
language plpgsql security definer set search_path = public as $$
declare
  f followups;
  v_patient uuid;
begin
  if current_staff_role() is distinct from 'doctor' then
    raise exception using errcode = '42501', message = 'only a doctor can approve a followup';
  end if;

  select * into f from followups where id = p_followup_id for update;
  if not found then
    raise exception using errcode = 'QN404', message = 'NOT_FOUND';
  end if;
  if f.status <> 'draft' then
    raise exception using errcode = 'QN409', message = 'NOT_DRAFT', detail = f.status::text;
  end if;

  if p_followup_date is null or p_followup_date < _ist_today() then
    raise exception using errcode = 'QN422', message = 'INVALID_FOLLOWUP_DATE';
  end if;

  if p_patient_id is not null then
    select id into v_patient from patients where id = p_patient_id;
    if v_patient is null then
      raise exception using errcode = 'QN422', message = 'PATIENT_NOT_FOUND';
    end if;
  elsif p_new_patient_name is not null and p_new_patient_phone is not null then
    insert into patients (name, phone_e164, language)
    values (p_new_patient_name, p_new_patient_phone, coalesce(p_new_patient_language, 'hinglish'))
    on conflict (phone_e164, lower(name)) do update set name = patients.name
    returning id into v_patient;
  elsif f.patient_id is not null then
    v_patient := f.patient_id;
  else
    raise exception using errcode = 'QN422', message = 'PATIENT_NEEDS_PHONE';
  end if;

  update followups
     set status = 'approved',
         patient_id = v_patient,
         followup_date = p_followup_date,
         followup_time = p_followup_time,
         message_preview = p_message_preview,
         raw_note = null,
         attention_reason = null,
         approved_at = now()
   where id = f.id
   returning * into f;

  perform _write_planned_reminders(f.id, p_reminders);
  return f;
end;
$$;

-- ---------------------------------------------------------------------------
-- reschedule: receptionist or doctor moves an active followup
-- ---------------------------------------------------------------------------
create or replace function reschedule_followup(
  p_followup_id uuid,
  p_followup_date date,
  p_followup_time time,
  p_message_preview text,
  p_reminders jsonb
)
returns followups
language plpgsql security definer set search_path = public as $$
declare
  f followups;
begin
  if not is_staff() then
    raise exception using errcode = '42501', message = 'staff only';
  end if;

  select * into f from followups where id = p_followup_id for update;
  if not found then
    raise exception using errcode = 'QN404', message = 'NOT_FOUND';
  end if;
  if f.status not in ('approved', 'confirmed', 'reschedule_requested') then
    raise exception using errcode = 'QN409', message = 'NOT_RESCHEDULABLE', detail = f.status::text;
  end if;
  if p_followup_date is null or p_followup_date < _ist_today() then
    raise exception using errcode = 'QN422', message = 'INVALID_FOLLOWUP_DATE';
  end if;

  update reminders
     set status = 'cancelled'
   where followup_id = f.id and status in ('pending', 'failed');

  update followups
     set status = 'approved',
         followup_date = p_followup_date,
         followup_time = p_followup_time,
         message_preview = p_message_preview,
         attention_reason = null,
         confirmed_at = null
   where id = f.id
   returning * into f;

  perform _write_planned_reminders(f.id, p_reminders);
  return f;
end;
$$;

-- ---------------------------------------------------------------------------
-- status: "Arrived" (completed) or cancel
-- ---------------------------------------------------------------------------
create or replace function set_followup_status(p_followup_id uuid, p_status followup_status)
returns followups
language plpgsql security definer set search_path = public as $$
declare
  f followups;
begin
  if not is_staff() then
    raise exception using errcode = '42501', message = 'staff only';
  end if;
  if p_status not in ('completed', 'cancelled') then
    raise exception using errcode = 'QN422', message = 'INVALID_STATUS';
  end if;

  select * into f from followups where id = p_followup_id for update;
  if not found then
    raise exception using errcode = 'QN404', message = 'NOT_FOUND';
  end if;

  if p_status = 'completed' and f.status not in ('approved', 'confirmed', 'reschedule_requested') then
    raise exception using errcode = 'QN409', message = 'ILLEGAL_TRANSITION', detail = f.status::text;
  end if;
  if p_status = 'cancelled' and f.status not in ('draft', 'approved', 'confirmed', 'reschedule_requested') then
    raise exception using errcode = 'QN409', message = 'ILLEGAL_TRANSITION', detail = f.status::text;
  end if;

  update reminders
     set status = 'cancelled'
   where followup_id = f.id and status in ('pending', 'failed');

  update followups
     set status = p_status,
         completed_at = case when p_status = 'completed' then now() else completed_at end,
         raw_note = null,
         attention_reason = null
   where id = f.id
   returning * into f;

  return f;
end;
$$;

revoke all on function approve_followup(uuid, uuid, text, text, text, date, time, text, jsonb) from public, anon;
revoke all on function reschedule_followup(uuid, date, time, text, jsonb) from public, anon;
revoke all on function set_followup_status(uuid, followup_status) from public, anon;
grant execute on function approve_followup(uuid, uuid, text, text, text, date, time, text, jsonb) to authenticated;
grant execute on function reschedule_followup(uuid, date, time, text, jsonb) to authenticated;
grant execute on function set_followup_status(uuid, followup_status) to authenticated;
revoke all on function _ist_today() from public, anon;
grant execute on function _ist_today() to authenticated, service_role;
