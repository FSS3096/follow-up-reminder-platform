/**
 * In-memory stand-in for the 0004 SQL functions, used by service tests.
 * It mirrors the DB rules that matter to the service (draft-only approve, unique reminder
 * per kind, never overwrite a 'sending' row). The real SQL is tested by supabase/tests/run_local.sh.
 */
import type { FollowupRow, FollowupWithPatient, PlannedReminderJson } from '@/lib/data/followupsRepo';
import type { PatientRow } from '@/lib/data/patientsRepo';
import type { ReminderRow } from '@/lib/data/remindersRepo';
import type { FollowupDeps } from '@/lib/followups/service';
import { ApiError } from '@/lib/http/errors';
import type { ReminderKind, ReminderStatus } from '@/lib/supabase/types';

let seq = 0;
const uuid = () => {
  seq += 1;
  return `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
};

export function makePatient(over: Partial<PatientRow> = {}): PatientRow {
  return {
    id: uuid(),
    name: 'Sita Verma',
    phone_e164: '+919800000001',
    language: 'hinglish',
    opted_out: false,
    last_inbound_at: null,
    is_seed: false,
    created_at: '2026-11-01T00:00:00Z',
    ...over,
  };
}

export function makeFollowup(over: Partial<FollowupRow> = {}): FollowupRow {
  return {
    id: uuid(),
    patient_id: null,
    patient_name_raw: 'Sita',
    doctor_id: 'doc-1',
    followup_date: '2026-11-11',
    followup_time: null,
    status: 'draft',
    raw_note: 'Sita 5 din baad',
    parse_source: 'rules',
    date_source: 'relative',
    message_preview: null,
    attention_reason: null,
    client_input_ms: 3000,
    parsed_at: '2026-11-06T04:30:00Z',
    approved_at: null,
    confirmed_at: null,
    completed_at: null,
    missed_at: null,
    is_seed: false,
    created_at: '2026-11-06T04:30:00Z',
    ...over,
  };
}

export class FakeStore {
  patients = new Map<string, PatientRow>();
  followups = new Map<string, FollowupRow>();
  reminders: ReminderRow[] = [];
  approveCalls: Parameters<FollowupDeps['approve']>[0][] = [];

  addPatient(over: Partial<PatientRow> = {}) {
    const p = makePatient(over);
    this.patients.set(p.id, p);
    return p;
  }
  addFollowup(over: Partial<FollowupRow> = {}) {
    const f = makeFollowup(over);
    this.followups.set(f.id, f);
    return f;
  }

  private writePlan(followupId: string, plan: PlannedReminderJson[]) {
    for (const r of plan) {
      const existing = this.reminders.find((x) => x.followup_id === followupId && x.kind === r.kind);
      if (existing) {
        if (existing.status === 'sending') continue;
        Object.assign(existing, { scheduled_for: r.scheduled_for, status: r.status as ReminderStatus, skip_reason: r.skip_reason, attempts: 0 });
      } else {
        this.reminders.push({
          id: uuid(),
          followup_id: followupId,
          kind: r.kind as ReminderKind,
          scheduled_for: r.scheduled_for,
          status: r.status as ReminderStatus,
          attempts: 0,
          provider: null,
          provider_message_sid: null,
          skip_reason: r.skip_reason,
          last_error: null,
          claimed_at: null,
          sent_at: null,
          created_at: '2026-11-06T00:00:00Z',
        });
      }
    }
  }

  deps(now: Date, over: Partial<FollowupDeps> = {}): FollowupDeps {
    return {
      now: () => now,
      clinic: { clinicName: 'Sunrise Family Clinic', doctorName: 'Dr. Mehra', clinicPhone: '+911100000000' },
      getFollowup: async (id) => this.followups.get(id) ?? null,
      getPatient: async (id) => this.patients.get(id) ?? null,
      approve: async (args) => {
        this.approveCalls.push(args);
        const f = this.followups.get(args.followupId);
        if (!f) throw new ApiError(404, 'NOT_FOUND', 'x');
        if (f.status !== 'draft') throw new ApiError(409, 'CONFLICT', 'NOT_DRAFT');
        let patientId = args.patientId;
        if (!patientId && args.newPatient) {
          const existing = [...this.patients.values()].find(
            (p) => p.phone_e164 === args.newPatient!.phoneE164 && p.name.toLowerCase() === args.newPatient!.name.toLowerCase(),
          );
          patientId = existing?.id ?? this.addPatient({ name: args.newPatient.name, phone_e164: args.newPatient.phoneE164, language: args.newPatient.language }).id;
        }
        Object.assign(f, {
          status: 'approved',
          patient_id: patientId ?? f.patient_id,
          followup_date: args.followupDate,
          followup_time: args.followupTime ? `${args.followupTime}:00` : null,
          message_preview: args.messagePreview,
          raw_note: null,
          attention_reason: null,
          approved_at: now.toISOString(),
        });
        this.writePlan(f.id, args.reminders);
        return { ...f };
      },
      reschedule: async (args) => {
        const f = this.followups.get(args.followupId);
        if (!f) throw new ApiError(404, 'NOT_FOUND', 'x');
        for (const r of this.reminders) {
          if (r.followup_id === f.id && (r.status === 'pending' || r.status === 'failed')) r.status = 'cancelled';
        }
        Object.assign(f, {
          status: 'approved',
          followup_date: args.followupDate,
          followup_time: args.followupTime ? `${args.followupTime}:00` : null,
          message_preview: args.messagePreview,
          attention_reason: null,
          confirmed_at: null,
        });
        this.writePlan(f.id, args.reminders);
        return { ...f };
      },
      setStatus: async (id, status) => {
        const f = this.followups.get(id);
        if (!f) throw new ApiError(404, 'NOT_FOUND', 'x');
        for (const r of this.reminders) if (r.followup_id === id && r.status === 'pending') r.status = 'cancelled';
        Object.assign(f, { status, completed_at: status === 'completed' ? now.toISOString() : f.completed_at });
        return { ...f };
      },
      listReminders: async (id) => this.reminders.filter((r) => r.followup_id === id),
      list: async (filters) => {
        let rows = [...this.followups.values()].sort((a, b) => a.followup_date.localeCompare(b.followup_date) || a.id.localeCompare(b.id));
        if (filters.statuses) rows = rows.filter((r) => filters.statuses!.includes(r.status));
        if (filters.after) {
          const { date, id } = filters.after;
          rows = rows.filter((r) => r.followup_date > date || (r.followup_date === date && r.id > id));
        }
        return rows.slice(0, filters.limit).map((r): FollowupWithPatient => {
          const p = r.patient_id ? this.patients.get(r.patient_id) : undefined;
          return { ...r, patient: p ? { id: p.id, name: p.name, phone_e164: p.phone_e164, language: p.language, opted_out: p.opted_out, is_seed: p.is_seed } : null };
        });
      },
      ...over,
    };
  }
}
