import 'server-only';
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { getPublicEnv } from '@/lib/env';
import type { Database } from './types';

export type UserSupabaseClient = SupabaseClient<Database>;

/**
 * Supabase client bound to the signed-in user's session cookie.
 * Every query runs as `authenticated` and is subject to RLS (0002_rls.sql).
 */
export function createUserClient(): UserSupabaseClient {
  const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY } = getPublicEnv();
  const cookieStore = cookies();

  return createServerClient<Database>(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component where cookies are read-only.
          // Session refresh then happens on the next route handler / middleware call.
        }
      },
    },
  });
}
