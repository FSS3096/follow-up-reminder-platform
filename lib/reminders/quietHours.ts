import { addDays, istDate, istInstant, istParts } from '@/lib/time/ist';

/** No sends from 21:00 to 07:00 IST; anything landing there moves to 07:30 IST. */
export const QUIET_START_MIN = 21 * 60;
export const QUIET_END_MIN = 7 * 60;
export const QUIET_RESUME_MIN = 7 * 60 + 30;

export function isQuietHours(instant: Date): boolean {
  const p = istParts(instant);
  const minutes = p.hour * 60 + p.minute;
  return minutes >= QUIET_START_MIN || minutes < QUIET_END_MIN;
}

/** `now` if sending is allowed, else the next 07:30 IST. */
export function nextAllowedSendTime(now: Date): Date {
  if (!isQuietHours(now)) return new Date(now.getTime());
  const p = istParts(now);
  const today = istDate(now);
  const day = p.hour * 60 + p.minute >= QUIET_START_MIN ? addDays(today, 1) : today;
  return istInstant(day, QUIET_RESUME_MIN);
}
