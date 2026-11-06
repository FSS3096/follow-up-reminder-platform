-- 0002_rls.sql : row level security (Brief section 3, RLS).
--   authenticated staff : select/insert/update patients + followups, select reminders
--   staff table         : select own row only
--   anon                : nothing (no policies AND no table privileges)
--   reminder writes     : service role only (server-side)

alter table staff     enable row level security;
alter table patients  enable row level security;
alter table followups enable row level security;
alter table reminders enable row level security;

-- Defence in depth: RLS with no policy already denies anon, but also remove the
-- table grants Supabase gives anon by default so even a future permissive policy
-- cannot expose data to the anon key.
revoke all on table staff, patients, followups, reminders from anon;
revoke all on table staff, patients, followups, reminders from authenticated;
grant select on table staff to authenticated;
grant select, insert, update on table patients, followups to authenticated;
grant select on table reminders to authenticated;

-- Helpers. SECURITY DEFINER so policies on other tables can look up staff without
-- depending on (or recursing through) the staff table's own policy.
create or replace function is_staff()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff where id = auth.uid());
$$;

create or replace function current_staff_role()
returns text
language sql stable security definer set search_path = public as $$
  select role from staff where id = auth.uid();
$$;

revoke all on function is_staff() from public, anon;
revoke all on function current_staff_role() from public, anon;
grant execute on function is_staff() to authenticated, service_role;
grant execute on function current_staff_role() to authenticated, service_role;

-- staff: own row only
create policy staff_select_own on staff
  for select to authenticated
  using (id = auth.uid());

-- patients
create policy patients_select_staff on patients
  for select to authenticated using (is_staff());
create policy patients_insert_staff on patients
  for insert to authenticated with check (is_staff());
create policy patients_update_staff on patients
  for update to authenticated using (is_staff()) with check (is_staff());

-- followups (new rows from a user session are always drafts)
create policy followups_select_staff on followups
  for select to authenticated using (is_staff());
create policy followups_insert_staff on followups
  for insert to authenticated with check (is_staff() and status = 'draft');
create policy followups_update_staff on followups
  for update to authenticated using (is_staff()) with check (is_staff());

-- reminders: read-only for staff
create policy reminders_select_staff on reminders
  for select to authenticated using (is_staff());

-- State-machine guard for writes that come from a user session (role "authenticated").
-- RLS allows staff to UPDATE followups, which would otherwise let any staff session
-- approve or jump states directly through PostgREST. Server jobs (service_role) are
-- not restricted here; lib/* enforces the same machine for them.
create or replace function followups_user_update_guard()
returns trigger
language plpgsql set search_path = public as $$
declare
  allowed boolean;
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  if new.doctor_id is distinct from old.doctor_id
     or new.is_seed is distinct from old.is_seed
     or new.parsed_at is distinct from old.parsed_at
     or new.created_at is distinct from old.created_at then
    raise exception 'immutable followup column changed' using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    allowed := case old.status
      when 'draft'                then new.status in ('approved','cancelled')
      when 'approved'             then new.status in ('confirmed','reschedule_requested','completed','missed','cancelled')
      when 'confirmed'            then new.status in ('completed','missed','cancelled')
      when 'reschedule_requested' then new.status in ('approved','completed','missed','cancelled')
      else false                       -- completed, missed, cancelled are terminal
    end;
    if not allowed then
      raise exception 'illegal followup transition % -> %', old.status, new.status using errcode = '42501';
    end if;
    if old.status = 'draft' and new.status = 'approved' and current_staff_role() is distinct from 'doctor' then
      raise exception 'only a doctor can approve a followup' using errcode = '42501';
    end if;
  end if;

  -- Data minimisation: a note may only exist on a draft.
  if new.status <> 'draft' and new.raw_note is not null then
    raise exception 'raw_note must be null once a followup leaves draft' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger followups_user_update_guard
  before update on followups
  for each row execute function followups_user_update_guard();
