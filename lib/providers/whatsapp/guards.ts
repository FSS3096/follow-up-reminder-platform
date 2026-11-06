import type { FollowupStatus, ReminderKind } from '@/lib/supabase/types';

export type SendBlockReason = 'live_send_disabled' | 'opted_out' | 'seed_patient' | 'followup_inactive';

/** Seed numbers are +91 followed by nine zeros and two digits: +9100000000NN. Never routable. */
export const SEED_PHONE = /^\+910{9}/;

/** Which followup statuses still want each reminder kind. Stricter than "not cancelled/completed". */
export const ACTIVE_STATUSES: Readonly<Record<ReminderKind, readonly FollowupStatus[]>> = {
  confirmation: ['approved'],
  day_before: ['approved', 'confirmed'],
  morning_of: ['approved', 'confirmed'],
  missed_nudge: ['missed'],
};

export interface GuardInput {
  live: boolean;
  allowLiveSend: boolean;
  kind: ReminderKind;
  followupStatus: FollowupStatus;
  patient: { opted_out: boolean; is_seed: boolean; phone_e164: string };
}

/**
 * Brief 6.3 send guards. All must pass before any real send:
 *  1. ALLOW_LIVE_SEND === 'true'   2. not opted out   3. not seed / not a seed number   4. followup still active.
 * Non-live providers (console, wa_link) still respect 2 and 4.
 */
export function checkSendGuards(g: GuardInput): { ok: true } | { ok: false; reason: SendBlockReason } {
  if (g.patient.opted_out) return { ok: false, reason: 'opted_out' };
  if (!ACTIVE_STATUSES[g.kind].includes(g.followupStatus)) return { ok: false, reason: 'followup_inactive' };
  if (g.live) {
    if (!g.allowLiveSend) return { ok: false, reason: 'live_send_disabled' };
    if (g.patient.is_seed || SEED_PHONE.test(g.patient.phone_e164)) return { ok: false, reason: 'seed_patient' };
  }
  return { ok: true };
}
