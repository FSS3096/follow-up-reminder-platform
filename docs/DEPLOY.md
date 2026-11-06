# Deploy

Status: database (B1) + app, Twilio and scheduler (B9).
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
`0001_init.sql`, `0002_rls.sql`, `0003_functions.sql`, `0004_followup_functions.sql`, `0005_tick_functions.sql`,
`0006_inbound.sql` (all in `supabase/migrations/`).

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

## 6. Vercel [human]

1. Import the GitHub repo as a Vercel project (Hobby). Framework: Next.js. No build settings to change.
2. Project -> Settings -> Environment Variables (Production and Preview). `lib/env.ts` validates all of them at boot;
   a missing or malformed value makes the deployment refuse to start, with the variable name in the logs.

   | Variable | Value |
   |----------|-------|
   | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | from Supabase -> Project Settings -> API |
   | `SUPABASE_SERVICE_ROLE_KEY` | same page. **Never** with a `NEXT_PUBLIC_` prefix |
   | `CRON_SECRET` | `openssl rand -hex 32` (>= 32 chars) |
   | `APP_BASE_URL` | the production URL, e.g. `https://quick-notes-xyz.vercel.app` (https, no trailing slash) |
   | `MESSAGE_PROVIDER` | `console` first; `twilio_sandbox` once step 7 is done |
   | `ALLOW_LIVE_SEND` | `false` until the demo dry run, then `true` |
   | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`, `TWILIO_SANDBOX_TEMPLATE_CONTENT_SID`, `TWILIO_SANDBOX_JOIN_CODE` | step 7 |
   | `CLINIC_NAME`, `CLINIC_PHONE`, `DEFAULT_DOCTOR_NAME` | fictional clinic |
   | modeled-stats inputs | optional, see `docs/CONTRACTS.md` |

3. Redeploy after changing env (Vercel does not apply env changes to running deployments).
4. `vercel.json` adds a **daily** cron (02:00 UTC = 07:30 IST) on `/api/cron/tick`. Hobby allows one run per day and may
   fire anywhere in that hour, so it is only a backstop. Vercel sends `Authorization: Bearer $CRON_SECRET` on cron
   requests when `CRON_SECRET` is set (re-check the Vercel cron docs before demo day); the route accepts GET and POST.

## 7. Twilio WhatsApp Sandbox [human]

1. Twilio Console -> Messaging -> Try it out -> Send a WhatsApp message. Note the sandbox number and the join code.
2. Every demo phone sends `join <code>` to the sandbox number. **The session expires 3 days after joining**: re-join
   within 3 days of the demo.
3. Sandbox settings -> *When a message comes in*: `https://<APP_BASE_URL host>/api/webhooks/twilio/inbound`, method POST.
   The URL must be exactly `APP_BASE_URL` + path, because the signature is checked against that string.
4. Status callback is set per message by the app (`/api/webhooks/twilio/status`), nothing to configure.
5. Find the Content SID (`HX...`) of the sandbox's pre-approved *Appointment Reminder* template in the Console
   (Content Template Builder / sandbox templates) and put it in `TWILIO_SANDBOX_TEMPLATE_CONTENT_SID`. Do not guess it.
6. Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM=whatsapp:+<sandbox number>`,
   `MESSAGE_PROVIDER=twilio_sandbox`, redeploy.
7. Trial caps: Twilio docs disagree (50/day vs 100 total). Treat 50 messages/day as the ceiling; each approved
   follow-up costs up to 3 messages.

How sends work: inside 24 h of the patient's last message (a `join` counts) the app sends the real Hinglish/English
text; outside it, the sandbox template "Your appointment is coming up on {{1}} at {{2}}" with date + time.

## 8. Scheduler: cron-job.org every 5 minutes [human]

1. cron-job.org -> Create cronjob.
2. URL `https://<APP_BASE_URL host>/api/cron/tick`, schedule every 5 minutes, request method **POST**.
3. Advanced -> Headers: `Authorization: Bearer <CRON_SECRET>`.
4. Enable "notify on failure". Save, then "Run now" and check the response is 200 with JSON counters.

The tick is idempotent and safe to run concurrently (rows are claimed with `FOR UPDATE SKIP LOCKED`), so the
Vercel daily backstop overlapping with cron-job.org is harmless. The 5-minute calls also keep the free Supabase
project from pausing.

## 9. Prove it works (curl)

```bash
export APP=https://<your-app>.vercel.app
export CRON_SECRET=...            # from your password manager

# tick: 401 without / with a wrong bearer, 200 with counters with the right one
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$APP/api/cron/tick"                                   # 401
curl -s -X POST -H "Authorization: Bearer $CRON_SECRET" "$APP/api/cron/tick"
# {"claimed":0,"sent":0,"failed":0,"skipped":0,"deferred":0,"retried":0,"markedMissed":0,"recoveredStuck":0}

# webhook: a forged request is rejected
curl -s -w ' %{http_code}\n' -X POST -H 'Content-Type: application/x-www-form-urlencoded' \
  -H 'X-Twilio-Signature: forged' -d 'From=whatsapp:%2B910000000001&Body=1' "$APP/api/webhooks/twilio/inbound"   # 403

# cross-site write is rejected
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Origin: https://evil.example' "$APP/api/notes/parse"   # 403

# a correctly signed webhook (to test without a phone). Needs TWILIO_AUTH_TOKEN locally; never paste it anywhere.
node -e '
const c=require("crypto"); const url=process.env.APP+"/api/webhooks/twilio/inbound";
const p=new URLSearchParams({From:"whatsapp:+910000000001",Body:"hello",MessageSid:"SMtest00000"});
let d=url; for (const k of [...p.keys()].sort()) d+=k+p.get(k);
console.log(c.createHmac("sha1",process.env.TWILIO_AUTH_TOKEN).update(d).digest("base64"));' > /tmp/sig
curl -s -X POST -H 'Content-Type: application/x-www-form-urlencoded' -H "X-Twilio-Signature: $(cat /tmp/sig)" \
  --data-urlencode 'From=whatsapp:+910000000001' --data-urlencode 'Body=hello' --data-urlencode 'MessageSid=SMtest00000' \
  "$APP/api/webhooks/twilio/inbound"     # 200, TwiML out-of-scope reply (unknown number)
```

## 10. Demo-day checklist

- [ ] Demo phones re-sent `join <code>` less than 3 days ago.
- [ ] `MESSAGE_PROVIDER=twilio_sandbox`, `ALLOW_LIVE_SEND=true`, redeployed.
- [ ] cron-job.org last runs are 200.
- [ ] Real team phones are attached to demo patients via `DEMO_PHONE_1..3` (seed), never committed.
- [ ] Dry run: parse -> approve -> WhatsApp arrives -> reply `1` -> status `confirmed` within one tick.
- [ ] `GET /api/stats` shows `doctorTimeMs.n >= 5`.
- [ ] After the demo: `ALLOW_LIVE_SEND=false`.
