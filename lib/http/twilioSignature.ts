import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Twilio request signature (X-Twilio-Signature):
 * base64(HMAC-SHA1(authToken, url + concat(sorted(param keys) -> key + value))).
 * `url` must be the public URL Twilio called (APP_BASE_URL + path + query), not request.url,
 * because proxies rewrite the host/protocol.
 */
export function computeTwilioSignature(authToken: string, url: string, params: URLSearchParams): string {
  const keys = [...new Set(params.keys())].sort();
  let data = url;
  for (const key of keys) {
    for (const value of params.getAll(key)) data += key + value;
  }
  return createHmac('sha1', authToken).update(Buffer.from(data, 'utf8')).digest('base64');
}

export function isValidTwilioSignature(authToken: string, url: string, params: URLSearchParams, signature: string | null): boolean {
  if (!signature) return false;
  const expected = Buffer.from(computeTwilioSignature(authToken, url, params));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
