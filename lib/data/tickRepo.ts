import 'server-only';
import type { AdminSupabaseClient } from '@/lib/supabase/admin';
import type { ReminderKind } from '@/lib/supabase/types';
import { mapDbError } from './dbErrors';
import type { FollowupRow } from './followupsRepo';
import type { PatientRow } from './patientsRepo';
import type { ReminderRow } from './remindersRepo';

export interface ReminderContext {
  followup: FollowupRow;
  patient: PatientRow | null;
}

/** Service-role data access for the tick. Every write is conditioned on status = 'sending'. */
export interface TickRepo {
  recoverStuck(): Promise<number>;
  markMissed(cutoff: string, nudgeAt: Date): Promise<number>;
  claimDue(batchSize: number): Promise<ReminderRow[]>;
  claimOne(followupId: string, kind: ReminderKind): Promise<ReminderRow | null>;
  loadContext(followupIds: string[]): Promise<Map<string, ReminderContext>>;
  markSent(id: string, provider: string, sid: string, at: Date): Promise<void>;
  markSkipped(id: string, reason: string): Promise<void>;
  markRetry(id: string, nextAt: Date, error: string): Promise<void>;
  /** Back to pending without spending an attempt (quiet hours). */
  defer(id: string, to: Date, attempts: number): Promise<void>;
  markFailed(id: string, followupId: string, error: string): Promise<void>;
}

export function createTickRepo(db: AdminSupabaseClient): TickRepo {
  const fail = (error: unknown) => {
    if (error) throw mapDbError(error);
  };
  return {
    async recoverStuck() {
      const { data, error } = await db.rpc('recover_stuck_reminders', {});
      fail(error);
      return Number(data ?? 0);
    },
    async markMissed(cutoff, nudgeAt) {
      const { data, error } = await db.rpc('mark_missed_followups', { p_cutoff: cutoff, p_nudge_at: nudgeAt.toISOString() });
      fail(error);
      return Number(data ?? 0);
    },
    async claimDue(batchSize) {
      const { data, error } = await db.rpc('claim_due_reminders', { batch_size: batchSize });
      fail(error);
      return (data ?? []) as ReminderRow[];
    },
    async claimOne(followupId, kind) {
      const { data, error } = await db.rpc('claim_reminder', { p_followup_id: followupId, p_kind: kind });
      fail(error);
      const rows = (data ?? []) as ReminderRow[];
      return rows[0] ?? null;
    },
    async loadContext(followupIds) {
      const out = new Map<string, ReminderContext>();
      if (followupIds.length === 0) return out;
      const { data, error } = await db.from('followups').select('*, patient:patients(*)').in('id', followupIds);
      fail(error);
      for (const row of (data ?? []) as unknown as Array<FollowupRow & { patient: PatientRow | null }>) {
        const { patient, ...followup } = row;
        out.set(row.id, { followup, patient });
      }
      return out;
    },
    async markSent(id, provider, sid, at) {
      const { error } = await db
        .from('reminders')
        .update({ status: 'sent', provider, provider_message_sid: sid, sent_at: at.toISOString(), last_error: null })
        .eq('id', id)
        .eq('status', 'sending');
      fail(error);
    },
    async markSkipped(id, reason) {
      const { error } = await db.from('reminders').update({ status: 'skipped', skip_reason: reason }).eq('id', id).eq('status', 'sending');
      fail(error);
    },
    async markRetry(id, nextAt, lastError) {
      const { error } = await db
        .from('reminders')
        .update({ status: 'pending', scheduled_for: nextAt.toISOString(), last_error: lastError, claimed_at: null })
        .eq('id', id)
        .eq('status', 'sending');
      fail(error);
    },
    async defer(id, to, attempts) {
      const { error } = await db
        .from('reminders')
        .update({ status: 'pending', scheduled_for: to.toISOString(), attempts: Math.max(0, attempts - 1), claimed_at: null })
        .eq('id', id)
        .eq('status', 'sending');
      fail(error);
    },
    async markFailed(id, followupId, lastError) {
      const { error } = await db.from('reminders').update({ status: 'failed', last_error: lastError }).eq('id', id).eq('status', 'sending');
      fail(error);
      const { error: fErr } = await db
        .from('followups')
        .update({ attention_reason: 'send_failed' })
        .eq('id', followupId)
        .is('attention_reason', null);
      fail(fErr);
    },
  };
}
