import { NextResponse } from 'next/server';
import { z } from 'zod';
import { clinicFromEnv } from '@/lib/clinic';
import { insertDraft } from '@/lib/data/followupsRepo';
import { listForMatching } from '@/lib/data/patientsRepo';
import { requireStaff } from '@/lib/http/auth';
import { errors, withErrorHandling } from '@/lib/http/errors';
import { createRateLimiter } from '@/lib/http/rateLimit';
import { parseJsonBody } from '@/lib/http/validate';
import { parseNoteAndCreateDraft } from '@/lib/notes/parseNoteService';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  text: z.string().min(1).max(280),
  clientInputMs: z.number().int().min(0).max(600_000).optional(),
});

const limiter = createRateLimiter({ limit: 30, windowMs: 60_000 });

export const POST = withErrorHandling('notes.parse', async (req: Request) => {
  // v1: only doctors write notes (followups.doctor_id must be a doctor). See OPEN_QUESTIONS OQ-13.
  const staff = await requireStaff(['doctor']);
  const retryAfter = limiter.check(staff.userId);
  if (retryAfter > 0) throw errors.rateLimited(retryAfter);

  const body = await parseJsonBody(req, bodySchema);
  const result = await parseNoteAndCreateDraft(
    { text: body.text, clientInputMs: body.clientInputMs, doctorId: staff.userId },
    {
      now: () => new Date(),
      clinic: clinicFromEnv(),
      listPatients: () => listForMatching(staff.supabase),
      insertDraft: (row) => insertDraft(staff.supabase, row),
    },
  );
  return NextResponse.json(result, { status: 200, headers: { 'Cache-Control': 'no-store' } });
});
