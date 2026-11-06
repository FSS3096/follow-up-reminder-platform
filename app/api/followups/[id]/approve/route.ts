import { NextResponse } from 'next/server';
import { z } from 'zod';
import { followupDeps } from '@/lib/followups/deps';
import { approveFollowup } from '@/lib/followups/service';
import { requireStaff } from '@/lib/http/auth';
import { withErrorHandling } from '@/lib/http/errors';
import { idParamsSchema, isoDateSchema, languageSchema, patientNameSchema, phoneE164Schema, timeSchema, uuidSchema } from '@/lib/http/schemas';
import { parseJsonBody, parseParams } from '@/lib/http/validate';

export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    patientId: uuidSchema.optional(),
    newPatient: z.object({ name: patientNameSchema, phoneE164: phoneE164Schema, language: languageSchema.optional() }).strict().optional(),
    followupDate: isoDateSchema.optional(),
    followupTime: timeSchema.nullable().optional(),
  })
  .strict()
  .refine((b) => !(b.patientId && b.newPatient), { message: 'send patientId or newPatient, not both' });

type Ctx = { params: { id: string } };

export const POST = withErrorHandling<Ctx>('followups.approve', async (req, ctx) => {
  const staff = await requireStaff(['doctor']);
  const { id } = parseParams(ctx.params, idParamsSchema);
  const body = await parseJsonBody(req, bodySchema);
  const result = await approveFollowup({ followupId: id, ...body }, followupDeps(staff.supabase));
  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
});
