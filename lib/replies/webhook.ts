import { getServerEnv } from '@/lib/env';
import { ApiError } from '@/lib/http/errors';
import { isValidTwilioSignature } from '@/lib/http/twilioSignature';

const MAX_FORM_BYTES = 32 * 1024;

/**
 * Reads a Twilio webhook form body and verifies X-Twilio-Signature against
 * APP_BASE_URL + path (+ query). 403 INVALID_SIGNATURE on any mismatch.
 */
export async function readSignedTwilioForm(req: Request, path: string): Promise<URLSearchParams> {
  const env = getServerEnv();
  if (!env.TWILIO_AUTH_TOKEN) {
    // Webhooks only make sense with Twilio configured; refuse rather than accept unsigned input.
    throw new ApiError(403, 'INVALID_SIGNATURE', 'Twilio is not configured');
  }
  const ct = req.headers.get('content-type') ?? '';
  if (!ct.toLowerCase().startsWith('application/x-www-form-urlencoded')) {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Expected application/x-www-form-urlencoded');
  }
  const raw = await req.text();
  if (Buffer.byteLength(raw, 'utf8') > MAX_FORM_BYTES) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Body too large');
  const params = new URLSearchParams(raw);
  const query = new URL(req.url).search;
  const url = `${env.APP_BASE_URL}${path}${query}`;
  if (!isValidTwilioSignature(env.TWILIO_AUTH_TOKEN, url, params, req.headers.get('x-twilio-signature'))) {
    throw new ApiError(403, 'INVALID_SIGNATURE', 'Invalid Twilio signature');
  }
  return params;
}

/** 'whatsapp:+919812345678' -> '+919812345678', or null if not E.164. */
export function parseWhatsAppFrom(value: string | null): string | null {
  if (!value) return null;
  const phone = value.replace(/^whatsapp:/i, '').trim();
  return /^\+[1-9][0-9]{9,14}$/.test(phone) ? phone : null;
}
