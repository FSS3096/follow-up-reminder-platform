import { describe, expect, it } from 'vitest';
import { buildMessage, buildVars, firstName } from './build';
import { ALLOWED_VARS, renderTemplate, TEMPLATE_KEYS, TEMPLATES, TemplateRenderError, type TemplateVars } from './templates.provisional';

const BANNED = [
  'medicine', 'tablet', 'tab', 'capsule', 'syrup', 'mg', 'ml', 'dose', 'injection', 'bp', 'sugar', 'diabetes',
  'fever', 'antibiotic', 'report', 'test result', 'symptom', 'sab theek hai', 'dawai', 'goli',
];
const EMOJI = /\p{Extended_Pictographic}/gu;

const LONG_VARS: TemplateVars = {
  patient_first_name: 'Venkataramanaswamy',
  clinic_name: 'Sunrise Family Clinic and Polyclinic', // 37 chars
  doctor_name: 'Dr. Lakshminarayanan',
  date_long: 'Wed, 30 Dec',
  time_clause: ', 12:30 PM baje',
  clinic_phone: '+919876543210',
};

describe('provisional templates lint (Brief 6.2 rules)', () => {
  for (const lang of ['hinglish', 'english'] as const) {
    for (const key of TEMPLATE_KEYS) {
      const template = TEMPLATES[lang][key];
      it(`${lang}/${key}: exists, whitelisted placeholders only, no banned words, no links, <= 1 emoji`, () => {
        expect(template).toBeTruthy();
        for (const m of template.matchAll(/\{([^}]*)\}/g)) expect(ALLOWED_VARS.has(m[1] as string)).toBe(true);
        for (const word of BANNED) expect(template.toLowerCase()).not.toMatch(new RegExp(`\\b${word}\\b`));
        expect(template).not.toMatch(/https?:|www\.|\.com\b/i);
        expect((template.match(EMOJI) ?? []).length).toBeLessThanOrEqual(1);
      });
      it(`${lang}/${key}: renders <= 300 chars with long values and leaves no placeholder`, () => {
        const out = renderTemplate(key, lang, LONG_VARS);
        expect(out.length).toBeLessThanOrEqual(300);
        expect(out).not.toMatch(/[{}]/);
      });
    }
  }

  it('every reminder carries the reply instruction', () => {
    for (const lang of ['hinglish', 'english'] as const) {
      for (const key of ['confirmation', 'day_before', 'morning_of'] as const) {
        expect(TEMPLATES[lang][key]).toMatch(/\b1\b[\s\S]*\b2\b/);
      }
      expect(TEMPLATES[lang].missed_nudge).toMatch(/\b2\b/);
    }
  });

  it('hindi falls back to hinglish (P1)', () => {
    expect(renderTemplate('confirmation', 'hindi', LONG_VARS)).toBe(renderTemplate('confirmation', 'hinglish', LONG_VARS));
  });
});

describe('renderTemplate whitelist enforcement', () => {
  it('rejects an unknown variable at runtime', () => {
    const vars = { ...LONG_VARS, diagnosis: 'x' } as unknown as TemplateVars;
    expect(() => renderTemplate('confirmation', 'hinglish', vars)).toThrow(TemplateRenderError);
  });

  it('rejects an unknown variable at compile time', () => {
    // @ts-expect-error diagnosis is not a TemplateVars key
    const vars: TemplateVars = { ...LONG_VARS, diagnosis: 'x' };
    expect(vars).toBeDefined();
  });

  it('throws on a missing required variable', () => {
    const { clinic_phone: _omit, ...rest } = LONG_VARS;
    expect(() => renderTemplate('reply_out_of_scope', 'english', rest)).toThrow(/clinic_phone/);
  });

  it('does not expand placeholders smuggled inside a value', () => {
    const out = renderTemplate('confirmation', 'english', { ...LONG_VARS, patient_first_name: '{clinic_phone}' });
    expect(out).toContain('{clinic_phone}');
    expect(out).not.toContain('+919876543210');
  });
});

describe('buildMessage', () => {
  const clinic = { clinicName: 'Sunrise Family Clinic', doctorName: 'Dr. Mehra', clinicPhone: '+911100000000' };

  it('builds a Hinglish confirmation with a time', () => {
    expect(
      buildMessage('confirmation', { patientName: 'Ramesh Patel', language: 'hinglish', followupDate: '2026-11-09', followupTime: '17:00' }, clinic),
    ).toBe(
      'Namaste Ramesh ji, Dr. Mehra (Sunrise Family Clinic) ke saath aapka follow-up Mon, 9 Nov, 5:00 PM baje ko fix hua hai. Confirm karne ke liye 1, naya din chahiye to 2 reply karein.',
    );
  });

  it('builds an English confirmation without a time', () => {
    expect(
      buildMessage('confirmation', { patientName: 'sita verma', language: 'english', followupDate: '2026-11-11', followupTime: null }, clinic),
    ).toBe('Hello Sita, your follow-up with Dr. Mehra (Sunrise Family Clinic) is fixed for Wed, 11 Nov. Reply 1 to confirm, or 2 if you need another day.');
  });

  it('sanitises the first name and caps clinic values', () => {
    const vars = buildVars(
      { patientName: '<b>Ramesh</b>', language: 'english', followupDate: '2026-11-11', followupTime: null },
      { clinicName: `{x}${'A'.repeat(100)}`, doctorName: 'Dr\nX' },
    );
    expect(vars.patient_first_name).toBe('B');
    expect(vars.clinic_name).not.toMatch(/[{}]/);
    expect(vars.clinic_name.length).toBeLessThanOrEqual(60);
    expect(vars.doctor_name).toBe('Dr X');
    expect(firstName('')).toBe('ji');
  });
});
