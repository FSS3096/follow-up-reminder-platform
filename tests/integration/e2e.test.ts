/**
 * End-to-end over the real route handlers (Brief section 11), console provider, in-memory data:
 * parse -> approve -> tick sends confirmation -> inbound "1" -> confirmed -> stats show it.
 * Only the data layer and the session lookup are replaced; everything between HTTP and the
 * repositories is the production code path.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEnvCacheForTests } from '@/lib/env';
import { computeTwilioSignature } from '@/lib/http/twilioSignature';
import { ConsoleProvider } from '@/lib/providers/whatsapp';
import type { TickDeps } from '@/lib/reminders/tick';
import { FakeStore } from '@/lib/testing/fakeFollowupStore';
import { FakeInboundRepo } from '@/lib/testing/fakeInboundRepo';
import { FakeTickRepo } from '@/lib/testing/fakeTickRepo';
import { istDateTime } from '@/lib/time/ist';

const SECRET = 'e'.repeat(48);
const TOKEN = 'twilio-token-e2e';
const BASE = 'https://quick-notes.example.com';
const PHONE = '+919812345678';
const clinic = { clinicName: 'Sunrise Family Clinic', doctorName: 'Dr. Mehra', clinicPhone: '+911100000000' };

const store = new FakeStore();
const tickRepo = new FakeTickRepo(() => new Date());
tickRepo.followups = store.followups;
tickRepo.patients = store.patients;
tickRepo.reminders = store.reminders;
const inboundRepo = new FakeInboundRepo();
const provider = new ConsoleProvider();
const tick = (): TickDeps => ({ repo: tickRepo, provider, allowLiveSend: false, clinic, now: () => new Date() });

vi.mock('@/lib/http/auth', async (orig) => ({
  ...(await orig<typeof import('@/lib/http/auth')>()),
  requireStaff: async () => ({ userId: 'doc-1', role: 'doctor', name: 'Dr. Mehra', supabase: {} }),
}));
vi.mock('@/lib/clinic', () => ({ clinicFromEnv: () => clinic }));
vi.mock('@/lib/data/patientsRepo', () => ({
  listForMatching: async () => [...store.patients.values()].map((p) => ({ id: p.id, name: p.name, language: p.language })),
}));
vi.mock('@/lib/data/followupsRepo', () => ({
  insertDraft: async (_db: unknown, row: Record<string, unknown>) => ({ id: store.addFollowup(row).id }),
}));
vi.mock('@/lib/followups/deps', async () => {
  const { sendConfirmationNow } = await import('@/lib/reminders/tick');
  return { followupDeps: () => store.deps(new Date(), { now: () => new Date(), afterApprove: async (f) => void (await sendConfirmationNow(f.id, tick())) }) };
});
vi.mock('@/lib/reminders/tickDeps', () => ({ tickDeps: () => tick() }));
vi.mock('@/lib/replies/deps', () => ({
  inboundDeps: () => {
    inboundRepo.patients = [...store.patients.values()];
    inboundRepo.followups = [...store.followups.values()];
    return { repo: inboundRepo, clinic, now: () => new Date() };
  },
}));
vi.mock('@/lib/data/statsRepo', () => ({
  fetchStatsRows: async () => ({ rows: [...store.followups.values()], truncated: false }),
}));

const logs: string[] = [];
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(istDateTime('2026-11-06', '15:00'));
  Object.assign(process.env, {
    NEXT_PUBLIC_SUPABASE_URL: 'https://abcd.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key-anon-key-anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-service-role-key',
    CRON_SECRET: SECRET,
    APP_BASE_URL: BASE,
    TWILIO_AUTH_TOKEN: TOKEN,
  });
  resetEnvCacheForTests();
});
// vitest restoreMocks resets spies before each test, so capture is installed per test.
beforeEach(() => {
  for (const level of ['log', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logs.push(args.map(String).join(' ')));
  }
});
afterAll(() => {
  vi.useRealTimers();
});

const parse = await import('@/app/api/notes/parse/route');
const approve = await import('@/app/api/followups/[id]/approve/route');
const cron = await import('@/app/api/cron/tick/route');
const inbound = await import('@/app/api/webhooks/twilio/inbound/route');
const stats = await import('@/app/api/stats/route');

const json = (url: string, body: unknown) =>
  new Request(`${BASE}${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

function twilio(body: string) {
  const path = '/api/webhooks/twilio/inbound';
  const params = new URLSearchParams({ From: `whatsapp:${PHONE}`, Body: body, MessageSid: `SM${Date.now()}` });
  return new Request(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': computeTwilioSignature(TOKEN, `${BASE}${path}`, params) },
    body: params.toString(),
  });
}

const advance = (ms: number) => vi.setSystemTime(new Date(Date.now() + ms));

describe('e2e: parse -> approve -> tick -> reply 1 -> stats', () => {
  it('runs the whole loop five times and the stats measure it', async () => {
    const names = ['Sita Verma', 'Ramesh Patel', 'Kamla Devi', 'Arjun Rao', 'Meena Iyer'];
    for (const name of names) store.addPatient({ name, phone_e164: name === 'Sita Verma' ? PHONE : `+9198000000${names.indexOf(name)}0`, language: 'hinglish' });

    for (const [i, name] of names.entries()) {
      // 1. doctor types / dictates (with clinical noise that must be ignored)
      const res = await parse.POST(json('/api/notes/parse', { text: `${name} BP high amlodipine 5mg ${i + 3} din baad`, clientInputMs: 4000 + i * 500 }), {});
      expect(res.status).toBe(200);
      const preview = await res.json();
      expect(preview.patient.name).toBe(name);
      expect(preview.ignoredClinicalContent).toBe(true);
      expect(preview.messagePreview).not.toMatch(/bp|amlodipine|mg/i);

      // 2. glance + one tap
      advance(3000);
      const ap = await approve.POST(json(`/api/followups/${preview.followupId}/approve`, {}), { params: { id: preview.followupId } });
      expect(ap.status).toBe(200);
      const approved = await ap.json();
      expect(approved.followup.status).toBe('approved');
      expect(store.followups.get(preview.followupId)?.raw_note).toBeNull();

      // 3. tick: the confirmation already went out inline at approve; the tick must not send it again
      const t = await cron.POST(new Request(`${BASE}/api/cron/tick`, { method: 'POST', headers: { authorization: `Bearer ${SECRET}` } }), {});
      expect(t.status).toBe(200);
      const sentFor = store.reminders.filter((r) => r.followup_id === preview.followupId && r.kind === 'confirmation' && r.status === 'sent');
      expect(sentFor).toHaveLength(1);
      advance(60_000);
    }
    expect(provider.sent).toHaveLength(5);

    // 4. Sita replies "1" on WhatsApp
    const r = await inbound.POST(twilio('1'), {});
    expect(r.status).toBe(200);
    expect(await r.text()).toMatch(/<Message>Dhanyavaad Sita ji/);
    const sita = [...store.followups.values()].find((f) => f.patient_name_raw === 'Sita Verma');
    expect(sita?.status).toBe('confirmed');

    // 5. stats
    const s = await stats.GET(new Request(`${BASE}/api/stats?range=30d`), {});
    expect(s.status).toBe(200);
    const body = await s.json();
    expect(body.measured.totals).toMatchObject({ approved: 4, confirmed: 1 });
    expect(body.measured.confirmationRate).toBe(0.2);
    expect(body.measured.doctorTimeMs.n).toBe(5);
    expect(body.measured.doctorTimeMs.p50).toBeLessThan(15_000);
    expect(body.modeled.modeled).toBe(true);
  });

  it('a forged webhook and a bad cron bearer are refused', async () => {
    const forged = twilio('2');
    const tampered = new Request(forged.url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': 'AAAA' }, body: await forged.text() });
    expect((await inbound.POST(tampered, {})).status).toBe(403);
    expect((await cron.POST(new Request(`${BASE}/api/cron/tick`, { method: 'POST', headers: { authorization: 'Bearer nope' } }), {})).status).toBe(401);
  });

  it('no log line contains a phone number, note text or message body', () => {
    const all = logs.join('\n');
    expect(all.length).toBeGreaterThan(0);
    expect(all).not.toMatch(/9812345678|98000000\d0/);
    expect(all).not.toMatch(/amlodipine|BP high|din baad/i);
    expect(all).not.toMatch(/Namaste|Dhanyavaad/);
    expect(all).not.toContain(TOKEN);
    expect(all).not.toContain(SECRET);
  });
});
