import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/** Unknown /api paths answer in the standard error shape instead of an HTML 404 page. */
function notFound() {
  return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'No such API route' } }, { status: 404 });
}

export const GET = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
