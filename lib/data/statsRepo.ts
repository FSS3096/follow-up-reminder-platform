import type { SupabaseClient } from '@supabase/supabase-js';
import type { StatsRow } from '@/lib/stats/compute';
import type { Database } from '@/lib/supabase/types';
import { mapDbError } from './dbErrors';

export const STATS_ROW_LIMIT = 20_000;

export async function fetchStatsRows(
  db: SupabaseClient<Database>,
  opts: { since: Date | null; includeSeed: boolean },
): Promise<{ rows: StatsRow[]; truncated: boolean }> {
  let q = db
    .from('followups')
    .select('status, followup_date, client_input_ms, parsed_at, approved_at, confirmed_at')
    .order('created_at', { ascending: false })
    .limit(STATS_ROW_LIMIT + 1);
  if (opts.since) q = q.gte('created_at', opts.since.toISOString());
  if (!opts.includeSeed) q = q.eq('is_seed', false);
  const { data, error } = await q;
  if (error) throw mapDbError(error);
  const rows = (data ?? []) as StatsRow[];
  return { rows: rows.slice(0, STATS_ROW_LIMIT), truncated: rows.length > STATS_ROW_LIMIT };
}
