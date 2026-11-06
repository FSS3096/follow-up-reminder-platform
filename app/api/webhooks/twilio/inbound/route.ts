import { withErrorHandling } from '@/lib/http/errors';
import { log } from '@/lib/log';
import { inboundDeps } from '@/lib/replies/deps';
import { handleInbound } from '@/lib/replies/handleInbound';
import { twiml } from '@/lib/replies/twiml';
import { parseWhatsAppFrom, readSignedTwilioForm } from '@/lib/replies/webhook';

export const dynamic = 'force-dynamic';

const PATH = '/api/webhooks/twilio/inbound';

function xml(body: string): Response {
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/xml; charset=utf-8', 'Cache-Control': 'no-store' } });
}

export const POST = withErrorHandling('webhooks.twilio.inbound', async (req: Request) => {
  const params = await readSignedTwilioForm(req, PATH);
  const from = parseWhatsAppFrom(params.get('From'));
  if (!from) {
    log.warn('inbound_bad_from', { messageSid: params.get('MessageSid') });
    return xml(twiml(null));
  }
  // The body is used to classify the reply and then dropped: never stored, never logged.
  const result = await handleInbound({ fromE164: from, body: params.get('Body') ?? '' }, inboundDeps());
  log.info('inbound', { from, messageSid: params.get('MessageSid'), intent: result.intent, action: result.action, replied: result.reply !== null });
  return xml(twiml(result.reply));
});
