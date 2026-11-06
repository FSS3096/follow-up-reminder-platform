import { describe, expect, it } from 'vitest';
import { mapDbError } from './dbErrors';
import { listFollowups } from './followupsRepo';
import { escapeLike, searchPatients } from './patientsRepo';

/** Records the PostgREST builder calls so filter construction can be asserted. */
function fakeDb(result: { data: unknown; error: unknown } = { data: [], error: null }) {
  const calls: Array<[string, unknown[]]> = [];
  const builder: Record<string, unknown> = {};
  for (const m of ['from', 'select', 'order', 'limit', 'in', 'not', 'or', 'gte', 'lte', 'ilike', 'eq']) {
    builder[m] = (...args: unknown[]) => {
      calls.push([m, args]);
      return builder;
    };
  }
  builder.then = (resolve: (v: unknown) => void) => resolve(result);
  return { db: builder as never, calls };
}

describe('listFollowups filters', () => {
  it('builds attention + keyset filters', async () => {
    const { db, calls } = fakeDb();
    await listFollowups(db, { attention: true, limit: 11, after: { date: '2026-11-10', id: '00000000-0000-4000-8000-000000000001' } });
    expect(calls).toContainEqual(['not', ['status', 'in', '(completed,cancelled)']]);
    expect(calls).toContainEqual(['or', ['attention_reason.not.is.null,status.eq.missed']]);
    expect(calls).toContainEqual([
      'or',
      ['followup_date.gt.2026-11-10,and(followup_date.eq.2026-11-10,id.gt.00000000-0000-4000-8000-000000000001)'],
    ]);
    expect(calls).toContainEqual(['limit', [11]]);
  });

  it('maps DB errors', async () => {
    const { db } = fakeDb({ data: null, error: { code: '42501', message: 'denied' } });
    await expect(listFollowups(db, { limit: 1 })).rejects.toMatchObject({ status: 403 });
  });
});

describe('searchPatients', () => {
  it('escapes LIKE wildcards in the prefix search', async () => {
    const { db, calls } = fakeDb();
    await searchPatients(db, 'Ra%_\\', 20);
    expect(calls).toContainEqual(['ilike', ['name', 'Ra\\%\\_\\\\%']]);
    expect(escapeLike('50%')).toBe('50\\%');
  });
});

describe('mapDbError', () => {
  it.each([
    [{ code: 'QN404', message: 'NOT_FOUND' }, 404, 'NOT_FOUND'],
    [{ code: 'QN409', message: 'NOT_DRAFT', details: 'approved' }, 409, 'CONFLICT'],
    [{ code: 'QN422', message: 'PATIENT_NEEDS_PHONE' }, 422, 'PATIENT_NEEDS_PHONE'],
    [{ code: 'QN422', message: 'SOMETHING_ELSE' }, 422, 'VALIDATION_ERROR'],
    [{ code: '42501', message: 'x' }, 403, 'FORBIDDEN'],
    [{ code: '23505', message: 'dup' }, 409, 'CONFLICT'],
    [{ code: '23514', message: 'check' }, 400, 'VALIDATION_ERROR'],
  ])('%j -> %i %s', (err, status, code) => {
    expect(mapDbError(err)).toMatchObject({ status, code });
  });
  it('passes unknown errors through', () => {
    const e = { code: 'XX000', message: 'boom' };
    expect(mapDbError(e)).toBe(e);
    expect(mapDbError('str')).toBe('str');
  });
  it('409 details carry the current status, never row data', () => {
    expect(mapDbError({ code: 'QN409', message: 'NOT_DRAFT', details: 'approved' })).toMatchObject({ details: { currentStatus: 'approved' } });
  });
});
