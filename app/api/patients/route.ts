import { NextResponse } from 'next/server';
import { z } from 'zod';
import { insertPatient, searchPatients, type PatientRow } from '@/lib/data/patientsRepo';
import { requireStaff } from '@/lib/http/auth';
import { errors, withErrorHandling } from '@/lib/http/errors';
import { languageSchema, patientNameSchema, phoneE164Schema } from '@/lib/http/schemas';
import { parseJsonBody, parseQuery } from '@/lib/http/validate';
import { sanitizeName } from '@/lib/parser/names';

export const dynamic = 'force-dynamic';

function toPatientDto(p: PatientRow) {
  return {
    id: p.id,
    name: p.name,
    phoneE164: p.phone_e164,
    language: p.language,
    optedOut: p.opted_out,
    lastInboundAt: p.last_inbound_at,
    isSeed: p.is_seed,
    createdAt: p.created_at,
  };
}

const querySchema = z
  .object({
    q: z.string().max(80).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export const GET = withErrorHandling('patients.list', async (req: Request) => {
  const staff = await requireStaff();
  const { q, limit } = parseQuery(req, querySchema);
  // Wildcards are escaped in the repo; the value is sent as a bound filter, never as SQL.
  const term = q?.trim();
  const rows = await searchPatients(staff.supabase, term || undefined, limit);
  return NextResponse.json({ items: rows.map(toPatientDto) }, { headers: { 'Cache-Control': 'no-store' } });
});

const bodySchema = z
  .object({ name: patientNameSchema, phoneE164: phoneE164Schema, language: languageSchema.optional() })
  .strict();

export const POST = withErrorHandling('patients.create', async (req: Request) => {
  const staff = await requireStaff();
  const body = await parseJsonBody(req, bodySchema);
  const name = sanitizeName(body.name);
  if (!name) throw errors.badRequest('name must contain letters');
  const row = await insertPatient(staff.supabase, { name, phoneE164: body.phoneE164, language: body.language ?? 'hinglish' });
  return NextResponse.json({ patient: toPatientDto(row) }, { status: 201 });
});
