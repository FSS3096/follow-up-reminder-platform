import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Tables, TablesInsert } from '@/lib/supabase/types';

type Client = SupabaseClient<Database>;
export type FollowupRow = Tables<'followups'>;

export async function insertDraft(db: Client, row: TablesInsert<'followups'>): Promise<{ id: string }> {
  const { data, error } = await db
    .from('followups')
    .insert({ ...row, status: 'draft' })
    .select('id')
    .single();
  if (error) throw error;
  return data;
}

export async function getFollowup(db: Client, id: string): Promise<FollowupRow | null> {
  const { data, error } = await db.from('followups').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}
