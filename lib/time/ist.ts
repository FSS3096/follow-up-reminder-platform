/**
 * India Standard Time helpers. IST is a fixed UTC+05:30 with no daylight saving,
 * so plain offset arithmetic is exact and independent of the machine timezone.
 * Business dates are IST calendar dates 'YYYY-MM-DD'; times are IST 'HH:mm'.
 */

export const IST_OFFSET_MINUTES = 330;
const OFFSET_MS = IST_OFFSET_MINUTES * 60_000;
const DAY_MS = 86_400_000;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export interface IstParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0 = Sunday
}

export function istParts(instant: Date): IstParts {
  const shifted = new Date(instant.getTime() + OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    weekday: shifted.getUTCDay(),
  };
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

export function formatIsoDate(year: number, month: number, day: number): string {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/** True only for a real calendar date in 'YYYY-MM-DD' form (rejects 2026-02-30). */
export function isValidIsoDate(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1) return false;
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d;
}

export function isValidTime(value: string): boolean {
  return TIME_RE.test(value);
}

/** Minutes since midnight for a valid 'HH:mm'. */
export function timeToMinutes(value: string): number {
  const m = TIME_RE.exec(value);
  if (!m) throw new RangeError(`Invalid time: ${value}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

export function minutesToTime(total: number): string {
  if (!Number.isInteger(total) || total < 0 || total >= 24 * 60) throw new RangeError(`Invalid minutes: ${total}`);
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

function dateToUtcMidnight(date: string): number {
  if (!isValidIsoDate(date)) throw new RangeError(`Invalid date: ${date}`);
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

/** Absolute instant for an IST wall-clock date + minutes after midnight. */
export function istInstant(date: string, minutesAfterMidnight: number): Date {
  return new Date(dateToUtcMidnight(date) + minutesAfterMidnight * 60_000 - OFFSET_MS);
}

/** Absolute instant for an IST wall-clock date + 'HH:mm'. */
export function istDateTime(date: string, time: string): Date {
  return istInstant(date, timeToMinutes(time));
}

/** The IST calendar date of an instant. */
export function istDate(instant: Date): string {
  const p = istParts(instant);
  return formatIsoDate(p.year, p.month, p.day);
}

export function addDays(date: string, days: number): string {
  const shifted = new Date(dateToUtcMidnight(date) + days * DAY_MS);
  return formatIsoDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

/** 0 = Sunday. */
export function weekdayOf(date: string): number {
  return new Date(dateToUtcMidnight(date)).getUTCDay();
}

/** Signed difference in whole days, b - a. */
export function diffDays(a: string, b: string): number {
  return Math.round((dateToUtcMidnight(b) - dateToUtcMidnight(a)) / DAY_MS);
}

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** 'Mon, 9 Nov' (template variable date_long). */
export function formatDateLong(date: string): string {
  const [, m, d] = date.split('-').map(Number) as [number, number, number];
  return `${WEEKDAY_SHORT[weekdayOf(date)]}, ${d} ${MONTH_SHORT[m - 1]}`;
}

/** '17:00' -> '5:00 PM'. */
export function formatTime12h(time: string): string {
  const total = timeToMinutes(time);
  const h = Math.floor(total / 60);
  const m = total % 60;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(m)} ${suffix}`;
}
