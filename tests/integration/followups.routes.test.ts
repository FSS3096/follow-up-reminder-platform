import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/http/errors';
import { FakeStore } from '@/lib/testing/fakeFollowupStore';
import { istDateTime } from '@/lib/time/ist';

const requireStaff = vi.fn();
let store: FakeStore;
const NOW = istDateTime('2026-11-06', '15:00');

vi.mock('@/lib/http/auth', () => ({ requireStaff: (...a: unknown[]) => requireStaff(...a) }));
vi.mock('@/lib/followups/deps', () => ({ followupDeps: () => store.deps(NOW) }));
const insertPatient = vi.fn();
const searchPatients = vi.fn();
vi.mock('@/lib/data/patientsRepo', () => ({
  insertPatient: (...a: unknown[]) => insertPatient(...a),
  searchPatients: (...a: unknown[]) => searchPatients(...a),
}));

const approve = await import('@/app/api/followups/[id]/approve/route');
const reschedule = await import('@/app/api/followups/[id]/reschedule/route');
const patch = await import('@/app/api/followups/[id]/route');
const list = await import('@/app/api/followups/route');
const patients = await import('@/app/api/patients/route');

const json = (body: unknown, method = 'POST') =>
  new Request('https://app.test/x', { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: { id } });

beforeEach(() => {
  vi.clearAllMocks();
  store = new FakeStore();
  requireStaff.mockResolvedValue({ userId: 'doc-1', role: 'doctor', name: 'Dr', supabase: {} });
});

describe('POST /api/followups/:id/approve', () => {
  it('200, doctor role required', async () => {
    const p = store.addPatient();
    const f = store.addFollowup({ patient_id: p.id });
    const res = await approve.POST(json({}), ctx(f.id));
    expect(res.status).toBe(200);
    expect(requireStaff).toHaveBeenCalledWith(['doctor']);
    const body = await res.json();
    expect(body.followup.status).toBe('approved');
    expect(body.reminders).toHaveLength(3);
  });

  it('second call 409', async () => {
    const p = store.addPatient();
    const f = store.addFollowup({ patient_id: p.id });
    await approve.POST(json({}), ctx(f.id));
    const res = await approve.POST(json({}), ctx(f.id));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('CONFLICT');
  });

  it('403 for receptionist', async () => {
    requireStaff.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'no'));
    expect((await approve.POST(json({}), ctx('00000000-0000-4000-8000-000000000001'))).status).toBe(403);
  });

  it.each([
    ['not-a-uuid', {}],
    ['00000000-0000-4000-8000-000000000001', { followupDate: '2026-02-30' }],
    ['00000000-0000-4000-8000-000000000001', { followupTime: '25:00' }],
    ['00000000-0000-4000-8000-000000000001', { newPatient: { name: 'X', phoneE164: '98123' } }],
    ['00000000-0000-4000-8000-000000000001', { patientId: '00000000-0000-4000-8000-000000000002', newPatient: { name: 'X', phoneE164: '+919800000001' } }],
    ['00000000-0000-4000-8000-000000000001', { status: 'approved' }],
  ])('400 for id %s body %j', async (id, body) => {
    const res = await approve.POST(json(body), ctx(id));
    expect(res.status).toBe(400);
  });

  it('422 PATIENT_NEEDS_PHONE for an unmatched draft', async () => {
    const f = store.addFollowup();
    const res = await approve.POST(json({}), ctx(f.id));
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe('PATIENT_NEEDS_PHONE');
  });

  it('200 with newPatient', async () => {
    const f = store.addFollowup();
    const res = await approve.POST(json({ newPatient: { name: 'Kamla Devi', phoneE164: '+919800000002', language: 'hindi' } }), ctx(f.id));
    expect(res.status).toBe(200);
  });
});

describe('POST /api/followups/:id/reschedule', () => {
  it('any staff, 200', async () => {
    requireStaff.mockResolvedValue({ userId: 'rec-1', role: 'receptionist', name: 'Rita', supabase: {} });
    const p = store.addPatient();
    const f = store.addFollowup({ patient_id: p.id, status: 'reschedule_requested' });
    const res = await reschedule.POST(json({ followupDate: '2026-11-20' }), ctx(f.id));
    expect(res.status).toBe(200);
    expect(requireStaff).toHaveBeenCalledWith();
  });
  it('400 without followupDate', async () => {
    expect((await reschedule.POST(json({}), ctx('00000000-0000-4000-8000-000000000001'))).status).toBe(400);
  });
});

describe('PATCH /api/followups/:id', () => {
  it('completed = Arrived', async () => {
    const f = store.addFollowup({ status: 'confirmed' });
    const res = await patch.PATCH(json({ status: 'completed' }, 'PATCH'), ctx(f.id));
    expect(res.status).toBe(200);
    expect((await res.json()).followup.status).toBe('completed');
  });
  it.each(['approved', 'confirmed', 'missed', 'draft'])('400 for status %s', async (status) => {
    expect((await patch.PATCH(json({ status }, 'PATCH'), ctx('00000000-0000-4000-8000-000000000001'))).status).toBe(400);
  });
});

describe('GET /api/followups', () => {
  const get = (qs: string) => list.GET(new Request(`https://app.test/api/followups${qs}`), {});
  it('200 with items + nextCursor', async () => {
    store.addFollowup({ status: 'approved' });
    const res = await get('?status=approved,confirmed&limit=10');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ items: [{ status: 'approved' }], nextCursor: null });
  });
  it.each(['?status=bogus', '?limit=0', '?limit=101', '?from=2026-13-01', '?from=2026-11-10&to=2026-11-01', '?attention=yes', '?evil=1', '?cursor=abc'])(
    '400 for %s',
    async (qs) => {
      expect((await get(qs)).status).toBe(400);
    },
  );
});

describe('/api/patients', () => {
  it('POST creates with a sanitised name, 201', async () => {
    insertPatient.mockImplementation(async (_db, input) => ({
      id: 'p1', name: input.name, phone_e164: input.phoneE164, language: input.language, opted_out: false,
      last_inbound_at: null, last_auto_reply_at: null, is_seed: false, created_at: 'now',
    }));
    const res = await patients.POST(json({ name: ' sita <i>verma</i> ', phoneE164: '+919800000001' }), {});
    expect(res.status).toBe(201);
    expect((await res.json()).patient).toMatchObject({ name: 'Sita Verma', language: 'hinglish' });
  });
  it.each([
    [{ name: 'Sita', phoneE164: '9800000001' }],
    [{ name: 'Sita', phoneE164: '+910' }],
    [{ name: '', phoneE164: '+919800000001' }],
    [{ name: 'x'.repeat(81), phoneE164: '+919800000001' }],
    [{ name: 'Sita', phoneE164: '+919800000001', language: 'tamil' }],
    [{ name: 'Sita', phoneE164: '+919800000001', opted_out: true }],
  ])('POST 400 for %j', async (body) => {
    expect((await patients.POST(json(body), {})).status).toBe(400);
  });
  it('POST 400 when the name has no letters', async () => {
    expect((await patients.POST(json({ name: '12345', phoneE164: '+919800000001' }), {})).status).toBe(400);
  });
  it('POST 409 on duplicate', async () => {
    const { mapDbError } = await import('@/lib/data/dbErrors');
    insertPatient.mockRejectedValue(mapDbError({ code: '23505', message: 'dup' }));
    expect((await patients.POST(json({ name: 'Sita', phoneE164: '+919800000001' }), {})).status).toBe(409);
  });
  it('GET passes the trimmed prefix (wildcards escaped in the repo)', async () => {
    searchPatients.mockResolvedValue([]);
    const res = await patients.GET(new Request('https://app.test/api/patients?q=ra%25m'), {});
    expect(res.status).toBe(200);
    expect(searchPatients).toHaveBeenCalledWith({}, 'ra%m', 20);
  });
});
