# Red-team cases and verification

Use only a local/preview Supabase project with fictional records. These authenticated abuse cases must not be run against a real clinic without authorization.

## RT-01: clear opt-out / seed guard — mitigated in migration, database execution pending

The previous migration granted broad patient UPDATE privileges. The new `0007_authenticated_write_hardening.sql` revokes them, leaves only narrow INSERT columns for patient creation, and adds a trigger as defense in depth. Inbound updates continue through the server-only service role. No re-consent path was added.

Verify against a disposable database by running `./supabase/tests/run_local.sh`, or against a preview by signing in as staff and attempting:

```http
PATCH /rest/v1/patients?id=eq.<fictional-patient-uuid>
Authorization: Bearer <staff-session-jwt>
apikey: <supabase-anon-key>
Content-Type: application/json

{"opted_out":false,"is_seed":false,"phone_e164":"+919812345678"}
```

Expected: permission denied. The local SQL harness now checks table/column privileges and attempts the same mutation. It was not executable in the current environment because `initdb`/`pg_ctl`/`psql` are unavailable and the Docker daemon is inaccessible. Apply migration 0007 before relying on this protection in an existing Supabase project.

## RT-02: alter measured metrics / lifecycle through REST — mitigated in migration, database execution pending

Authenticated users no longer have direct UPDATE on followups. Validated transitions remain available through the existing RPCs; service-role inbound/tick writes remain available. Follow-up draft INSERT is column-limited, so clients cannot provide `status`, `parsed_at`, lifecycle timestamps, or `is_seed`; `parsed_at` now uses the database default. The RLS insert policy also requires `doctor_id = auth.uid()`.

The local SQL harness now checks that direct UPDATE of confirmation timestamps, client timing, status, and ownership fails, while RPC transition checks remain. Database execution is pending for the environment limitation listed under RT-01. `client_input_ms` remains accepted on draft INSERT because it is the client-measured typing duration; it is range-validated and cannot be updated after insertion. It is therefore a client-reported measurement, not tamper-proof telemetry.

## RT-03: concurrent patient confirmation/reschedule — fixed and unit verified

The inbound handler checks the conditional transition result and rereads the follow-up if another operation wins. It sends an acknowledgement only when the new state supports that response; otherwise it returns no reply. Regression cases cover a `1` reply racing with reschedule and a `2` reply racing with completion/cancellation. Run with `npm test -- tests/security/inbound-concurrency.test.ts`.

## RT-04: oversized webhook body — fixed and unit verified

`readSignedTwilioForm` now reads the request stream incrementally, stops and cancels when it exceeds 32 KiB, and only parses/signature-checks a body within the limit. Tests cover a just-under-limit signed form and a continuing stream that crosses the limit. Run with `npm test -- tests/security/webhook-size.test.ts`.

## Verification record

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm test -- tests/security`: passed (6 tests).
- `npm test`: passed (499 passed, 5 skipped; 1 test file skipped).
- Database migration/harness: not run locally; required PostgreSQL binaries are unavailable, and the Docker daemon is inaccessible.
