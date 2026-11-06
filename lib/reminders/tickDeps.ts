import 'server-only';
import { clinicFromEnv } from '@/lib/clinic';
import { createTickRepo } from '@/lib/data/tickRepo';
import { getServerEnv } from '@/lib/env';
import { getProvider } from '@/lib/providers/whatsapp';
import { getAdminClient } from '@/lib/supabase/admin';
import type { TickDeps } from './tick';

export function tickDeps(): TickDeps {
  return {
    repo: createTickRepo(getAdminClient()),
    provider: getProvider(),
    allowLiveSend: getServerEnv().ALLOW_LIVE_SEND,
    clinic: clinicFromEnv(),
    now: () => new Date(),
  };
}
