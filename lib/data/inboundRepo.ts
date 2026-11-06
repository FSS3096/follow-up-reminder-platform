import 'server-only';
import type { AdminSupabaseClient } from '@/lib/supabase/admin';
import type { AttentionReason, FollowupStatus, TablesUpdate } from '@/lib/supabase/types';
import { mapDbError } from './dbErrors';
import type { FollowupRow } from './followupsRepo';
import type { PatientRow } from './patientsRepo';

export interface InboundRepo {
  findPatientsByPhone(phoneE164: string): Promise<PatientRow[]>;
  touchInbound(patientIds: string[], at: Date): Promise<void>;
  activeFollowups(patientIds: string[]): Promise<FollowupRow[]>;
  /** Conditional transition; returns false if the row was no longer in one of `from`. */
  transition(followupId: string, from: FollowupStatus[], patch: TablesUpdate<'followups'>): Promise<boolean>;
  setAttentionIfEmpty(followupId: string, reason: AttentionReason): Promise<void>;
  optOut(patientIds: string[]): Promise<void>;
  /** Atomically takes the 6 h auto-reply slot for these patients; false if one was used recently. */
  takeAutoReplySlot(patientIds: string[], now: Date, windowMs: number): Promise<boolean>;
  markDeliveryFailed(providerSid: string, status: string): Promise<void>;
}

export function createInboundRepo(db: AdminSupabaseClient): InboundRepo {
  const fail = (error: unknown) => {
    if (error) throw mapDbError(error);
  };
  return {
    async findPatientsByPhone(phone) {
      const { data, error } = await db.from('patients').select('*').eq('phone_e164', phone);
      fail(error);
      return data ?? [];
    },
    async touchInbound(ids, at) {
      if (ids.length === 0) return;
      const { error } = await db.from('patients').update({ last_inbound_at: at.toISOString() }).in('id', ids);
      fail(error);
    },
    async activeFollowups(ids) {
      if (ids.length === 0) return [];
      const { data, error } = await db
        .from('followups')
        .select('*')
        .in('patient_id', ids)
        .in('status', ['approved', 'confirmed', 'reschedule_requested'])
        .order('followup_date', { ascending: true });
      fail(error);
      return data ?? [];
    },
    async transition(id, from, patch) {
      const { data, error } = await db.from('followups').update(patch).eq('id', id).in('status', from).select('id');
      fail(error);
      return (data ?? []).length > 0;
    },
    async setAttentionIfEmpty(id, reason) {
      const { error } = await db.from('followups').update({ attention_reason: reason }).eq('id', id).is('attention_reason', null);
      fail(error);
    },
    async optOut(ids) {
      if (ids.length === 0) return;
      const { error } = await db.from('patients').update({ opted_out: true }).in('id', ids);
      fail(error);
      const { data: fs, error: fErr } = await db.from('followups').select('id').in('patient_id', ids);
      fail(fErr);
      const followupIds = (fs ?? []).map((f) => f.id);
      if (followupIds.length === 0) return;
      const { error: rErr } = await db
        .from('reminders')
        .update({ status: 'cancelled', skip_reason: 'opted_out' })
        .in('followup_id', followupIds)
        .in('status', ['pending', 'failed']);
      fail(rErr);
    },
    async takeAutoReplySlot(ids, now, windowMs) {
      if (ids.length === 0) return false;
      const since = new Date(now.getTime() - windowMs).toISOString();
      const { data: recent, error } = await db
        .from('patients')
        .select('id')
        .in('id', ids)
        .gt('last_auto_reply_at', since)
        .limit(1);
      fail(error);
      if ((recent ?? []).length > 0) return false;
      const { data, error: uErr } = await db
        .from('patients')
        .update({ last_auto_reply_at: now.toISOString() })
        .in('id', ids)
        .or(`last_auto_reply_at.is.null,last_auto_reply_at.lte.${since}`)
        .select('id');
      fail(uErr);
      return (data ?? []).length > 0;
    },
    async markDeliveryFailed(sid, status) {
      const { data, error } = await db
        .from('reminders')
        .update({ status: 'failed', last_error: `twilio status ${status}` })
        .eq('provider_message_sid', sid)
        .eq('status', 'sent')
        .select('followup_id');
      fail(error);
      for (const row of data ?? []) {
        const { error: fErr } = await db
          .from('followups')
          .update({ attention_reason: 'send_failed' })
          .eq('id', row.followup_id)
          .is('attention_reason', null);
        fail(fErr);
      }
    },
  };
}
