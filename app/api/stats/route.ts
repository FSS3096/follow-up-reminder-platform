import { NextResponse } from 'next/server';
import { z } from 'zod';
import { fetchStatsRows } from '@/lib/data/statsRepo';
import { getServerEnv } from '@/lib/env';
import { requireStaff } from '@/lib/http/auth';
import { withErrorHandling } from '@/lib/http/errors';
import { parseQuery } from '@/lib/http/validate';
import { computeMeasured, computeModeled } from '@/lib/stats/compute';

export const dynamic = 'force-dynamic';

const RANGES = { '7d': 7, '30d': 30, '90d': 90, all: null } as const;

const querySchema = z
  .object({
    range: z.enum(['7d', '30d', '90d', 'all']).default('30d'),
    includeSeed: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  })
  .strict();

export const GET = withErrorHandling('stats', async (req: Request) => {
  const staff = await requireStaff();
  const q = parseQuery(req, querySchema);
  const now = new Date();
  const days = RANGES[q.range];
  const since = days === null ? null : new Date(now.getTime() - days * 86_400_000);
  const { rows, truncated } = await fetchStatsRows(staff.supabase, { since, includeSeed: q.includeSeed });
  const env = getServerEnv();
  return NextResponse.json(
    {
      range: q.range,
      includeSeed: q.includeSeed,
      generatedAt: now.toISOString(),
      measured: { ...computeMeasured(rows, now), truncated },
      modeled: computeModeled({
        patientsPerDay: env.PATIENTS_PER_DAY,
        baselineMissRate: env.BASELINE_MISS_RATE,
        followupShare: env.FOLLOWUP_SHARE,
        recoveryRate: env.RECOVERY_RATE,
        avgFeeInr: env.AVG_FEE_INR,
        workingDaysPerMonth: env.WORKING_DAYS_PER_MONTH,
      }),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
});
