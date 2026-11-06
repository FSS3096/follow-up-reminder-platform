import type { FollowupRow, FollowupWithPatient, ListFilters, PlannedReminderJson } from '@/lib/data/followupsRepo';
import type { PatientRow } from '@/lib/data/patientsRepo';
import type { ReminderRow } from '@/lib/data/remindersRepo';
import { ApiError, errors } from '@/lib/http/errors';
import { log } from '@/lib/log';
import { buildMessage, type ClinicContext } from '@/lib/outbound/build';
import { sanitizeName } from '@/lib/parser/names';
import { buildWaLink } from '@/lib/providers/whatsapp/waLink';
import { InvalidFollowupDateError, planReminders, type PlannedReminder } from '@/lib/reminders/plan';
import type { FollowupStatus, PatientLanguage } from '@/lib/supabase/types';
import { normaliseTime, toFollowupDto, toListItemDto, toReminderDto } from './dto';

export interface FollowupDeps {
  now: () => Date;
  clinic: ClinicContext;
  getFollowup: (id: string) => Promise<FollowupRow | null>;
  getPatient: (id: string) => Promise<PatientRow | null>;
  approve: (args: {
    followupId: string;
    patientId: string | null;
    newPatient: { name: string; phoneE164: string; language: PatientLanguage } | null;
    followupDate: string;
    followupTime: string | null;
    messagePreview: string;
    reminders: PlannedReminderJson[];
  }) => Promise<FollowupRow>;
  reschedule: (args: {
    followupId: string;
    followupDate: string;
    followupTime: string | null;
    messagePreview: string;
    reminders: PlannedReminderJson[];
  }) => Promise<FollowupRow>;
  setStatus: (followupId: string, status: 'completed' | 'cancelled') => Promise<FollowupRow>;
  listReminders: (followupId: string) => Promise<ReminderRow[]>;
  list: (filters: ListFilters) => Promise<FollowupWithPatient[]>;
  /** Best-effort inline confirmation send after approve; failures are left to the tick. */
  afterApprove?: (followup: FollowupRow) => Promise<void>;
}

export function toPlanJson(plan: PlannedReminder[]): PlannedReminderJson[] {
  return plan.map((r) => ({
    kind: r.kind,
    scheduled_for: r.scheduledFor.toISOString(),
    status: r.status,
    skip_reason: r.skipReason ?? null,
  }));
}

function planOr422(followupDate: string, followupTime: string | null, now: Date): PlannedReminder[] {
  try {
    return planReminders({ followupDate, followupTime, now });
  } catch (e) {
    if (e instanceof InvalidFollowupDateError) throw new ApiError(422, 'INVALID_FOLLOWUP_DATE', e.message);
    throw e;
  }
}

// ---------------------------------------------------------------------------

export interface ApproveInput {
  followupId: string;
  patientId?: string;
  newPatient?: { name: string; phoneE164: string; language?: PatientLanguage };
  followupDate?: string;
  followupTime?: string | null;
}

export async function approveFollowup(input: ApproveInput, deps: FollowupDeps) {
  const draft = await deps.getFollowup(input.followupId);
  if (!draft) throw errors.notFound('Follow-up');
  if (draft.status !== 'draft') {
    throw new ApiError(409, 'CONFLICT', 'Follow-up is already approved or closed', { currentStatus: draft.status });
  }

  const followupDate = input.followupDate ?? draft.followup_date;
  const followupTime = input.followupTime !== undefined ? input.followupTime : normaliseTime(draft.followup_time);

  let patientId: string | null = null;
  let newPatient: { name: string; phoneE164: string; language: PatientLanguage } | null = null;
  let subjectName: string;
  let language: PatientLanguage;

  if (input.patientId) {
    const p = await deps.getPatient(input.patientId);
    if (!p) throw new ApiError(422, 'PATIENT_NOT_FOUND', 'That patient does not exist');
    patientId = p.id;
    subjectName = p.name;
    language = p.language;
  } else if (input.newPatient) {
    const name = sanitizeName(input.newPatient.name);
    if (!name) throw errors.badRequest('newPatient.name must contain letters');
    newPatient = { name, phoneE164: input.newPatient.phoneE164, language: input.newPatient.language ?? 'hinglish' };
    subjectName = name;
    language = newPatient.language;
  } else if (draft.patient_id) {
    const p = await deps.getPatient(draft.patient_id);
    if (!p) throw new ApiError(422, 'PATIENT_NOT_FOUND', 'That patient does not exist');
    patientId = p.id;
    subjectName = p.name;
    language = p.language;
  } else {
    throw new ApiError(422, 'PATIENT_NEEDS_PHONE', 'Pick a patient or add a new one with a phone number');
  }

  const now = deps.now();
  const plan = planOr422(followupDate, followupTime, now);
  const messagePreview = buildMessage('confirmation', { patientName: subjectName, language, followupDate, followupTime }, deps.clinic);

  const approved = await deps.approve({
    followupId: draft.id,
    patientId,
    newPatient,
    followupDate,
    followupTime,
    messagePreview,
    reminders: toPlanJson(plan),
  });

  if (deps.afterApprove) {
    try {
      await deps.afterApprove(approved);
    } catch (err) {
      // The confirmation stays pending; the next tick retries it.
      log.warn('approve_inline_send_failed', { followupId: approved.id, err });
    }
  }

  const reminders = await deps.listReminders(approved.id);
  return { followup: toFollowupDto(approved), reminders: reminders.map(toReminderDto) };
}

// ---------------------------------------------------------------------------

export async function rescheduleFollowup(
  input: { followupId: string; followupDate: string; followupTime?: string | null },
  deps: FollowupDeps,
) {
  const current = await deps.getFollowup(input.followupId);
  if (!current) throw errors.notFound('Follow-up');
  if (!['approved', 'confirmed', 'reschedule_requested'].includes(current.status)) {
    throw new ApiError(409, 'CONFLICT', 'Only active follow-ups can be rescheduled', { currentStatus: current.status });
  }
  if (!current.patient_id) throw new ApiError(422, 'PATIENT_NEEDS_PHONE', 'Follow-up has no patient');
  const patient = await deps.getPatient(current.patient_id);
  if (!patient) throw new ApiError(422, 'PATIENT_NOT_FOUND', 'That patient does not exist');

  const followupTime = input.followupTime === undefined ? null : input.followupTime;
  const plan = planOr422(input.followupDate, followupTime, deps.now());
  const messagePreview = buildMessage(
    'confirmation',
    { patientName: patient.name, language: patient.language, followupDate: input.followupDate, followupTime },
    deps.clinic,
  );
  const updated = await deps.reschedule({
    followupId: current.id,
    followupDate: input.followupDate,
    followupTime,
    messagePreview,
    reminders: toPlanJson(plan),
  });
  const reminders = await deps.listReminders(updated.id);
  return { followup: toFollowupDto(updated), reminders: reminders.map(toReminderDto) };
}

// ---------------------------------------------------------------------------

export async function changeFollowupStatus(input: { followupId: string; status: 'completed' | 'cancelled' }, deps: FollowupDeps) {
  const updated = await deps.setStatus(input.followupId, input.status);
  return { followup: toFollowupDto(updated) };
}

// ---------------------------------------------------------------------------

export interface ListInput {
  statuses?: FollowupStatus[];
  attention?: boolean;
  from?: string;
  to?: string;
  limit: number;
  cursor?: string;
}

export function encodeCursor(date: string, id: string): string {
  return Buffer.from(`${date}|${id}`, 'utf8').toString('base64url');
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function decodeCursor(cursor: string): { date: string; id: string } {
  const [date, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  if (!date || !id || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !UUID.test(id)) throw errors.badRequest('Invalid cursor');
  return { date, id };
}

const WA_LINK_TEMPLATE: Partial<Record<FollowupStatus, 'confirmation' | 'missed_nudge'>> = {
  approved: 'confirmation',
  confirmed: 'confirmation',
  reschedule_requested: 'confirmation',
  missed: 'missed_nudge',
};

export function waLinkFor(f: FollowupWithPatient, clinic: ClinicContext): string | null {
  const key = WA_LINK_TEMPLATE[f.status];
  if (!key || !f.patient || f.patient.opted_out) return null;
  const body = buildMessage(
    key,
    { patientName: f.patient.name, language: f.patient.language, followupDate: f.followup_date, followupTime: normaliseTime(f.followup_time) },
    clinic,
  );
  return buildWaLink(f.patient.phone_e164, body);
}

export async function listFollowups(input: ListInput, deps: Pick<FollowupDeps, 'list' | 'clinic'>) {
  const after = input.cursor ? decodeCursor(input.cursor) : undefined;
  const rows = await deps.list({
    statuses: input.statuses,
    attention: input.attention,
    from: input.from,
    to: input.to,
    limit: input.limit + 1,
    after,
  });
  const page = rows.slice(0, input.limit);
  const last = page[page.length - 1];
  return {
    items: page.map((f) => toListItemDto(f, waLinkFor(f, deps.clinic))),
    nextCursor: rows.length > input.limit && last ? encodeCursor(last.followup_date, last.id) : null,
  };
}
