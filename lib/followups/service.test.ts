import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeStore } from '@/lib/testing/fakeFollowupStore';
import { istDateTime } from '@/lib/time/ist';
import { approveFollowup, changeFollowupStatus, decodeCursor, encodeCursor, listFollowups, rescheduleFollowup, toPlanJson } from './service';

const NOW = istDateTime('2026-11-06', '15:00');
let store: FakeStore;

beforeEach(() => {
  store = new FakeStore();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('approveFollowup', () => {
  it('approves a matched draft, plans 3 reminders, nulls the note, builds a fresh preview', async () => {
    const p = store.addPatient({ name: 'Sita Verma', language: 'english' });
    const f = store.addFollowup({ patient_id: p.id, followup_date: '2026-11-11' });
    const r = await approveFollowup({ followupId: f.id }, store.deps(NOW));
    expect(r.followup.status).toBe('approved');
    expect(r.followup.patientId).toBe(p.id);
    expect(r.followup).not.toHaveProperty('rawNote');
    expect(store.followups.get(f.id)?.raw_note).toBeNull();
    expect(r.reminders.map((x) => [x.kind, x.status])).toEqual([
      ['confirmation', 'pending'],
      ['day_before', 'pending'],
      ['morning_of', 'pending'],
    ]);
    expect(store.approveCalls[0]?.messagePreview).toMatch(/^Hello Sita, your follow-up/);
    expect(store.approveCalls[0]?.reminders[0]?.scheduled_for).toBe(NOW.toISOString());
  });

  it('second approve is 409 and does not add reminders', async () => {
    const p = store.addPatient();
    const f = store.addFollowup({ patient_id: p.id });
    await approveFollowup({ followupId: f.id }, store.deps(NOW));
    await expect(approveFollowup({ followupId: f.id }, store.deps(NOW))).rejects.toMatchObject({ status: 409 });
    expect(store.reminders.filter((x) => x.followup_id === f.id)).toHaveLength(3);
  });

  it('two concurrent approves: exactly one succeeds', async () => {
    const p = store.addPatient();
    const f = store.addFollowup({ patient_id: p.id });
    const results = await Promise.allSettled([
      approveFollowup({ followupId: f.id }, store.deps(NOW)),
      approveFollowup({ followupId: f.id }, store.deps(NOW)),
    ]);
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(store.reminders.filter((x) => x.followup_id === f.id)).toHaveLength(3);
  });

  it('404 for an unknown followup', async () => {
    await expect(approveFollowup({ followupId: 'nope' }, store.deps(NOW))).rejects.toMatchObject({ status: 404 });
  });

  it('unmatched draft without newPatient: 422 PATIENT_NEEDS_PHONE', async () => {
    const f = store.addFollowup();
    await expect(approveFollowup({ followupId: f.id }, store.deps(NOW))).rejects.toMatchObject({ status: 422, code: 'PATIENT_NEEDS_PHONE' });
    expect(store.approveCalls).toHaveLength(0);
  });

  it('newPatient: sanitised name, language default hinglish, patient created', async () => {
    const f = store.addFollowup();
    const r = await approveFollowup({ followupId: f.id, newPatient: { name: '  kamla <b>devi</b> ', phoneE164: '+919800000002' } }, store.deps(NOW));
    expect(store.approveCalls[0]?.newPatient).toEqual({ name: 'Kamla Devi', phoneE164: '+919800000002', language: 'hinglish' });
    expect(r.followup.patientId).toBeTruthy();
    expect(store.approveCalls[0]?.messagePreview).toMatch(/^Namaste Kamla ji/);
  });

  it('newPatient with no letters: 400', async () => {
    const f = store.addFollowup();
    await expect(approveFollowup({ followupId: f.id, newPatient: { name: '1234', phoneE164: '+919800000002' } }, store.deps(NOW))).rejects.toMatchObject({ status: 400 });
  });

  it('picked candidate that does not exist: 422 PATIENT_NOT_FOUND', async () => {
    const f = store.addFollowup();
    await expect(approveFollowup({ followupId: f.id, patientId: 'ghost' }, store.deps(NOW))).rejects.toMatchObject({ code: 'PATIENT_NOT_FOUND' });
  });

  it('doctor overrides date and clears time', async () => {
    const p = store.addPatient();
    const f = store.addFollowup({ patient_id: p.id, followup_time: '17:00:00' });
    const r = await approveFollowup({ followupId: f.id, followupDate: '2026-11-20', followupTime: null }, store.deps(NOW));
    expect(r.followup.followupDate).toBe('2026-11-20');
    expect(r.followup.followupTime).toBeNull();
  });

  it('keeps the draft time when not overridden (normalised from HH:mm:ss)', async () => {
    const p = store.addPatient();
    const f = store.addFollowup({ patient_id: p.id, followup_time: '17:00:00' });
    await approveFollowup({ followupId: f.id }, store.deps(NOW));
    expect(store.approveCalls[0]?.followupTime).toBe('17:00');
  });

  it('past date: 422 INVALID_FOLLOWUP_DATE, nothing written', async () => {
    const p = store.addPatient();
    const f = store.addFollowup({ patient_id: p.id });
    await expect(approveFollowup({ followupId: f.id, followupDate: '2026-11-01' }, store.deps(NOW))).rejects.toMatchObject({ code: 'INVALID_FOLLOWUP_DATE' });
    expect(store.approveCalls).toHaveLength(0);
  });

  it('a failing inline send never fails the approve', async () => {
    const p = store.addPatient();
    const f = store.addFollowup({ patient_id: p.id });
    const afterApprove = vi.fn().mockRejectedValue(new Error('twilio down'));
    const r = await approveFollowup({ followupId: f.id }, store.deps(NOW, { afterApprove }));
    expect(afterApprove).toHaveBeenCalledOnce();
    expect(r.followup.status).toBe('approved');
  });
});

describe('rescheduleFollowup', () => {
  it('re-plans, clears attention, returns to approved', async () => {
    const p = store.addPatient();
    const f = store.addFollowup({ patient_id: p.id });
    await approveFollowup({ followupId: f.id }, store.deps(NOW));
    store.followups.get(f.id)!.status = 'reschedule_requested';
    store.followups.get(f.id)!.attention_reason = 'reschedule_requested';
    const r = await rescheduleFollowup({ followupId: f.id, followupDate: '2026-11-15', followupTime: '11:00' }, store.deps(NOW));
    expect(r.followup).toMatchObject({ status: 'approved', followupDate: '2026-11-15', followupTime: '11:00', attentionReason: null });
    expect(r.reminders.filter((x) => x.status === 'pending')).toHaveLength(3);
  });

  it.each(['draft', 'completed', 'cancelled', 'missed'] as const)('409 from %s', async (status) => {
    const p = store.addPatient();
    const f = store.addFollowup({ patient_id: p.id, status });
    await expect(rescheduleFollowup({ followupId: f.id, followupDate: '2026-11-15' }, store.deps(NOW))).rejects.toMatchObject({ status: 409 });
  });

  it('past date: 422', async () => {
    const p = store.addPatient();
    const f = store.addFollowup({ patient_id: p.id, status: 'approved' });
    await expect(rescheduleFollowup({ followupId: f.id, followupDate: '2026-11-05' }, store.deps(NOW))).rejects.toMatchObject({ status: 422 });
  });
});

describe('changeFollowupStatus', () => {
  it('Arrived marks completed', async () => {
    const f = store.addFollowup({ status: 'approved' });
    const r = await changeFollowupStatus({ followupId: f.id, status: 'completed' }, store.deps(NOW));
    expect(r.followup.status).toBe('completed');
  });
});

describe('listFollowups', () => {
  it('pages with an opaque cursor and attaches a wa.me link', async () => {
    const p = store.addPatient({ name: 'Ramesh Patel', phone_e164: '+919812345678' });
    for (let i = 0; i < 5; i++) store.addFollowup({ patient_id: p.id, status: 'approved', followup_date: `2026-11-1${i}` });
    const deps = store.deps(NOW);
    const page1 = await listFollowups({ limit: 2 }, deps);
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).toBeTruthy();
    expect(page1.items[0]?.waLink).toMatch(/^https:\/\/wa\.me\/919812345678\?text=Namaste%20Ramesh%20ji/);
    const page2 = await listFollowups({ limit: 2, cursor: page1.nextCursor! }, deps);
    const page3 = await listFollowups({ limit: 2, cursor: page2.nextCursor! }, deps);
    expect(page3.items).toHaveLength(1);
    expect(page3.nextCursor).toBeNull();
    const ids = [...page1.items, ...page2.items, ...page3.items].map((x) => x.id);
    expect(new Set(ids).size).toBe(5);
  });

  it('no wa.me link for opted-out patients, drafts or closed followups', async () => {
    const out = store.addPatient({ opted_out: true });
    const ok = store.addPatient();
    store.addFollowup({ patient_id: out.id, status: 'approved' });
    store.addFollowup({ patient_id: ok.id, status: 'draft' });
    store.addFollowup({ patient_id: ok.id, status: 'completed' });
    const { items } = await listFollowups({ limit: 10 }, store.deps(NOW));
    expect(items.map((i) => i.waLink)).toEqual([null, null, null]);
  });

  it('missed followups link to the missed_nudge text', async () => {
    const p = store.addPatient({ language: 'english' });
    store.addFollowup({ patient_id: p.id, status: 'missed', followup_date: '2026-11-01' });
    const { items } = await listFollowups({ limit: 10 }, store.deps(NOW));
    expect(decodeURIComponent(items[0]!.waLink!)).toContain('we missed you');
  });

  it.each(['garbage', encodeCursor('2026-11-01', "x'),id.gt.0"), Buffer.from('2026-11-01').toString('base64url')])(
    'rejects a malformed or injected cursor %j',
    (cursor) => {
      expect(() => decodeCursor(cursor)).toThrow(/Invalid cursor/);
    },
  );
});

describe('toPlanJson', () => {
  it('serialises the planner output for the SQL function', () => {
    const json = toPlanJson([{ kind: 'day_before', scheduledFor: new Date('2026-11-10T12:30:00Z'), status: 'skipped', skipReason: 'in_past' }]);
    expect(json).toEqual([{ kind: 'day_before', scheduled_for: '2026-11-10T12:30:00.000Z', status: 'skipped', skip_reason: 'in_past' }]);
  });
});
