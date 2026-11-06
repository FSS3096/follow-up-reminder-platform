import type { FollowupRow, FollowupWithPatient } from '@/lib/data/followupsRepo';
import type { ReminderRow } from '@/lib/data/remindersRepo';

/** Postgres `time` comes back as 'HH:mm:ss'; the API uses 'HH:mm'. */
export function normaliseTime(value: string | null): string | null {
  return value === null ? null : value.slice(0, 5);
}

/** API shape of a followup. raw_note is never exposed. */
export function toFollowupDto(f: FollowupRow) {
  return {
    id: f.id,
    patientId: f.patient_id,
    patientNameRaw: f.patient_name_raw,
    doctorId: f.doctor_id,
    followupDate: f.followup_date,
    followupTime: normaliseTime(f.followup_time),
    status: f.status,
    parseSource: f.parse_source,
    dateSource: f.date_source,
    messagePreview: f.message_preview,
    attentionReason: f.attention_reason,
    clientInputMs: f.client_input_ms,
    parsedAt: f.parsed_at,
    approvedAt: f.approved_at,
    confirmedAt: f.confirmed_at,
    completedAt: f.completed_at,
    missedAt: f.missed_at,
    isSeed: f.is_seed,
    createdAt: f.created_at,
  };
}
export type FollowupDto = ReturnType<typeof toFollowupDto>;

export function toReminderDto(r: ReminderRow) {
  return {
    id: r.id,
    kind: r.kind,
    scheduledFor: r.scheduled_for,
    status: r.status,
    attempts: r.attempts,
    provider: r.provider,
    skipReason: r.skip_reason,
    sentAt: r.sent_at,
  };
}
export type ReminderDto = ReturnType<typeof toReminderDto>;

export function toListItemDto(f: FollowupWithPatient, waLink: string | null) {
  return {
    ...toFollowupDto(f),
    patient: f.patient
      ? { id: f.patient.id, name: f.patient.name, phoneE164: f.patient.phone_e164, language: f.patient.language, optedOut: f.patient.opted_out }
      : null,
    waLink,
  };
}
