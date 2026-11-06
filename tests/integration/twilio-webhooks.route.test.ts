import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEnvCacheForTests } from '@/lib/env';
import { computeTwilioSignature } from '@/lib/http/twilioSignature';
import { FakeInboundRepo } from '@/lib/testing/fakeInboundRepo';
import { istDateTime } from '@/lib/time/ist';

const TOKEN = 'twilio-auth-token-test';
const BASE = 'https://quick-notes.example.com';
let repo: FakeInboundRepo;

vi.mock('@/lib/replies/deps', () => ({
  inboundDeps: () => ({ repo, clinic: { clinicName: 'Sunrise Family Clinic', doctorName: 'Dr. Mehra', clinicPhone: '+911100000000' }, now: () => istDateTime('2026-11-06', '12:00') }),
}));
vi.mock('@/lib/supabase/admin', () => ({ getAdminClient: () => ({}) }));
vi.mock('@/lib/data/inboundRepo', () => ({ createInboundRepo: () => repo }));

beforeAll(() => {
  Object.assign(process.env, {
    NEXT_PUBLIC_SUPABASE_URL: 'https://abcd.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key-anon-key-anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-service-role-key',
    CRON_SECRET: 'c'.repeat(48),
    APP_BASE_URL: BASE,
    TWILIO_AUTH_TOKEN: TOKEN,
  });
  resetEnvCacheForTests();
});
beforeEach(() => {
  repo = new FakeInboundRepo();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

const inbound = await import('@/app/api/webhooks/twilio/inbound/route');
const status = await import('@/app/api/webhooks/twilio/status/route');

function signed(path: string, fields: Record<string, string>, opts: { token?: string; requestHost?: string; signature?: string | null } = {}) {
  const params = new URLSearchParams(fields);
  const sig = opts.signature === undefined ? computeTwilioSignature(opts.token ?? TOKEN, `${BASE}${path}`, params) : opts.signature;
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' };
  if (sig !== null) headers['x-twilio-signature'] = sig;
  // request.url differs from APP_BASE_URL on purpose (proxies rewrite it)
  return new Request(`${opts.requestHost ?? 'http://internal-lambda:3000'}${path}`, { method: 'POST', headers, body: params.toString() });
}

describe('POST /api/webhooks/twilio/inbound', () => {
  const path = '/api/webhooks/twilio/inbound';

  it('valid signature: confirms and replies with TwiML', async () => {
    const p = repo.addPatient({ phone_e164: '+919812345678', name: 'Sita Verma' });
    repo.addFollowup({ patient_id: p.id, followup_date: '2026-11-11' });
    const res = await inbound.POST(signed(path, { From: 'whatsapp:+919812345678', Body: '1', MessageSid: 'SM1' }), {});
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/xml/);
    expect(await res.text()).toMatch(/<Response><Message>Dhanyavaad Sita ji/);
    expect(repo.followups[0]?.status).toBe('confirmed');
  });

  it.each([
    ['missing signature', { signature: null }],
    ['wrong token', { token: 'forged' }],
    ['garbage signature', { signature: 'abc=' }],
  ])('403 for %s and no state change', async (_l, opts) => {
    const p = repo.addPatient({ phone_e164: '+919812345678' });
    repo.addFollowup({ patient_id: p.id });
    const res = await inbound.POST(signed(path, { From: 'whatsapp:+919812345678', Body: '1' }, opts), {});
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('INVALID_SIGNATURE');
    expect(repo.followups[0]?.status).toBe('approved');
  });

  it('a signature for another path is rejected', async () => {
    const params = new URLSearchParams({ From: 'whatsapp:+919812345678', Body: '1' });
    const sig = computeTwilioSignature(TOKEN, `${BASE}/api/webhooks/twilio/status`, params);
    const res = await inbound.POST(signed(path, Object.fromEntries(params), { signature: sig }), {});
    expect(res.status).toBe(403);
  });

  it('415 for JSON', async () => {
    const res = await inbound.POST(new Request(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }), {});
    expect(res.status).toBe(415);
  });

  it('bad From -> empty TwiML', async () => {
    const res = await inbound.POST(signed(path, { From: 'sms:12', Body: '1' }), {});
    expect(await res.text()).toMatch(/<Response><\/Response>/);
  });

  it('never logs the message body', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    await inbound.POST(signed(path, { From: 'whatsapp:+919812345678', Body: 'mujhe chakkar aa rahe hain' }), {});
    expect(info.mock.calls.flat().join(' ')).not.toMatch(/chakkar|9812345678/);
  });
});

describe('POST /api/webhooks/twilio/status', () => {
  const path = '/api/webhooks/twilio/status';
  it('failed delivery marks the reminder failed and flags the followup', async () => {
    const f = repo.addFollowup();
    repo.reminders.push({ followup_id: f.id, status: 'sent', provider_message_sid: 'SM0123456789', last_error: null });
    const res = await status.POST(signed(path, { MessageSid: 'SM0123456789', MessageStatus: 'undelivered', ErrorCode: '63016' }), {});
    expect(res.status).toBe(204);
    expect(repo.reminders[0]).toMatchObject({ status: 'failed', last_error: 'twilio status undelivered' });
    expect(repo.followups[0]?.attention_reason).toBe('send_failed');
  });
  it('delivered changes nothing', async () => {
    const f = repo.addFollowup();
    repo.reminders.push({ followup_id: f.id, status: 'sent', provider_message_sid: 'SM0123456789', last_error: null });
    await status.POST(signed(path, { MessageSid: 'SM0123456789', MessageStatus: 'delivered' }), {});
    expect(repo.reminders[0]?.status).toBe('sent');
  });
  it('403 when forged', async () => {
    expect((await status.POST(signed(path, { MessageSid: 'SM1', MessageStatus: 'failed' }, { token: 'x' }), {})).status).toBe(403);
  });
});
