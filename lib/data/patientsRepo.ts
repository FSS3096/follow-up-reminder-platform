import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, PatientLanguage, Tables } from '@/lib/supabase/types';
import { mapDbError } from './dbErrors';

type Client = SupabaseClient<Database>;
export type PatientRow = Tables<'patients'>;
export interface PatientForMatching {
  id: string;
  name: string;
  language: PatientLanguage;
}

/** Upper bound on names loaded for fuzzy matching; one clinic is far below this. */
export const MATCHING_LIMIT = 5000;

export async function listForMatching(db: Client): Promise<PatientForMatching[]> {
  const { data, error } = await db
    .from('patients')
    .select('id, name, language')
    .order('created_at', { ascending: false })
    .limit(MATCHING_LIMIT);
  if (error) throw mapDbError(error);
  return data ?? [];
}

export async function getPatient(db: Client, id: string): Promise<PatientRow | null> {
  const { data, error } = await db.from('patients').select('*').eq('id', id).maybeSingle();
  if (error) throw mapDbError(error);
  return data;
}

/** Escapes LIKE wildcards so user input is matched literally. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function searchPatients(db: Client, q: string | undefined, limit: number): Promise<PatientRow[]> {
  let query = db.from('patients').select('*').order('name', { ascending: true }).limit(limit);
  if (q) query = query.ilike('name', `${escapeLike(q)}%`);
  const { data, error } = await query;
  if (error) throw mapDbError(error);
  return data ?? [];
}

export async function insertPatient(
  db: Client,
  input: { name: string; phoneE164: string; language: PatientLanguage },
): Promise<PatientRow> {
  const { data, error } = await db
    .from('patients')
    .insert({ name: input.name, phone_e164: input.phoneE164, language: input.language })
    .select('*')
    .single();
  if (error) throw mapDbError(error);
  return data;
}

/** All patients sharing a phone (families share phones). Server jobs only. */
export async function findByPhone(db: Client, phoneE164: string): Promise<PatientRow[]> {
  const { data, error } = await db.from('patients').select('*').eq('phone_e164', phoneE164);
  if (error) throw mapDbError(error);
  return data ?? [];
}
