import { addDays, istDate } from '@/lib/time/ist';
import { nextAllowedSendTime } from './quietHours';

/**
 * Missed rule (Brief B6): active followup AND followup_date < today_IST - 1 day.
 * One day of grace: a followup dated yesterday is not missed yet.
 */
export function missedCutoff(now: Date): string {
  return addDays(istDate(now), -1);
}

export function missedNudgeAt(now: Date): Date {
  return nextAllowedSendTime(now);
}
