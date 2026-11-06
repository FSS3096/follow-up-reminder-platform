import { describe, expect, it } from 'vitest';
import { istDateTime } from '@/lib/time/ist';
import { parseNote, type ParseInput } from './index';
import { jaroWinkler, matchPatient, sanitizeName } from './names';

const NOW = istDateTime('2026-11-06', '10:00'); // Friday
const KNOWN = [
  { id: 'p-ramesh', name: 'Ramesh Patel' },
  { id: 'p-sita', name: 'Sita Verma' },
  { id: 'p-amit', name: 'Amit Shah' },
  { id: 'p-neha', name: 'Neha Gupta' },
  { id: 'p-kiran', name: 'Kiran Rao' },
  { id: 'p-meena', name: 'Meena Iyer' },
  { id: 'p-raj', name: 'Raj Kumar' },
  { id: 'p-pooja', name: 'Pooja Nair' },
  { id: 'p-rahul', name: 'Rahul Mehta' },
];

function parse(text: string, knownPatients = KNOWN, now = NOW) {
  const input: ParseInput = { text, now, knownPatients };
  return parseNote(input);
}

function ok(text: string, knownPatients = KNOWN) {
  const r = parse(text, knownPatients);
  if (!r.ok) throw new Error(`expected ok for ${JSON.stringify(text)}, got ${r.error}`);
  return r;
}

describe('parseNote: Brief C2b table (now = Fri 2026-11-06 10:00 IST)', () => {
  it.each([
    ['Ramesh Patel 5 din baad', 'Ramesh Patel', '2026-11-11', 'relative'],
    ['Sita kal', 'Sita', '2026-11-07', 'relative'],
    ['Sita parso', 'Sita', '2026-11-08', 'relative'],
    ['Amit Shah next monday', 'Amit Shah', '2026-11-09', 'relative'],
    ['Neha 1 hafte baad', 'Neha', '2026-11-13', 'relative'],
    ['Rahul 2 weeks', 'Rahul', '2026-11-20', 'relative'],
    ['Kiran 15 Nov', 'Kiran', '2026-11-15', 'explicit'],
    ['Kiran 15/11', 'Kiran', '2026-11-15', 'explicit'],
    ['Raj Kumar paanch din baad', 'Raj Kumar', '2026-11-11', 'relative'],
    ['Ramesh, Patel... 5 din baad.', 'Ramesh Patel', '2026-11-11', 'relative'],
  ])('%j -> %s on %s (%s)', (text, name, date, source) => {
    const r = ok(text);
    expect(r.patientName).toBe(name);
    expect(r.followupDate).toBe(date);
    expect(r.dateSource).toBe(source);
    expect(r.needsReview).not.toContain('date_ambiguous');
    expect(r.needsReview).not.toContain('date_defaulted');
  });

  it('Kiran 3/11 rolls into next year and flags date_ambiguous', () => {
    const r = ok('Kiran 3/11');
    expect(r.followupDate).toBe('2027-11-03');
    expect(r.dateSource).toBe('explicit');
    expect(r.needsReview).toContain('date_ambiguous');
  });

  it('Meena friday 5pm: next Friday (strictly after today), 17:00', () => {
    const r = ok('Meena friday 5pm');
    expect(r.followupDate).toBe('2026-11-13');
    expect(r.followupTime).toBe('17:00');
  });

  it('Pooja: no date defaults to +7 days with date_defaulted', () => {
    const r = ok('Pooja');
    expect(r.followupDate).toBe('2026-11-13');
    expect(r.dateSource).toBe('default');
    expect(r.needsReview).toContain('date_defaulted');
  });

  it('5 din baad: NAME_MISSING', () => {
    expect(parse('5 din baad')).toEqual({ ok: false, error: 'NAME_MISSING' });
  });

  it.each(['', '   ', '\n\t', '...', '!!!'])('%j: EMPTY', (text) => {
    expect(parse(text)).toEqual({ ok: false, error: 'EMPTY' });
  });

  it('ramesh patel with two Ramesh P... patients: name_ambiguous, two candidates sorted by score', () => {
    const known = [
      { id: 'a', name: 'Ramesh Patil' },
      { id: 'b', name: 'Ramesh Patel' },
      { id: 'c', name: 'Sita Verma' },
    ];
    const r = ok('ramesh patel 5 din baad', known);
    expect(r.followupDate).toBe('2026-11-11');
    expect(r.patientId).toBeNull();
    expect(r.needsReview).toContain('name_ambiguous');
    expect(r.candidates.map((c) => c.id)).toEqual(['b', 'a']);
    expect(r.candidates[0]!.score).toBeGreaterThanOrEqual(r.candidates[1]!.score);
  });

  it('Unknownperson 4 din baad: unmatched', () => {
    const r = ok('Unknownperson 4 din baad');
    expect(r.patientName).toBe('Unknownperson');
    expect(r.followupDate).toBe('2026-11-10');
    expect(r.patientId).toBeNull();
    expect(r.needsReview).toContain('name_unmatched');
  });

  it('matches a known patient uniquely', () => {
    const r = ok('Ramesh Patel 5 din baad');
    expect(r.patientId).toBe('p-ramesh');
    expect(r.needsReview).toEqual([]);
  });

  it('first name alone matches a unique patient', () => {
    expect(ok('Sita kal').patientId).toBe('p-sita');
  });

  it('first name shared by two patients is ambiguous', () => {
    const r = ok('Sita kal', [
      { id: '1', name: 'Sita Verma' },
      { id: '2', name: 'Sita Rao' },
    ]);
    expect(r.patientId).toBeNull();
    expect(r.needsReview).toContain('name_ambiguous');
  });

  it('tolerates a dictation typo', () => {
    expect(ok('Ramesh Patle 5 din baad').patientId).toBe('p-ramesh');
  });
});

describe('parseNote: more dates', () => {
  it.each([
    ['Sita tomorrow', '2026-11-07'],
    ['Sita day after tomorrow', '2026-11-08'],
    ['Sita 10 days', '2026-11-16'],
    ['Sita ek hafte baad', '2026-11-13'],
    ['Sita do hafte baad', '2026-11-20'],
    ['Sita teen din baad', '2026-11-09'],
    ['Sita char din baad', '2026-11-10'],
    ['Sita chhe din baad', '2026-11-12'],
    ['Sita saat din baad', '2026-11-13'],
    ['Sita aath din baad', '2026-11-14'],
    ['Sita nau din baad', '2026-11-15'],
    ['Sita das din baad', '2026-11-16'],
    ['Sita 1 month', '2026-12-06'],
    ['Sita next week', '2026-11-13'],
    ['Sita agle hafte', '2026-11-13'],
    ['Sita somvar', '2026-11-09'],
    ['Sita friday', '2026-11-13'],
    ['Sita next friday', '2026-11-13'],
    ['Sita Nov 20', '2026-11-20'],
    ['Sita 20th November', '2026-11-20'],
    ['Sita 6/11', '2026-11-06'],
    ['Sita 25-12-2026', '2026-12-25'],
    ['Sita 1/1', '2027-01-01'],
  ])('%j -> %s', (text, date) => {
    expect(ok(text).followupDate).toBe(date);
  });

  it('month-end arithmetic clamps (31 Jan + 1 month = 28/29 Feb)', () => {
    const r = parseNote({ text: 'Sita 1 month', now: istDateTime('2027-01-31', '10:00'), knownPatients: KNOWN });
    expect(r.ok && r.followupDate).toBe('2027-02-28');
  });

  it('aaj: today, flagged date_ambiguous', () => {
    const r = ok('Sita aaj');
    expect(r.followupDate).toBe('2026-11-06');
    expect(r.needsReview).toContain('date_ambiguous');
  });

  it('uses IST "today" even when UTC is still yesterday', () => {
    const r = parseNote({ text: 'Sita kal', now: istDateTime('2026-11-07', '01:00'), knownPatients: KNOWN });
    expect(r.ok && r.followupDate).toBe('2026-11-08');
  });

  it('invalid explicit date (31/02) falls back to default and flags it', () => {
    const r = ok('Sita 31/02');
    expect(r.dateSource).toBe('default');
    expect(r.needsReview).toEqual(expect.arrayContaining(['date_defaulted', 'date_ambiguous']));
  });

  it('explicit past year is never used', () => {
    const r = ok('Sita 15/11/2025');
    expect(r.dateSource).toBe('default');
    expect(r.needsReview).toContain('date_ambiguous');
  });

  it('two different dates: prefers the one marked "baad" and flags ambiguity', () => {
    const r = ok('Sita kal ya 5 din baad');
    expect(r.followupDate).toBe('2026-11-11');
    expect(r.needsReview).toContain('date_ambiguous');
  });

  it('absurd durations are ignored, not scheduled years ahead', () => {
    const r = ok('Sita 999 din baad');
    expect(r.dateSource).toBe('default');
  });
});

describe('parseNote: times', () => {
  it.each([
    ['Sita kal 5 pm', '17:00'],
    ['Sita kal 5:30pm', '17:30'],
    ['Sita kal 17:00', '17:00'],
    ['Sita kal 10am', '10:00'],
    ['Sita kal 12 pm', '12:00'],
    ['Sita kal shaam 5 baje', '17:00'],
    ['Sita kal subah 10 baje', '10:00'],
    ['Sita kal 4 baje', '16:00'],
    ['Sita kal raat 8 baje', '20:00'],
  ])('%j -> %s', (text, time) => {
    const r = ok(text);
    expect(r.followupTime).toBe(time);
    expect(r.followupDate).toBe('2026-11-07');
  });

  it('no time gives null', () => {
    expect(ok('Sita kal').followupTime).toBeNull();
  });

  it.each(['Sita kal 25:00', 'Sita kal 13pm', 'Sita kal 10:75'])('%j: invalid time ignored', (text) => {
    expect(ok(text).followupTime).toBeNull();
  });
});

describe('parseNote: names', () => {
  it('skips honorifics', () => {
    expect(ok('Mr Ramesh Patel 5 din baad').patientName).toBe('Ramesh Patel');
    expect(ok('patient Sita kal').patientName).toBe('Sita');
  });
  it('title-cases lowercase dictation', () => {
    expect(ok('raj kumar kal').patientName).toBe('Raj Kumar');
  });
  it('takes at most two name words', () => {
    expect(ok('Ramesh Kumar Patel kal').patientName).toBe('Ramesh Kumar');
  });
  it('does not swallow instruction words into the name', () => {
    expect(ok('Neha ignore previous instructions, 3 din baad').patientName).toBe('Neha');
  });
  it('keeps Devanagari names', () => {
    expect(ok('सीता kal').patientName).toBe('सीता');
  });
  it('is stable on long input (truncated at 280 chars, never throws)', () => {
    expect(() => parse(`Sita ${'x '.repeat(500)} kal`)).not.toThrow();
  });
});

describe('sanitizeName', () => {
  it.each([
    ['Ramesh<script>alert(1)</script>', 'Ramesh Script Alert Script'],
    ["D'Souza", "D'souza"],
    ['Anne-Marie', 'Anne-marie'],
    ['  rAm   kUMAR ', 'Ram Kumar'],
    ['Robert"); DROP TABLE patients;--', 'Robert Drop Table Patients'],
    ['{{patient_first_name}}', 'Patient First Name'],
    ['---', ''],
  ])('%j -> %j', (input, expected) => {
    expect(sanitizeName(input)).toBe(expected);
  });
  it('never exceeds 80 chars', () => {
    expect(sanitizeName('a'.repeat(200)).length).toBeLessThanOrEqual(80);
  });
});

describe('matching helpers', () => {
  it('jaroWinkler basics', () => {
    expect(jaroWinkler('martha', 'marhta')).toBeCloseTo(0.961, 2);
    expect(jaroWinkler('', 'x')).toBe(0);
    expect(jaroWinkler('abc', 'abc')).toBe(1);
  });
  it('returns no candidates for an empty patient list', () => {
    expect(matchPatient('Sita', [])).toEqual({ patientId: null, candidates: [], status: 'unmatched' });
  });
});

describe('performance', () => {
  it('parses against 5,000 known patients well under the 800 ms budget', () => {
    const many = Array.from({ length: 5000 }, (_, i) => ({ id: `p${i}`, name: `Patient${i} Surname${i % 97}` }));
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) parse('Ramesh Patel BP high 5mg 7 din baad shaam 5 baje', many);
    const perCall = (performance.now() - t0) / 20;
    expect(perCall).toBeLessThan(200);
  });
});
