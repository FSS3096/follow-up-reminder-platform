import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Tables } from '@/lib/supabase/types';
import { mapDbError } from './dbErrors';

type Client = SupabaseClient<Database>;
export type ReminderRow = Tables<'reminders'>;

export async function listRemindersForFollowup(db: Client, followupId: string): Promise<ReminderRow[]> {
  const { data, error } = await db
    .from('reminders')
    .select('*')
    .eq('followup_id', followupId)
    .order('scheduled_for', { ascending: true });
  if (error) throw mapDbError(error);
  return data ?? [];
}
