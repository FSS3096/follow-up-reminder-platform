import type { z } from 'zod';
import { ApiError } from './errors';

const DEFAULT_MAX_BYTES = 16 * 1024;

/**
 * Reads a JSON body with a size cap and validates it with zod.
 * Throws ApiError (400/413/415) or ZodError (mapped to 400 by toErrorResponse).
 */
export async function parseJsonBody<S extends z.ZodType>(
  req: Request,
  schema: S,
  opts: { maxBytes?: number } = {},
): Promise<z.output<S>> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const contentType = req.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json');
  }
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > maxBytes) {
    throw new ApiError(413, 'PAYLOAD_TOO_LARGE', `Body must be at most ${maxBytes} bytes`);
  }
  const raw = await req.text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) {
    throw new ApiError(413, 'PAYLOAD_TOO_LARGE', `Body must be at most ${maxBytes} bytes`);
  }
  let data: unknown;
  try {
    data = raw === '' ? {} : JSON.parse(raw);
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Body is not valid JSON');
  }
  return schema.parse(data);
}

/** Validates URL search params. Repeated keys keep the last value. */
export function parseQuery<S extends z.ZodType>(req: Request, schema: S): z.output<S> {
  const params = Object.fromEntries(new URL(req.url).searchParams.entries());
  return schema.parse(params);
}

/** Validates dynamic route params (e.g. `{ id }`). */
export function parseParams<S extends z.ZodType>(params: unknown, schema: S): z.output<S> {
  return schema.parse(params);
}
