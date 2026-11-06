import { afterEach, describe, expect, it, vi } from 'vitest';
import { log, maskPhone, redact } from './log';

describe('maskPhone', () => {
  it('masks an Indian E.164 number to the brief format', () => {
    expect(maskPhone('+919876543210')).toBe('+91XXXXXX3210');
  });
  it('fully masks very short values', () => {
    expect(maskPhone('12345')).toBe('XXXX');
  });
});

describe('redact', () => {
  it('drops note text and message bodies and masks phones in any string', () => {
    const out = redact({
      text: 'Ramesh BP high 5mg',
      Body: 'mujhe chakkar',
      raw_note: 'x',
      to: 'whatsapp:+919876543210',
      nested: { detail: 'sent to +91 98765 43210' },
    }) as Record<string, unknown>;
    expect(out.text).toBe('[redacted]');
    expect(out.Body).toBe('[redacted]');
    expect(out.raw_note).toBe('[redacted]');
    expect(out.to).toBe('whatsapp:+91XXXXXX3210');
    expect(JSON.stringify(out.nested)).not.toMatch(/98765/);
  });
});

describe('log', () => {
  afterEach(() => vi.restoreAllMocks());
  it('writes one JSON line without the phone number', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    log.info('reminder_sent', { to: '+919876543210' });
    const line = String(spy.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toMatchObject({ level: 'info', event: 'reminder_sent', to: '+91XXXXXX3210' });
    expect(line).not.toContain('9876543210');
  });
});
