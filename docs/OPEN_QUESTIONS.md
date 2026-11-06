# Open questions

Append only. Format: number, date, raised by, question, default chosen, status.
Brief section 13 questions 1-5 still stand; they are not repeated here.

### OQ-1 (2026-11-06, Claude Code, B0) Where do backend unit tests live?
`tests/**` (except `tests/integration/`) is owned by Codex, but B0 needs tests for env, logging and HTTP helpers.
**Default:** co-located `lib/**/*.test.ts` (Claude Code owns `lib/`). `vitest.config.mts` includes both `tests/**` and `lib/**`.
Codex's suites stay the acceptance tests. Status: open, please confirm.

### OQ-2 (2026-11-06, Claude Code, B0) `test:safety` and `db:seed` before Codex lands C2b / C3
Both scripts exist as required. `npm run test:safety` fails with "No test files found" until `tests/safety/` exists, and
`npm run db:seed` fails until `seed/seed.ts` exists.
**Default:** deliberately no `--passWithNoTests`, so an empty safety suite can never report green. Status: resolves itself when C2b and C3 merge.

### OQ-3 (2026-11-06, Claude Code, B0) `.env.example` is owned by Codex (C4)
Until it lands, the variable list with validation rules is in `docs/CONTRACTS.md` and `lib/env.ts` is the source of truth.
Status: open (Codex).

### OQ-4 (2026-11-06, Claude Code, B0) Env validation is stricter than section 10 states
Added rules (all fail at boot, names only, values never printed):
- `CRON_SECRET` >= 32 chars; `APP_BASE_URL` must be https when `NODE_ENV=production`.
- `MESSAGE_PROVIDER=twilio_sandbox` requires all four Twilio values (incl. `TWILIO_SANDBOX_TEMPLATE_CONTENT_SID`).
- `ALLOW_LIVE_SEND=true` is rejected unless `MESSAGE_PROVIDER=twilio_sandbox` (it would be a no-op and hides misconfiguration).
- `ENABLE_LLM_PARSER=true` requires `GEMINI_API_KEY`.
- Any `NEXT_PUBLIC_*` variable whose name looks like a secret (SECRET/TOKEN/SERVICE_ROLE/AUTH/...) is rejected.
- `DEFAULT_TIMEZONE` must be `Asia/Kolkata` (the planner is written for IST only).
Status: open, shout if any of these gets in the way.

### OQ-5 (2026-11-06, Claude Code, B1) RLS lets any staff session UPDATE followups directly
Section 3 grants `authenticated` staff update on `followups`. Through PostgREST that would let a receptionist approve a
followup (bypassing the doctor-only rule) or jump states.
**Default (safest, no contract change):** `0002_rls.sql` adds a `BEFORE UPDATE` trigger that applies only to the
`authenticated` role:
- status changes must follow the section 2 state machine; only a doctor can do `draft -> approved`;
- `doctor_id`, `is_seed`, `parsed_at`, `created_at` are immutable;
- `raw_note` must be null on any non-draft row (enforces data minimisation in the DB);
- inserts from a user session must have `status = 'draft'` (RLS `with check`).
`service_role` (cron, webhooks) is not restricted by the trigger; `lib/*` enforces the same machine there.
Verified offline with `supabase/tests/run_local.sh`. Status: open, confirm.

### OQ-6 (2026-11-06, Claude Code, B1) State machine edge cases not in the brief
Not allowed today (by the trigger and, later, by lib):
- `confirmed -> reschedule_requested` (patient confirms, then replies 2). The diagram only has it from `approved`.
  The inbound webhook runs as service_role, so B7 can still decide; the question is product behaviour.
- `missed -> completed` (patient turns up late after being marked missed). Receptionist "Arrived" would fail.
Proposed: allow both. Waiting for a team decision before changing the trigger. Status: open.

### OQ-7 (2026-11-06, Claude Code, B1) DB types are hand-written
`lib/supabase/types.ts` matches the migrations but was written by hand because no Supabase project exists yet.
Regenerate after the project is created (command in `docs/DEPLOY.md`). Status: open (needs Fenil's project).

### OQ-8 (2026-11-06, Claude Code, B0) Root `app/layout.tsx` and `app/page.tsx`
Next.js needs a root layout to boot. Both are minimal placeholders; the frontend owner may replace them.
Status: info.

### OQ-9 (2026-11-06, Claude Code, B0) `Brief.md` is not in the repo
The folder structure lists `Brief.md` at the root but it is not committed. Please add it so both agents read the same version.
Status: open (Fenil).

### OQ-10 (2026-11-06, Claude Code, B3) Codex's `plan.test.ts` (C2a) not in the repo yet
B3 was built test-first against the C2a table using co-located `lib/reminders/plan.test.ts` (all 13 cases plus
boundaries, quiet hours and machine-TZ independence, run under UTC, Asia/Kolkata, America/Los_Angeles, Pacific/Kiritimati).
Codex's suite stays the acceptance test; if it disagrees with this one, the brief wins and I fix the code, not the test.
- Invalid time throws `InvalidFollowupTimeError`, a subclass of `InvalidFollowupDateError`, so `toThrow(InvalidFollowupDateError)` passes.
Status: open (Codex).

### OQ-11 (2026-11-06, Claude Code, B3) Appointments before 10:00 and the 07:00 morning floor
`morning_of = max(07:00, T - 3h)`. For T before 07:00 (e.g. 06:30) the reminder lands after the appointment.
Proposed: reject followupTime outside clinic hours (07:00-21:00) in the API (B4) rather than change the planner.
Status: open. NOT enforced in B4 after all: rejecting a parsed time at approve would block the doctor's one tap (rule 1).
The planner keeps the spec formula; the team should decide whether times before 07:00 are possible at all.

### OQ-12 (2026-11-06, Claude Code, B2) Templates: Codex's C1 not in the repo yet
Outbound text must come from `renderTemplate`, but `lib/messages/templates.ts` (Codex) does not exist.
**Default:** `lib/outbound/templates.provisional.ts` (Claude Code owned) implements the exact 6.2 interface with the
Brief's seed copy and passes the same lint rules (tests in `lib/outbound/templates.test.ts`).
`lib/outbound/render.ts` is the single seam: switching to Codex's file is one import. Changes vs seed copy:
`morning_of` gained the 1/2 reply instruction (rule "every reminder ends with the 1/2 instruction"); `reply_confirmed`,
`reply_reschedule_ack`, `optout_ack` had no seed text and were written admin-only. Status: open (Codex).

### OQ-13 (2026-11-06, Claude Code, B2) `POST /api/notes/parse` is doctor-only in v1 (contract said "staff")
`followups.doctor_id` must reference the doctor, and a receptionist cannot see other staff rows under RLS. Since
approve is doctor-only as well (section 13 Q2), parse requires role `doctor`; a receptionist gets 403.
Status: open, revisit together with section 13 Q2.

### OQ-14 (2026-11-06, Claude Code, B2) What is stored in `raw_note`
Only the clinically stripped note (`sanitizedNote`) is stored, never the text as typed, and approve nulls it.
Stricter than section 3 ("raw_note"), same column. Status: info.

### OQ-15 (2026-11-06, Claude Code, B2) LLM fallback (L4) is not built
`ENABLE_LLM_PARSER=true` is rejected at boot with "not implemented in v1" instead of being silently ignored.
`chrono-node` was not used: the rules parser covers the Brief's English phrases directly, with tests. Status: info.

### OQ-16 (2026-11-06, Claude Code, B2) Parser decisions worth a look
- Two or more patients scoring >= 0.85 is always `name_ambiguous` (never auto-picked), even if one is an exact match:
  a wrong match sends a reminder to the wrong family.
- A one-word name ("Sita") can match a unique "Sita Verma" (score capped at 0.9).
- Several date phrases: the one followed by "baad"/"later" wins, else the last one; `date_ambiguous` is set.
- "N baje" without am/pm: 1-7 is read as PM (clinic hours), 8-12 as written.
- Durations over 400 days and explicit dates with a past year are ignored (default date + `date_ambiguous`).
Status: open for Codex's C2b tests to confirm.

### OQ-17 (2026-11-06, Claude Code, B4) Approve / reschedule / status are SQL functions
`supabase/migrations/0004_followup_functions.sql`. supabase-js has no transactions, so each write is one
`security definer` function (row lock, state check, reminders written in the same transaction). The reminder plan is
still computed by the pure TS planner and passed in as JSON; the function validates it (no `missed_nudge`, only
pending/skipped). Errors use custom SQLSTATEs `QN404/QN409/QN422` mapped in `lib/data/dbErrors.ts`.
Status: info.

### OQ-18 (2026-11-06, Claude Code, B4) Reschedule details
- `followupTime` omitted on reschedule means "no time" (null), not "keep the old time".
- Reschedule from `confirmed` goes back to `approved` (patient must confirm the new date); `confirmed_at` is cleared.
- The confirmation reminder is re-sent for the new date (it is part of the re-plan).
- A reminder a tick is currently sending is left alone.
- A `missed` followup cannot be rescheduled (state machine). Receptionists will want this; see OQ-6.
Status: open.

### OQ-19 (2026-11-06, Claude Code, B5/B6) Provider and tick behaviour beyond the brief
- `OutboundMessage.lastInboundAt` added so the sandbox provider can pick free-form vs template (CONTRACTS.md).
- Twilio is called over REST with `fetch` (no SDK dependency). Permanent Twilio errors (e.g. 21211 invalid number,
  63016 outside window) fail immediately; 429/5xx/network/timeouts retry (10 min x attempt, max 3).
- `wa_link` provider never sends: the tick marks the reminder `skipped/manual_send`; the list view has the link.
- Send guard 4 is per kind: confirmation only while `approved`; day_before/morning_of while `approved|confirmed`
  (not `reschedule_requested`, the date is about to change); missed_nudge only while `missed`.
- Reminders that are too late to make sense (tick down for a day) are skipped as `too_late` instead of sending
  "aaj aapka follow-up hai" a day late.
- In quiet hours claimed reminders are deferred to 07:30 without spending an attempt.
- If a send succeeds but recording it fails, the row stays `sending` (never re-queued by the tick). Recovery after
  10 minutes can then resend once: a rare duplicate is preferred over a lost reminder. Flagging in case the team
  prefers the opposite.
- `/api/cron/tick` also answers GET (Vercel cron sends GET with the same bearer) and returns two extra counters,
  `deferred` and `retried`.
Status: open for review.

### OQ-20 (2026-11-06, Claude Code, B7) Inbound decisions
- Schema addition: `patients.last_auto_reply_at` (0006). The 6 h out-of-scope limit must survive serverless cold
  starts; it stores a timestamp only. Unknown numbers fall back to an in-memory limiter.
- "Latest active followup" = the soonest upcoming active one (date >= today), else the most recent active one.
- "2" is accepted from `approved` and `confirmed` (the diagram only shows `approved`; a confirmed patient who then
  cannot come must be able to say so). Raised in OQ-6.
- "1" while `reschedule_requested` does not undo the request; the patient gets the reschedule ack again.
- STOP opts out every patient sharing that phone (it is the phone owner asking).
- `patient_message` attention never overwrites `send_failed` / `reschedule_requested`.
- Webhooks return 403 if `TWILIO_AUTH_TOKEN` is not set, instead of accepting unsigned input.
Status: open for review.
