import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRateLimiter } from '@/lib/http/rateLimit';
import { computeTwilioSignature, isValidTwilioSignature } from '@/lib/http/twilioSignature';
import { FakeInboundRepo } from '@/lib/testing/fakeInboundRepo';
import { istDateTime } from '@/lib/time/ist';
import { AUTO_REPLY_WINDOW_MS, handleInbound, pickFollowup, type InboundDeps } from './handleInbound';
import { classify, normalise } from './intent';
import { twiml } from './twiml';

const PHONE = '+919812345678';
let now: Date;
let repo: FakeInboundRepo;
const clinic = { clinicName: 'Sunrise Family Clinic', doctorName: 'Dr. Mehra', clinicPhone: '+911100000000' };
const deps = (): InboundDeps => ({ repo, clinic, now: () => now, unknownLimiter: createRateLimiter({ limit: 1, windowMs: AUTO_REPLY_WINDOW_MS }) });

beforeEach(() => {
  now = istDateTime('2026-11-06', '12:00');
  repo = new FakeInboundRepo();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
});

describe('classify', () => {
  it.each([
    ['1', 'confirm'], [' 1. ', 'confirm'], ['YES', 'confirm'], ['Haan!', 'confirm'], ['ha', 'confirm'], ['confirm', 'confirm'], ['ok', 'confirm'],
    ['2', 'reschedule'], ['Reschedule', 'reschedule'], ['change', 'reschedule'],
    ['STOP', 'stop'], ['unsubscribe', 'stop'], ['band', 'stop'],
    ['join yellow-tiger', 'join'], ['Join  bright-sun', 'join'],
    ['1 2', 'other'], ['12', 'other'], ['yes please call me', 'other'], ['mujhe chakkar aa rahe hain kya lu', 'other'], ['', 'other'], ['🙂', 'other'],
  ])('%j -> %s', (body, intent) => {
    expect(classify(body)).toBe(intent);
  });
  it('normalise strips punctuation and case', () => {
    expect(normalise('  HaAn!!!  ')).toBe('haan');
  });
});

describe('handleInbound (Brief B7 reply table)', () => {
  it('"1" confirms the active followup and replies reply_confirmed', async () => {
    const p = repo.addPatient({ phone_e164: PHONE, name: 'Sita Verma' });
    const f = repo.addFollowup({ patient_id: p.id, followup_date: '2026-11-11' });
    const r = await handleInbound({ fromE164: PHONE, body: '1' }, deps());
    expect(r).toMatchObject({ intent: 'confirm', action: 'confirmed' });
    expect(r.reply).toBe('Dhanyavaad Sita ji, Wed, 11 Nov ka aapka follow-up confirm ho gaya hai. Sunrise Family Clinic');
    expect(repo.followups[0]).toMatchObject({ id: f.id, status: 'confirmed', confirmed_at: now.toISOString() });
    expect(repo.patients[0]?.last_inbound_at).toBe(now.toISOString());
  });

  it('"1" twice is idempotent', async () => {
    const p = repo.addPatient({ phone_e164: PHONE });
    repo.addFollowup({ patient_id: p.id });
    await handleInbound({ fromE164: PHONE, body: '1' }, deps());
    const second = await handleInbound({ fromE164: PHONE, body: 'yes' }, deps());
    expect(second.action).toBe('none');
    expect(second.reply).toMatch(/confirm/);
  });

  it('"2" -> reschedule_requested with attention, ack reply', async () => {
    const p = repo.addPatient({ phone_e164: PHONE, language: 'english' });
    repo.addFollowup({ patient_id: p.id, status: 'confirmed' });
    const r = await handleInbound({ fromE164: PHONE, body: '2' }, deps());
    expect(r.action).toBe('reschedule_requested');
    expect(repo.followups[0]).toMatchObject({ status: 'reschedule_requested', attention_reason: 'reschedule_requested' });
    expect(r.reply).toMatch(/will call you soon/);
  });

  it('"1" after "2" does not undo the reschedule request', async () => {
    const p = repo.addPatient({ phone_e164: PHONE });
    repo.addFollowup({ patient_id: p.id, status: 'reschedule_requested', attention_reason: 'reschedule_requested' });
    const r = await handleInbound({ fromE164: PHONE, body: '1' }, deps());
    expect(r.action).toBe('none');
    expect(repo.followups[0]?.status).toBe('reschedule_requested');
  });

  it('STOP opts out every patient on that phone and cancels pending reminders', async () => {
    const a = repo.addPatient({ phone_e164: PHONE, name: 'Sita Verma' });
    const b = repo.addPatient({ phone_e164: PHONE, name: 'Ramesh Verma' });
    const f = repo.addFollowup({ patient_id: a.id });
    repo.reminders.push({ followup_id: f.id, status: 'pending', provider_message_sid: null, last_error: null });
    repo.reminders.push({ followup_id: f.id, status: 'sent', provider_message_sid: 'SM1', last_error: null });
    const r = await handleInbound({ fromE164: PHONE, body: 'STOP' }, deps());
    expect(r.action).toBe('opted_out');
    expect(repo.patients.every((p) => p.opted_out)).toBe(true);
    expect(repo.reminders.map((x) => x.status)).toEqual(['cancelled', 'sent']);
    expect(r.reply).toMatch(/reminders nahi aayenge/);
    expect([a.id, b.id]).toHaveLength(2);
  });

  it('join only updates last_inbound_at, no reply', async () => {
    const p = repo.addPatient({ phone_e164: PHONE });
    repo.addFollowup({ patient_id: p.id });
    const r = await handleInbound({ fromE164: PHONE, body: 'join yellow-tiger' }, deps());
    expect(r).toEqual({ intent: 'join', action: 'none', reply: null });
    expect(repo.patients[0]?.last_inbound_at).toBe(now.toISOString());
    expect(repo.followups[0]?.status).toBe('approved');
  });

  it('a health question gets the fixed out-of-scope reply, attention set, no status change', async () => {
    const p = repo.addPatient({ phone_e164: PHONE });
    repo.addFollowup({ patient_id: p.id });
    const r = await handleInbound({ fromE164: PHONE, body: 'mujhe chakkar aa rahe hain kya lu' }, deps());
    expect(r.reply).toBe(
      'Ye number sirf appointment reminders ke liye hai. Health se jude sawal ke liye kripya clinic ko +911100000000 par call karein.',
    );
    expect(repo.followups[0]).toMatchObject({ status: 'approved', attention_reason: 'patient_message' });
    expect(JSON.stringify(repo)).not.toContain('chakkar');
  });

  it('out-of-scope reply at most once per 6 h per patient', async () => {
    const p = repo.addPatient({ phone_e164: PHONE });
    repo.addFollowup({ patient_id: p.id });
    expect((await handleInbound({ fromE164: PHONE, body: 'hello' }, deps())).reply).not.toBeNull();
    now = new Date(now.getTime() + 5 * 3600_000);
    expect((await handleInbound({ fromE164: PHONE, body: 'hello?' }, deps())).reply).toBeNull();
    now = new Date(now.getTime() + 61 * 60_000);
    expect((await handleInbound({ fromE164: PHONE, body: 'hello??' }, deps())).reply).not.toBeNull();
  });

  it('does not overwrite a stronger attention reason', async () => {
    const p = repo.addPatient({ phone_e164: PHONE });
    repo.addFollowup({ patient_id: p.id, attention_reason: 'send_failed' });
    await handleInbound({ fromE164: PHONE, body: 'hi' }, deps());
    expect(repo.followups[0]?.attention_reason).toBe('send_failed');
  });

  it.each(['1', '2', 'STOP', 'hello'])('unknown phone + %j -> out-of-scope reply, nothing changed', async (body) => {
    const d = deps();
    const r = await handleInbound({ fromE164: '+919999999999', body }, d);
    expect(r.action).toBe('none');
    expect(r.reply).toMatch(/sirf appointment reminders/);
    expect((await handleInbound({ fromE164: '+919999999999', body }, d)).reply).toBeNull();
  });

  it('known phone without an active followup: "1" gets out-of-scope', async () => {
    const p = repo.addPatient({ phone_e164: PHONE });
    repo.addFollowup({ patient_id: p.id, status: 'completed' });
    const r = await handleInbound({ fromE164: PHONE, body: '1' }, deps());
    expect(r.action).toBe('none');
    expect(repo.followups[0]?.status).toBe('completed');
    expect(r.reply).toMatch(/sirf appointment reminders/);
  });

  it('replies never contain the inbound text', async () => {
    const p = repo.addPatient({ phone_e164: PHONE });
    repo.addFollowup({ patient_id: p.id });
    const r = await handleInbound({ fromE164: PHONE, body: 'take paracetamol 500mg?' }, deps());
    expect(r.reply).not.toMatch(/paracetamol|500mg/);
  });
});

describe('pickFollowup', () => {
  it('prefers the soonest upcoming over past ones', () => {
    const past = repo.addFollowup({ followup_date: '2026-11-01' });
    const soon = repo.addFollowup({ followup_date: '2026-11-08' });
    repo.addFollowup({ followup_date: '2026-11-20' });
    expect(pickFollowup(repo.followups, now)?.id).toBe(soon.id);
    expect(pickFollowup([past], now)?.id).toBe(past.id);
    expect(pickFollowup([], now)).toBeNull();
  });
});

describe('twiml', () => {
  it('escapes XML and produces empty Response for null', () => {
    expect(twiml(null)).toBe('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    expect(twiml('a < b & "c"')).toContain('<Message>a &lt; b &amp; &quot;c&quot;</Message>');
  });
});

describe('Twilio signature', () => {
  const url = 'https://app.test/api/webhooks/twilio/inbound';
  const params = new URLSearchParams({ From: 'whatsapp:+919812345678', Body: '1', MessageSid: 'SM123' });
  it('round-trips and is order independent', () => {
    const sig = computeTwilioSignature('tok', url, params);
    const reordered = new URLSearchParams({ MessageSid: 'SM123', Body: '1', From: 'whatsapp:+919812345678' });
    expect(isValidTwilioSignature('tok', url, reordered, sig)).toBe(true);
  });
  it.each([
    ['wrong token', 'other', url, params],
    ['different url', 'tok', 'https://evil.test/api/webhooks/twilio/inbound', params],
    ['tampered body', 'tok', url, new URLSearchParams({ From: 'whatsapp:+919812345678', Body: '2', MessageSid: 'SM123' })],
  ])('rejects %s', (_l, token, u, p) => {
    const sig = computeTwilioSignature('tok', url, params);
    expect(isValidTwilioSignature(token, u, p, sig)).toBe(false);
  });
  it('rejects missing or garbage signatures', () => {
    expect(isValidTwilioSignature('tok', url, params, null)).toBe(false);
    expect(isValidTwilioSignature('tok', url, params, 'x')).toBe(false);
  });
  it('matches an independent HMAC-SHA1 computation', async () => {
    const { createHmac } = await import('node:crypto');
    const data = url + 'Body1' + 'Fromwhatsapp:+919812345678' + 'MessageSidSM123';
    expect(computeTwilioSignature('tok', url, params)).toBe(createHmac('sha1', 'tok').update(data).digest('base64'));
  });
});
