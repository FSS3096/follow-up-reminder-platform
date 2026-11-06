import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';
import { getServerEnv } from '@/lib/env';
import { createUserClient, type UserSupabaseClient } from '@/lib/supabase/server';
import type { StaffRole } from '@/lib/supabase/types';
import { ApiError, errors } from './errors';

export interface StaffContext {
  userId: string;
  name: string;
  role: StaffRole;
  supabase: UserSupabaseClient;
}

/**
 * Resolves the signed-in staff member from the Supabase session cookie.
 * getUser() verifies the JWT with Supabase Auth (getSession() alone would trust the cookie).
 */
export async function requireStaff(allowedRoles?: readonly StaffRole[]): Promise<StaffContext> {
  const supabase = createUserClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw errors.unauthenticated();

  const { data: staff, error: staffError } = await supabase
    .from('staff')
    .select('id, name, role')
    .eq('id', data.user.id)
    .maybeSingle();
  if (staffError) throw staffError;
  if (!staff) throw new ApiError(403, 'STAFF_NOT_FOUND', 'This account is not registered as clinic staff');

  if (allowedRoles && !allowedRoles.includes(staff.role)) {
    throw errors.forbidden(`This action needs role: ${allowedRoles.join(' or ')}`);
  }
  return { userId: staff.id, name: staff.name, role: staff.role, supabase };
}

/** Constant-time string comparison (hashing first removes the length side channel). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a, 'utf8').digest();
  const hb = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(ha, hb);
}

/** Checks `Authorization: Bearer <secret>` against an expected secret. */
export function isValidBearer(header: string | null, expectedSecret: string): boolean {
  if (!header) return false;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match?.[1]) return false;
  return safeEqual(match[1], expectedSecret);
}

/** Guard for /api/cron/tick. Throws 401 on a missing or wrong bearer. */
export function requireCronSecret(req: Request): void {
  if (!isValidBearer(req.headers.get('authorization'), getServerEnv().CRON_SECRET)) {
    throw errors.unauthenticated();
  }
}
