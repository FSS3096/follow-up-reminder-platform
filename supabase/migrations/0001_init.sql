-- 0001_init.sql : core schema (Brief section 3).
-- By design there are NO diagnosis, medicine or clinical-note columns.
-- raw_note exists only while a followup is a draft and is nulled at approve.

create extension if not exists pgcrypto;

create type followup_status as enum
  ('draft','approved','confirmed','reschedule_requested','completed','missed','cancelled');
create type reminder_kind as enum ('confirmation','day_before','morning_of','missed_nudge');
create type reminder_status as enum ('pending','sending','sent','failed','skipped','cancelled');

create table staff (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  role text not null check (role in ('doctor','receptionist')),
  created_at timestamptz not null default now()
);

create table patients (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{9,14}$'),
  language text not null default 'hinglish' check (language in ('hinglish','english','hindi')),
  opted_out boolean not null default false,
  last_inbound_at timestamptz,            -- opens the 24h free-form window
  is_seed boolean not null default false,
  created_at timestamptz not null default now()
);
create index patients_name_idx on patients (lower(name));
create unique index patients_phone_name_uq on patients (phone_e164, lower(name)); -- families can share a phone

create table followups (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references patients(id),          -- null until matched / created
  patient_name_raw text not null,
  doctor_id uuid not null references staff(id),
  followup_date date not null,                      -- IST calendar date
  followup_time time,                               -- IST, optional
  status followup_status not null default 'draft',
  raw_note text,                                    -- NULLED at approve (data minimisation)
  parse_source text not null default 'rules' check (parse_source in ('rules','llm')),
  date_source text not null check (date_source in ('explicit','relative','default')),
  message_preview text,
  attention_reason text check (attention_reason in
    ('reschedule_requested','patient_message','send_failed','unmatched_patient')),
  client_input_ms integer check (client_input_ms between 0 and 600000),
  parsed_at timestamptz not null default now(),
  approved_at timestamptz,
  confirmed_at timestamptz,
  completed_at timestamptz,
  missed_at timestamptz,
  is_seed boolean not null default false,
  created_at timestamptz not null default now()
);
create index followups_status_date_idx on followups (status, followup_date);
create index followups_patient_idx on followups (patient_id);

create table reminders (
  id uuid primary key default gen_random_uuid(),
  followup_id uuid not null references followups(id) on delete cascade,
  kind reminder_kind not null,
  scheduled_for timestamptz not null,
  status reminder_status not null default 'pending',
  attempts smallint not null default 0,
  provider text,
  provider_message_sid text,
  skip_reason text,
  last_error text,
  claimed_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (followup_id, kind)                        -- idempotent planning
);
create index reminders_due_idx on reminders (scheduled_for) where status = 'pending';
