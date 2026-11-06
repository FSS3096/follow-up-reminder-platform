import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRateLimiter } from '@/lib/http/rateLimit';
import { FakeInboundRepo } from '@/lib/testing/fakeInboundRepo';
import { istDateTime } from '@/lib/time/ist';
import { AUTO_REPLY_WINDOW_MS, handleInbound, type InboundDeps } from '@/lib/replies/handleInbound';

const PHONE = '+919812345678';
const clinic = { clinicName: 'Sunrise Family Clinic', doctorName: 'Dr. Mehra', clinicPhone: '+911100000000' };
let repo: FakeInboundRepo;
let now: Date;
let deps: InboundDeps;

beforeEach(() => {
  repo = new FakeInboundRepo();
  now = istDateTime('2026-11-06', '12:00');
  deps = { repo, clinic, now: () => now, unknownLimiter: createRateLimiter({ limit: 1, windowMs: AUTO_REPLY_WINDOW_MS }) };
});

describe('red-team concurrency regressions', () => {
  it('does not claim a reply changed state when the conditional transition loses a race', async () => {
    const patient = repo.addPatient({ phone_e164: PHONE, name: 'Sita Verma' });
    repo.addFollowup({ patient_id: patient.id, status: 'approved' });

    // Models another request changing the followup after this handler read it.
    vi.spyOn(repo, 'transition').mockResolvedValue(false);
    const result = await handleInbound({ fromE164: PHONE, body: '1' }, deps);

    expect(result.action).not.toBe('confirmed');
    expect(repo.followups[0]?.status).toBe('approved');
  });

  it('reconciles a confirmation that loses to a reschedule', async () => {
    const patient = repo.addPatient({ phone_e164: PHONE, name: 'Sita Verma' });
    const followup = repo.addFollowup({ patient_id: patient.id, status: 'approved' });
    vi.spyOn(repo, 'transition').mockImplementation(async () => {
      Object.assign(repo.followups[0]!, { status: 'reschedule_requested', attention_reason: 'reschedule_requested' });
      return false;
    });

    const result = await handleInbound({ fromE164: PHONE, body: '1' }, deps);

    expect(result.action).toBe('none');
    expect(result.reply).toMatch(/call/);
    expect(repo.followups[0]).toMatchObject({ id: followup.id, status: 'reschedule_requested' });
  });

  it.each(['completed', 'cancelled'] as const)('does not acknowledge reschedule if completion/cancellation wins the race (%s)', async (status) => {
    const patient = repo.addPatient({ phone_e164: PHONE, name: 'Sita Verma' });
    const followup = repo.addFollowup({ patient_id: patient.id, status: 'approved' });
    vi.spyOn(repo, 'transition').mockImplementation(async () => {
      Object.assign(repo.followups[0]!, { status });
      return false;
    });

    const result = await handleInbound({ fromE164: PHONE, body: '2' }, deps);

    expect(result).toEqual({ intent: 'reschedule', action: 'none', reply: null });
    expect(repo.followups[0]).toMatchObject({ id: followup.id, status });
  });
});
