import { describe, expect, it, vi } from 'vitest';
import { loadServerEnv } from '@/lib/env';
import { ConsoleProvider } from './consoleProvider';
import { checkSendGuards, type GuardInput } from './guards';
import { createProvider } from './index';
import { TwilioSandboxProvider } from './twilioSandbox';
import { ManualSendRequired, ProviderError } from './types';
import { buildWaLink, WaLinkProvider } from './waLink';

const NOW = new Date('2026-11-06T09:30:00Z');
const cfg = {
  accountSid: 'AC' + 'a'.repeat(32),
  authToken: 'token-secret',
  from: 'whatsapp:+14155238886',
  templateContentSid: 'HX' + 'b'.repeat(32),
  statusCallbackUrl: 'https://app.test/api/webhooks/twilio/status',
  now: () => NOW,
};
const msg = {
  toE164: '+919812345678',
  body: 'Namaste Sita ji, ...',
  sandboxTemplateVars: { date: 'Wed, 11 Nov', time: 'during clinic hours' },
};

function okFetch(sid = 'SM123') {
  return vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ sid }), { status: 201 }));
}

describe('TwilioSandboxProvider', () => {
  it('free-form inside the 24h window', async () => {
    const fetch = okFetch();
    const p = new TwilioSandboxProvider({ ...cfg, fetch });
    const r = await p.send({ ...msg, lastInboundAt: new Date(NOW.getTime() - 23 * 3600_000) });
    expect(r.sid).toBe('SM123');
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${cfg.accountSid}/Messages.json`);
    const form = new URLSearchParams(String(init!.body));
    expect(form.get('Body')).toBe(msg.body);
    expect(form.get('ContentSid')).toBeNull();
    expect(form.get('To')).toBe('whatsapp:+919812345678');
    expect(form.get('From')).toBe(cfg.from);
    expect(form.get('StatusCallback')).toBe(cfg.statusCallbackUrl);
    expect((init!.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from(`${cfg.accountSid}:token-secret`).toString('base64')}`);
  });

  it.each([
    ['never wrote', null],
    ['wrote 25h ago', new Date(NOW.getTime() - 25 * 3600_000)],
    ['exactly 24h ago', new Date(NOW.getTime() - 24 * 3600_000)],
  ])('template outside the window (%s)', async (_label, lastInboundAt) => {
    const fetch = okFetch();
    const p = new TwilioSandboxProvider({ ...cfg, fetch });
    await p.send({ ...msg, lastInboundAt });
    const form = new URLSearchParams(String(fetch.mock.calls[0]![1]!.body));
    expect(form.get('Body')).toBeNull();
    expect(form.get('ContentSid')).toBe(cfg.templateContentSid);
    expect(JSON.parse(form.get('ContentVariables')!)).toEqual({ 1: 'Wed, 11 Nov', 2: 'during clinic hours' });
  });

  it('template mode without template vars is a permanent error, no request made', async () => {
    const fetch = okFetch();
    const p = new TwilioSandboxProvider({ ...cfg, fetch });
    await expect(p.send({ toE164: msg.toE164, body: 'x' })).rejects.toMatchObject({ retryable: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    [500, {}, true],
    [503, { code: 20503 }, true],
    [429, { code: 20429 }, true],
    [400, { code: 63016, message: 'outside window for +919812345678' }, false],
    [400, { code: 21211 }, false],
    [401, { code: 20003 }, false],
  ])('HTTP %i %j -> retryable=%s, message has no phone', async (status, payload, retryable) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify(payload), { status }));
    const p = new TwilioSandboxProvider({ ...cfg, fetch });
    const err = await p.send({ ...msg, lastInboundAt: null }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).retryable).toBe(retryable);
    expect((err as Error).message).not.toContain('9812345678');
    expect((err as Error).message).not.toContain('token-secret');
  });

  it('network failure and timeout are retryable', async () => {
    const net = new TwilioSandboxProvider({ ...cfg, fetch: vi.fn(async () => { throw new TypeError('fetch failed'); }) });
    await expect(net.send({ ...msg, lastInboundAt: null })).rejects.toMatchObject({ retryable: true });

    const hang = vi.fn<typeof fetch>((_u, init) => new Promise((_r, reject) => {
      init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }));
    const slow = new TwilioSandboxProvider({ ...cfg, fetch: hang, timeoutMs: 20 });
    await expect(slow.send({ ...msg, lastInboundAt: null })).rejects.toMatchObject({ retryable: true, message: 'Twilio request timed out' });
  });

  it('non-JSON error page is handled', async () => {
    const p = new TwilioSandboxProvider({ ...cfg, fetch: vi.fn(async () => new Response('<html>bad gateway</html>', { status: 502 })) });
    await expect(p.send({ ...msg, lastInboundAt: null })).rejects.toMatchObject({ retryable: true });
  });
});

describe('WaLinkProvider / buildWaLink', () => {
  it('builds an encoded wa.me link', () => {
    expect(buildWaLink('+919812345678', 'Namaste Sita ji, 1 & 2?')).toBe('https://wa.me/919812345678?text=Namaste%20Sita%20ji%2C%201%20%26%202%3F');
  });
  it('rejects non-E.164', () => {
    expect(() => buildWaLink('12', 'x')).toThrow(RangeError);
  });
  it('never sends: throws ManualSendRequired carrying the link', async () => {
    const err = await new WaLinkProvider().send(msg).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ManualSendRequired);
    expect((err as ManualSendRequired).link).toMatch(/^https:\/\/wa\.me\/919812345678/);
  });
});

describe('ConsoleProvider', () => {
  it('logs a masked line without the body', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const p = new ConsoleProvider();
    const r = await p.send(msg);
    expect(r.sid).toMatch(/^console-/);
    const line = String(spy.mock.calls[0]?.[0]);
    expect(line).toContain('+91XXXXXX5678');
    expect(line).not.toContain('Namaste');
    expect(p.sent).toHaveLength(1);
  });
});

describe('checkSendGuards', () => {
  const base: GuardInput = {
    live: true,
    allowLiveSend: true,
    kind: 'day_before',
    followupStatus: 'approved',
    patient: { opted_out: false, is_seed: false, phone_e164: '+919812345678' },
  };
  it('passes when everything is fine', () => {
    expect(checkSendGuards(base)).toEqual({ ok: true });
  });
  it.each([
    [{ allowLiveSend: false }, 'live_send_disabled'],
    [{ patient: { ...base.patient, opted_out: true } }, 'opted_out'],
    [{ patient: { ...base.patient, is_seed: true } }, 'seed_patient'],
    [{ patient: { ...base.patient, phone_e164: '+910000000001' } }, 'seed_patient'],
    [{ followupStatus: 'cancelled' }, 'followup_inactive'],
    [{ followupStatus: 'completed' }, 'followup_inactive'],
    [{ followupStatus: 'reschedule_requested' }, 'followup_inactive'],
    [{ kind: 'confirmation', followupStatus: 'confirmed' }, 'followup_inactive'],
    [{ kind: 'missed_nudge', followupStatus: 'approved' }, 'followup_inactive'],
  ] as const)('%j -> %s', (over, reason) => {
    expect(checkSendGuards({ ...base, ...(over as Partial<GuardInput>) })).toEqual({ ok: false, reason });
  });
  it('non-live providers ignore ALLOW_LIVE_SEND and seed checks but keep opt-out and status', () => {
    const nonLive = { ...base, live: false, allowLiveSend: false, patient: { ...base.patient, is_seed: true } };
    expect(checkSendGuards(nonLive)).toEqual({ ok: true });
    expect(checkSendGuards({ ...nonLive, patient: { ...nonLive.patient, opted_out: true } })).toEqual({ ok: false, reason: 'opted_out' });
  });
  it('missed_nudge goes only to missed followups', () => {
    expect(checkSendGuards({ ...base, kind: 'missed_nudge', followupStatus: 'missed' })).toEqual({ ok: true });
  });
});

describe('createProvider', () => {
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: 'https://abcd.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key-anon-key-anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-service-role-key',
    CRON_SECRET: 'x'.repeat(40),
    APP_BASE_URL: 'https://app.test',
  };
  it('defaults to console', () => {
    expect(createProvider(loadServerEnv(env)).name).toBe('console');
  });
  it('builds twilio_sandbox and wa_link', () => {
    expect(
      createProvider(
        loadServerEnv({
          ...env,
          MESSAGE_PROVIDER: 'twilio_sandbox',
          TWILIO_ACCOUNT_SID: cfg.accountSid,
          TWILIO_AUTH_TOKEN: 't',
          TWILIO_WHATSAPP_FROM: cfg.from,
          TWILIO_SANDBOX_TEMPLATE_CONTENT_SID: cfg.templateContentSid,
        }),
      ).name,
    ).toBe('twilio_sandbox');
    expect(createProvider(loadServerEnv({ ...env, MESSAGE_PROVIDER: 'wa_link' })).name).toBe('wa_link');
  });
});
