import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, FollowupStatus, Json, Tables, TablesInsert } from '@/lib/supabase/types';
import { mapDbError } from './dbErrors';

type Client = SupabaseClient<Database>;
export type FollowupRow = Tables<'followups'>;
export type PatientSummary = Pick<Tables<'patients'>, 'id' | 'name' | 'phone_e164' | 'language' | 'opted_out' | 'is_seed'>;
export type FollowupWithPatient = FollowupRow & { patient: PatientSummary | null };

export async function insertDraft(db: Client, row: Omit<TablesInsert<'followups'>, 'status' | 'parsed_at'>): Promise<{ id: string }> {
  // status and parsed_at use database defaults; clients have no column privilege to set them.
  const { data, error } = await db.from('followups').insert(row).select('id').single();
  if (error) throw mapDbError(error);
  return data;
}

export async function getFollowup(db: Client, id: string): Promise<FollowupRow | null> {
  const { data, error } = await db.from('followups').select('*').eq('id', id).maybeSingle();
  if (error) throw mapDbError(error);
  return data;
}

export interface PlannedReminderJson {
  kind: string;
  scheduled_for: string;
  status: 'pending' | 'skipped';
  skip_reason: string | null;
}

export async function approveFollowup(
  db: Client,
  args: {
    followupId: string;
    patientId: string | null;
    newPatient: { name: string; phoneE164: string; language: string } | null;
    followupDate: string;
    followupTime: string | null;
    messagePreview: string;
    reminders: PlannedReminderJson[];
  },
): Promise<FollowupRow> {
  const { data, error } = await db.rpc('approve_followup', {
    p_followup_id: args.followupId,
    p_patient_id: args.patientId,
    p_new_patient_name: args.newPatient?.name ?? null,
    p_new_patient_phone: args.newPatient?.phoneE164 ?? null,
    p_new_patient_language: args.newPatient?.language ?? null,
    p_followup_date: args.followupDate,
    p_followup_time: args.followupTime,
    p_message_preview: args.messagePreview,
    p_reminders: args.reminders as unknown as Json,
  });
  if (error) throw mapDbError(error);
  return data as FollowupRow;
}

export async function rescheduleFollowup(
  db: Client,
  args: { followupId: string; followupDate: string; followupTime: string | null; messagePreview: string; reminders: PlannedReminderJson[] },
): Promise<FollowupRow> {
  const { data, error } = await db.rpc('reschedule_followup', {
    p_followup_id: args.followupId,
    p_followup_date: args.followupDate,
    p_followup_time: args.followupTime,
    p_message_preview: args.messagePreview,
    p_reminders: args.reminders as unknown as Json,
  });
  if (error) throw mapDbError(error);
  return data as FollowupRow;
}

export async function setFollowupStatus(db: Client, followupId: string, status: 'completed' | 'cancelled'): Promise<FollowupRow> {
  const { data, error } = await db.rpc('set_followup_status', { p_followup_id: followupId, p_status: status });
  if (error) throw mapDbError(error);
  return data as FollowupRow;
}

export interface ListFilters {
  statuses?: FollowupStatus[];
  attention?: boolean;
  from?: string;
  to?: string;
  limit: number;
  after?: { date: string; id: string };
}

const PATIENT_COLUMNS = 'id, name, phone_e164, language, opted_out, is_seed';

/** Keyset-paginated list ordered by (followup_date, id). Filter values are validated by the route. */
export async function listFollowups(db: Client, f: ListFilters): Promise<FollowupWithPatient[]> {
  let q = db
    .from('followups')
    .select(`*, patient:patients(${PATIENT_COLUMNS})`)
    .order('followup_date', { ascending: true })
    .order('id', { ascending: true })
    .limit(f.limit);
  if (f.statuses && f.statuses.length > 0) q = q.in('status', f.statuses);
  if (f.attention) {
    q = q.not('status', 'in', '(completed,cancelled)').or('attention_reason.not.is.null,status.eq.missed');
  }
  if (f.from) q = q.gte('followup_date', f.from);
  if (f.to) q = q.lte('followup_date', f.to);
  if (f.after) {
    q = q.or(`followup_date.gt.${f.after.date},and(followup_date.eq.${f.after.date},id.gt.${f.after.id})`);
  }
  const { data, error } = await q;
  if (error) throw mapDbError(error);
  return (data ?? []) as unknown as FollowupWithPatient[];
}
