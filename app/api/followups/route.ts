import { NextResponse } from 'next/server';
import { z } from 'zod';
import { followupDeps } from '@/lib/followups/deps';
import { listFollowups } from '@/lib/followups/service';
import { requireStaff } from '@/lib/http/auth';
import { withErrorHandling } from '@/lib/http/errors';
import { isoDateSchema } from '@/lib/http/schemas';
import { parseQuery } from '@/lib/http/validate';

export const dynamic = 'force-dynamic';

const STATUSES = ['draft', 'approved', 'confirmed', 'reschedule_requested', 'completed', 'missed', 'cancelled'] as const;

const querySchema = z
  .object({
    status: z
      .string()
      .optional()
      .transform((v) => (v ? v.split(',').map((s) => s.trim()) : undefined))
      .pipe(z.array(z.enum(STATUSES)).max(STATUSES.length).optional()),
    attention: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().max(200).optional(),
  })
  .strict()
  .refine((q) => !(q.from && q.to && q.from > q.to), { message: 'from must be <= to' });

export const GET = withErrorHandling('followups.list', async (req: Request) => {
  const staff = await requireStaff();
  const q = parseQuery(req, querySchema);
  const result = await listFollowups(
    { statuses: q.status, attention: q.attention, from: q.from, to: q.to, limit: q.limit, cursor: q.cursor },
    followupDeps(staff.supabase),
  );
  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
});
