import { ApiError, type ErrorCode } from '@/lib/http/errors';

/** Shape of PostgrestError we rely on. */
export interface DbErrorLike {
  code?: string;
  message?: string;
  details?: string | null;
}

const UNPROCESSABLE_CODES: ReadonlySet<string> = new Set<ErrorCode>([
  'PATIENT_NEEDS_PHONE',
  'PATIENT_NOT_FOUND',
  'INVALID_FOLLOWUP_DATE',
  'INVALID_REMINDER_PLAN',
  'INVALID_STATUS',
]);

function isDbError(e: unknown): e is DbErrorLike {
  return typeof e === 'object' && e !== null && 'code' in e && typeof (e as DbErrorLike).code === 'string';
}

/**
 * Maps the custom SQLSTATEs raised by 0004_followup_functions.sql (and common Postgres errors)
 * to ApiError. Anything else is returned unchanged and becomes a 500.
 */
export function mapDbError(e: unknown): unknown {
  if (!isDbError(e)) return e;
  const message = e.message ?? '';
  switch (e.code) {
    case 'QN404':
      return new ApiError(404, 'NOT_FOUND', 'Follow-up not found');
    case 'QN409':
      return new ApiError(409, 'CONFLICT', `Follow-up is not in a state that allows this (${message})`, {
        reason: message,
        ...(e.details ? { currentStatus: e.details } : {}),
      });
    case 'QN422': {
      const code = UNPROCESSABLE_CODES.has(message) ? (message as ErrorCode) : 'VALIDATION_ERROR';
      return new ApiError(422, code, humanMessage(code));
    }
    case '42501':
      return new ApiError(403, 'FORBIDDEN', 'You do not have permission for this action');
    case '23505':
      return new ApiError(409, 'CONFLICT', 'A record with these details already exists');
    case '23514':
    case '22P02':
    case '22007':
    case '22008':
      return new ApiError(400, 'VALIDATION_ERROR', 'A value was rejected by the database');
    default:
      return e;
  }
}

function humanMessage(code: ErrorCode): string {
  switch (code) {
    case 'PATIENT_NEEDS_PHONE':
      return 'Pick a patient or add a new one with a phone number';
    case 'PATIENT_NOT_FOUND':
      return 'That patient does not exist';
    case 'INVALID_FOLLOWUP_DATE':
      return 'Follow-up date must be today or later';
    case 'INVALID_REMINDER_PLAN':
      return 'Reminder plan was rejected';
    case 'INVALID_STATUS':
      return 'Status can only be set to completed or cancelled';
    default:
      return 'Request could not be processed';
  }
}

/** Throws the mapped error if `error` is set. */
export function throwIfDbError(error: unknown): void {
  if (error) throw mapDbError(error);
}
