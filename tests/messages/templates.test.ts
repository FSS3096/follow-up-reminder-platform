import { describe, expect, it } from 'vitest';
import { ALLOWED_VARS, renderTemplate, TEMPLATE_KEYS, TEMPLATES, TemplateRenderError, type Language, type TemplateVars } from '@/lib/messages/templates';

const BANNED = ['medicine', 'tablet', 'tab', 'capsule', 'syrup', 'mg', 'ml', 'dose', 'injection', 'bp', 'sugar', 'diabetes', 'fever', 'antibiotic', 'symptom', 'dawai', 'goli'];
const vars: TemplateVars = { patient_first_name: 'Ramesh', clinic_name: 'Sunrise Family Clinic', doctor_name: 'Dr. Mehra', date_long: 'Wed, 11 Nov', time_clause: ' at 5:00 PM', clinic_phone: '+911100000000' };

describe('outbound template safety', () => {
  for (const lang of ['hinglish', 'english'] as const satisfies readonly Language[]) {
    for (const key of TEMPLATE_KEYS) {
      it(`${lang}/${key} is lint clean and renders fully`, () => {
        const template = TEMPLATES[lang][key];
        expect(template).toBeTruthy();
        for (const match of template.matchAll(/\{([^}]*)\}/g)) expect(ALLOWED_VARS.has(match[1] ?? '')).toBe(true);
        for (const word of BANNED) expect(template.toLowerCase()).not.toMatch(new RegExp(`\\b${word}\\b`));
        expect(template).not.toMatch(/https?:|www\.|\.com\b/i);
        expect([...template.matchAll(/\p{Extended_Pictographic}/gu)]).toHaveLength(0);
        const rendered = renderTemplate(key, lang, vars);
        expect(rendered.length).toBeLessThanOrEqual(300);
        expect(rendered).not.toMatch(/[{}]/);
      });
    }
  }
  it('rejects an unknown runtime variable', () => {
    expect(() => renderTemplate('confirmation', 'english', { ...vars, diagnosis: 'x' } as TemplateVars)).toThrow(TemplateRenderError);
  });
  it('does not expand placeholders supplied as a value', () => {
    expect(renderTemplate('confirmation', 'english', { ...vars, patient_first_name: '{clinic_phone}' })).toContain('{clinic_phone}');
  });
  it('falls back to Hinglish for Hindi until Hindi copy is added', () => {
    expect(renderTemplate('confirmation', 'hindi', vars)).toBe(renderTemplate('confirmation', 'hinglish', vars));
  });
});
