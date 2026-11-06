import { createInboundRepo } from '@/lib/data/inboundRepo';
import { withErrorHandling } from '@/lib/http/errors';
import { log } from '@/lib/log';
import { readSignedTwilioForm } from '@/lib/replies/webhook';
import { getAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

const PATH = '/api/webhooks/twilio/status';
const FAILED = new Set(['failed', 'undelivered']);

/** P1: delivery status callbacks. Only failures change state (send_failed attention). */
export const POST = withErrorHandling('webhooks.twilio.status', async (req: Request) => {
  const params = await readSignedTwilioForm(req, PATH);
  const sid = params.get('MessageSid');
  const status = (params.get('MessageStatus') ?? '').toLowerCase();
  if (sid && /^[A-Za-z0-9]{10,64}$/.test(sid) && FAILED.has(status)) {
    await createInboundRepo(getAdminClient()).markDeliveryFailed(sid, status);
    log.warn('delivery_failed', { messageSid: sid, status, errorCode: params.get('ErrorCode') });
  }
  return new Response(null, { status: 204 });
});
