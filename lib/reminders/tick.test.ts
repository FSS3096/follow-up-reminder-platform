import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConsoleProvider, ProviderError, WaLinkProvider, type OutboundMessage, type WhatsAppProvider } from '@/lib/providers/whatsapp';
import { FakeTickRepo } from '@/lib/testing/fakeTickRepo';
import { istDateTime } from '@/lib/time/ist';
import { mapLimit, runTick, sendConfirmationNow, tooLate, type TickDeps } from './tick';

const clinic = { clinicName: 'Sunrise Family Clinic', doctorName: 'Dr. Mehra', clinicPhone: '+911100000000' };
let now: Date;
let repo: FakeTickRepo;

function deps(provider: WhatsAppProvider = new ConsoleProvider(), over: Partial<TickDeps> = {}): TickDeps {
  return { repo, provider, allowLiveSend: true, clinic, now: () => now, ...over };
}

/** A live provider double: records sends, can fail on demand. */
class FakeLive implements WhatsAppProvider {
  readonly name = 'twilio_sandbox' as const;
  readonly live = true;
  sent: OutboundMessage[] = [];
  constructor(private behaviour: (m: OutboundMessage) => Promise<{ sid: string }> = async () => ({ sid: `SM${Math.random()}` })) {}
  async send(m: OutboundMessage) {
    const r = await this.behaviour(m);
    this.sent.push(m);
    return r;
  }
}

beforeEach(() => {
  now = istDateTime('2026-11-06', '15:00');
  repo = new FakeTickRepo(() => now);
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('runTick', () => {
  it('sends a due confirmation and reports counters', async () => {
    const { followup } = repo.addFollowup({ followup_date: '2026-11-11' }, { name: 'Sita Verma', phone_e164: '+919812345678', language: 'english' });
    const r = repo.addReminder(followup.id, 'confirmation');
    repo.addReminder(followup.id, 'day_before', { scheduled_for: istDateTime('2026-11-10', '18:00').toISOString() });
    const provider = new FakeLive();
    const result = await runTick(deps(provider));
    expect(result).toEqual({ claimed: 1, sent: 1, failed: 0, skipped: 0, deferred: 0, retried: 0, markedMissed: 0, recoveredStuck: 0 });
    expect(repo.reminders.find((x) => x.id === r.id)).toMatchObject({ status: 'sent', provider: 'twilio_sandbox' });
    expect(provider.sent[0]).toMatchObject({ toE164: '+919812345678', sandboxTemplateVars: { date: 'Wed, 11 Nov', time: 'during clinic hours' } });
    expect(provider.sent[0]!.body).toMatch(/^Hello Sita, your follow-up/);
  });

  it('two concurrent ticks never double-send', async () => {
    for (let i = 0; i < 40; i++) {
      const { followup } = repo.addFollowup({ followup_date: '2026-11-11' }, { phone_e164: `+9198000000${String(i).padStart(2, '0')}` });
      repo.addReminder(followup.id, 'confirmation');
    }
    const provider = new FakeLive(async () => {
      await new Promise((r) => setTimeout(r, 1));
      return { sid: 'SM' };
    });
    const [a, b] = await Promise.all([runTick(deps(provider)), runTick(deps(provider))]);
    expect(a.sent + b.sent).toBe(40 - Math.max(0, 40 - 50)); // 25 + 15
    const sentTo = provider.sent.map((m) => m.toE164);
    expect(new Set(sentTo).size).toBe(sentTo.length);
    expect(repo.reminders.every((r) => r.status === 'sent')).toBe(true);
  });

  it('claims at most 25 per tick', async () => {
    for (let i = 0; i < 30; i++) repo.addReminder(repo.addFollowup({ followup_date: '2026-11-11' }).followup.id, 'confirmation');
    const res = await runTick(deps());
    expect(res.claimed).toBe(25);
    expect(repo.reminders.filter((r) => r.status === 'pending')).toHaveLength(5);
  });

  it('retryable failure: back to pending in 10 min x attempt, then failed + send_failed after 3', async () => {
    const { followup } = repo.addFollowup({ followup_date: '2026-11-11' });
    const r = repo.addReminder(followup.id, 'confirmation');
    const provider = new FakeLive(async () => {
      throw new ProviderError('Twilio HTTP 503', true);
    });

    await runTick(deps(provider));
    expect(r).toMatchObject({ status: 'pending', attempts: 1, last_error: 'Twilio HTTP 503' });
    expect(r.scheduled_for).toBe(new Date(now.getTime() + 10 * 60_000).toISOString());

    now = new Date(r.scheduled_for);
    await runTick(deps(provider));
    expect(r).toMatchObject({ status: 'pending', attempts: 2 });
    expect(r.scheduled_for).toBe(new Date(now.getTime() + 20 * 60_000).toISOString());

    now = new Date(r.scheduled_for);
    const res = await runTick(deps(provider));
    expect(res.failed).toBe(1);
    expect(r).toMatchObject({ status: 'failed', attempts: 3 });
    expect(repo.followups.get(followup.id)?.attention_reason).toBe('send_failed');
  });

  it('permanent failure fails immediately', async () => {
    const { followup } = repo.addFollowup({ followup_date: '2026-11-11' });
    const r = repo.addReminder(followup.id, 'confirmation');
    await runTick(deps(new FakeLive(async () => { throw new ProviderError('Twilio HTTP 400 code 21211', false, 21211); })));
    expect(r.status).toBe('failed');
  });

  it('unknown errors are treated as retryable', async () => {
    const { followup } = repo.addFollowup({ followup_date: '2026-11-11' });
    const r = repo.addReminder(followup.id, 'confirmation');
    await runTick(deps(new FakeLive(async () => { throw new Error('boom'); })));
    expect(r.status).toBe('pending');
  });

  it('retry that would land in quiet hours moves to 07:30', async () => {
    now = istDateTime('2026-11-06', '20:55');
    const { followup } = repo.addFollowup({ followup_date: '2026-11-11' });
    const r = repo.addReminder(followup.id, 'confirmation');
    await runTick(deps(new FakeLive(async () => { throw new ProviderError('x', true); })));
    expect(r.scheduled_for).toBe(istDateTime('2026-11-07', '07:30').toISOString());
  });

  it('in quiet hours claimed reminders are deferred to 07:30 without spending an attempt', async () => {
    now = istDateTime('2026-11-06', '22:00');
    const { followup } = repo.addFollowup({ followup_date: '2026-11-11' });
    const r = repo.addReminder(followup.id, 'confirmation');
    const provider = new FakeLive();
    const res = await runTick(deps(provider));
    expect(res.deferred).toBe(1);
    expect(provider.sent).toHaveLength(0);
    expect(r).toMatchObject({ status: 'pending', attempts: 0, scheduled_for: istDateTime('2026-11-07', '07:30').toISOString() });
  });

  describe('send guards', () => {
    it.each([
      ['ALLOW_LIVE_SEND false', {}, {}, { allowLiveSend: false }, 'live_send_disabled'],
      ['opted out', {}, { opted_out: true }, {}, 'opted_out'],
      ['seed patient', {}, { is_seed: true }, {}, 'seed_patient'],
      ['seed number', {}, { phone_e164: '+910000000007' }, {}, 'seed_patient'],
      ['cancelled followup', { status: 'cancelled' as const }, {}, {}, 'followup_inactive'],
      ['completed followup', { status: 'completed' as const }, {}, {}, 'followup_inactive'],
    ])('%s -> skipped %s, nothing sent', async (_l, f, p, d, reason) => {
      const { followup } = repo.addFollowup({ followup_date: '2026-11-11', ...f }, p);
      const r = repo.addReminder(followup.id, 'confirmation');
      const provider = new FakeLive();
      await runTick(deps(provider, d));
      expect(provider.sent).toHaveLength(0);
      expect(r).toMatchObject({ status: 'skipped', skip_reason: reason });
    });

    it('no patient -> skipped', async () => {
      const { followup } = repo.addFollowup({ followup_date: '2026-11-11' }, null);
      const r = repo.addReminder(followup.id, 'confirmation');
      await runTick(deps());
      expect(r.skip_reason).toBe('no_patient');
    });
  });

  it('wa_link provider: skipped manual_send', async () => {
    const { followup } = repo.addFollowup({ followup_date: '2026-11-11' });
    const r = repo.addReminder(followup.id, 'confirmation');
    await runTick(deps(new WaLinkProvider()));
    expect(r).toMatchObject({ status: 'skipped', skip_reason: 'manual_send' });
  });

  it('a stale morning_of (tick was down) is skipped as too_late', async () => {
    const { followup } = repo.addFollowup({ followup_date: '2026-11-05', status: 'confirmed' });
    const r = repo.addReminder(followup.id, 'morning_of', { scheduled_for: istDateTime('2026-11-05', '08:00').toISOString() });
    now = istDateTime('2026-11-06', '09:00');
    const provider = new FakeLive();
    await runTick(deps(provider));
    expect(r.skip_reason).toBe('too_late');
    expect(provider.sent).toHaveLength(0);
  });

  it('missed: date < today-1 -> missed + one nudge sent; date = yesterday is not missed yet', async () => {
    now = istDateTime('2026-11-06', '10:00');
    const old = repo.addFollowup({ followup_date: '2026-11-04', status: 'confirmed' }, { language: 'hinglish' });
    const grace = repo.addFollowup({ followup_date: '2026-11-05' });
    const provider = new FakeLive();
    const res = await runTick(deps(provider));
    expect(res.markedMissed).toBe(1);
    expect(repo.missedCalls[0]?.cutoff).toBe('2026-11-05');
    expect(repo.followups.get(old.followup.id)?.status).toBe('missed');
    expect(repo.followups.get(grace.followup.id)?.status).toBe('approved');
    expect(provider.sent).toHaveLength(1);
    expect(provider.sent[0]!.body).toMatch(/nahi aa paaye/);
    await runTick(deps(provider));
    expect(provider.sent).toHaveLength(1);
  });

  it('missed at night: nudge waits for 07:30', async () => {
    now = istDateTime('2026-11-06', '23:00');
    repo.addFollowup({ followup_date: '2026-11-01' });
    const provider = new FakeLive();
    await runTick(deps(provider));
    expect(provider.sent).toHaveLength(0);
    expect(repo.reminders[0]?.scheduled_for).toBe(istDateTime('2026-11-07', '07:30').toISOString());
  });

  it('recovers reminders stuck in sending', async () => {
    const { followup } = repo.addFollowup({ followup_date: '2026-11-11' });
    const r = repo.addReminder(followup.id, 'confirmation', { status: 'sending', attempts: 1, claimed_at: new Date(now.getTime() - 15 * 60_000).toISOString() });
    const res = await runTick(deps());
    expect(res.recoveredStuck).toBe(1);
    expect(r.status).toBe('sent');
  });

  it('the message body never contains the note text', async () => {
    const { followup } = repo.addFollowup({ followup_date: '2026-11-11', raw_note: 'BP high amlodipine 5mg' });
    repo.addReminder(followup.id, 'confirmation');
    const provider = new FakeLive();
    await runTick(deps(provider));
    expect(provider.sent[0]!.body).not.toMatch(/bp|amlodipine|mg/i);
  });

  it('a bookkeeping failure after a successful send is never retried (no double send)', async () => {
    const a = repo.addFollowup({ followup_date: '2026-11-11' });
    const b = repo.addFollowup({ followup_date: '2026-11-11' });
    const ra = repo.addReminder(a.followup.id, 'confirmation');
    const rb = repo.addReminder(b.followup.id, 'confirmation');
    const orig = repo.markSent.bind(repo);
    repo.markSent = async (id, ...rest) => {
      if (id === ra.id) throw new Error('db down');
      return orig(id, ...rest);
    };
    const provider = new FakeLive();
    const res = await runTick(deps(provider));
    expect(res.sent).toBe(2);
    expect(res.retried).toBe(0);
    expect(provider.sent).toHaveLength(2);
    expect(ra.status).toBe('sending'); // left for recovery, not re-queued
    expect(rb.status).toBe('sent');
  });

  it('a DB failure before sending does not abort the batch', async () => {
    const a = repo.addFollowup({ followup_date: '2026-11-11' }, { opted_out: true });
    const b = repo.addFollowup({ followup_date: '2026-11-11' });
    repo.addReminder(a.followup.id, 'confirmation');
    repo.addReminder(b.followup.id, 'confirmation');
    repo.markSkipped = async () => {
      throw new Error('db down');
    };
    const res = await runTick(deps(new FakeLive()));
    expect(res).toMatchObject({ sent: 1, failed: 1 });
  });
});

describe('sendConfirmationNow', () => {
  it('sends the due confirmation once', async () => {
    const { followup } = repo.addFollowup({ followup_date: '2026-11-11' });
    repo.addReminder(followup.id, 'confirmation');
    const provider = new FakeLive();
    expect(await sendConfirmationNow(followup.id, deps(provider))).toBe('sent');
    expect(await sendConfirmationNow(followup.id, deps(provider))).toBeNull();
    expect(provider.sent).toHaveLength(1);
  });
  it('does nothing when the confirmation is scheduled for later (quiet hours)', async () => {
    const { followup } = repo.addFollowup({ followup_date: '2026-11-11' });
    repo.addReminder(followup.id, 'confirmation', { scheduled_for: new Date(now.getTime() + 3600_000).toISOString() });
    expect(await sendConfirmationNow(followup.id, deps())).toBeNull();
  });
});

describe('helpers', () => {
  it('mapLimit keeps order and bounds concurrency', async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async (x) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;
      return x * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14]);
    expect(peak).toBeLessThanOrEqual(3);
    expect(await mapLimit([], 5, async (x) => x)).toEqual([]);
  });
  it.each([
    ['confirmation', '2026-11-06', false],
    ['confirmation', '2026-11-05', true],
    ['day_before', '2026-11-07', false],
    ['day_before', '2026-11-06', true],
    ['morning_of', '2026-11-06', false],
    ['morning_of', '2026-11-07', true],
    ['missed_nudge', '2026-10-01', false],
  ] as const)('tooLate(%s, %s) = %s', (kind, date, expected) => {
    expect(tooLate(kind, date, istDateTime('2026-11-06', '10:00'))).toBe(expected);
  });
});
