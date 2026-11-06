import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

/**
 * Live check against the real Supabase project: the anon key must not read any table
 * or call the claim function. Skipped unless RUN_DB_CHECKS=true (needs network + project).
 *   RUN_DB_CHECKS=true NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_ANON_KEY=... npm test -- tests/integration/rls
 * The same guarantee is checked offline by supabase/tests/run_local.sh.
 */
const enabled = process.env.RUN_DB_CHECKS === 'true';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

describe.skipIf(!enabled)('anon role (live project)', () => {
  // Created lazily: describe bodies run even when the suite is skipped.
  const anon = () => createClient(url, anonKey, { auth: { persistSession: false } });

  it.each(['staff', 'patients', 'followups', 'reminders'] as const)('cannot read %s', async (table) => {
    const { data, error } = await anon().from(table).select('*').limit(1);
    // Revoked grants give a permission error; either way no row may come back.
    expect(data ?? []).toHaveLength(0);
    expect(error?.code).toBe('42501');
  });

  it('cannot call claim_due_reminders', async () => {
    const { data, error } = await anon().rpc('claim_due_reminders', { batch_size: 1 });
    expect(data ?? []).toHaveLength(0);
    expect(error).not.toBeNull();
  });
});
