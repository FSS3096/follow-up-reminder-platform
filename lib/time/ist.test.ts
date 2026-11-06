import { describe, expect, it } from 'vitest';
import {
  addDays,
  diffDays,
  formatDateLong,
  formatTime12h,
  istDate,
  istDateTime,
  istParts,
  isValidIsoDate,
  isValidTime,
  weekdayOf,
} from './ist';

describe('IST helpers', () => {
  it('converts IST wall clock to UTC', () => {
    expect(istDateTime('2026-11-06', '00:00').toISOString()).toBe('2026-11-05T18:30:00.000Z');
  });
  it('reads IST parts from an instant regardless of machine TZ', () => {
    expect(istParts(new Date('2026-11-06T20:30:00Z'))).toMatchObject({ year: 2026, month: 11, day: 7, hour: 2, minute: 0 });
    expect(istDate(new Date('2026-11-06T18:29:59Z'))).toBe('2026-11-06');
    expect(istDate(new Date('2026-11-06T18:30:00Z'))).toBe('2026-11-07');
  });
  it('adds days across month, year and leap boundaries', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(diffDays('2026-11-06', '2026-11-13')).toBe(7);
  });
  it('validates dates and times strictly', () => {
    expect(isValidIsoDate('2028-02-29')).toBe(true);
    expect(isValidIsoDate('2026-02-29')).toBe(false);
    expect(isValidIsoDate('2026-04-31')).toBe(false);
    expect(isValidTime('00:00')).toBe(true);
    expect(isValidTime('23:59')).toBe(true);
    expect(isValidTime('24:00')).toBe(false);
  });
  it('knows weekdays', () => {
    expect(weekdayOf('2026-11-06')).toBe(5); // Friday
    expect(weekdayOf('2026-11-08')).toBe(0); // Sunday
  });
  it('formats for templates', () => {
    expect(formatDateLong('2026-11-09')).toBe('Mon, 9 Nov');
    expect(formatTime12h('17:00')).toBe('5:00 PM');
    expect(formatTime12h('00:15')).toBe('12:15 AM');
    expect(formatTime12h('12:00')).toBe('12:00 PM');
  });
});
