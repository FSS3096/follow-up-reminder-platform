import { sanitizeName } from '@/lib/parser/names';
import { formatDateLong, formatTime12h } from '@/lib/time/ist';
import { renderTemplate, type Language, type TemplateKey, type TemplateVars } from './render';

export interface ClinicContext {
  clinicName: string;
  doctorName: string;
  clinicPhone?: string;
}

export interface MessageSubject {
  patientName: string;
  language: Language;
  followupDate: string; // IST YYYY-MM-DD
  followupTime: string | null; // IST HH:mm
}

const VALUE_MAX = 60;

/** Template values come from structured, sanitised fields only, never from note or reply text. */
function safeValue(value: string): string {
  return value.replace(/[{}<>\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, VALUE_MAX);
}

export function firstName(fullName: string): string {
  const clean = sanitizeName(fullName);
  return clean.split(' ')[0] || 'ji';
}

export function timeClause(time: string | null, language: Language): string {
  if (time === null) return '';
  const t = formatTime12h(time);
  return language === 'english' ? ` at ${t}` : `, ${t} baje`;
}

export function buildVars(subject: MessageSubject, clinic: ClinicContext): TemplateVars {
  return {
    patient_first_name: firstName(subject.patientName),
    clinic_name: safeValue(clinic.clinicName),
    doctor_name: safeValue(clinic.doctorName),
    date_long: formatDateLong(subject.followupDate),
    time_clause: timeClause(subject.followupTime, subject.language),
    clinic_phone: clinic.clinicPhone ? safeValue(clinic.clinicPhone) : subject.language === 'english' ? 'its usual number' : 'unke number',
  };
}

export function buildMessage(key: TemplateKey, subject: MessageSubject, clinic: ClinicContext): string {
  return renderTemplate(key, subject.language, buildVars(subject, clinic));
}
