import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/http/errors';

const insertDraft = vi.fn();
const requireStaff = vi.fn();

vi.mock('@/lib/http/auth', () => ({ requireStaff: (...a: unknown[]) => requireStaff(...a) }));
vi.mock('@/lib/data/followupsRepo', () => ({ insertDraft: (...a: unknown[]) => insertDraft(...a) }));
vi.mock('@/lib/data/patientsRepo', () => ({ listForMatching: async () => [] }));
vi.mock('@/lib/clinic', () => ({ clinicFromEnv: () => ({ clinicName: 'Sunrise Family Clinic', doctorName: 'Dr. Mehra' }) }));

const { POST } = await import('@/app/api/notes/parse/route');

function req(body: unknown, headers: Record<string, string> = { 'content-type': 'application/json' }) {
  return new Request('https://app.test/api/notes/parse', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
}

describe('POST /api/notes/parse (route layer)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireStaff.mockResolvedValue({ userId: 'doc-1', role: 'doctor', name: 'Dr', supabase: {} });
    insertDraft.mockResolvedValue({ id: 'f-1' });
  });

  it('200 with the preview contract and only doctors allowed', async () => {
    const res = await POST(req({ text: 'Sita kal 5pm', clientInputMs: 3000 }), {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(
      ['dateSource', 'followupDate', 'followupId', 'followupTime', 'ignoredClinicalContent', 'messagePreview', 'needsReview', 'patient'].sort(),
    );
    expect(body.followupTime).toBe('17:00');
    expect(requireStaff).toHaveBeenCalledWith(['doctor']);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('never echoes the raw note', async () => {
    const res = await POST(req({ text: 'Ramesh BP high amlodipine 5mg 7 din baad' }), {});
    expect(JSON.stringify(await res.json())).not.toMatch(/amlodipine|5mg|\bBP\b/i);
  });

  it('401 when not signed in', async () => {
    requireStaff.mockRejectedValue(new ApiError(401, 'UNAUTHENTICATED', 'Sign in required'));
    const res = await POST(req({ text: 'Sita kal' }), {});
    expect(res.status).toBe(401);
    expect(insertDraft).not.toHaveBeenCalled();
  });

  it('403 for a receptionist', async () => {
    requireStaff.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'no'));
    expect((await POST(req({ text: 'Sita kal' }), {})).status).toBe(403);
  });

  it.each([
    [{}, 400],
    [{ text: '' }, 400],
    [{ text: 'x'.repeat(281) }, 400],
    [{ text: 'Sita', clientInputMs: -1 }, 400],
    [{ text: 42 }, 400],
    ['not json', 400],
  ])('%j -> %i', async (body, status) => {
    const res = await POST(req(body), {});
    expect(res.status).toBe(status);
    expect((await res.json()).error.code).toMatch(/VALIDATION_ERROR|INVALID_JSON/);
  });

  it('422 NAME_MISSING', async () => {
    const res = await POST(req({ text: '5 din baad' }), {});
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe('NAME_MISSING');
  });

  it('422 EMPTY for whitespace', async () => {
    const res = await POST(req({ text: '   ' }), {});
    expect((await res.json()).error.code).toBe('EMPTY');
  });

  it('415 for a non-JSON content type', async () => {
    expect((await POST(req({ text: 'Sita' }, { 'content-type': 'text/plain' }), {})).status).toBe(415);
  });

  it('500 hides database errors', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    insertDraft.mockRejectedValue(new Error('duplicate key value violates constraint'));
    const res = await POST(req({ text: 'Sita kal' }), {});
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('duplicate');
  });

  it('429 after 30 parses a minute from the same doctor', async () => {
    requireStaff.mockResolvedValue({ userId: 'rate-test', role: 'doctor', name: 'Dr', supabase: {} });
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await POST(req({ text: 'Sita kal' }), {})).status;
    expect(last).toBe(429);
  });
});
