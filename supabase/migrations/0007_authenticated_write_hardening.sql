-- Restrict authenticated PostgREST writes to the operations exposed by the application.
-- Lifecycle transitions are implemented by the validated SECURITY DEFINER RPCs in 0004;
-- inbound/tick changes use the server-only service role.

-- Existing deployments received broad table UPDATE grants from 0002. Remove those grants,
-- including any inherited per-column permissions, then restore only the columns needed for
-- staff-created patient and draft records.
revoke all on table patients, followups from authenticated;
revoke update (id, name, phone_e164, language, opted_out, last_inbound_at, last_auto_reply_at, is_seed, created_at)
  on table patients from authenticated;
revoke update (id, patient_id, patient_name_raw, doctor_id, followup_date, followup_time, status, raw_note,
               parse_source, date_source, message_preview, attention_reason, client_input_ms, parsed_at,
               approved_at, confirmed_at, completed_at, missed_at, is_seed, created_at)
  on table followups from authenticated;
grant select on table patients, followups to authenticated;
grant insert (name, phone_e164, language) on table patients to authenticated;
grant insert (patient_id, patient_name_raw, doctor_id, followup_date, followup_time, raw_note,
              parse_source, date_source, message_preview, attention_reason, client_input_ms)
  on table followups to authenticated;

drop policy if exists patients_update_staff on patients;
drop policy if exists followups_update_staff on followups;
drop policy if exists followups_insert_staff on followups;
create policy followups_insert_staff on followups
  for insert to authenticated with check (is_staff() and status = 'draft' and doctor_id = auth.uid());

-- Defense in depth: if a future migration accidentally restores UPDATE privileges, direct
-- authenticated mutations cannot clear opt-out, alter seed state, or rewrite lifecycle data.
create or replace function patients_authenticated_update_guard()
returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user = 'authenticated' then
    if new.opted_out is distinct from old.opted_out then
      raise exception 'patient opt-out is server managed' using errcode = '42501';
    end if;
    if new.is_seed is distinct from old.is_seed then
      raise exception 'patient seed marker is immutable' using errcode = '42501';
    end if;
    if old.is_seed and new.phone_e164 is distinct from old.phone_e164 then
      raise exception 'seed patient phone is immutable' using errcode = '42501';
    end if;
    if new.last_inbound_at is distinct from old.last_inbound_at
       or new.last_auto_reply_at is distinct from old.last_auto_reply_at then
      raise exception 'inbound timestamps are server managed' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
create trigger patients_authenticated_update_guard
  before update on patients
  for each row execute function patients_authenticated_update_guard();

create or replace function followups_authenticated_update_guard()
returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user = 'authenticated' then
    raise exception 'follow-up updates must use the validated server operation' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger followups_authenticated_update_guard
  before update on followups
  for each row execute function followups_authenticated_update_guard();
