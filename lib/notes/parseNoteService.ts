import { ApiError } from '@/lib/http/errors';
import { buildMessage, type ClinicContext } from '@/lib/outbound/build';
import { parseNote, type NeedsReview } from '@/lib/parser';
import type { DateSource } from '@/lib/parser/dates';
import type { PatientLanguage, TablesInsert } from '@/lib/supabase/types';

export interface ParseNoteDeps {
  now: () => Date;
  clinic: ClinicContext;
  listPatients: () => Promise<Array<{ id: string; name: string; language: PatientLanguage }>>;
  insertDraft: (row: TablesInsert<'followups'>) => Promise<{ id: string }>;
}

export interface ParseNoteResponse {
  followupId: string;
  patient: { id: string | null; name: string; candidates: Array<{ id: string; name: string; score: number }> };
  followupDate: string;
  followupTime: string | null;
  dateSource: DateSource;
  needsReview: NeedsReview[];
  ignoredClinicalContent: boolean;
  messagePreview: string;
}

/**
 * POST /api/notes/parse business logic: parse, create the draft, build the preview.
 * Everything the doctor's preview needs comes back in this one call (Brief rule 1).
 * The raw note is never returned; only the clinically stripped note is stored, and
 * approve nulls it.
 */
export async function parseNoteAndCreateDraft(
  input: { text: string; clientInputMs?: number; doctorId: string },
  deps: ParseNoteDeps,
): Promise<ParseNoteResponse> {
  const now = deps.now();
  const known = await deps.listPatients();
  const result = parseNote({ text: input.text, now, knownPatients: known });
  if (!result.ok) {
    throw new ApiError(
      422,
      result.error,
      result.error === 'EMPTY' ? 'The note is empty' : 'No patient name found at the start of the note',
    );
  }

  const matched = result.patientId ? known.find((p) => p.id === result.patientId) : undefined;
  const language: PatientLanguage = matched?.language ?? 'hinglish';
  const displayName = matched?.name ?? result.patientName;

  const messagePreview = buildMessage(
    'confirmation',
    { patientName: displayName, language, followupDate: result.followupDate, followupTime: result.followupTime },
    deps.clinic,
  );

  const { id } = await deps.insertDraft({
    patient_id: result.patientId,
    patient_name_raw: result.patientName,
    doctor_id: input.doctorId,
    followup_date: result.followupDate,
    followup_time: result.followupTime,
    raw_note: result.sanitizedNote || null,
    parse_source: result.parseSource,
    date_source: result.dateSource,
    message_preview: messagePreview,
    attention_reason: result.patientId ? null : 'unmatched_patient',
    client_input_ms: input.clientInputMs ?? null,
  });

  return {
    followupId: id,
    patient: { id: result.patientId, name: displayName, candidates: result.candidates },
    followupDate: result.followupDate,
    followupTime: result.followupTime,
    dateSource: result.dateSource,
    needsReview: result.needsReview,
    ignoredClinicalContent: result.ignoredClinicalContent,
    messagePreview,
  };
}
