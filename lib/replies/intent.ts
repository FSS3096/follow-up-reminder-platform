export type Intent = 'confirm' | 'reschedule' | 'stop' | 'join' | 'other';

const CONFIRM = new Set(['1', 'yes', 'haan', 'ha', 'han', 'haa', 'confirm', 'confirmed', 'ok', 'okay']);
const RESCHEDULE = new Set(['2', 'reschedule', 'change']);
const STOP = new Set(['stop', 'unsubscribe', 'band']);

/** Brief B7: trim, lowercase, strip punctuation; then an exact match on the whole message. */
export function normalise(body: string): string {
  return body
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function classify(body: string): Intent {
  const n = normalise(body);
  if (/^join [a-z0-9-]+( [a-z0-9-]+)*$/.test(n)) return 'join';
  if (CONFIRM.has(n)) return 'confirm';
  if (RESCHEDULE.has(n)) return 'reschedule';
  if (STOP.has(n)) return 'stop';
  return 'other';
}
