/**
 * L3 input guard (Brief 6.1). Finds drug / dose / diagnosis / symptom tokens in a note so
 * the parser ignores them. It never blocks the doctor: it only reports
 * ignoredClinicalContent=true so the UI can show "Clinical details ignored".
 *
 * Over-matching is safe (a word is ignored, the note still parses); under-matching is what
 * the outbound template layer (L1) protects against, because note text never reaches a message.
 */

export interface GuardToken {
  /** Normalised lowercase token. */
  value: string;
  /** Original spelling (for names). */
  raw: string;
  clinical: boolean;
}

export interface GuardResult {
  tokens: GuardToken[];
  ignoredClinicalContent: boolean;
}

/** Single-word clinical vocabulary (lowercase). */
export const CLINICAL_WORDS: ReadonlySet<string> = new Set([
  // dosage forms / units / frequency
  'mg', 'mgs', 'ml', 'mcg', 'gm', 'gram', 'grams', 'iu', 'unit', 'units', 'tab', 'tabs', 'tablet', 'tablets', 'cap',
  'caps', 'capsule', 'capsules', 'syrup', 'syp', 'syr', 'inj', 'injection', 'injections', 'drop', 'drops', 'dose',
  'doses', 'dosage', 'ointment', 'cream', 'gel', 'inhaler', 'puff', 'puffs', 'nebulizer', 'nebulise', 'nebulize',
  'sachet', 'od', 'bd', 'bid', 'tds', 'tid', 'qid', 'hs', 'sos', 'prn', 'stat', 'qd', 'ac', 'pc', 'rx',
  'medicine', 'medicines', 'medication', 'meds', 'dawai', 'dawa', 'dava', 'davai', 'goli', 'goliyan',
  'prescription', 'prescribe', 'prescribed',
  // vitals / labs
  'bp', 'sugar', 'glucose', 'hba1c', 'fbs', 'ppbs', 'rbs', 'cbc', 'esr', 'crp', 'tsh', 't3', 't4', 'lft', 'kft',
  'rft', 'ecg', 'echo', 'xray', 'x-ray', 'mri', 'ct', 'usg', 'ultrasound', 'report', 'reports', 'test', 'tests',
  'lab', 'labs', 'result', 'results', 'pulse', 'spo2', 'temp', 'temperature', 'weight', 'bmi', 'hb',
  'cholesterol', 'creatinine', 'urea', 'platelet', 'platelets', 'wbc', 'rbc', 'hemoglobin', 'haemoglobin',
  // qualifiers that only appear next to vitals in notes
  'high', 'low', 'raised', 'elevated', 'normal', 'abnormal', 'badh', 'badha', 'badhi', 'badhao', 'ghatao', 'kam',
  'zyada', 'jyada', 'increase', 'decrease', 'reduce', 'stop', 'continue', 'taper', 'start',
  // diagnoses / conditions
  'diabetes', 'diabetic', 'dm', 't2dm', 'htn', 'hypertension', 'hypertensive', 'thyroid', 'hypothyroid',
  'hyperthyroid', 'asthma', 'copd', 'tb', 'typhoid', 'dengue', 'malaria', 'covid', 'infection', 'uti', 'urti',
  'pneumonia', 'migraine', 'arthritis', 'pcod', 'pcos', 'anemia', 'anaemia', 'cancer', 'tumour', 'tumor',
  'fracture', 'ulcer', 'gastritis', 'acidity', 'allergy', 'allergic', 'cardiac', 'heart', 'kidney', 'liver',
  'pregnancy', 'pregnant', 'depression', 'anxiety', 'cholera', 'jaundice', 'hepatitis', 'hiv', 'std',
  // symptoms (English + Hinglish)
  'fever', 'bukhar', 'bukhaar', 'pain', 'dard', 'cough', 'khansi', 'khaansi', 'cold', 'zukam', 'zukaam', 'nausea',
  'vomiting', 'vomit', 'ulti', 'diarrhea', 'diarrhoea', 'dast', 'loose', 'motion', 'motions', 'headache',
  'sir', 'chakkar', 'dizziness', 'dizzy', 'giddiness', 'swelling', 'sujan', 'soojan', 'rash', 'itching',
  'khujli', 'breathlessness', 'sob', 'weakness', 'kamzori', 'fatigue', 'bleeding', 'infected', 'wound',
  'sore', 'throat', 'burning', 'jalan', 'insomnia', 'constipation', 'kabz', 'gas',
  // drug names and classes commonly seen in Indian OPD notes
  'antibiotic', 'antibiotics', 'painkiller', 'painkillers', 'steroid', 'steroids', 'insulin', 'vaccine',
  'vaccination', 'paracetamol', 'pcm', 'dolo', 'crocin', 'calpol', 'combiflam', 'ibuprofen', 'brufen',
  'diclofenac', 'aceclofenac', 'nimesulide', 'aspirin', 'ecosprin', 'amlodipine', 'amlo', 'telmisartan', 'telma',
  'losartan', 'atenolol', 'metoprolol', 'metformin', 'glimepiride', 'gliclazide', 'sitagliptin', 'vildagliptin',
  'atorvastatin', 'rosuvastatin', 'thyronorm', 'eltroxin', 'levothyroxine', 'amoxicillin', 'amox', 'augmentin',
  'azithromycin', 'azithral', 'azee', 'cefixime', 'ciprofloxacin', 'cipro', 'ofloxacin', 'levofloxacin',
  'doxycycline', 'metronidazole', 'flagyl', 'pantoprazole', 'pan', 'pantop', 'omeprazole', 'rabeprazole',
  'ranitidine', 'domperidone', 'ondansetron', 'emset', 'cetirizine', 'levocetirizine', 'montelukast',
  'allegra', 'fexofenadine', 'salbutamol', 'asthalin', 'budesonide', 'prednisolone', 'dexamethasone',
  'ors', 'zinc', 'iron', 'calcium', 'vitamin', 'multivitamin', 'b12', 'd3', 'shelcal', 'becosules',
  'clopidogrel', 'warfarin', 'heparin', 'furosemide', 'lasix', 'spironolactone', 'insulin',
]);

/** Multi-word phrases joined with a space after normalisation. */
const CLINICAL_PHRASES: readonly string[][] = [
  ['blood', 'pressure'],
  ['blood', 'sugar'],
  ['sugar', 'level'],
  ['test', 'result'],
  ['side', 'effect'],
  ['side', 'effects'],
];

/** 5mg, 2.5ml, 500mcg, 10u, 1g, 1-0-1, 1+0+1 */
const DOSE_TOKEN = /^(\d+(\.\d+)?(mg|mgs|ml|mcg|g|gm|iu|u|units?|%|cc)|\d[-+]\d[-+]\d)$/;
const NUMBER_TOKEN = /^\d+(\.\d+)?$/;
const DURATION_UNITS = new Set(['din', 'dino', 'dinon', 'day', 'days', 'week', 'weeks', 'hafte', 'hafta', 'month', 'months', 'mahine', 'mahina']);
const AFTER_MARKERS = new Set(['baad', 'bad', 'later', 'after', 'mein', 'me']);

/**
 * Split into tokens: letters, digits and in-word . - ' + %. Everything else (commas, dots at word
 * ends, ellipses, emoji, newlines) is a separator. Times like 5:30 and dates like 15/11 survive.
 */
export function tokenize(text: string): Array<{ raw: string; value: string }> {
  const matches = text.normalize('NFKC').match(/[\p{L}\p{M}\p{N}]+(?:[.:/'’+%-][\p{L}\p{M}\p{N}]+)*%?/gu) ?? [];
  return matches.map((raw) => ({ raw, value: raw.toLowerCase().replace(/’/g, "'") }));
}

function isClinicalWord(value: string): boolean {
  if (CLINICAL_WORDS.has(value)) return true;
  if (DOSE_TOKEN.test(value)) return true;
  // hyphenated forms such as "x-ray" or "anti-biotic"
  if (value.includes('-') || value.includes('/')) {
    if (CLINICAL_WORDS.has(value.replace(/[-/]/g, ''))) return true;
    // "dolo-650", "amlo-5", "bp/sugar": any clinical part makes the whole token clinical
    if (value.split(/[-/]/).some((part) => CLINICAL_WORDS.has(part) || DOSE_TOKEN.test(part))) return true;
  }
  return false;
}

export function clinicalGuard(text: string): GuardResult {
  const base = tokenize(text);
  const tokens: GuardToken[] = base.map((t) => ({ ...t, clinical: isClinicalWord(t.value) }));

  // multi-word phrases
  for (let i = 0; i < tokens.length; i++) {
    for (const phrase of CLINICAL_PHRASES) {
      if (phrase.every((w, k) => tokens[i + k]?.value === w)) {
        for (let k = 0; k < phrase.length; k++) (tokens[i + k] as GuardToken).clinical = true;
      }
    }
  }

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] as GuardToken;
    const prev = tokens[i - 1];
    const next = tokens[i + 1];
    if (!NUMBER_TOKEN.test(t.value) || t.clinical) continue;

    // "dolo 650", "amlodipine 5": a bare number right after a clinical word is a strength,
    // unless it starts a follow-up duration ("SOS 10 din baad").
    const startsDuration = next && DURATION_UNITS.has(next.value);
    if (prev?.clinical && !startsDuration) t.clinical = true;
    // "5 mg", "2 tab": a number right before a unit / form
    if (next && CLINICAL_WORDS.has(next.value) && !startsDuration) t.clinical = true;
  }

  // Course durations: "antibiotic 5 din" (clinical word, then N days, NOT followed by baad/later).
  for (let i = 1; i + 1 < tokens.length; i++) {
    const prev = tokens[i - 1] as GuardToken;
    const num = tokens[i] as GuardToken;
    const unit = tokens[i + 1] as GuardToken;
    const after = tokens[i + 2];
    if (prev.clinical && NUMBER_TOKEN.test(num.value) && DURATION_UNITS.has(unit.value) && !(after && AFTER_MARKERS.has(after.value))) {
      num.clinical = true;
      unit.clinical = true;
    }
  }

  return { tokens, ignoredClinicalContent: tokens.some((t) => t.clinical) };
}

/** The note with clinical tokens removed (what may be stored as raw_note while a draft). */
export function stripClinical(result: GuardResult): string {
  return result.tokens
    .filter((t) => !t.clinical)
    .map((t) => t.raw)
    .join(' ');
}
