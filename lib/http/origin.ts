/**
 * Same-origin policy for /api (Brief B10 "CORS closed"). No CORS headers are ever sent, so browsers
 * block cross-origin reads; this also blocks cross-site WRITES (CSRF), which CORS alone does not,
 * because the Supabase session lives in a cookie.
 *
 * Requests without Origin / Sec-Fetch-Site (Twilio, cron-job.org, curl) are not browsers and pass;
 * they are authenticated by signature / bearer instead.
 */
export type OriginDecision = { allow: true } | { allow: false; reason: 'cross_origin' | 'preflight' };

const SAFE_METHODS = new Set(['GET', 'HEAD']);

export function checkOrigin(input: { method: string; origin: string | null; secFetchSite: string | null; appOrigin: string }): OriginDecision {
  const method = input.method.toUpperCase();
  if (method === 'OPTIONS') return { allow: false, reason: 'preflight' };
  if (input.origin !== null && input.origin !== input.appOrigin) return { allow: false, reason: 'cross_origin' };
  if (!SAFE_METHODS.has(method) && input.secFetchSite === 'cross-site') return { allow: false, reason: 'cross_origin' };
  return { allow: true };
}
