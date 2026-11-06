import { clinicalGuard, stripClinical } from '@/lib/safety/clinicalGuard';
import { addDays, istDate } from '@/lib/time/ist';
import { chooseDate, scanDates, type DateSource } from './dates';
import { extractNameTokens, matchPatient, sanitizeName, type NameToken } from './names';

export type NeedsReview = 'name_ambiguous' | 'name_unmatched' | 'date_defaulted' | 'date_ambiguous';

export interface ParseInput {
  text: string;
  now: Date;
  knownPatients: Array<{ id: string; name: string }>;
}

export type ParseResult =
  | {
      ok: true;
      patientName: string;
      patientId: string | null;
      candidates: Array<{ id: string; name: string; score: number }>;
      followupDate: string; // 'YYYY-MM-DD' IST
      followupTime: string | null; // 'HH:mm'
      dateSource: DateSource;
      needsReview: NeedsReview[];
      ignoredClinicalContent: boolean;
      /** Note with clinical tokens removed; the only form of the note that may be stored. */
      sanitizedNote: string;
      parseSource: 'rules';
    }
  | { ok: false; error: 'EMPTY' | 'NAME_MISSING' };

export const DEFAULT_FOLLOWUP_DAYS = 7;
export const MAX_NOTE_LENGTH = 280;

/**
 * Deterministic rules parser (Brief B2). Pure: no I/O, no clock reads, `now` is injected.
 * Never throws on user text; worst case is a draft with review chips.
 */
export function parseNote(input: ParseInput): ParseResult {
  const text = (input.text ?? '').slice(0, MAX_NOTE_LENGTH);
  if (text.trim() === '') return { ok: false, error: 'EMPTY' };

  const guard = clinicalGuard(text);
  if (guard.tokens.length === 0) return { ok: false, error: 'EMPTY' };

  const indexed: NameToken[] = guard.tokens.map((t, index) => ({ ...t, index }));
  const nonClinical = indexed.filter((t) => !t.clinical);

  const scan = scanDates(nonClinical, input.now);
  const nameTokens = extractNameTokens(indexed, scan.consumed);
  const patientName = sanitizeName(nameTokens.map((t) => t.raw).join(' '));
  if (patientName === '') return { ok: false, error: 'NAME_MISSING' };

  const needsReview = new Set<NeedsReview>();

  const match = matchPatient(patientName, input.knownPatients);
  if (match.status === 'ambiguous') needsReview.add('name_ambiguous');
  if (match.status === 'unmatched') needsReview.add('name_unmatched');

  const { chosen, conflicting } = chooseDate(scan.candidates);
  let followupDate: string;
  let dateSource: DateSource;
  if (chosen) {
    followupDate = chosen.date;
    dateSource = chosen.source;
    if (chosen.ambiguous || conflicting || scan.rejected) needsReview.add('date_ambiguous');
  } else {
    followupDate = addDays(istDate(input.now), DEFAULT_FOLLOWUP_DAYS);
    dateSource = 'default';
    needsReview.add('date_defaulted');
    if (scan.rejected) needsReview.add('date_ambiguous');
  }

  const order: NeedsReview[] = ['name_ambiguous', 'name_unmatched', 'date_defaulted', 'date_ambiguous'];
  return {
    ok: true,
    patientName,
    patientId: match.patientId,
    candidates: match.candidates,
    followupDate,
    followupTime: scan.time,
    dateSource,
    needsReview: order.filter((r) => needsReview.has(r)),
    ignoredClinicalContent: guard.ignoredClinicalContent,
    sanitizedNote: stripClinical(guard),
    parseSource: 'rules',
  };
}
