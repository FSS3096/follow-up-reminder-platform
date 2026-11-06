import { describe, expect, it } from 'vitest';
import { EnvError, loadServerEnv } from './env';

const valid = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://abcd.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key-anon-key-anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-service-role-key',
  CRON_SECRET: 'x'.repeat(40),
  APP_BASE_URL: 'https://quick-notes.example.com/',
};

function problemsOf(source: Record<string, string | undefined>): string[] {
  try {
    loadServerEnv(source);
    return [];
  } catch (e) {
    if (e instanceof EnvError) return e.problems;
    throw e;
  }
}

describe('loadServerEnv', () => {
  it('accepts a minimal valid env and applies safe defaults', () => {
    const env = loadServerEnv(valid);
    expect(env.MESSAGE_PROVIDER).toBe('console');
    expect(env.ALLOW_LIVE_SEND).toBe(false);
    expect(env.ENABLE_LLM_PARSER).toBe(false);
    expect(env.DEFAULT_TIMEZONE).toBe('Asia/Kolkata');
    expect(env.APP_BASE_URL).toBe('https://quick-notes.example.com');
    expect(env.CLINIC_CLOSED_DAYS).toEqual([]);
    expect(env.PATIENTS_PER_DAY).toBe(50);
    expect(env.BASELINE_MISS_RATE).toBe(0.3);
  });

  it.each(['SUPABASE_SERVICE_ROLE_KEY', 'CRON_SECRET', 'APP_BASE_URL', 'NEXT_PUBLIC_SUPABASE_URL'])(
    'refuses to boot without %s',
    (key) => {
      const problems = problemsOf({ ...valid, [key]: undefined });
      expect(problems.some((p) => p.startsWith(`${key}:`))).toBe(true);
    },
  );

  it('rejects a short CRON_SECRET', () => {
    expect(problemsOf({ ...valid, CRON_SECRET: 'short' }).join()).toMatch(/CRON_SECRET/);
  });

  it('requires Twilio settings when the sandbox provider is selected', () => {
    const problems = problemsOf({ ...valid, MESSAGE_PROVIDER: 'twilio_sandbox' });
    for (const key of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_WHATSAPP_FROM', 'TWILIO_SANDBOX_TEMPLATE_CONTENT_SID']) {
      expect(problems.some((p) => p.startsWith(`${key}:`))).toBe(true);
    }
  });

  it('only accepts the literal strings true/false for flags', () => {
    expect(problemsOf({ ...valid, ALLOW_LIVE_SEND: 'yes' }).join()).toMatch(/ALLOW_LIVE_SEND/);
    expect(problemsOf({ ...valid, ALLOW_LIVE_SEND: 'true' }).join()).toMatch(/only meaningful/);
  });

  it('requires GEMINI_API_KEY when the LLM parser is enabled', () => {
    expect(problemsOf({ ...valid, ENABLE_LLM_PARSER: 'true' }).join()).toMatch(/GEMINI_API_KEY/);
  });

  it('rejects secrets exposed with a NEXT_PUBLIC_ prefix', () => {
    const problems = problemsOf({ ...valid, NEXT_PUBLIC_TWILIO_AUTH_TOKEN: 'abc' });
    expect(problems.join()).toMatch(/NEXT_PUBLIC_TWILIO_AUTH_TOKEN/);
  });

  it('parses CLINIC_CLOSED_DAYS', () => {
    expect(loadServerEnv({ ...valid, CLINIC_CLOSED_DAYS: '0, 6,0' }).CLINIC_CLOSED_DAYS).toEqual([0, 6]);
    expect(problemsOf({ ...valid, CLINIC_CLOSED_DAYS: '7' }).join()).toMatch(/CLINIC_CLOSED_DAYS/);
  });

  it('requires https APP_BASE_URL in production', () => {
    expect(problemsOf({ ...valid, NODE_ENV: 'production', APP_BASE_URL: 'http://x.example.com' }).join()).toMatch(
      /https/,
    );
  });

  it('never puts secret values in the error message', () => {
    try {
      loadServerEnv({ ...valid, CRON_SECRET: 'tiny-secret-value' });
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).not.toContain('tiny-secret-value');
    }
  });
});
