# Safety boundaries

This application supports clinic administration only. It does not diagnose, recommend treatment, or answer health questions. No diagnosis, medicine, or clinical note field exists in the database. The parser creates a follow-up draft; only a doctor can approve it.

## Five safeguards

1. **Fixed outbound architecture.** `lib/messages/templates.ts` contains the only patient-facing copy. Rendering accepts a closed variable set (`patient_first_name`, `clinic_name`, `doctor_name`, `date_long`, `time_clause`, `clinic_phone`). Note text and inbound bodies are never message variables.
2. **Minimal persistence.** There are no clinical columns. Draft `raw_note` is cleared on approval; inbound message bodies are not stored. Opt-out and last-inbound timestamps are retained as operational state.
3. **Input guard.** `clinicalGuard` detects common clinical, symptom, medicine, and dosage terms, strips them before parsing, and flags `ignoredClinicalContent`. It does not block the doctor. Regardless of detection, raw note content cannot reach outbound copy.
4. **No generative patient messaging.** The optional LLM parser is disabled and rejected by configuration in v1. Parsing is deterministic; no model can write patient-facing text.
5. **Inbound guard.** Only confirmation, reschedule, and opt-out intents change state. Other inbound text gets a fixed administrative response, raises receptionist attention, and is rate-limited. The body is not persisted or logged.

## Automated evidence

Run `npm run test:safety`. The command runs the parser and clinical boundary tests plus the template linter. These checks cover adversarial note content, fixed outbound templates, placeholder whitelisting, message length, and the absence of clinical terms in template copy.

| Check | Evidence in suite | Expected result |
|---|---|---|
| Clinical note stripping | adversarial cases: BP/drug/dose, sugar/insulin, antibiotic and prompt injection | date/name extraction only; preview contains no clinical token |
| Inbound health question | `lib/replies/handleInbound.test.ts` | fixed response and attention flag; body absent from repository state |
| Allowed outbound copy | every template key × Hinglish/English | banned vocabulary and unknown placeholders rejected; rendered output ≤300 chars |
| Variable isolation | unknown variable and placeholder-smuggling cases | runtime rejection / single-pass rendering |
| LLM containment | `lib/env.test.ts` | enabling the unimplemented LLM parser is rejected |

This evidence is from automated unit tests, not a clinical validation study. The tests cannot guarantee that every possible medical phrase is detected; the architectural rule that free text never enters outbound messages is the primary containment boundary.
