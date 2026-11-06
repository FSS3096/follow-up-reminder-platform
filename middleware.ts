import { NextResponse, type NextRequest } from 'next/server';
import { checkOrigin } from './lib/http/origin';

export const config = { matcher: '/api/:path*' };

export function middleware(req: NextRequest) {
  const base = process.env.APP_BASE_URL;
  // If APP_BASE_URL is missing the server refuses to boot (instrumentation.ts); fall back to the request origin.
  const appOrigin = base ? new URL(base).origin : req.nextUrl.origin;
  const decision = checkOrigin({
    method: req.method,
    origin: req.headers.get('origin'),
    secFetchSite: req.headers.get('sec-fetch-site'),
    appOrigin,
  });
  if (!decision.allow) {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: 'Cross-origin requests are not allowed' } },
      { status: 403, headers: { 'Cache-Control': 'no-store', Vary: 'Origin' } },
    );
  }
  return NextResponse.next();
}
