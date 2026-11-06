import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiError, toErrorResponse, withErrorHandling } from './errors';
import { parseJsonBody, parseQuery } from './validate';
import { isValidBearer, safeEqual } from './auth';

function jsonRequest(body: string, headers: Record<string, string> = { 'content-type': 'application/json' }) {
  return new Request('https://x.test/api/thing', { method: 'POST', body, headers });
}

describe('error shape', () => {
  it('serialises ApiError into the standard shape', async () => {
    const res = toErrorResponse(new ApiError(422, 'NAME_MISSING', 'No patient name found'));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: { code: 'NAME_MISSING', message: 'No patient name found' } });
  });

  it('maps zod errors to 400 without echoing input values', async () => {
    const parsed = z.object({ text: z.string().max(3) }).safeParse({ text: 'secret clinical note' });
    const res = toErrorResponse(parsed.error);
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(body)).not.toContain('secret clinical note');
  });

  it('hides unknown errors behind INTERNAL', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const handler = withErrorHandling('test', async () => {
      throw new Error('db password is hunter2');
    });
    const res = await handler(new Request('https://x.test'), {});
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body).toEqual({ error: { code: 'INTERNAL', message: 'Something went wrong' } });
  });

  it('sets Retry-After on rate limit errors', () => {
    const res = toErrorResponse(new ApiError(429, 'RATE_LIMITED', 'slow', { retryAfterSeconds: 7 }));
    expect(res.headers.get('Retry-After')).toBe('7');
  });
});

describe('parseJsonBody', () => {
  const schema = z.object({ text: z.string().min(1).max(280) });

  it('parses a valid body', async () => {
    await expect(parseJsonBody(jsonRequest('{"text":"Sita kal"}'), schema)).resolves.toEqual({ text: 'Sita kal' });
  });
  it('rejects malformed JSON with INVALID_JSON', async () => {
    await expect(parseJsonBody(jsonRequest('{oops'), schema)).rejects.toMatchObject({ code: 'INVALID_JSON' });
  });
  it('rejects the wrong content type', async () => {
    await expect(parseJsonBody(jsonRequest('{}', { 'content-type': 'text/plain' }), schema)).rejects.toMatchObject({
      status: 415,
    });
  });
  it('rejects oversized bodies', async () => {
    const big = JSON.stringify({ text: 'a'.repeat(20_000) });
    await expect(parseJsonBody(jsonRequest(big), schema)).rejects.toMatchObject({ status: 413 });
  });
});

describe('parseQuery', () => {
  it('validates search params', () => {
    const q = parseQuery(new Request('https://x.test/api?limit=5'), z.object({ limit: z.coerce.number().int().max(100) }));
    expect(q.limit).toBe(5);
  });
});

describe('bearer check', () => {
  const secret = 's'.repeat(40);
  it('accepts the right secret only', () => {
    expect(isValidBearer(`Bearer ${secret}`, secret)).toBe(true);
    expect(isValidBearer(`Bearer ${secret}x`, secret)).toBe(false);
    expect(isValidBearer(secret, secret)).toBe(false);
    expect(isValidBearer(null, secret)).toBe(false);
  });
  it('safeEqual handles different lengths without throwing', () => {
    expect(safeEqual('a', 'abc')).toBe(false);
  });
});
