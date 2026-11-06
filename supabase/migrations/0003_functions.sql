-- 0003_functions.sql : atomic claim so overlapping ticks never double-send.
-- FOR UPDATE SKIP LOCKED means two concurrent callers get disjoint batches.

create or replace function claim_due_reminders(batch_size int default 25)
returns setof reminders
language sql security definer set search_path = public as $$
  update reminders r
     set status = 'sending', claimed_at = now(), attempts = attempts + 1
   where r.id in (
     select id from reminders
      where status = 'pending' and scheduled_for <= now()
      order by scheduled_for
      limit batch_size
      for update skip locked)
  returning r.*;
$$;
revoke all on function claim_due_reminders(int) from public, anon, authenticated;
grant execute on function claim_due_reminders(int) to service_role;
