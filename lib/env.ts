import { z } from 'zod';

/**
 * Environment contract (Brief section 10). Validated with zod, fails fast at boot
 * (see instrumentation.ts). Only NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
 * may be public; every other value is server-only.
 */

export const PUBLIC_ENV_ALLOWLIST = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'] as const;

const SENSITIVE_NAME = /(SECRET|TOKEN|SERVICE_ROLE|PASSWORD|PRIVATE|AUTH)/i;

const boolFlag = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v === undefined || v === '' ? undefined : v));

function fraction(defaultValue: number) {
  return z.coerce.number().min(0).max(1).default(defaultValue);
}

function positive(defaultValue: number, max: number) {
  return z.coerce.number().positive().max(max).default(defaultValue);
}

const closedDays = z
  .string()
  .trim()
  .default('')
  .transform((v, ctx) => {
    if (v === '') return [] as number[];
    const days = v.split(',').map((d) => Number(d.trim()));
    if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
      ctx.addIssue({ code: 'custom', message: 'must be comma separated weekday numbers 0-6 (0 = Sunday)' });
      return z.NEVER;
    }
    return [...new Set(days)];
  });

const phoneE164 = z.string().regex(/^\+[1-9][0-9]{9,14}$/, 'must be E.164, e.g. +919812345678');

export const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
});

export const serverEnvSchema = publicEnvSchema
  .extend({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    VERCEL_ENV: z.enum(['development', 'preview', 'production']).optional(),

    SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),

    MESSAGE_PROVIDER: z.enum(['twilio_sandbox', 'wa_link', 'console']).default('console'),
    ALLOW_LIVE_SEND: boolFlag,
    TWILIO_ACCOUNT_SID: optionalString.pipe(z.string().regex(/^AC[0-9a-f]{32}$/i).optional()),
    TWILIO_AUTH_TOKEN: optionalString,
    TWILIO_WHATSAPP_FROM: optionalString.pipe(
      z
        .string()
        .regex(/^whatsapp:\+[1-9][0-9]{6,14}$/, 'must look like whatsapp:+14155238886')
        .optional(),
    ),
    TWILIO_SANDBOX_JOIN_CODE: optionalString,
    TWILIO_SANDBOX_TEMPLATE_CONTENT_SID: optionalString.pipe(z.string().regex(/^HX[0-9a-f]{32}$/i).optional()),

    CRON_SECRET: z.string().min(32, 'use a long random string (>= 32 chars)'),
    APP_BASE_URL: z
      .url()
      .transform((v) => v.replace(/\/+$/, '')),

    CLINIC_NAME: z.string().trim().min(1).max(60).default('Sunrise Family Clinic'),
    CLINIC_PHONE: optionalString.pipe(phoneE164.optional()),
    DEFAULT_DOCTOR_NAME: z.string().trim().min(1).max(60).default('Dr. Mehra'),
    DEFAULT_TIMEZONE: z.literal('Asia/Kolkata').default('Asia/Kolkata'),
    CLINIC_CLOSED_DAYS: closedDays,

    ENABLE_LLM_PARSER: boolFlag,
    GEMINI_API_KEY: optionalString,

    // Modeled stats inputs. Defaults are PLACEHOLDERS (Brief B8), not facts.
    PATIENTS_PER_DAY: positive(50, 10_000),
    BASELINE_MISS_RATE: fraction(0.3),
    FOLLOWUP_SHARE: fraction(0.4),
    RECOVERY_RATE: fraction(0.5),
    AVG_FEE_INR: positive(300, 1_000_000),
    WORKING_DAYS_PER_MONTH: positive(26, 31),
  })
  .superRefine((env, ctx) => {
    if (env.MESSAGE_PROVIDER === 'twilio_sandbox') {
      for (const key of [
        'TWILIO_ACCOUNT_SID',
        'TWILIO_AUTH_TOKEN',
        'TWILIO_WHATSAPP_FROM',
        'TWILIO_SANDBOX_TEMPLATE_CONTENT_SID',
      ] as const) {
        if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'required when MESSAGE_PROVIDER=twilio_sandbox' });
      }
    }
    if (env.ALLOW_LIVE_SEND && env.MESSAGE_PROVIDER !== 'twilio_sandbox') {
      ctx.addIssue({
        code: 'custom',
        path: ['ALLOW_LIVE_SEND'],
        message: 'only meaningful with MESSAGE_PROVIDER=twilio_sandbox; leave it false otherwise',
      });
    }
    if (env.ENABLE_LLM_PARSER && !env.GEMINI_API_KEY) {
      ctx.addIssue({ code: 'custom', path: ['GEMINI_API_KEY'], message: 'required when ENABLE_LLM_PARSER=true' });
    }
    if (env.NODE_ENV === 'production' && !env.APP_BASE_URL.startsWith('https://')) {
      ctx.addIssue({ code: 'custom', path: ['APP_BASE_URL'], message: 'must be https in production (Twilio signature check)' });
    }
  });

export type PublicEnv = z.infer<typeof publicEnvSchema>;
export type ServerEnv = z.infer<typeof serverEnvSchema>;

export class EnvError extends Error {
  constructor(public readonly problems: string[]) {
    // Only variable names and rule messages, never values.
    super(`Invalid environment configuration:\n  - ${problems.join('\n  - ')}`);
    this.name = 'EnvError';
  }
}

type EnvSource = Record<string, string | undefined>;

/** Rejects secrets that were accidentally exposed to the browser bundle. */
function checkPublicLeaks(source: EnvSource): string[] {
  return Object.keys(source)
    .filter((k) => k.startsWith('NEXT_PUBLIC_'))
    .filter((k) => !(PUBLIC_ENV_ALLOWLIST as readonly string[]).includes(k))
    .filter((k) => SENSITIVE_NAME.test(k))
    .map((k) => `${k}: secrets must never use the NEXT_PUBLIC_ prefix`);
}

function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
}

/** Pure loader, used by tests and by getServerEnv(). */
export function loadServerEnv(source: EnvSource): ServerEnv {
  const leaks = checkPublicLeaks(source);
  const parsed = serverEnvSchema.safeParse(source);
  const problems = [...leaks, ...(parsed.success ? [] : formatIssues(parsed.error))];
  if (problems.length > 0 || !parsed.success) throw new EnvError(problems);
  return parsed.data;
}

export function loadPublicEnv(source: EnvSource): PublicEnv {
  const parsed = publicEnvSchema.safeParse(source);
  if (!parsed.success) throw new EnvError(formatIssues(parsed.error));
  return parsed.data;
}

let cachedServerEnv: ServerEnv | undefined;

/**
 * Server env, validated once and cached. Lazy so that `next build` can import
 * route modules without secrets; instrumentation.ts calls it at boot.
 */
export function getServerEnv(): ServerEnv {
  if (typeof window !== 'undefined') {
    throw new Error('getServerEnv() must never run in the browser');
  }
  cachedServerEnv ??= loadServerEnv(process.env);
  return cachedServerEnv;
}

/**
 * Public env. Next.js inlines NEXT_PUBLIC_* only for literal property access,
 * so the two keys are read explicitly.
 */
export function getPublicEnv(): PublicEnv {
  return loadPublicEnv({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
}

/** Test helper only. */
export function resetEnvCacheForTests(): void {
  cachedServerEnv = undefined;
}
