import { createClient } from '@supabase/supabase-js';
import { getServerEnv } from '@/lib/env';
import type { Database, PatientLanguage, FollowupStatus } from '@/lib/supabase/types';

const env = getServerEnv();
if (env.VERCEL_ENV === 'production') throw new Error('Refusing to seed production.');
const db = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const names = ['Aarav Sharma', 'Sita Verma', 'Rohan Patel', 'Meera Iyer', 'Kabir Khan', 'Anaya Rao', 'Dev Mehta', 'Ishita Nair', 'Arjun Das', 'Diya Joshi', 'Vikram Shah', 'Nisha Kumar'];
const languages: PatientLanguage[] = ['hinglish', 'english', 'hindi'];
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
function plusDays(days: number): string {
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}
function check<T>(result: { data: T | null; error: { message: string } | null }, operation: string): T {
  if (result.error) throw new Error(`${operation} failed: ${result.error.message}`);
  if (result.data === null) throw new Error(`${operation} returned no data`);
  return result.data;
}

async function main(): Promise<void> {
  const { data: staff, error: staffError } = await db.from('staff').select('id, role').eq('role', 'doctor').limit(1).maybeSingle();
  if (staffError) throw new Error(`Find seeded doctor failed: ${staffError.message}`);
  if (!staff) throw new Error('Create at least one doctor auth user and staff row before running db:seed (see docs/DEPLOY.md).');

  // Delete only our fixtures. FK cascade removes their reminders; patient deletion follows.
  const oldPatients = check(await db.from('patients').select('id').eq('is_seed', true), 'Find seed patients');
  const oldIds = oldPatients.map((p) => p.id);
  if (oldIds.length) {
    check(await db.from('followups').delete().eq('is_seed', true).select('id'), 'Delete seed followups');
    check(await db.from('patients').delete().eq('is_seed', true).select('id'), 'Delete seed patients');
  }

  const demoPhones = [process.env.DEMO_PHONE_1, process.env.DEMO_PHONE_2, process.env.DEMO_PHONE_3];
  const patients = check(await db.from('patients').insert(names.map((name, i) => ({
    name,
    phone_e164: demoPhones[i] || `+9100000000${String(i + 1).padStart(2, '0')}`,
    language: languages[i % languages.length] as PatientLanguage,
    is_seed: true,
  }))).select('id, name'), 'Insert seed patients');
  const indexed = names.map((name) => patients.find((p) => p.name === name)!);
  const schedule: Array<{ status: FollowupStatus; offset: number; time: string | null; attention: 'unmatched_patient' | 'reschedule_requested' | null }> = [
    { status: 'draft', offset: 5, time: null, attention: 'unmatched_patient' },
    { status: 'draft', offset: 7, time: null, attention: null },
    ...Array.from({ length: 6 }, (_, i) => ({ status: 'approved' as const, offset: i + 1, time: i % 2 ? null : '10:30:00', attention: null })),
    ...Array.from({ length: 4 }, (_, i) => ({ status: 'confirmed' as const, offset: i + 2, time: null, attention: null })),
    { status: 'reschedule_requested', offset: 3, time: null, attention: 'reschedule_requested' },
    { status: 'reschedule_requested', offset: 4, time: '14:00:00', attention: 'reschedule_requested' },
    ...Array.from({ length: 3 }, (_, i) => ({ status: 'completed' as const, offset: -(i + 2), time: null, attention: null })),
    ...Array.from({ length: 3 }, (_, i) => ({ status: 'missed' as const, offset: -(i + 3), time: null, attention: null })),
  ];
  const followups = check(await db.from('followups').insert(schedule.map((item, i) => ({
    patient_id: item.status === 'draft' && i === 0 ? null : indexed[i % indexed.length]!.id,
    patient_name_raw: names[i % names.length]!,
    doctor_id: staff.id,
    followup_date: plusDays(item.offset),
    followup_time: item.time,
    status: item.status,
    raw_note: item.status === 'draft' ? 'Follow-up next week' : null,
    parse_source: 'rules' as const,
    date_source: 'relative' as const,
    attention_reason: item.attention,
    message_preview: `${env.CLINIC_NAME}: follow-up reminder.`,
    approved_at: item.status === 'draft' ? null : new Date().toISOString(),
    confirmed_at: item.status === 'confirmed' ? new Date().toISOString() : null,
    completed_at: item.status === 'completed' ? new Date().toISOString() : null,
    missed_at: item.status === 'missed' ? new Date().toISOString() : null,
    is_seed: true,
  }))).select('id, status, followup_date'), 'Insert seed followups');

  const reminders = followups.filter((f) => ['approved', 'confirmed', 'missed'].includes(f.status)).flatMap((f) => [
    { followup_id: f.id, kind: 'confirmation' as const, scheduled_for: `${f.followup_date}T04:00:00.000Z`, status: f.status === 'missed' ? 'cancelled' as const : 'sent' as const, sent_at: new Date().toISOString() },
    ...(f.status === 'approved' ? [{ followup_id: f.id, kind: 'morning_of' as const, scheduled_for: `${f.followup_date}T02:30:00.000Z`, status: 'pending' as const }] : []),
  ]);
  if (reminders.length) check(await db.from('reminders').insert(reminders).select('id'), 'Insert seed reminders');
  const missed = followups.find((f) => f.status === 'missed');
  if (missed) check(await db.from('reminders').insert({ followup_id: missed.id, kind: 'missed_nudge', scheduled_for: new Date().toISOString(), status: 'sent', sent_at: new Date().toISOString() }).select('id').single(), 'Insert missed nudge');
  console.info(`Seeded ${patients.length} fictional patients, ${followups.length} followups, and ${reminders.length + (missed ? 1 : 0)} reminders.`);
}

void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : 'Seed failed'); process.exitCode = 1; });
