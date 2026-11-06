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
