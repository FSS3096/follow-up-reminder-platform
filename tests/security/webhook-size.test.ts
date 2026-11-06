import { beforeAll, describe, expect, it } from 'vitest';
import { resetEnvCacheForTests } from '@/lib/env';
import { computeTwilioSignature } from '@/lib/http/twilioSignature';
import { MAX_FORM_BYTES, readSignedTwilioForm } from '@/lib/replies/webhook';

const TOKEN = 'twilio-auth-token-size-test';
const BASE = 'https://quick-notes.example.com';
const PATH = '/api/webhooks/twilio/inbound';

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

function requestWithStream(stream: ReadableStream<Uint8Array>, signature = ''): Request {
  return new Request(`${BASE}${PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': signature },
    body: stream,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
}

describe('bounded Twilio webhook body reader', () => {
  it('accepts an exactly just-under-limit signed form', async () => {
    const raw = `Pad=${'a'.repeat(MAX_FORM_BYTES - 5)}`;
    expect(new TextEncoder().encode(raw).byteLength).toBe(MAX_FORM_BYTES - 1);
    const params = new URLSearchParams(raw);
    const signature = computeTwilioSignature(TOKEN, `${BASE}${PATH}`, params);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode(raw)); controller.close(); },
    });

    const parsed = await readSignedTwilioForm(requestWithStream(stream, signature), PATH);

    expect(parsed.get('Pad')).toBe('a'.repeat(MAX_FORM_BYTES - 5));
  });

  it('cancels a continuing stream immediately when it crosses the limit', async () => {
    let pulls = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(pulls === 1 ? MAX_FORM_BYTES : 1));
      },
      cancel() { cancelled = true; },
    });

    await expect(readSignedTwilioForm(requestWithStream(stream), PATH)).rejects.toMatchObject({ status: 413, code: 'PAYLOAD_TOO_LARGE' });
    expect(cancelled).toBe(true);
    expect(pulls).toBeLessThanOrEqual(2);
  });
});
