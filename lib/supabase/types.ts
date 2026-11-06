/**
 * Database types for supabase/migrations 0001-0003.
 * Hand-written to match the migrations until the project exists; regenerate with
 *   npx supabase gen types typescript --project-id <ref> --schema public > lib/supabase/types.ts
 * (see docs/DEPLOY.md) and keep the exported aliases at the bottom.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type FollowupStatus =
  | 'draft'
  | 'approved'
  | 'confirmed'
  | 'reschedule_requested'
  | 'completed'
  | 'missed'
  | 'cancelled';
export type ReminderKind = 'confirmation' | 'day_before' | 'morning_of' | 'missed_nudge';
export type ReminderStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'skipped' | 'cancelled';
export type StaffRole = 'doctor' | 'receptionist';
export type PatientLanguage = 'hinglish' | 'english' | 'hindi';
export type ParseSource = 'rules' | 'llm';
export type DateSource = 'explicit' | 'relative' | 'default';
export type AttentionReason = 'reschedule_requested' | 'patient_message' | 'send_failed' | 'unmatched_patient';

type StaffRow = {
  id: string;
  name: string;
  role: StaffRole;
  created_at: string;
}

type PatientRow = {
  id: string;
  name: string;
  phone_e164: string;
  language: PatientLanguage;
  opted_out: boolean;
  last_inbound_at: string | null;
  last_auto_reply_at: string | null;
  is_seed: boolean;
  created_at: string;
}

type FollowupRow = {
  id: string;
  patient_id: string | null;
  patient_name_raw: string;
  doctor_id: string;
  followup_date: string;
  followup_time: string | null;
  status: FollowupStatus;
  raw_note: string | null;
  parse_source: ParseSource;
  date_source: DateSource;
  message_preview: string | null;
  attention_reason: AttentionReason | null;
  client_input_ms: number | null;
  parsed_at: string;
  approved_at: string | null;
  confirmed_at: string | null;
  completed_at: string | null;
  missed_at: string | null;
  is_seed: boolean;
  created_at: string;
}

type ReminderRow = {
  id: string;
  followup_id: string;
  kind: ReminderKind;
  scheduled_for: string;
  status: ReminderStatus;
  attempts: number;
  provider: string | null;
  provider_message_sid: string | null;
  skip_reason: string | null;
  last_error: string | null;
  claimed_at: string | null;
  sent_at: string | null;
  created_at: string;
}

type WithDefaults<Row, Required extends keyof Row> = Pick<Row, Required> & Partial<Omit<Row, Required>>;

export type Database = {
  public: {
    Tables: {
      staff: {
        Row: StaffRow;
        Insert: WithDefaults<StaffRow, 'id' | 'name' | 'role'>;
        Update: Partial<StaffRow>;
        Relationships: [];
      };
      patients: {
        Row: PatientRow;
        Insert: WithDefaults<PatientRow, 'name' | 'phone_e164'>;
        Update: Partial<PatientRow>;
        Relationships: [];
      };
      followups: {
        Row: FollowupRow;
        Insert: WithDefaults<FollowupRow, 'patient_name_raw' | 'doctor_id' | 'followup_date' | 'date_source'>;
        Update: Partial<FollowupRow>;
        Relationships: [
          {
            foreignKeyName: 'followups_patient_id_fkey';
            columns: ['patient_id'];
            isOneToOne: false;
            referencedRelation: 'patients';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'followups_doctor_id_fkey';
            columns: ['doctor_id'];
            isOneToOne: false;
            referencedRelation: 'staff';
            referencedColumns: ['id'];
          },
        ];
      };
      reminders: {
        Row: ReminderRow;
        Insert: WithDefaults<ReminderRow, 'followup_id' | 'kind' | 'scheduled_for'>;
        Update: Partial<ReminderRow>;
        Relationships: [
          {
            foreignKeyName: 'reminders_followup_id_fkey';
            columns: ['followup_id'];
            isOneToOne: false;
            referencedRelation: 'followups';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      claim_due_reminders: {
        Args: { batch_size?: number };
        Returns: ReminderRow[];
      };
      approve_followup: {
        Args: {
          p_followup_id: string;
          p_patient_id: string | null;
          p_new_patient_name: string | null;
          p_new_patient_phone: string | null;
          p_new_patient_language: string | null;
          p_followup_date: string;
          p_followup_time: string | null;
          p_message_preview: string;
          p_reminders: Json;
        };
        Returns: FollowupRow;
      };
      reschedule_followup: {
        Args: {
          p_followup_id: string;
          p_followup_date: string;
          p_followup_time: string | null;
          p_message_preview: string;
          p_reminders: Json;
        };
        Returns: FollowupRow;
      };
      set_followup_status: {
        Args: { p_followup_id: string; p_status: FollowupStatus };
        Returns: FollowupRow;
      };
      recover_stuck_reminders: {
        Args: { p_older_than?: string; p_max_attempts?: number };
        Returns: number;
      };
      mark_missed_followups: {
        Args: { p_cutoff: string; p_nudge_at: string };
        Returns: number;
      };
      claim_reminder: {
        Args: { p_followup_id: string; p_kind: ReminderKind };
        Returns: ReminderRow[];
      };
      is_staff: {
        Args: never;
        Returns: boolean;
      };
      current_staff_role: {
        Args: never;
        Returns: string | null;
      };
    };
    Enums: {
      followup_status: FollowupStatus;
      reminder_kind: ReminderKind;
      reminder_status: ReminderStatus;
    };
    CompositeTypes: { [_ in never]: never };
  };
}

export type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row'];
export type TablesInsert<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Insert'];
export type TablesUpdate<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Update'];
