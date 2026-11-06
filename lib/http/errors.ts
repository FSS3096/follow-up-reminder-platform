import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { log } from '@/lib/log';

/**
 * Uniform error shape (Brief section 2):
 * { "error": { "code": "STRING_CODE", "message": "human readable", "details"?: {} } }
 */

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'INVALID_JSON'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'STAFF_NOT_FOUND'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'EMPTY'
  | 'NAME_MISSING'
  | 'PATIENT_NEEDS_PHONE'
  | 'INVALID_FOLLOWUP_DATE'
  | 'INVALID_SIGNATURE'
  | 'INTERNAL';

export interface ErrorBody {
  error: { code: ErrorCode; message: string; details?: Record<string, unknown> };
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const errors = {
  badRequest: (message: string, details?: Record<string, unknown>) =>
    new ApiError(400, 'VALIDATION_ERROR', message, details),
  unauthenticated: () => new ApiError(401, 'UNAUTHENTICATED', 'Sign in required'),
  forbidden: (message = 'You do not have permission for this action') => new ApiError(403, 'FORBIDDEN', message),
  notFound: (what = 'Resource') => new ApiError(404, 'NOT_FOUND', `${what} not found`),
  conflict: (message: string, details?: Record<string, unknown>) => new ApiError(409, 'CONFLICT', message, details),
  unprocessable: (code: ErrorCode, message: string, details?: Record<string, unknown>) =>
    new ApiError(422, code, message, details),
  rateLimited: (retryAfterSeconds: number) =>
    new ApiError(429, 'RATE_LIMITED', 'Too many requests, slow down', { retryAfterSeconds }),
};

export function errorResponse(status: number, body: ErrorBody, headers?: HeadersInit): NextResponse<ErrorBody> {
  return NextResponse.json(body, { status, headers });
}

function zodDetails(err: ZodError): Record<string, unknown> {
  // Paths and messages only; never echo received input values.
  return {
    issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message, code: i.code })),
  };
}

/** Converts anything thrown inside a route handler into the standard error response. */
export function toErrorResponse(err: unknown, context: { route?: string } = {}): NextResponse<ErrorBody> {
  if (err instanceof ApiError) {
    const headers: Record<string, string> = {};
    if (err.code === 'RATE_LIMITED' && typeof err.details?.retryAfterSeconds === 'number') {
      headers['Retry-After'] = String(err.details.retryAfterSeconds);
    }
    return errorResponse(
      err.status,
      { error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } },
      headers,
    );
  }
  if (err instanceof ZodError) {
    return errorResponse(400, {
      error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', details: zodDetails(err) },
    });
  }
  log.error('unhandled_error', { route: context.route, err });
  return errorResponse(500, { error: { code: 'INTERNAL', message: 'Something went wrong' } });
}

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;

/** Wraps a route handler so every failure leaves in the standard error shape. */
export function withErrorHandling<C>(route: string, handler: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (err) {
      return toErrorResponse(err, { route });
    }
  };
}
