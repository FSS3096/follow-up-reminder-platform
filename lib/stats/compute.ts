import type { FollowupStatus } from '@/lib/supabase/types';
import { istDate } from '@/lib/time/ist';

export type StatsRow = {
  status: FollowupStatus;
  followup_date: string;
  client_input_ms: number | null;
  parsed_at: string;
  approved_at: string | null;
  confirmed_at: string | null;
};

export const MIN_SAMPLES_FOR_PERCENTILES = 5;

/** Nearest-rank percentile on a sorted copy. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) throw new RangeError('no values');
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1] as number;
}

function ratio(num: number, den: number): number | null {
  return den === 0 ? null : Math.round((num / den) * 1000) / 1000;
}

const STATUSES: readonly FollowupStatus[] = ['draft', 'approved', 'confirmed', 'reschedule_requested', 'completed', 'missed', 'cancelled'];

/**
 * MEASURED metrics only (Brief B8). Every number here comes from rows in the database.
 * - confirmationRate = confirmed (ever) / approved (ever)
 * - missRate         = missed / (completed + missed)   (resolved follow-ups only)
 * - doctorTimeMs     = client_input_ms + (approved_at - parsed_at), p50/p90, null below 5 samples
 * - unmarkedArrivals = date already passed, still active (nobody pressed "Arrived")
 */
export function computeMeasured(rows: readonly StatsRow[], now: Date) {
  const totals = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<FollowupStatus, number>;
  for (const r of rows) totals[r.status] += 1;

  const approved = rows.filter((r) => r.approved_at !== null);
  const confirmed = approved.filter((r) => r.confirmed_at !== null);

  const doctorTimes = approved
    .filter((r) => r.client_input_ms !== null)
    .map((r) => (r.client_input_ms as number) + Math.max(0, Date.parse(r.approved_at as string) - Date.parse(r.parsed_at)))
    .filter((v) => Number.isFinite(v));

  const today = istDate(now);
  const unmarkedArrivals = rows.filter(
    (r) => r.followup_date < today && (r.status === 'approved' || r.status === 'confirmed' || r.status === 'reschedule_requested'),
  ).length;

  const n = doctorTimes.length;
  return {
    totals,
    total: rows.length,
    confirmationRate: ratio(confirmed.length, approved.length),
    missRate: ratio(totals.missed, totals.missed + totals.completed),
    doctorTimeMs:
      n >= MIN_SAMPLES_FOR_PERCENTILES
        ? { p50: percentile(doctorTimes, 50), p90: percentile(doctorTimes, 90), n }
        : { p50: null, p90: null, n },
    unmarkedArrivals,
  };
}

export interface ModelAssumptions {
  patientsPerDay: number;
  baselineMissRate: number;
  followupShare: number;
  recoveryRate: number;
  avgFeeInr: number;
  workingDaysPerMonth: number;
}

/**
 * MODELED value (Brief B8). Illustration only, never mixed into `measured`.
 * recoveredPerMonth = patientsPerDay * followupShare * baselineMissRate * recoveryRate * workingDaysPerMonth
 */
export function computeModeled(a: ModelAssumptions) {
  const recoveredPerMonth = a.patientsPerDay * a.followupShare * a.baselineMissRate * a.recoveryRate * a.workingDaysPerMonth;
  const rounded = Math.round(recoveredPerMonth * 10) / 10;
  return {
    modeled: true as const,
    label: 'MODELED estimate from placeholder assumptions, not a measurement',
    assumptions: {
      patientsPerDay: { value: a.patientsPerDay, source: 'case brief (fact)' },
      baselineMissRate: { value: a.baselineMissRate, source: 'case brief (fact)' },
      followupShare: { value: a.followupShare, source: 'ASSUMPTION, no source' },
      recoveryRate: { value: a.recoveryRate, source: 'ASSUMPTION, no source' },
      avgFeeInr: { value: a.avgFeeInr, source: 'ASSUMPTION, replace with the clinic fee' },
      workingDaysPerMonth: { value: a.workingDaysPerMonth, source: 'ASSUMPTION' },
    },
    formula: 'patientsPerDay * followupShare * baselineMissRate * recoveryRate * workingDaysPerMonth',
    recoveredPerMonth: rounded,
    revenueInrPerMonth: Math.round(rounded * a.avgFeeInr),
  };
}
