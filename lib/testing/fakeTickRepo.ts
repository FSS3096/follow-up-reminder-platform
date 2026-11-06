/** In-memory TickRepo mirroring the SQL semantics (claim is atomic, writes require status 'sending'). */
import type { ReminderContext, TickRepo } from '@/lib/data/tickRepo';
import type { FollowupRow } from '@/lib/data/followupsRepo';
import type { PatientRow } from '@/lib/data/patientsRepo';
import type { ReminderRow } from '@/lib/data/remindersRepo';
import type { ReminderKind, ReminderStatus } from '@/lib/supabase/types';
import { makeFollowup, makePatient } from './fakeFollowupStore';

let seq = 0;

export class FakeTickRepo implements TickRepo {
  followups = new Map<string, FollowupRow>();
  patients = new Map<string, PatientRow>();
  reminders: ReminderRow[] = [];
  missedCalls: Array<{ cutoff: string; nudgeAt: Date }> = [];
  constructor(public clock: () => Date) {}

  addFollowup(f: Partial<FollowupRow> = {}, p: Partial<PatientRow> | null = {}) {
    const patient = p === null ? null : makePatient(p);
    if (patient) this.patients.set(patient.id, patient);
    const followup = makeFollowup({ status: 'approved', patient_id: patient?.id ?? null, raw_note: null, ...f });
    this.followups.set(followup.id, followup);
    return { followup, patient };
  }

  addReminder(followupId: string, kind: ReminderKind, over: Partial<ReminderRow> = {}) {
    seq += 1;
    const r: ReminderRow = {
      id: `r-${seq}`,
      followup_id: followupId,
      kind,
      scheduled_for: new Date(this.clock().getTime() - 60_000).toISOString(),
      status: 'pending',
      attempts: 0,
      provider: null,
      provider_message_sid: null,
      skip_reason: null,
      last_error: null,
      claimed_at: null,
      sent_at: null,
      created_at: this.clock().toISOString(),
      ...over,
    };
    this.reminders.push(r);
    return r;
  }

  private sending(id: string) {
    const r = this.reminders.find((x) => x.id === id);
    return r && r.status === 'sending' ? r : undefined;
  }

  async recoverStuck() {
    const cutoff = this.clock().getTime() - 10 * 60_000;
    let n = 0;
    for (const r of this.reminders) {
      if (r.status === 'sending' && r.claimed_at && new Date(r.claimed_at).getTime() < cutoff) {
        r.status = (r.attempts >= 3 ? 'failed' : 'pending') as ReminderStatus;
        r.claimed_at = null;
        n++;
      }
    }
    return n;
  }
  async markMissed(cutoff: string, nudgeAt: Date) {
    this.missedCalls.push({ cutoff, nudgeAt });
    let n = 0;
    for (const f of this.followups.values()) {
      if (['approved', 'confirmed', 'reschedule_requested'].includes(f.status) && f.followup_date < cutoff) {
        f.status = 'missed';
        f.missed_at = this.clock().toISOString();
        n++;
        for (const r of this.reminders) if (r.followup_id === f.id && r.status === 'pending') r.status = 'cancelled';
        if (!this.reminders.some((r) => r.followup_id === f.id && r.kind === 'missed_nudge')) {
          this.addReminder(f.id, 'missed_nudge', { scheduled_for: nudgeAt.toISOString() });
        }
      }
    }
    return n;
  }
  async claimDue(batch: number) {
    const now = this.clock().getTime();
    const due = this.reminders
      .filter((r) => r.status === 'pending' && new Date(r.scheduled_for).getTime() <= now)
      .sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for))
      .slice(0, batch);
    for (const r of due) Object.assign(r, { status: 'sending', claimed_at: this.clock().toISOString(), attempts: r.attempts + 1 });
    return due.map((r) => ({ ...r }));
  }
  async claimOne(followupId: string, kind: ReminderKind) {
    const r = this.reminders.find(
      (x) => x.followup_id === followupId && x.kind === kind && x.status === 'pending' && new Date(x.scheduled_for) <= this.clock(),
    );
    if (!r) return null;
    Object.assign(r, { status: 'sending', claimed_at: this.clock().toISOString(), attempts: r.attempts + 1 });
    return { ...r };
  }
  async loadContext(ids: string[]) {
    const out = new Map<string, ReminderContext>();
    for (const id of ids) {
      const f = this.followups.get(id);
      if (f) out.set(id, { followup: { ...f }, patient: f.patient_id ? { ...this.patients.get(f.patient_id)! } : null });
    }
    return out;
  }
  async markSent(id: string, provider: string, sid: string, at: Date) {
    const r = this.sending(id);
    if (r) Object.assign(r, { status: 'sent', provider, provider_message_sid: sid, sent_at: at.toISOString() });
  }
  async markSkipped(id: string, reason: string) {
    const r = this.sending(id);
    if (r) Object.assign(r, { status: 'skipped', skip_reason: reason });
  }
  async markRetry(id: string, nextAt: Date, error: string) {
    const r = this.sending(id);
    if (r) Object.assign(r, { status: 'pending', scheduled_for: nextAt.toISOString(), last_error: error, claimed_at: null });
  }
  async defer(id: string, to: Date, attempts: number) {
    const r = this.sending(id);
    if (r) Object.assign(r, { status: 'pending', scheduled_for: to.toISOString(), attempts: Math.max(0, attempts - 1), claimed_at: null });
  }
  async markFailed(id: string, followupId: string, error: string) {
    const r = this.sending(id);
    if (r) Object.assign(r, { status: 'failed', last_error: error });
    const f = this.followups.get(followupId);
    if (f && f.attention_reason === null) f.attention_reason = 'send_failed';
  }
}
