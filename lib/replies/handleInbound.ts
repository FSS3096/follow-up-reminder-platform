import type { FollowupRow } from '@/lib/data/followupsRepo';
import type { InboundRepo } from '@/lib/data/inboundRepo';
import type { PatientRow } from '@/lib/data/patientsRepo';
import { log } from '@/lib/log';
import { buildMessage, type ClinicContext } from '@/lib/outbound/build';
import type { TemplateKey } from '@/lib/outbound/render';
import { createRateLimiter, type RateLimiter } from '@/lib/http/rateLimit';
import { istDate } from '@/lib/time/ist';
import { classify, type Intent } from './intent';

export const AUTO_REPLY_WINDOW_MS = 6 * 60 * 60 * 1000;

export interface InboundDeps {
  repo: InboundRepo;
  clinic: ClinicContext;
  now: () => Date;
  /** Fallback limiter for unknown numbers (no patient row to store the timestamp on). */
  unknownLimiter?: RateLimiter;
}

export interface InboundInput {
  fromE164: string;
  /** Used for classification only. Never stored, never logged. */
  body: string;
}

export interface InboundResult {
  intent: Intent;
  action: 'confirmed' | 'reschedule_requested' | 'opted_out' | 'noted' | 'none';
  reply: string | null;
}

const defaultUnknownLimiter = createRateLimiter({ limit: 1, windowMs: AUTO_REPLY_WINDOW_MS });

/**
 * The followup a reply refers to: the soonest upcoming active one (today - 1 onwards),
 * otherwise the most recent active one.
 */
export function pickFollowup(active: FollowupRow[], now: Date): FollowupRow | null {
  if (active.length === 0) return null;
  const sorted = [...active].sort((a, b) => a.followup_date.localeCompare(b.followup_date) || a.created_at.localeCompare(b.created_at));
  const today = istDate(now);
  return sorted.find((f) => f.followup_date >= today) ?? (sorted[sorted.length - 1] as FollowupRow);
}

function replyFor(key: TemplateKey, patient: PatientRow | undefined, followup: FollowupRow | null, deps: InboundDeps): string {
  return buildMessage(
    key,
    {
      patientName: patient?.name ?? '',
      language: patient?.language ?? 'hinglish',
      followupDate: followup?.followup_date ?? istDate(deps.now()),
      followupTime: followup?.followup_time ? followup.followup_time.slice(0, 5) : null,
    },
    deps.clinic,
  );
}

/** Brief B7 reply table. L5: anything that is not 1 / 2 / stop gets one fixed reply, at most once per 6 h. */
export async function handleInbound(input: InboundInput, deps: InboundDeps): Promise<InboundResult> {
  const now = deps.now();
  const intent = classify(input.body);
  const patients = await deps.repo.findPatientsByPhone(input.fromE164);
  const ids = patients.map((p) => p.id);
  await deps.repo.touchInbound(ids, now);

  if (intent === 'join') return { intent, action: 'none', reply: null };

  const active = await deps.repo.activeFollowups(ids);
  const followup = pickFollowup(active, now);
  const patient = followup ? patients.find((p) => p.id === followup.patient_id) : patients[0];

  if (intent === 'stop' && patients.length > 0) {
    await deps.repo.optOut(ids);
    log.info('inbound_opt_out', { from: input.fromE164, patients: ids.length });
    return { intent, action: 'opted_out', reply: replyFor('optout_ack', patient, followup, deps) };
  }

  if (intent === 'confirm' && followup) {
    if (followup.status === 'approved') {
      const changed = await deps.repo.transition(followup.id, ['approved'], { status: 'confirmed', confirmed_at: now.toISOString() });
      if (changed) return { intent, action: 'confirmed', reply: replyFor('reply_confirmed', patient, followup, deps) };
      const current = await deps.repo.getFollowup(followup.id);
      if (current?.status === 'confirmed') return { intent, action: 'none', reply: replyFor('reply_confirmed', patient, current, deps) };
      if (current?.status === 'reschedule_requested') {
        return { intent, action: 'none', reply: replyFor('reply_reschedule_ack', patient, current, deps) };
      }
      return { intent, action: 'none', reply: null };
    }
    if (followup.status === 'confirmed') return { intent, action: 'none', reply: replyFor('reply_confirmed', patient, followup, deps) };
    // reschedule_requested: the clinic is already calling them; acknowledge that instead.
    return { intent, action: 'none', reply: replyFor('reply_reschedule_ack', patient, followup, deps) };
  }

  if (intent === 'reschedule' && followup) {
    if (followup.status !== 'reschedule_requested') {
      const changed = await deps.repo.transition(followup.id, ['approved', 'confirmed'], {
        status: 'reschedule_requested',
        attention_reason: 'reschedule_requested',
      });
      if (!changed) {
        const current = await deps.repo.getFollowup(followup.id);
        if (current?.status === 'reschedule_requested') {
          return { intent, action: 'none', reply: replyFor('reply_reschedule_ack', patient, current, deps) };
        }
        return { intent, action: 'none', reply: null };
      }
    }
    return { intent, action: 'reschedule_requested', reply: replyFor('reply_reschedule_ack', patient, followup, deps) };
  }

  // Anything else, or a phone / followup we do not know: no status change, one fixed reply (rate limited).
  if (followup) await deps.repo.setAttentionIfEmpty(followup.id, 'patient_message');
  const allowed =
    ids.length > 0
      ? await deps.repo.takeAutoReplySlot(ids, now, AUTO_REPLY_WINDOW_MS)
      : (deps.unknownLimiter ?? defaultUnknownLimiter).check(input.fromE164, now.getTime()) === 0;
  return {
    intent,
    action: followup ? 'noted' : 'none',
    reply: allowed ? replyFor('reply_out_of_scope', patient, followup, deps) : null,
  };
}
