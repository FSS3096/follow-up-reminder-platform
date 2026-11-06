# Deploy

Status: **B1 (database) only.** Vercel, Twilio webhook and cron-job.org steps are added in B9.
Steps marked **[human]** are account / console work that agents must not do (Brief section 9).

## 1. Supabase project [human]

1. Create a free Supabase project (region close to India, e.g. Mumbai `ap-south-1`).
2. Copy into Vercel env / local `.env.local` (never into chat, commits or screenshots):
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
3. Free projects can pause after inactivity. The 5-minute tick (B6/B9) keeps it warm; re-check the current
   pause policy on supabase.com before demo day.

## 2. Apply migrations

Pick one.

**A. SQL editor (no CLI):** Dashboard -> SQL Editor -> run, in order and one at a time:
`supabase/migrations/0001_init.sql`, `0002_rls.sql`, `0003_functions.sql`.

**B. Supabase CLI:**
```bash
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase db push          # applies supabase/migrations in order
```

## 3. Prove `anon` cannot read anything

Run `supabase/tests/project_anon_check.sql` in the SQL editor. It is read-only (runs in a transaction that rolls back).
Expected: five rows, every `result` = `denied (ok)`.

Optional live check from a laptop:
```bash
RUN_DB_CHECKS=true NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_ANON_KEY=... npm test -- tests/integration/rls
```

Offline (no project needed, Postgres 15+ binaries on PATH, e.g. `brew install postgresql@16`):
```bash
./supabase/tests/run_local.sh
```
Applies the migrations to a throwaway local Postgres with a minimal Supabase stand-in and checks: anon denied,
non-staff sees nothing, receptionist cannot approve or touch reminders, doctor approve requires `raw_note = null`,
illegal transitions rejected, `claim_due_reminders` claims only due rows and never the same row twice.
Lines in the `ANON`, `RECEPTIONIST` and `DOCTOR` sections are expected to print `ERROR`.

## 4. Staff users (doctor + receptionist) [human]

Two fictional staff accounts for the demo.

1. Dashboard -> Authentication -> Users -> **Add user** -> *Create new user*, tick *Auto confirm*:
   - `doctor@quicknotes.test` (Dr. Mehra, fictional)
   - `reception@quicknotes.test` (Rita, fictional)
   Use strong passwords and keep them in the password manager, not in the repo.
2. SQL editor:
   ```sql
   insert into public.staff (id, name, role)
   select id, 'Dr. Mehra', 'doctor' from auth.users where email = 'doctor@quicknotes.test'
   union all
   select id, 'Rita', 'receptionist' from auth.users where email = 'reception@quicknotes.test'
   on conflict (id) do update set name = excluded.name, role = excluded.role;

   select s.name, s.role, u.email from public.staff s join auth.users u on u.id = s.id;  -- expect 2 rows
   ```
3. Turn off public sign-ups (Authentication -> Providers -> Email -> *Allow new users to sign up* off).
   A random sign-up would have no `staff` row and gets `403 STAFF_NOT_FOUND`, but there is no reason to allow it.

## 5. Regenerate DB types (after step 2)

```bash
npx supabase gen types typescript --project-id <project-ref> --schema public > /tmp/db.ts
```
Replace the `Database` type in `lib/supabase/types.ts` with the generated one and keep the exported aliases at the
bottom of that file. Then `npm run typecheck`.
