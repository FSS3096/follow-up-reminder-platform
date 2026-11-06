import { getServerEnv } from '@/lib/env';
import { ApiError } from '@/lib/http/errors';
import { isValidTwilioSignature } from '@/lib/http/twilioSignature';

export const MAX_FORM_BYTES = 32 * 1024;

async function readBodyBounded(req: Request, maxBytes: number): Promise<string> {
  const body = req.body;
  if (!body) return '';
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel('request body exceeds configured limit');
        throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Body too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

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
  const contentLength = req.headers.get('content-length');
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > MAX_FORM_BYTES) {
    await req.body?.cancel('request body exceeds configured limit');
    throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Body too large');
  }
  const raw = await readBodyBounded(req, MAX_FORM_BYTES);
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
