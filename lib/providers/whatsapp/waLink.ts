import { ManualSendRequired, type OutboundMessage, type WhatsAppProvider } from './types';

/**
 * wa.me click-to-send link for the receptionist (Brief 6.3 fallback). No API call, no join,
 * no template restrictions. The body must come from renderTemplate.
 */
export function buildWaLink(phoneE164: string, body: string): string {
  const digits = phoneE164.replace(/\D/g, '');
  if (!/^[1-9]\d{9,14}$/.test(digits)) throw new RangeError('phone must be E.164');
  return `https://wa.me/${digits}?text=${encodeURIComponent(body)}`;
}

/** Never sends. The tick records the reminder as skipped/manual_send; the list view carries the link. */
export class WaLinkProvider implements WhatsAppProvider {
  readonly name = 'wa_link' as const;
  readonly live = false;
  async send(msg: OutboundMessage): Promise<{ sid: string }> {
    throw new ManualSendRequired(buildWaLink(msg.toE164, msg.body));
  }
}
