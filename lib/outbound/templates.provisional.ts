/**
 * PROVISIONAL message templates, owned by Claude Code only until Codex's C1
 * (lib/messages/templates.ts) lands. Same interface as Brief 6.2, so switching is the
 * one import in lib/outbound/render.ts. Copy follows the Brief's seed text; Codex owns
 * the final copy. Admin-only wording: no clinical words, no health reassurance, no links.
 */

export type Language = 'hinglish' | 'english' | 'hindi';
export type TemplateKey =
  | 'confirmation'
  | 'day_before'
  | 'morning_of'
  | 'missed_nudge'
  | 'reply_confirmed'
  | 'reply_reschedule_ack'
  | 'reply_out_of_scope'
  | 'optout_ack';

export interface TemplateVars {
  patient_first_name: string;
  clinic_name: string;
  doctor_name: string;
  date_long: string; // e.g. "Mon, 9 Nov"
  time_clause?: string; // e.g. " at 5:00 PM" or ""
  clinic_phone?: string;
}

export const TEMPLATE_KEYS: readonly TemplateKey[] = [
  'confirmation',
  'day_before',
  'morning_of',
  'missed_nudge',
  'reply_confirmed',
  'reply_reschedule_ack',
  'reply_out_of_scope',
  'optout_ack',
];

export const ALLOWED_VARS: ReadonlySet<string> = new Set([
  'patient_first_name',
  'clinic_name',
  'doctor_name',
  'date_long',
  'time_clause',
  'clinic_phone',
]);

export const TEMPLATES: Readonly<Record<'hinglish' | 'english', Readonly<Record<TemplateKey, string>>>> = {
  hinglish: {
    confirmation:
      'Namaste {patient_first_name} ji, {doctor_name} ({clinic_name}) ke saath aapka follow-up {date_long}{time_clause} ko fix hua hai. Confirm karne ke liye 1, naya din chahiye to 2 reply karein.',
    day_before:
      'Namaste {patient_first_name} ji, yaad dila rahe hain: kal ({date_long}) {clinic_name} mein aapka follow-up hai{time_clause}. Confirm ke liye 1, reschedule ke liye 2 reply karein.',
    morning_of:
      'Good morning {patient_first_name} ji, aaj {clinic_name} mein aapka follow-up hai{time_clause}. Hum aapka intezaar karenge. Confirm ke liye 1, reschedule ke liye 2 reply karein.',
    missed_nudge:
      'Namaste {patient_first_name} ji, aap {date_long} ko {clinic_name} nahi aa paaye. Naya time chahiye to 2 reply karein, hum aapko call karenge.',
    reply_confirmed:
      'Dhanyavaad {patient_first_name} ji, {date_long}{time_clause} ka aapka follow-up confirm ho gaya hai. {clinic_name}',
    reply_reschedule_ack:
      'Ji zaroor {patient_first_name} ji, {clinic_name} se aapko naye time ke liye jaldi call aayega.',
    reply_out_of_scope:
      'Ye number sirf appointment reminders ke liye hai. Health se jude sawal ke liye kripya clinic ko {clinic_phone} par call karein.',
    optout_ack:
      'Aapko ab {clinic_name} se reminders nahi aayenge. Dobara shuru karne ke liye clinic ko call karein.',
  },
  english: {
    confirmation:
      'Hello {patient_first_name}, your follow-up with {doctor_name} ({clinic_name}) is fixed for {date_long}{time_clause}. Reply 1 to confirm, or 2 if you need another day.',
    day_before:
      'Hello {patient_first_name}, a reminder: your follow-up at {clinic_name} is tomorrow ({date_long}){time_clause}. Reply 1 to confirm, or 2 to reschedule.',
    morning_of:
      'Good morning {patient_first_name}, your follow-up at {clinic_name} is today{time_clause}. We look forward to seeing you. Reply 1 to confirm, or 2 to reschedule.',
    missed_nudge:
      'Hello {patient_first_name}, we missed you at {clinic_name} on {date_long}. Reply 2 if you would like a new time and we will call you.',
    reply_confirmed: 'Thank you {patient_first_name}, your follow-up on {date_long}{time_clause} is confirmed. {clinic_name}',
    reply_reschedule_ack: 'Sure {patient_first_name}, {clinic_name} will call you soon to fix a new time.',
    reply_out_of_scope:
      'This number is only for appointment reminders. For any health question please call the clinic on {clinic_phone}.',
    optout_ack: 'You will no longer get reminders from {clinic_name}. Call the clinic to start them again.',
  },
};

export class TemplateRenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateRenderError';
  }
}

const PLACEHOLDER = /\{([a-z_]+)\}/g;

export function renderTemplate(key: TemplateKey, lang: Language, vars: TemplateVars): string {
  const table = lang === 'english' ? TEMPLATES.english : TEMPLATES.hinglish; // hindi is P1: falls back to hinglish
  const template = table[key];
  if (template === undefined) throw new TemplateRenderError(`Unknown template key: ${String(key)}`);

  for (const name of Object.keys(vars)) {
    if (!ALLOWED_VARS.has(name)) throw new TemplateRenderError(`Variable not in whitelist: ${name}`);
  }
  const values = vars as unknown as Record<string, unknown>;
  // Single pass: a value can never introduce a placeholder that gets expanded again.
  return template.replace(PLACEHOLDER, (_m, name: string) => {
    if (!ALLOWED_VARS.has(name)) throw new TemplateRenderError(`Template uses non-whitelisted placeholder: ${name}`);
    const value = values[name];
    if (value === undefined) {
      if (name === 'time_clause') return '';
      throw new TemplateRenderError(`Missing template variable: ${name}`);
    }
    if (typeof value !== 'string') throw new TemplateRenderError(`Template variable must be a string: ${name}`);
    return value;
  });
}
