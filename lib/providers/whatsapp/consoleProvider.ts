import { randomUUID } from 'node:crypto';
import { log } from '@/lib/log';
import type { OutboundMessage, WhatsAppProvider } from './types';

/** Dev/test default. Logs a masked line (never the body) and pretends to send. */
export class ConsoleProvider implements WhatsAppProvider {
  readonly name = 'console' as const;
  readonly live = false;
  readonly sent: OutboundMessage[] = [];

  async send(msg: OutboundMessage): Promise<{ sid: string }> {
    const sid = `console-${randomUUID()}`;
    this.sent.push(msg);
    log.info('whatsapp_console_send', { to: msg.toE164, sid, chars: msg.body.length });
    return { sid };
  }
}
