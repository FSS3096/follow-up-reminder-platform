import { NextResponse } from 'next/server';
import { z } from 'zod';
import { followupDeps } from '@/lib/followups/deps';
import { rescheduleFollowup } from '@/lib/followups/service';
import { requireStaff } from '@/lib/http/auth';
import { withErrorHandling } from '@/lib/http/errors';
import { idParamsSchema, isoDateSchema, timeSchema } from '@/lib/http/schemas';
import { parseJsonBody, parseParams } from '@/lib/http/validate';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ followupDate: isoDateSchema, followupTime: timeSchema.nullable().optional() }).strict();

type Ctx = { params: { id: string } };

export const POST = withErrorHandling<Ctx>('followups.reschedule', async (req, ctx) => {
  const staff = await requireStaff();
  const { id } = parseParams(ctx.params, idParamsSchema);
  const body = await parseJsonBody(req, bodySchema);
  const result = await rescheduleFollowup({ followupId: id, ...body }, followupDeps(staff.supabase));
  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
});
