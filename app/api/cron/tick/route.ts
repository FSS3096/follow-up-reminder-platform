import { NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/http/auth';
import { withErrorHandling } from '@/lib/http/errors';
import { log } from '@/lib/log';
import { runTick } from '@/lib/reminders/tick';
import { tickDeps } from '@/lib/reminders/tickDeps';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function handle(req: Request): Promise<Response> {
  requireCronSecret(req);
  const result = await runTick(tickDeps());
  log.info('tick', { ...result });
  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
}

/** cron-job.org (primary) calls POST; the daily Vercel cron backstop calls GET with the same bearer. */
export const POST = withErrorHandling('cron.tick', handle);
export const GET = withErrorHandling('cron.tick', handle);
