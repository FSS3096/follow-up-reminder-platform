import { DAY_AFTER_WORDS, HONORIFICS, MONTHS, NEXT_WORDS, NON_NAME_WORDS, TODAY_WORDS, TOMORROW_WORDS, WEEKDAYS } from './lexicon';

export const NAME_MAX_LENGTH = 80;
export const MATCH_THRESHOLD = 0.85;
const CANDIDATE_FLOOR = 0.6;
const MAX_CANDIDATES = 5;

/** Letters (any script, incl. combining marks), spaces, hyphen, apostrophe. Title-cased, max 80 chars. */
export function sanitizeName(input: string): string {
  const cleaned = input
    .normalize('NFKC')
    .replace(/<[^>]*>/g, ' ')
    .replace(/’/g, "'")
    .replace(/[^\p{L}\p{M}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .replace(/(^|\s)['-]+|['-]+(?=\s|$)/g, '$1')
    .trim()
    .slice(0, NAME_MAX_LENGTH)
    .trim();
  return cleaned
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toLocaleUpperCase('en-IN') + w.slice(1).toLocaleLowerCase('en-IN'))
    .join(' ');
}

const NAME_TOKEN = /^\p{L}[\p{L}\p{M}'-]*$/u;

function isNameWord(value: string): boolean {
  return (
    NAME_TOKEN.test(value) &&
    value.length >= 2 &&
    !NON_NAME_WORDS.has(value) &&
    !HONORIFICS.has(value) &&
    WEEKDAYS[value] === undefined &&
    MONTHS[value] === undefined &&
    !TODAY_WORDS.has(value) &&
    !TOMORROW_WORDS.has(value) &&
    !DAY_AFTER_WORDS.has(value) &&
    !NEXT_WORDS.has(value)
  );
}

export interface NameToken {
  value: string;
  raw: string;
  index: number;
  clinical: boolean;
}

/**
 * Leading 1-2 name words. Skips leading honorifics ("Mr", "patient") and leading clinical words;
 * stops at the first token that is a date/time expression, clinical, or not name-like.
 */
export function extractNameTokens(tokens: readonly NameToken[], consumed: ReadonlySet<number>): NameToken[] {
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i] as NameToken;
    if (HONORIFICS.has(t.value) || (t.clinical && !consumed.has(t.index))) i++;
    else break;
  }
  const out: NameToken[] = [];
  for (; i < tokens.length && out.length < 2; i++) {
    const t = tokens[i] as NameToken;
    if (t.clinical || consumed.has(t.index) || !isNameWord(t.value)) break;
    out.push(t);
  }
  return out;
}

/** Jaro-Winkler similarity in [0, 1]. */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatch = new Array<boolean>(a.length).fill(false);
  const bMatch = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - range);
    const hi = Math.min(i + range + 1, b.length);
    for (let j = lo; j < hi; j++) {
      if (bMatch[j] || a[i] !== b[j]) continue;
      aMatch[i] = true;
      bMatch[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;
  let t = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatch[i]) continue;
    while (!bMatch[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  const jaro = (matches / a.length + matches / b.length + (matches - t / 2) / matches) / 3;
  let prefix = 0;
  while (prefix < 4 && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

function norm(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{M}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Score of a parsed name against a known patient. A one-word note name ("Sita") is compared with
 * the patient's first name and capped at 0.9, so it can match but never beats a full-name match.
 */
export function nameScore(parsed: string, patientName: string): number {
  const p = norm(parsed);
  const k = norm(patientName);
  if (!p || !k) return 0;
  const full = jaroWinkler(p, k);
  const pWords = p.split(' ');
  const kWords = k.split(' ');
  if (pWords.length === 1 && kWords.length > 1) {
    return Math.max(full, jaroWinkler(p, kWords[0] as string) * 0.9);
  }
  return full;
}

export interface Candidate {
  id: string;
  name: string;
  score: number;
}

export interface MatchResult {
  patientId: string | null;
  candidates: Candidate[];
  status: 'matched' | 'ambiguous' | 'unmatched';
}

/**
 * Only auto-links a patient when exactly one known patient scores >= 0.85.
 * Two or more strong matches is "ambiguous": a wrong patient would receive the reminder,
 * so the doctor picks from the chip instead.
 */
export function matchPatient(parsedName: string, known: ReadonlyArray<{ id: string; name: string }>): MatchResult {
  const scored = known
    .map((k) => ({ id: k.id, name: k.name, score: Math.round(nameScore(parsedName, k.name) * 1000) / 1000 }))
    .filter((c) => c.score >= CANDIDATE_FLOOR)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const strong = scored.filter((c) => c.score >= MATCH_THRESHOLD);
  const candidates = scored.slice(0, MAX_CANDIDATES);
  if (strong.length === 1) return { patientId: (strong[0] as Candidate).id, candidates, status: 'matched' };
  if (strong.length > 1) return { patientId: null, candidates, status: 'ambiguous' };
  return { patientId: null, candidates, status: 'unmatched' };
}
