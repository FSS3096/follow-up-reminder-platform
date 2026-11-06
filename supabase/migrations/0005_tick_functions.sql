-- 0005_tick_functions.sql : atomic helpers for the cron tick (Brief B6). service_role only.

-- (1) Reminders stuck in 'sending' (a tick crashed mid-send) go back to pending, or to failed
--     once they have used all attempts. Returns the number of rows touched.
create or replace function recover_stuck_reminders(p_older_than interval default interval '10 minutes', p_max_attempts int default 3)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  with stuck as (
    select id, attempts from reminders
     where status = 'sending' and claimed_at < now() - p_older_than
     for update skip locked
  )
  update reminders r
     set status = case when stuck.attempts >= p_max_attempts then 'failed'::reminder_status else 'pending'::reminder_status end,
         last_error = coalesce(r.last_error, 'recovered after stuck send'),
         claimed_at = null
    from stuck
   where r.id = stuck.id;
  get diagnostics n = row_count;

  -- surface permanently failed ones to the receptionist
  update followups f
     set attention_reason = 'send_failed'
   where f.attention_reason is null
     and f.status in ('approved', 'confirmed', 'missed')
     and exists (select 1 from reminders r where r.followup_id = f.id and r.status = 'failed'
                   and r.last_error = 'recovered after stuck send');
  return n;
end;
$$;

-- (5) Missed logic: active followups whose date is more than one day in the past become 'missed',
--     their pending reminders are cancelled and exactly one missed_nudge is planned.
--     Idempotent: a followup is only ever marked once, and the nudge is unique per followup.
create or replace function mark_missed_followups(p_cutoff date, p_nudge_at timestamptz)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  ids uuid[];
begin
  with candidates as (
    select id from followups
     where status in ('approved', 'confirmed', 'reschedule_requested')
       and followup_date < p_cutoff
     for update skip locked
  ), updated as (
    update followups f
       set status = 'missed', missed_at = now()
      from candidates c
     where f.id = c.id
    returning f.id
  )
  select coalesce(array_agg(id), '{}') into ids from updated;

  if array_length(ids, 1) is null then
    return 0;
  end if;

  update reminders set status = 'cancelled'
   where followup_id = any(ids) and status = 'pending';

  insert into reminders (followup_id, kind, scheduled_for, status)
  select unnest(ids), 'missed_nudge', p_nudge_at, 'pending'
  on conflict (followup_id, kind) do nothing;

  return array_length(ids, 1);
end;
$$;

-- Approve's inline confirmation send: claim one specific due reminder (same rules as the batch claim).
create or replace function claim_reminder(p_followup_id uuid, p_kind reminder_kind)
returns setof reminders
language sql security definer set search_path = public as $$
  update reminders r
     set status = 'sending', claimed_at = now(), attempts = attempts + 1
   where r.id = (
     select id from reminders
      where followup_id = p_followup_id and kind = p_kind
        and status = 'pending' and scheduled_for <= now()
      for update skip locked)
  returning r.*;
$$;

revoke all on function recover_stuck_reminders(interval, int) from public, anon, authenticated;
revoke all on function mark_missed_followups(date, timestamptz) from public, anon, authenticated;
revoke all on function claim_reminder(uuid, reminder_kind) from public, anon, authenticated;
grant execute on function recover_stuck_reminders(interval, int) to service_role;
grant execute on function mark_missed_followups(date, timestamptz) to service_role;
grant execute on function claim_reminder(uuid, reminder_kind) to service_role;
