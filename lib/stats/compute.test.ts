import { describe, expect, it } from 'vitest';
import { istDateTime } from '@/lib/time/ist';
import { computeMeasured, computeModeled, percentile, type StatsRow } from './compute';

const NOW = istDateTime('2026-11-06', '12:00');
function row(over: Partial<StatsRow>): StatsRow {
  return {
    status: 'approved',
    followup_date: '2026-11-10',
    client_input_ms: null,
    parsed_at: '2026-11-01T04:00:00.000Z',
    approved_at: '2026-11-01T04:00:05.000Z',
    confirmed_at: null,
    ...over,
  };
}

describe('percentile (nearest rank)', () => {
  it.each([
    [[1, 2, 3, 4, 5], 50, 3],
    [[1, 2, 3, 4, 5], 90, 5],
    [[5, 1, 4, 2, 3], 50, 3],
    [[10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 90, 90],
    [[7], 50, 7],
  ])('%j p%i = %i', (values, p, expected) => {
    expect(percentile(values, p)).toBe(expected);
  });
  it('throws on empty', () => {
    expect(() => percentile([], 50)).toThrow(RangeError);
  });
});

describe('computeMeasured', () => {
  it('is all-null/zero on an empty clinic', () => {
    const m = computeMeasured([], NOW);
    expect(m).toMatchObject({ total: 0, confirmationRate: null, missRate: null, doctorTimeMs: { p50: null, p90: null, n: 0 }, unmarkedArrivals: 0 });
    expect(m.totals.draft).toBe(0);
  });

  it('computes rates from approved / resolved followups only', () => {
    const rows = [
      row({ status: 'draft', approved_at: null }),
      row({ status: 'confirmed', confirmed_at: '2026-11-02T00:00:00Z' }),
      row({ status: 'completed', confirmed_at: '2026-11-02T00:00:00Z', followup_date: '2026-11-03' }),
      row({ status: 'completed', followup_date: '2026-11-03' }),
      row({ status: 'missed', followup_date: '2026-11-01' }),
      row({ status: 'approved' }),
    ];
    const m = computeMeasured(rows, NOW);
    expect(m.totals).toMatchObject({ draft: 1, confirmed: 1, completed: 2, missed: 1, approved: 1 });
    expect(m.confirmationRate).toBe(0.4); // 2 of 5 approved
    expect(m.missRate).toBe(0.333); // 1 of 3 resolved
  });

  it('doctor time = client input + approve delay; null percentiles below 5 samples', () => {
    const four = [1000, 2000, 3000, 4000].map((ms) => row({ client_input_ms: ms }));
    expect(computeMeasured(four, NOW).doctorTimeMs).toEqual({ p50: null, p90: null, n: 4 });
    const five = [...four, row({ client_input_ms: 20_000 })];
    // each adds the 5 s approve delay
    expect(computeMeasured(five, NOW).doctorTimeMs).toEqual({ p50: 8000, p90: 25000, n: 5 });
  });

  it('ignores drafts and rows without client timing for doctor time; clamps negative delays', () => {
    const rows = [
      row({ client_input_ms: 1000, approved_at: null, status: 'draft' }),
      row({ client_input_ms: null }),
      ...Array.from({ length: 5 }, () => row({ client_input_ms: 3000, approved_at: '2026-11-01T03:59:00.000Z' })),
    ];
    expect(computeMeasured(rows, NOW).doctorTimeMs).toEqual({ p50: 3000, p90: 3000, n: 5 });
  });

  it('counts unmarked arrivals: date passed, still active', () => {
    const rows = [
      row({ status: 'approved', followup_date: '2026-11-05' }),
      row({ status: 'confirmed', followup_date: '2026-11-04' }),
      row({ status: 'approved', followup_date: '2026-11-06' }), // today, not yet
      row({ status: 'completed', followup_date: '2026-11-04' }),
      row({ status: 'missed', followup_date: '2026-11-01' }),
    ];
    expect(computeMeasured(rows, NOW).unmarkedArrivals).toBe(2);
  });
});

describe('computeModeled', () => {
  it('matches the Brief defaults: 78 recovered -> Rs 23,400 per month', () => {
    const m = computeModeled({ patientsPerDay: 50, baselineMissRate: 0.3, followupShare: 0.4, recoveryRate: 0.5, avgFeeInr: 300, workingDaysPerMonth: 26 });
    expect(m.modeled).toBe(true);
    expect(m.recoveredPerMonth).toBe(78);
    expect(m.revenueInrPerMonth).toBe(23_400);
    expect(m.assumptions.followupShare.source).toMatch(/ASSUMPTION/);
    expect(m.label).toMatch(/MODELED/);
  });
});
