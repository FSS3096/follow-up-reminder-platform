import { describe, expect, it } from 'vitest';
import { istDateTime } from '@/lib/time/ist';
import { InvalidFollowupDateError, PLAN, planReminders, type PlannedReminder } from './plan';
import { isQuietHours, nextAllowedSendTime } from './quietHours';

/** IST wall clock -> instant, e.g. ist('2026-11-06 15:00'). */
function ist(s: string): Date {
  const [d, t] = s.split(' ') as [string, string];
  return istDateTime(d, t);
}

function byKind(plan: PlannedReminder[]) {
  return Object.fromEntries(plan.map((r) => [r.kind, r]));
}

describe('planReminders (Brief C2a table)', () => {
  it('#1 future date without time: three pending reminders at the spec times', () => {
    const r = byKind(planReminders({ followupDate: '2026-11-11', followupTime: null, now: ist('2026-11-06 15:00') }));
    expect(r.confirmation).toEqual({ kind: 'confirmation', scheduledFor: ist('2026-11-06 15:00'), status: 'pending' });
    expect(r.day_before).toEqual({ kind: 'day_before', scheduledFor: ist('2026-11-10 18:00'), status: 'pending' });
    expect(r.morning_of).toEqual({ kind: 'morning_of', scheduledFor: ist('2026-11-11 08:00'), status: 'pending' });
    expect(Object.keys(r)).toHaveLength(3);
  });

  it.each([
    ['#2', '10:00', '07:00'],
    ['#3', '17:00', '14:00'],
    ['#4', '09:00', '07:00'],
  ])('%s morning_of with time %s is at %s', (_id, time, expected) => {
    const r = byKind(planReminders({ followupDate: '2026-11-11', followupTime: time, now: ist('2026-11-06 15:00') }));
    expect(r.morning_of?.scheduledFor).toEqual(ist(`2026-11-11 ${expected}`));
    expect(r.morning_of?.status).toBe('pending');
  });

  it('#5 tomorrow, before 18:00 today: day_before is today 18:00 and pending', () => {
    const r = byKind(planReminders({ followupDate: '2026-11-07', followupTime: null, now: ist('2026-11-06 15:00') }));
    expect(r.day_before).toMatchObject({ scheduledFor: ist('2026-11-06 18:00'), status: 'pending' });
  });

  it('#6 tomorrow, after 18:00 today: day_before skipped in_past, morning_of pending', () => {
    const r = byKind(planReminders({ followupDate: '2026-11-07', followupTime: null, now: ist('2026-11-06 19:00') }));
    expect(r.day_before).toMatchObject({ status: 'skipped', skipReason: 'in_past' });
    expect(r.morning_of).toMatchObject({ scheduledFor: ist('2026-11-07 08:00'), status: 'pending' });
  });

  it('#7 today, afternoon: day_before and morning_of skipped, confirmation pending', () => {
    const r = byKind(planReminders({ followupDate: '2026-11-06', followupTime: null, now: ist('2026-11-06 15:00') }));
    expect(r.day_before).toMatchObject({ status: 'skipped', skipReason: 'in_past' });
    expect(r.morning_of).toMatchObject({ status: 'skipped', skipReason: 'in_past' });
    expect(r.confirmation).toMatchObject({ status: 'pending' });
  });

  it('#8 approved in quiet hours: confirmation moves to 07:30 next morning', () => {
    const r = byKind(planReminders({ followupDate: '2026-11-11', followupTime: null, now: ist('2026-11-06 23:30') }));
    expect(r.confirmation).toMatchObject({ scheduledFor: ist('2026-11-07 07:30'), status: 'pending' });
  });

  it('#9 morning_of exactly at now is skipped (needs strictly after now + 1 min)', () => {
    const r = byKind(planReminders({ followupDate: '2026-11-06', followupTime: '18:00', now: ist('2026-11-06 15:00') }));
    expect(r.morning_of).toMatchObject({ scheduledFor: ist('2026-11-06 15:00'), status: 'skipped' });
  });

  it('skips a reminder that is only 1 minute ahead, keeps one 2 minutes ahead', () => {
    const one = byKind(planReminders({ followupDate: '2026-11-06', followupTime: '18:00', now: ist('2026-11-06 14:59') }));
    expect(one.morning_of?.status).toBe('skipped');
    const two = byKind(planReminders({ followupDate: '2026-11-06', followupTime: '18:00', now: ist('2026-11-06 14:58') }));
    expect(two.morning_of?.status).toBe('pending');
  });

  it('#10 year boundary', () => {
    const r = byKind(planReminders({ followupDate: '2027-01-01', followupTime: null, now: ist('2026-12-30 12:00') }));
    expect(r.day_before?.scheduledFor).toEqual(ist('2026-12-31 18:00'));
    expect(r.morning_of?.scheduledFor).toEqual(ist('2027-01-01 08:00'));
  });

  it('#11 absolute UTC instants', () => {
    const r = byKind(planReminders({ followupDate: '2026-11-11', followupTime: null, now: ist('2026-11-06 15:00') }));
    expect(r.day_before?.scheduledFor.toISOString()).toBe('2026-11-10T12:30:00.000Z');
    expect(r.morning_of?.scheduledFor.toISOString()).toBe('2026-11-11T02:30:00.000Z');
  });

  it('#12 a past date throws InvalidFollowupDateError', () => {
    expect(() => planReminders({ followupDate: '2026-11-05', followupTime: null, now: ist('2026-11-06 15:00') })).toThrow(
      InvalidFollowupDateError,
    );
  });

  it('a date that is "today" in IST but "yesterday" in UTC is still valid', () => {
    // 2026-11-07 02:00 IST is 2026-11-06 20:30Z.
    expect(() => planReminders({ followupDate: '2026-11-07', followupTime: null, now: ist('2026-11-07 02:00') })).not.toThrow();
    expect(() => planReminders({ followupDate: '2026-11-06', followupTime: null, now: ist('2026-11-07 02:00') })).toThrow(
      InvalidFollowupDateError,
    );
  });

  it.each(['25:00', 'abc', '9:00', '12:60', '', '17:00:00'])('#13 invalid time %j throws', (time) => {
    expect(() => planReminders({ followupDate: '2026-11-11', followupTime: time, now: ist('2026-11-06 15:00') })).toThrow(
      InvalidFollowupDateError,
    );
  });

  it.each(['2026-02-30', '2026-13-01', '11/11/2026', '2026-1-1', ''])('invalid date %j throws', (date) => {
    expect(() => planReminders({ followupDate: date, followupTime: null, now: ist('2026-01-01 10:00') })).toThrow(
      InvalidFollowupDateError,
    );
  });

  it('rejects an invalid now', () => {
    expect(() => planReminders({ followupDate: '2026-11-11', followupTime: null, now: new Date('nope') })).toThrow(TypeError);
  });

  it('never plans missed_nudge (the tick creates it)', () => {
    const kinds = planReminders({ followupDate: '2026-11-11', followupTime: null, now: ist('2026-11-06 15:00') }).map((r) => r.kind);
    expect(kinds).not.toContain('missed_nudge');
    expect(PLAN.map((p) => p.kind)).toEqual(['confirmation', 'day_before', 'morning_of']);
  });

  it('is pure: same input gives same output and does not mutate now', () => {
    const now = ist('2026-11-06 15:00');
    const before = now.getTime();
    expect(planReminders({ followupDate: '2026-11-11', followupTime: '10:00', now })).toEqual(
      planReminders({ followupDate: '2026-11-11', followupTime: '10:00', now }),
    );
    expect(now.getTime()).toBe(before);
  });

  it('no planned pending reminder ever lands in quiet hours', () => {
    const now = ist('2026-11-06 22:10');
    for (const time of [null, '00:30', '07:00', '09:00', '13:00', '20:59', '23:59']) {
      for (const date of ['2026-11-07', '2026-11-09']) {
        for (const r of planReminders({ followupDate: date, followupTime: time, now })) {
          if (r.status === 'pending') expect(isQuietHours(r.scheduledFor)).toBe(false);
        }
      }
    }
  });
});

describe('nextAllowedSendTime', () => {
  it.each([
    ['2026-11-06 07:00', '2026-11-06 07:00'],
    ['2026-11-06 12:00', '2026-11-06 12:00'],
    ['2026-11-06 20:59', '2026-11-06 20:59'],
    ['2026-11-06 21:00', '2026-11-07 07:30'],
    ['2026-11-06 23:59', '2026-11-07 07:30'],
    ['2026-11-07 00:00', '2026-11-07 07:30'],
    ['2026-11-07 06:59', '2026-11-07 07:30'],
    ['2026-12-31 22:00', '2027-01-01 07:30'],
  ])('%s IST -> %s IST', (now, expected) => {
    expect(nextAllowedSendTime(ist(now))).toEqual(ist(expected));
  });

  it('returns a copy, not the same Date object', () => {
    const now = ist('2026-11-06 12:00');
    expect(nextAllowedSendTime(now)).not.toBe(now);
  });
});
