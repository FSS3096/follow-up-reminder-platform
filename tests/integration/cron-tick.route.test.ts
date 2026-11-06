import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEnvCacheForTests } from '@/lib/env';
import { ConsoleProvider } from '@/lib/providers/whatsapp';
import { FakeTickRepo } from '@/lib/testing/fakeTickRepo';
import { istDateTime } from '@/lib/time/ist';

const SECRET = 'c'.repeat(48);
const NOW = istDateTime('2026-11-06', '15:00');
let repo: FakeTickRepo;

vi.mock('@/lib/reminders/tickDeps', () => ({
  tickDeps: () => ({
    repo,
    provider: new ConsoleProvider(),
    allowLiveSend: false,
    clinic: { clinicName: 'Sunrise Family Clinic', doctorName: 'Dr. Mehra' },
    now: () => NOW,
  }),
}));

beforeAll(() => {
  Object.assign(process.env, {
    NEXT_PUBLIC_SUPABASE_URL: 'https://abcd.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key-anon-key-anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-service-role-key',
    CRON_SECRET: SECRET,
    APP_BASE_URL: 'https://app.test',
  });
  resetEnvCacheForTests();
});

beforeEach(() => {
  repo = new FakeTickRepo(() => NOW);
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
});

const { POST, GET } = await import('@/app/api/cron/tick/route');
const call = (fn: typeof POST, auth?: string) =>
  fn(new Request('https://app.test/api/cron/tick', { method: 'POST', headers: auth ? { authorization: auth } : {} }), {});

describe('/api/cron/tick', () => {
  it.each([undefined, 'Bearer wrong', `Bearer ${SECRET}x`, SECRET, `Basic ${SECRET}`])('401 for authorization %j', async (auth) => {
    const res = await call(POST, auth);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('UNAUTHENTICATED');
  });

  it('200 with counters (POST and GET)', async () => {
    const { followup } = repo.addFollowup({ followup_date: '2026-11-11' });
    repo.addReminder(followup.id, 'confirmation');
    const res = await call(POST, `Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ claimed: 1, sent: 1, failed: 0, skipped: 0, deferred: 0, retried: 0, markedMissed: 0, recoveredStuck: 0 });
    const res2 = await call(GET, `Bearer ${SECRET}`);
    expect((await res2.json()).claimed).toBe(0);
  });
});
