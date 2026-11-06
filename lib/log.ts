/**
 * Structured logger with redaction (Brief section 2, Logging):
 * - phone numbers are masked (+91XXXXXX3210)
 * - note text, message bodies and credentials are never written
 */

type Level = 'info' | 'warn' | 'error';
type Fields = Record<string, unknown>;

const REDACTED_KEYS = new Set([
  'text',
  'body',
  'Body',
  'note',
  'raw_note',
  'rawNote',
  'message',
  'messagePreview',
  'message_preview',
  'authorization',
  'cookie',
  'password',
  'token',
  'secret',
  'apiKey',
  'api_key',
]);

const PHONE_IN_TEXT = /\+?\d[\d\s-]{8,}\d/g;

/** "+919876543210" -> "+91XXXXXX3210". Anything shorter than 8 digits is fully masked. */
export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 8) return 'XXXX';
  const country = digits.length > 10 ? digits.slice(0, digits.length - 10) : '';
  const last4 = digits.slice(-4);
  const hidden = 'X'.repeat(digits.length - country.length - 4);
  return `${value.trim().startsWith('+') || country ? '+' : ''}${country}${hidden}${last4}`;
}

function scrubString(value: string): string {
  return value.replace(PHONE_IN_TEXT, (m) => maskPhone(m));
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[depth]';
  if (typeof value === 'string') return scrubString(value);
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value instanceof Error) {
    return { name: value.name, message: scrubString(value.message) };
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = REDACTED_KEYS.has(k) ? '[redacted]' : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

function write(level: Level, event: string, fields: Fields = {}): void {
  const line = JSON.stringify({ level, event, at: new Date().toISOString(), ...(redact(fields) as Fields) });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.info(line);
}

export const log = {
  info: (event: string, fields?: Fields) => write('info', event, fields),
  warn: (event: string, fields?: Fields) => write('warn', event, fields),
  error: (event: string, fields?: Fields) => write('error', event, fields),
};
