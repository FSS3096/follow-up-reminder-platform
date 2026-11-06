import type { ReminderContext, TickRepo } from '@/lib/data/tickRepo';
import type { ReminderRow } from '@/lib/data/remindersRepo';
import { log } from '@/lib/log';
import { buildMessage, type ClinicContext } from '@/lib/outbound/build';
import { checkSendGuards, ManualSendRequired, ProviderError, type WhatsAppProvider } from '@/lib/providers/whatsapp';
import { formatDateLong, formatTime12h, istDate } from '@/lib/time/ist';
import { missedCutoff, missedNudgeAt } from './missed';
import { isQuietHours, nextAllowedSendTime } from './quietHours';

export const BATCH_SIZE = 25;
export const SEND_CONCURRENCY = 5;
export const MAX_ATTEMPTS = 3;
export const BACKOFF_MS = 10 * 60_000;

export interface TickDeps {
  repo: TickRepo;
  provider: WhatsAppProvider;
  allowLiveSend: boolean;
  clinic: ClinicContext;
  now: () => Date;
}

export interface TickResult {
  claimed: number;
  sent: number;
  failed: number;
  skipped: number;
  deferred: number;
  retried: number;
  markedMissed: number;
  recoveredStuck: number;
}

export type Outcome = 'sent' | 'failed' | 'skipped' | 'deferred' | 'retried';

/** Runs `fn` over items with at most `limit` in flight. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i] as T);
    }
  });
  await Promise.all(workers);
  return results;
}

/** A reminder that is too late to make sense (tick was down) is skipped, not sent. */
export function tooLate(kind: ReminderRow['kind'], followupDate: string, now: Date): boolean {
  const today = istDate(now);
  switch (kind) {
    case 'confirmation':
      return today > followupDate;
    case 'day_before':
      return today >= followupDate; // would say "kal" on the day itself
    case 'morning_of':
      return today !== followupDate;
    case 'missed_nudge':
      return false;
  }
}

function errorText(err: unknown): string {
  if (err instanceof ProviderError) return err.message.slice(0, 200);
  if (err instanceof Error) return `${err.name}`.slice(0, 200);
  return 'unknown error';
}

/** Processes one claimed reminder end to end. Never throws. */
export async function processReminder(r: ReminderRow, ctx: ReminderContext | undefined, deps: TickDeps): Promise<Outcome> {
  const { repo, provider } = deps;
  const now = deps.now();
  try {
    if (isQuietHours(now)) {
      await repo.defer(r.id, nextAllowedSendTime(now), r.attempts);
      return 'deferred';
    }
    if (!ctx) {
      await repo.markSkipped(r.id, 'followup_missing');
      return 'skipped';
    }
    const { followup, patient } = ctx;
    if (!patient) {
      await repo.markSkipped(r.id, 'no_patient');
      return 'skipped';
    }
    if (tooLate(r.kind, followup.followup_date, now)) {
      await repo.markSkipped(r.id, 'too_late');
      return 'skipped';
    }
    const guard = checkSendGuards({
      live: provider.live,
      allowLiveSend: deps.allowLiveSend,
      kind: r.kind,
      followupStatus: followup.status,
      patient,
    });
    if (!guard.ok) {
      await repo.markSkipped(r.id, guard.reason);
      return 'skipped';
    }

    const followupTime = followup.followup_time ? followup.followup_time.slice(0, 5) : null;
    const body = buildMessage(
      r.kind,
      { patientName: patient.name, language: patient.language, followupDate: followup.followup_date, followupTime },
      deps.clinic,
    );

    let sid: string;
    try {
      ({ sid } = await provider.send({
        toE164: patient.phone_e164,
        body,
        lastInboundAt: patient.last_inbound_at ? new Date(patient.last_inbound_at) : null,
        sandboxTemplateVars: {
          date: formatDateLong(followup.followup_date),
          time: followupTime ? formatTime12h(followupTime) : 'during clinic hours',
        },
      }));
    } catch (err) {
      if (err instanceof ManualSendRequired) {
        await repo.markSkipped(r.id, 'manual_send');
        return 'skipped';
      }
      const retryable = !(err instanceof ProviderError) || err.retryable;
      const text = errorText(err);
      if (retryable && r.attempts < MAX_ATTEMPTS) {
        await repo.markRetry(r.id, nextAllowedSendTime(new Date(now.getTime() + BACKOFF_MS * r.attempts)), text);
        log.warn('reminder_retry', { reminderId: r.id, attempts: r.attempts, error: text });
        return 'retried';
      }
      await repo.markFailed(r.id, r.followup_id, text);
      log.error('reminder_failed', { reminderId: r.id, attempts: r.attempts, error: text });
      return 'failed';
    }

    // The message is out. Never route a bookkeeping failure into the retry path (that would double-send).
    try {
      await repo.markSent(r.id, provider.name, sid, now);
    } catch (err) {
      log.error('reminder_mark_sent_failed', { reminderId: r.id, sid, err });
    }
    log.info('reminder_sent', { reminderId: r.id, kind: r.kind, provider: provider.name, to: patient.phone_e164 });
    return 'sent';
  } catch (err) {
    // A DB write failed. The row stays 'sending' and recoverStuck() picks it up after 10 minutes.
    log.error('reminder_process_error', { reminderId: r.id, err });
    return 'failed';
  }
}

/**
 * One scheduler tick (Brief B6). Idempotent and safe to run concurrently:
 * claims use FOR UPDATE SKIP LOCKED, every write is conditioned on status = 'sending'.
 */
export async function runTick(deps: TickDeps): Promise<TickResult> {
  const now = deps.now();
  const recoveredStuck = await deps.repo.recoverStuck();
  const markedMissed = await deps.repo.markMissed(missedCutoff(now), missedNudgeAt(now));
  const claimed = await deps.repo.claimDue(BATCH_SIZE);
  const contexts = await deps.repo.loadContext([...new Set(claimed.map((r) => r.followup_id))]);

  const outcomes = await mapLimit(claimed, SEND_CONCURRENCY, (r) => processReminder(r, contexts.get(r.followup_id), deps));
  const count = (o: Outcome) => outcomes.filter((x) => x === o).length;
  return {
    claimed: claimed.length,
    sent: count('sent'),
    failed: count('failed'),
    skipped: count('skipped'),
    deferred: count('deferred'),
    retried: count('retried'),
    markedMissed,
    recoveredStuck,
  };
}

/** Approve's best-effort inline confirmation. Returns the outcome, or null if nothing was due. */
export async function sendConfirmationNow(followupId: string, deps: TickDeps): Promise<Outcome | null> {
  const r = await deps.repo.claimOne(followupId, 'confirmation');
  if (!r) return null;
  const ctx = (await deps.repo.loadContext([followupId])).get(followupId);
  return processReminder(r, ctx, deps);
}
