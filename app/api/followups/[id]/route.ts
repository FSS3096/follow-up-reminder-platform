import { NextResponse } from 'next/server';
import { z } from 'zod';
import { followupDeps } from '@/lib/followups/deps';
import { changeFollowupStatus } from '@/lib/followups/service';
import { requireStaff } from '@/lib/http/auth';
import { withErrorHandling } from '@/lib/http/errors';
import { idParamsSchema } from '@/lib/http/schemas';
import { parseJsonBody, parseParams } from '@/lib/http/validate';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ status: z.enum(['completed', 'cancelled']) }).strict();

type Ctx = { params: { id: string } };

/** "Arrived" = completed. Cancelling cancels pending reminders. */
export const PATCH = withErrorHandling<Ctx>('followups.patch', async (req, ctx) => {
  const staff = await requireStaff();
  const { id } = parseParams(ctx.params, idParamsSchema);
  const body = await parseJsonBody(req, bodySchema);
  const result = await changeFollowupStatus({ followupId: id, status: body.status }, followupDeps(staff.supabase));
  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
});
