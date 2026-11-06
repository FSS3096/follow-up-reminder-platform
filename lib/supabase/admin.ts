import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getServerEnv } from '@/lib/env';
import type { Database } from './types';

export type AdminSupabaseClient = SupabaseClient<Database>;

let adminClient: AdminSupabaseClient | undefined;

/**
 * Service-role client. BYPASSES RLS.
 * Use only from lib/data/* repos for server-side jobs (cron tick, webhooks, reminder writes).
 * Never pass it user-controlled table or column names.
 */
export function getAdminClient(): AdminSupabaseClient {
  if (!adminClient) {
    const env = getServerEnv();
    adminClient = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { 'X-Client-Info': 'quick-notes-server' } },
    });
  }
  return adminClient;
}
