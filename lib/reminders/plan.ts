import { addDays, istDate, istDateTime, istInstant, isValidIsoDate, isValidTime, timeToMinutes } from '@/lib/time/ist';
import { nextAllowedSendTime } from './quietHours';

export type ReminderKind = 'confirmation' | 'day_before' | 'morning_of' | 'missed_nudge';

export interface PlannedReminder {
  kind: ReminderKind;
  scheduledFor: Date; // absolute instant
  status: 'pending' | 'skipped';
  skipReason?: 'in_past';
}

export class InvalidFollowupDateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidFollowupDateError';
  }
}

/** Subclass so callers catching InvalidFollowupDateError also catch bad times. */
export class InvalidFollowupTimeError extends InvalidFollowupDateError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidFollowupTimeError';
  }
}

export interface PlanInput {
  followupDate: string; // IST 'YYYY-MM-DD'
  followupTime: string | null; // IST 'HH:mm'
  now: Date;
}

/** A reminder is only worth sending if it lands strictly after now + 1 minute. */
const MIN_LEAD_MS = 60_000;

const DAY_BEFORE_MIN = 18 * 60;
const MORNING_DEFAULT_MIN = 8 * 60;
const MORNING_FLOOR_MIN = 7 * 60;
const MORNING_LEAD_MIN = 3 * 60;

interface PlanStep {
  kind: Exclude<ReminderKind, 'missed_nudge'>;
  /** Always planned as pending (no in_past skip). */
  always?: boolean;
  at: (input: PlanInput) => Date;
}

/**
 * The reminder plan in one array. Adding `two_days_before` later is one entry here
 * plus the enum value in the DB and ReminderKind.
 */
export const PLAN: readonly PlanStep[] = [
  { kind: 'confirmation', always: true, at: ({ now }) => nextAllowedSendTime(now) },
  { kind: 'day_before', at: ({ followupDate }) => istInstant(addDays(followupDate, -1), DAY_BEFORE_MIN) },
  {
    kind: 'morning_of',
    at: ({ followupDate, followupTime }) => {
      if (followupTime === null) return istInstant(followupDate, MORNING_DEFAULT_MIN);
      const minutes = Math.max(MORNING_FLOOR_MIN, timeToMinutes(followupTime) - MORNING_LEAD_MIN);
      return istInstant(followupDate, minutes);
    },
  },
];

export function assertValidFollowup(input: PlanInput): void {
  if (!(input.now instanceof Date) || Number.isNaN(input.now.getTime())) {
    throw new TypeError('now must be a valid Date');
  }
  if (typeof input.followupDate !== 'string' || !isValidIsoDate(input.followupDate)) {
    throw new InvalidFollowupDateError('followupDate must be a real YYYY-MM-DD date');
  }
  if (input.followupTime !== null && (typeof input.followupTime !== 'string' || !isValidTime(input.followupTime))) {
    throw new InvalidFollowupTimeError('followupTime must be HH:mm (00:00-23:59) or null');
  }
  if (input.followupDate < istDate(input.now)) {
    throw new InvalidFollowupDateError('followupDate is in the past');
  }
}

/** Pure. followupDate is an IST calendar date; followupTime is IST 'HH:mm' or null. */
export function planReminders(input: PlanInput): PlannedReminder[] {
  assertValidFollowup(input);
  const threshold = input.now.getTime() + MIN_LEAD_MS;
  return PLAN.map((step) => {
    const scheduledFor = step.at(input);
    if (step.always || scheduledFor.getTime() > threshold) {
      return { kind: step.kind, scheduledFor, status: 'pending' as const };
    }
    return { kind: step.kind, scheduledFor, status: 'skipped' as const, skipReason: 'in_past' as const };
  });
}

/** The appointment instant if a time is set (used by callers for display / sanity checks). */
export function appointmentInstant(followupDate: string, followupTime: string | null): Date | null {
  return followupTime === null ? null : istDateTime(followupDate, followupTime);
}

export { nextAllowedSendTime };
