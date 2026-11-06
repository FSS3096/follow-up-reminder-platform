import { addDays, diffDays, formatIsoDate, isValidIsoDate, istParts, minutesToTime, weekdayOf } from '@/lib/time/ist';
import {
  AFTER_MARKERS,
  AM_WORDS,
  DAY_AFTER_WORDS,
  DAY_UNITS,
  MONTHS,
  MONTH_UNITS,
  NEXT_WORDS,
  NUMBER_WORDS,
  OCLOCK_WORDS,
  PM_WORDS,
  TODAY_WORDS,
  TOMORROW_WORDS,
  WEEKDAYS,
  WEEK_UNITS,
} from './lexicon';

export type DateSource = 'explicit' | 'relative' | 'default';

export interface DateCandidate {
  date: string;
  source: Exclude<DateSource, 'default'>;
  /** Followed by "baad"/"later": the strongest signal that this is the follow-up date. */
  marked: boolean;
  /** Inherently ambiguous phrase ("aaj", explicit date rolled into next year). */
  ambiguous: boolean;
  index: number;
}

export interface DateScan {
  candidates: DateCandidate[];
  time: string | null;
  /** Token indices used by date/time expressions (excluded from name extraction). */
  consumed: Set<number>;
  /** Something looked like a date but could not be used (e.g. past date with explicit year). */
  rejected: boolean;
}

const MAX_DAYS_AHEAD = 400;

function toNumber(value: string | undefined): number | null {
  if (value === undefined) return null;
  if (/^\d{1,3}$/.test(value)) return Number(value);
  return NUMBER_WORDS[value] ?? null;
}

function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return formatIsoDate(ny, nm, Math.min(d, lastDay));
}

/** First occurrence of weekday strictly after `today`. */
function nextWeekday(today: string, weekday: number): string {
  const delta = ((weekday - weekdayOf(today) + 7) % 7) || 7;
  return addDays(today, delta);
}

/** dd/mm with no year: the next occurrence on or after today. */
function resolveDayMonth(today: string, day: number, month: number, year: number | null): { date: string; rolled: boolean } | null {
  const [ty] = today.split('-').map(Number) as [number];
  if (year !== null) {
    const full = year < 100 ? 2000 + year : year;
    const date = formatIsoDate(full, month, day);
    return isValidIsoDate(date) ? { date, rolled: false } : null;
  }
  for (const y of [ty, ty + 1, ty + 2, ty + 3, ty + 4]) {
    const date = formatIsoDate(y, month, day);
    if (isValidIsoDate(date) && date >= today) return { date, rolled: y !== ty };
  }
  return null; // e.g. 31/02
}

function parseHour(h: number, minute: number, meridiem: 'am' | 'pm' | null): string | null {
  if (minute < 0 || minute > 59) return null;
  let hour = h;
  if (meridiem === 'am') {
    if (h < 1 || h > 12) return null;
    hour = h === 12 ? 0 : h;
  } else if (meridiem === 'pm') {
    if (h < 1 || h > 12) return null;
    hour = h === 12 ? 12 : h + 12;
  } else {
    if (h > 23) return null;
    // "5 baje" with no am/pm: clinic hours. 1-7 means afternoon/evening.
    if (h >= 1 && h <= 7) hour = h + 12;
  }
  return minutesToTime(hour * 60 + minute);
}

function meridiemOf(value: string | undefined): 'am' | 'pm' | null {
  if (value === undefined) return null;
  if (AM_WORDS.has(value)) return 'am';
  if (PM_WORDS.has(value)) return 'pm';
  return null;
}

/**
 * Scans normalised tokens (clinical ones already removed, original positions kept via `index`)
 * for follow-up date and time expressions.
 */
export function scanDates(tokens: ReadonlyArray<{ value: string; index: number }>, now: Date): DateScan {
  const p = istParts(now);
  const today = formatIsoDate(p.year, p.month, p.day);
  const candidates: DateCandidate[] = [];
  const consumed = new Set<number>();
  let time: string | null = null;
  let rejected = false;

  const v = (i: number) => tokens[i]?.value;
  const take = (...is: number[]) => is.forEach((i) => tokens[i] && consumed.add((tokens[i] as { index: number }).index));
  const isMarker = (i: number) => {
    const t = v(i);
    return t !== undefined && AFTER_MARKERS.has(t);
  };
  const push = (date: string, source: 'explicit' | 'relative', at: number, last: number, ambiguous = false) => {
    if (diffDays(today, date) > MAX_DAYS_AHEAD) {
      rejected = true;
      return;
    }
    const marked = isMarker(last + 1);
    if (marked) take(last + 1);
    candidates.push({ date, source, marked, ambiguous, index: at });
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = v(i) as string;
    if (consumed.has((tokens[i] as { index: number }).index)) continue;

    // ---- times ----------------------------------------------------------
    let m = /^(\d{1,2}):(\d{2})(am|pm)?$/.exec(t);
    if (m) {
      const mer = (m[3] as 'am' | 'pm' | undefined) ?? meridiemOf(v(i + 1)) ?? meridiemOf(v(i - 1));
      const parsed = parseHour(Number(m[1]), Number(m[2]), mer ?? null);
      if (parsed) {
        time = parsed;
        take(i);
        if (!m[3] && meridiemOf(v(i + 1))) take(i + 1);
        if (meridiemOf(v(i - 1))) take(i - 1);
        if (v(i + 1) !== undefined && OCLOCK_WORDS.has(v(i + 1) as string)) take(i + 1);
        continue;
      }
    }
    m = /^(\d{1,2})(am|pm)$/.exec(t);
    if (m) {
      const parsed = parseHour(Number(m[1]), 0, m[2] as 'am' | 'pm');
      if (parsed) {
        time = parsed;
        take(i);
        continue;
      }
    }
    if (/^\d{1,2}$/.test(t)) {
      const next = v(i + 1);
      const before = meridiemOf(v(i - 1));
      if (next !== undefined && (AM_WORDS.has(next) || PM_WORDS.has(next) || OCLOCK_WORDS.has(next))) {
        const mer = meridiemOf(next) ?? before;
        const parsed = parseHour(Number(t), 0, mer);
        if (parsed) {
          time = parsed;
          take(i, i + 1);
          if (before) take(i - 1);
          if (OCLOCK_WORDS.has(next) === false && v(i + 2) !== undefined && OCLOCK_WORDS.has(v(i + 2) as string)) take(i + 2);
          continue;
        }
      }
    }

    // ---- explicit dates -------------------------------------------------
    m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/.exec(t);
    if (m) {
      const res = resolveDayMonth(today, Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : null);
      take(i);
      if (!res || res.date < today) rejected = true;
      else push(res.date, 'explicit', i, i, res.rolled);
      continue;
    }
    const dayNum = /^(\d{1,2})(st|nd|rd|th)?$/.exec(t);
    const monthAfter = v(i + 1) !== undefined ? MONTHS[v(i + 1) as string] : undefined;
    if (dayNum && monthAfter) {
      const yearTok = v(i + 2);
      const year = yearTok && /^\d{4}$/.test(yearTok) ? Number(yearTok) : null;
      const res = resolveDayMonth(today, Number(dayNum[1]), monthAfter, year);
      const last = year ? i + 2 : i + 1;
      take(i, i + 1);
      if (year) take(i + 2);
      if (!res || res.date < today) rejected = true;
      else push(res.date, 'explicit', i, last, res.rolled);
      i = last;
      continue;
    }
    const monthHere = MONTHS[t];
    const dayAfter = v(i + 1) !== undefined ? /^(\d{1,2})(st|nd|rd|th)?$/.exec(v(i + 1) as string) : null;
    if (monthHere && dayAfter) {
      const res = resolveDayMonth(today, Number(dayAfter[1]), monthHere, null);
      take(i, i + 1);
      if (!res) rejected = true;
      else push(res.date, 'explicit', i, i + 1, res.rolled);
      i += 1;
      continue;
    }

    // ---- relative: N din / N hafte / N mahine (also "next week") --------
    const n = toNumber(t);
    const unit = v(i + 1);
    if (n !== null && unit !== undefined && n > 0) {
      let date: string | null = null;
      if (DAY_UNITS.has(unit)) date = addDays(today, n);
      else if (WEEK_UNITS.has(unit)) date = addDays(today, 7 * n);
      else if (MONTH_UNITS.has(unit)) date = addMonths(today, n);
      if (date) {
        take(i, i + 1);
        push(date, 'relative', i, i + 1);
        i += 1;
        continue;
      }
    }
    if (NEXT_WORDS.has(t) && unit !== undefined && (WEEK_UNITS.has(unit) || MONTH_UNITS.has(unit))) {
      take(i, i + 1);
      push(WEEK_UNITS.has(unit) ? addDays(today, 7) : addMonths(today, 1), 'relative', i, i + 1);
      i += 1;
      continue;
    }

    // ---- weekdays ---------------------------------------------------------
    const wdAfterNext = NEXT_WORDS.has(t) && unit !== undefined ? WEEKDAYS[unit] : undefined;
    if (wdAfterNext !== undefined) {
      take(i, i + 1);
      push(nextWeekday(today, wdAfterNext), 'relative', i, i + 1);
      i += 1;
      continue;
    }
    const wd = WEEKDAYS[t];
    if (wd !== undefined) {
      take(i);
      push(nextWeekday(today, wd), 'relative', i, i);
      continue;
    }

    // ---- today / tomorrow / day after -----------------------------------
    if (TODAY_WORDS.has(t)) {
      take(i);
      push(today, 'relative', i, i, true);
      continue;
    }
    if (TOMORROW_WORDS.has(t)) {
      take(i);
      push(addDays(today, 1), 'relative', i, i);
      continue;
    }
    if (DAY_AFTER_WORDS.has(t)) {
      take(i);
      push(addDays(today, 2), 'relative', i, i);
      continue;
    }
    if (t === 'day' && v(i + 1) === 'after' && v(i + 2) === 'tomorrow') {
      take(i, i + 1, i + 2);
      push(addDays(today, 2), 'relative', i, i + 2);
      i += 2;
      continue;
    }
  }

  return { candidates, time, consumed, rejected };
}

/** Prefer a candidate marked with "baad"/"later"; otherwise the last one mentioned. */
export function chooseDate(candidates: DateCandidate[]): { chosen: DateCandidate | null; conflicting: boolean } {
  if (candidates.length === 0) return { chosen: null, conflicting: false };
  const marked = candidates.filter((c) => c.marked);
  const pool = marked.length > 0 ? marked : candidates;
  const chosen = pool[pool.length - 1] as DateCandidate;
  const distinct = new Set(candidates.map((c) => c.date));
  return { chosen, conflicting: distinct.size > 1 };
}
