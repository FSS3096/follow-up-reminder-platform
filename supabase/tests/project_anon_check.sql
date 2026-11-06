-- Read-only check to paste into the Supabase SQL editor after applying migrations.
-- Proves the anon role cannot read any table or call the claim function.
-- Expected output: five rows, every one with result = 'denied (ok)'.
begin;
create temporary table _anon_check (object text, result text) on commit drop;
grant all on _anon_check to anon;
set local role anon;
do $$
declare t text;
begin
  foreach t in array array['staff','patients','followups','reminders'] loop
    begin
      execute format('select count(*) from public.%I', t);
      insert into _anon_check values (t, 'READABLE (FAIL)');
    exception when insufficient_privilege then
      insert into _anon_check values (t, 'denied (ok)');
    end;
  end loop;
  begin
    perform public.claim_due_reminders(1);
    insert into _anon_check values ('claim_due_reminders()', 'CALLABLE (FAIL)');
  exception when insufficient_privilege then
    insert into _anon_check values ('claim_due_reminders()', 'denied (ok)');
  end;
end $$;
reset role;
select * from _anon_check order by object;
rollback;
