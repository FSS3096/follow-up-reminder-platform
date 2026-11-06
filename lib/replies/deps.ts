import 'server-only';
import { clinicFromEnv } from '@/lib/clinic';
import { createInboundRepo } from '@/lib/data/inboundRepo';
import { getAdminClient } from '@/lib/supabase/admin';
import type { InboundDeps } from './handleInbound';

export function inboundDeps(): InboundDeps {
  return { repo: createInboundRepo(getAdminClient()), clinic: clinicFromEnv(), now: () => new Date() };
}
