# Contracts

Source of truth for interfaces between Claude Code (backend), Codex (helper) and the frontend.
The API contract is Brief section 4; this file records **additions and changes** to it.
Change process (Brief rule 7): edit here + note to the other agent via a human.

## Error shape (all routes)

```json
{ "error": { "code": "STRING_CODE", "message": "human readable", "details": {} } }
```

| HTTP | code | When |
|------|------|------|
| 400 | `VALIDATION_ERROR` | zod validation failed. `details.issues[] = { path, message, code }`. Input values are never echoed. |
| 400 | `INVALID_JSON` | Body is not JSON |
| 401 | `UNAUTHENTICATED` | No / invalid session, or bad cron bearer |
| 403 | `FORBIDDEN` | Wrong role (e.g. receptionist calling approve) |
| 403 | `STAFF_NOT_FOUND` | Signed in but no `staff` row |
| 403 | `INVALID_SIGNATURE` | Twilio signature check failed (B7) |
| 404 | `NOT_FOUND` | |
| 409 | `CONFLICT` | e.g. approve on a non-draft followup |
| 413 | `PAYLOAD_TOO_LARGE` | JSON body > 16 KB (default) |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | JSON routes require `Content-Type: application/json` |
| 422 | `EMPTY`, `NAME_MISSING`, `PATIENT_NEEDS_PHONE`, `INVALID_FOLLOWUP_DATE` | Business validation |
| 429 | `RATE_LIMITED` | `details.retryAfterSeconds`, plus `Retry-After` header |
| 500 | `INTERNAL` | Anything unexpected. Logged server-side (redacted), generic message to client |

## Server building blocks (B0)

| Module | Contract |
|--------|----------|
| `lib/env.ts` | `getServerEnv()` validated + cached, `getPublicEnv()`. Boot fails via `instrumentation.ts` on any problem. |
| `lib/http/errors.ts` | `ApiError(status, code, message, details?)`, `errors.*` helpers, `withErrorHandling(route, handler)`. |
| `lib/http/validate.ts` | `parseJsonBody(req, schema, {maxBytes})`, `parseQuery(req, schema)`, `parseParams(params, schema)`. |
| `lib/http/auth.ts` | `requireStaff(roles?)` -> `{ userId, name, role, supabase }`; `requireCronSecret(req)`; `safeEqual`. |
| `lib/supabase/server.ts` | `createUserClient()`: user session, RLS applies. |
| `lib/supabase/admin.ts` | `getAdminClient()`: service role, bypasses RLS, `server-only`. Used only from `lib/data/*`. |
| `lib/log.ts` | `log.info/warn/error(event, fields)`: JSON lines, phones masked, note/body/secret keys redacted. |

## Environment variables

`lib/env.ts` is authoritative. Summary (Brief section 10 plus the rules in OPEN_QUESTIONS OQ-4):

| Variable | Required | Default | Rule |
|----------|----------|---------|------|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | | URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | | |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | | server only |
| `CRON_SECRET` | yes | | >= 32 chars |
| `APP_BASE_URL` | yes | | URL, trailing slash stripped, https in production |
| `MESSAGE_PROVIDER` | no | `console` | `twilio_sandbox` / `wa_link` / `console` |
| `ALLOW_LIVE_SEND` | no | `false` | literal `true`/`false`; `true` only with `twilio_sandbox` |
| `TWILIO_ACCOUNT_SID` | if sandbox | | `AC` + 32 hex |
| `TWILIO_AUTH_TOKEN` | if sandbox | | |
| `TWILIO_WHATSAPP_FROM` | if sandbox | | `whatsapp:+<digits>` |
| `TWILIO_SANDBOX_TEMPLATE_CONTENT_SID` | if sandbox | | `HX` + 32 hex, from Console |
| `TWILIO_SANDBOX_JOIN_CODE` | no | | |
| `CLINIC_NAME` | no | `Sunrise Family Clinic` (fictional) | |
| `CLINIC_PHONE` | no | | E.164 |
| `DEFAULT_DOCTOR_NAME` | no | `Dr. Mehra` (fictional) | |
| `DEFAULT_TIMEZONE` | no | `Asia/Kolkata` | only that value |
| `CLINIC_CLOSED_DAYS` | no | empty | e.g. `0` or `0,6` |
| `ENABLE_LLM_PARSER` | no | `false` | |
| `GEMINI_API_KEY` | if LLM on | | |
| `PATIENTS_PER_DAY` / `BASELINE_MISS_RATE` / `FOLLOWUP_SHARE` / `RECOVERY_RATE` / `AVG_FEE_INR` / `WORKING_DAYS_PER_MONTH` | no | 50 / 0.30 / 0.40 / 0.50 / 300 / 26 | modeled stats, placeholders |
| `DEMO_PHONE_1..3` | no | | read by seed only, not by the app |

## Database (B1)

Migrations `supabase/migrations/0001-0003` implement Brief section 3 exactly, plus (see OQ-5):

| Addition | Why |
|----------|-----|
| `is_staff()`, `current_staff_role()` (security definer) | Used by policies and the guard trigger |
| Table grants revoked from `anon`; `authenticated` gets only what section 3 lists | Defence in depth on top of RLS |
| `followups` insert policy requires `status = 'draft'` | User sessions can only create drafts |
| `followups_user_update_guard` trigger (role `authenticated` only) | State machine, doctor-only approve, immutable columns, `raw_note` null outside draft |
| `grant execute on claim_due_reminders to service_role` | Explicit, since `public` was revoked |

## API changes vs Brief section 4 (B2-B10)

| Endpoint | Change | Why |
|----------|--------|-----|
| `POST /api/notes/parse` | Role **doctor** (was "staff"). 429 `RATE_LIMITED` after 30/min per user. | OQ-13 |
| `POST /api/followups/:id/approve` | Body is `.strict()`; `patientId` and `newPatient` are mutually exclusive; `followupTime: null` clears the time. 422 codes: `PATIENT_NEEDS_PHONE`, `PATIENT_NOT_FOUND`, `INVALID_FOLLOWUP_DATE`. | |
| `POST /api/followups/:id/reschedule` | Omitted `followupTime` = no time. 409 unless status is approved / confirmed / reschedule_requested. | OQ-18 |
| `GET /api/followups` | `status` accepts a comma list. `attention=true` = attention_reason set OR status missed, excluding completed/cancelled. Items carry `patient` and `waLink` (null for opted-out, draft, closed). Opaque `cursor`. | |
| `GET /api/patients` | `?q=&limit=` (prefix, case-insensitive). `POST` returns 201 `{ patient }`, 409 on duplicate phone+name. | |
| `GET /api/stats` | `?range=7d|30d|90d|all&includeSeed=false`. Response `{ range, includeSeed, generatedAt, measured, modeled }`. | B8 |
| `POST|GET /api/cron/tick` | GET added for the Vercel cron backstop. Two extra counters: `deferred`, `retried`. | OQ-19 |
| `POST /api/webhooks/twilio/inbound` | 403 `INVALID_SIGNATURE` on bad/missing signature or when Twilio is not configured. 415 for non-form bodies. | |
| `POST /api/webhooks/twilio/status` | Implemented (P1): failed/undelivered -> reminder failed + `send_failed`. 204. | |
| any `/api/*` | Cross-origin requests and cross-site writes get 403 `FORBIDDEN` (middleware). Unknown paths 404 JSON. | B10 |

### Response DTOs

`followup`: `id, patientId, patientNameRaw, doctorId, followupDate, followupTime (HH:mm), status, parseSource, dateSource,
messagePreview, attentionReason, clientInputMs, parsedAt, approvedAt, confirmedAt, completedAt, missedAt, isSeed, createdAt`.
`raw_note` is never returned by any endpoint.

`reminder`: `id, kind, scheduledFor, status, attempts, provider, skipReason, sentAt`. `last_error` is not exposed.

## Provider interface addition

`OutboundMessage.lastInboundAt?: Date | null`: lets `twilio_sandbox` choose free-form (inside 24 h) vs template.

## Schema additions after B1

| Migration | Adds |
|-----------|------|
| `0004_followup_functions.sql` | `approve_followup`, `reschedule_followup`, `set_followup_status` (authenticated) |
| `0005_tick_functions.sql` | `recover_stuck_reminders`, `mark_missed_followups`, `claim_reminder` (service_role) |
| `0006_inbound.sql` | `patients.last_auto_reply_at`, index on `reminders.provider_message_sid` |

## Outbound templates seam

All outbound text goes through `lib/outbound/render.ts`. It currently re-exports the provisional templates in
`lib/outbound/templates.provisional.ts`; when Codex's `lib/messages/templates.ts` (C1) lands, change that one import.
