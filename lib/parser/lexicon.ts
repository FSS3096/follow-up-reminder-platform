/**
 * Word lists for the deterministic parser. All entries are lowercase, matched against
 * normalised tokens. Keep clinical words in lib/safety/clinicalGuard.ts, not here.
 */

export const NUMBER_WORDS: Readonly<Record<string, number>> = {
  // Hinglish (several dictation spellings)
  ek: 1, do: 2, teen: 3, tin: 3, char: 4, chaar: 4, chār: 4, paanch: 5, panch: 5, paach: 5,
  chhe: 6, che: 6, chhah: 6, chah: 6, cheh: 6, saat: 7, sat: 7, aath: 8, ath: 8, nau: 9, das: 10, dus: 10,
  // English
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  a: 1, an: 1,
};

export const DAY_UNITS = new Set(['din', 'dino', 'dinon', 'dinn', 'day', 'days', 'd']);
export const WEEK_UNITS = new Set(['hafte', 'hafta', 'hafton', 'haftey', 'week', 'weeks', 'wk', 'wks', 'w']);
export const MONTH_UNITS = new Set(['mahine', 'mahina', 'mahino', 'month', 'months', 'mo']);

/** Words that mark "from now" after a duration. */
export const AFTER_MARKERS = new Set(['baad', 'bad', 'later', 'after', 'mein', 'me', 'main', 'hence']);

export const TODAY_WORDS = new Set(['aaj', 'today']);
export const TOMORROW_WORDS = new Set(['kal', 'tomorrow', 'tmrw', 'tmr']);
export const DAY_AFTER_WORDS = new Set(['parso', 'parson', 'parsoon', 'parsun']);

export const NEXT_WORDS = new Set(['next', 'agle', 'agla', 'agli', 'coming', 'this']);

/** 0 = Sunday. */
export const WEEKDAYS: Readonly<Record<string, number>> = {
  sunday: 0, sun: 0, ravivar: 0, raviwar: 0, itvar: 0, itwar: 0,
  monday: 1, mon: 1, somvar: 1, somwar: 1,
  tuesday: 2, tue: 2, tues: 2, mangalvar: 2, mangalwar: 2, mangal: 2,
  wednesday: 3, wed: 3, budhvar: 3, budhwar: 3, budh: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4, guruvar: 4, guruwar: 4, brihaspativar: 4, veervar: 4,
  friday: 5, fri: 5, shukravar: 5, shukrawar: 5, shukra: 5,
  saturday: 6, sat: 6, shanivar: 6, shaniwar: 6, shani: 6,
};

export const MONTHS: Readonly<Record<string, number>> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

export const AM_WORDS = new Set(['am', 'subah', 'savere', 'morning']);
export const PM_WORDS = new Set(['pm', 'shaam', 'sham', 'evening', 'dopahar', 'dopehar', 'afternoon', 'raat', 'night']);
export const OCLOCK_WORDS = new Set(['baje', 'bajey', 'bje', 'oclock']);

/** Leading words skipped before the name. */
export const HONORIFICS = new Set([
  'patient', 'pt', 'mr', 'mrs', 'ms', 'miss', 'shri', 'shree', 'sri', 'smt', 'kumari', 'master', 'baby', 'dr',
]);

/**
 * Words that can never be part of a patient name. Stops the second name token from
 * swallowing an instruction ("Neha ignore previous instructions ...").
 */
export const NON_NAME_WORDS = new Set([
  // English function / instruction words
  'the', 'and', 'or', 'to', 'for', 'of', 'in', 'on', 'at', 'by', 'with', 'from', 'her', 'his', 'him', 'she', 'he',
  'they', 'them', 'it', 'is', 'was', 'be', 'tell', 'ask', 'take', 'give', 'send', 'call', 'ignore', 'previous',
  'instructions', 'instruction', 'please', 'pls', 'plz', 'follow', 'followup', 'fu', 'up', 'review', 'visit',
  'revisit', 'checkup', 'check', 'come', 'again', 'back', 'appointment', 'appt', 'see', 'recheck', 'repeat',
  'in', 'after', 'before', 'next', 'this', 'that', 'not', 'no', 'yes', 'ok', 'okay', 'new', 'old', 'reminder',
  'message', 'msg', 'whatsapp', 'system', 'prompt', 'assistant', 'user', 'say', 'write', 'reply',
  'script', 'alert', 'select', 'drop', 'insert', 'delete', 'update', 'null', 'undefined', 'http', 'https', 'www',
  // Hinglish function words
  'ko', 'ka', 'ki', 'ke', 'se', 'aur', 'ya', 'phir', 'fir', 'wapas', 'vapas', 'aana', 'aane', 'aaye', 'aaiye',
  'bulao', 'bulana', 'dikhana', 'dikhane', 'hai', 'hain', 'tha', 'thi', 'karo', 'karna', 'dena', 'lena', 'ji',
  'jee', 'baad', 'pe', 'par', 'tak', 'gaya', 'gayi', 'gaye', 'kuch', 'bhi', 'nahi', 'nahin',
]);
