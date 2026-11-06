import type { FollowupRow } from '@/lib/data/followupsRepo';
import type { InboundRepo } from '@/lib/data/inboundRepo';
import type { PatientRow } from '@/lib/data/patientsRepo';
import type { ReminderRow } from '@/lib/data/remindersRepo';
import { makeFollowup, makePatient } from './fakeFollowupStore';

export class FakeInboundRepo implements InboundRepo {
  patients: PatientRow[] = [];
  followups: FollowupRow[] = [];
  reminders: Array<Pick<ReminderRow, 'followup_id' | 'status' | 'provider_message_sid' | 'last_error'>> = [];

  addPatient(over: Partial<PatientRow> = {}) {
    const p = makePatient(over);
    this.patients.push(p);
    return p;
  }
  addFollowup(over: Partial<FollowupRow> = {}) {
    const f = makeFollowup({ status: 'approved', raw_note: null, ...over });
    this.followups.push(f);
    return f;
  }

  async findPatientsByPhone(phone: string) {
    return this.patients.filter((p) => p.phone_e164 === phone).map((p) => ({ ...p }));
  }
  async touchInbound(ids: string[], at: Date) {
    for (const p of this.patients) if (ids.includes(p.id)) p.last_inbound_at = at.toISOString();
  }
  async activeFollowups(ids: string[]) {
    return this.followups
      .filter((f) => f.patient_id && ids.includes(f.patient_id) && ['approved', 'confirmed', 'reschedule_requested'].includes(f.status))
      .map((f) => ({ ...f }));
  }
  async transition(id: string, from: FollowupRow['status'][], patch: Partial<FollowupRow>) {
    const f = this.followups.find((x) => x.id === id);
    if (!f || !from.includes(f.status)) return false;
    Object.assign(f, patch);
    return true;
  }
  async setAttentionIfEmpty(id: string, reason: NonNullable<FollowupRow['attention_reason']>) {
    const f = this.followups.find((x) => x.id === id);
    if (f && f.attention_reason === null) f.attention_reason = reason;
  }
  async optOut(ids: string[]) {
    for (const p of this.patients) if (ids.includes(p.id)) p.opted_out = true;
    const fids = this.followups.filter((f) => f.patient_id && ids.includes(f.patient_id)).map((f) => f.id);
    for (const r of this.reminders) if (fids.includes(r.followup_id) && (r.status === 'pending' || r.status === 'failed')) r.status = 'cancelled';
  }
  async takeAutoReplySlot(ids: string[], now: Date, windowMs: number) {
    const ps = this.patients.filter((p) => ids.includes(p.id));
    if (ps.some((p) => p.last_auto_reply_at && now.getTime() - new Date(p.last_auto_reply_at).getTime() < windowMs)) return false;
    for (const p of ps) p.last_auto_reply_at = now.toISOString();
    return ps.length > 0;
  }
  async markDeliveryFailed(sid: string, status: string) {
    for (const r of this.reminders) {
      if (r.provider_message_sid === sid && r.status === 'sent') {
        r.status = 'failed';
        r.last_error = `twilio status ${status}`;
        const f = this.followups.find((x) => x.id === r.followup_id);
        if (f && f.attention_reason === null) f.attention_reason = 'send_failed';
      }
    }
  }
}
