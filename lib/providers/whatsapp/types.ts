export type ProviderName = 'twilio_sandbox' | 'wa_link' | 'console';

export interface OutboundMessage {
  toE164: string;
  /** Rendered by renderTemplate only. */
  body: string;
  /** Values for the Twilio sandbox pre-approved template, used outside the 24h window. */
  sandboxTemplateVars?: { date: string; time: string };
  /**
   * Extension to Brief 6.3: the patient's last inbound message time, so the sandbox provider
   * can choose free-form (inside 24h) vs template (outside). Null/undefined = never wrote.
   */
  lastInboundAt?: Date | null;
}

export interface WhatsAppProvider {
  readonly name: ProviderName;
  /** True when the provider reaches a real phone (send guards apply in full). */
  readonly live: boolean;
  send(msg: OutboundMessage): Promise<{ sid: string }>;
}

/** Thrown when a provider cannot or must not deliver. `retryable` drives the tick's backoff. */
export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly providerCode?: string | number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/** wa_link cannot send by itself: the receptionist sends from the list view. */
export class ManualSendRequired extends Error {
  constructor(public readonly link: string) {
    super('Manual send required (wa.me link)');
    this.name = 'ManualSendRequired';
  }
}
