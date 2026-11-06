import { ProviderError, type OutboundMessage, type WhatsAppProvider } from './types';

export interface TwilioSandboxConfig {
  accountSid: string;
  authToken: string;
  /** 'whatsapp:+14155238886' style. */
  from: string;
  /** Content SID of the sandbox's pre-approved Appointment Reminder template (from the Console). */
  templateContentSid: string;
  statusCallbackUrl?: string;
  fetch?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
}

export const FREE_FORM_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Twilio error codes that will not succeed on retry. */
const PERMANENT_TWILIO_CODES = new Set([21211, 21408, 21610, 21614, 63003, 63015, 63016, 63018, 63024, 63032]);

/**
 * Twilio WhatsApp Sandbox via the REST API (no SDK, so nothing extra to install).
 * Inside the 24h window opened by the patient's last inbound message: free-form body.
 * Outside it: the sandbox's pre-approved template with {{1}}=date, {{2}}=time.
 */
export class TwilioSandboxProvider implements WhatsAppProvider {
  readonly name = 'twilio_sandbox' as const;
  readonly live = true;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;

  constructor(private readonly cfg: TwilioSandboxConfig) {
    this.fetchImpl = cfg.fetch ?? fetch;
    this.now = cfg.now ?? (() => new Date());
  }

  /** Chooses free-form vs template for a message. Exposed for tests. */
  mode(msg: OutboundMessage): 'free_form' | 'template' {
    const last = msg.lastInboundAt;
    if (last && this.now().getTime() - last.getTime() < FREE_FORM_WINDOW_MS) return 'free_form';
    return 'template';
  }

  buildForm(msg: OutboundMessage): URLSearchParams {
    const form = new URLSearchParams();
    form.set('From', this.cfg.from);
    form.set('To', `whatsapp:${msg.toE164}`);
    if (this.mode(msg) === 'free_form') {
      form.set('Body', msg.body);
    } else {
      if (!msg.sandboxTemplateVars) throw new ProviderError('Template variables required outside the 24h window', false);
      form.set('ContentSid', this.cfg.templateContentSid);
      form.set('ContentVariables', JSON.stringify({ 1: msg.sandboxTemplateVars.date, 2: msg.sandboxTemplateVars.time }));
    }
    if (this.cfg.statusCallbackUrl) form.set('StatusCallback', this.cfg.statusCallbackUrl);
    return form;
  }

  async send(msg: OutboundMessage): Promise<{ sid: string }> {
    const form = this.buildForm(msg);
    const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.cfg.accountSid)}/Messages.json`;
    const auth = Buffer.from(`${this.cfg.accountSid}:${this.cfg.authToken}`).toString('base64');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs ?? 10_000);
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
        signal: controller.signal,
      });
    } catch (err) {
      const aborted = err instanceof Error && err.name === 'AbortError';
      throw new ProviderError(aborted ? 'Twilio request timed out' : 'Twilio request failed (network)', true);
    } finally {
      clearTimeout(timer);
    }

    let payload: { sid?: unknown; code?: unknown; message?: unknown } = {};
    try {
      payload = (await res.json()) as typeof payload;
    } catch {
      // non-JSON error page
    }
    if (res.ok && typeof payload.sid === 'string') return { sid: payload.sid };

    const code = typeof payload.code === 'number' ? payload.code : undefined;
    const retryable = res.status === 429 || res.status >= 500 || (code === undefined && res.ok);
    const permanent = code !== undefined && PERMANENT_TWILIO_CODES.has(code);
    // Twilio messages can contain the phone number; only the code and status go into the error.
    throw new ProviderError(`Twilio HTTP ${res.status}${code ? ` code ${code}` : ''}`, retryable && !permanent, code);
  }
}
