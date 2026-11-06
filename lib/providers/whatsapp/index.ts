import { getServerEnv, type ServerEnv } from '@/lib/env';
import { ConsoleProvider } from './consoleProvider';
import { TwilioSandboxProvider } from './twilioSandbox';
import type { WhatsAppProvider } from './types';
import { WaLinkProvider } from './waLink';

export * from './types';
export { checkSendGuards, SEED_PHONE, ACTIVE_STATUSES } from './guards';
export { buildWaLink, WaLinkProvider } from './waLink';
export { ConsoleProvider } from './consoleProvider';
export { TwilioSandboxProvider } from './twilioSandbox';

export function createProvider(env: ServerEnv): WhatsAppProvider {
  switch (env.MESSAGE_PROVIDER) {
    case 'twilio_sandbox':
      // env.ts guarantees these are present when MESSAGE_PROVIDER=twilio_sandbox.
      return new TwilioSandboxProvider({
        accountSid: env.TWILIO_ACCOUNT_SID as string,
        authToken: env.TWILIO_AUTH_TOKEN as string,
        from: env.TWILIO_WHATSAPP_FROM as string,
        templateContentSid: env.TWILIO_SANDBOX_TEMPLATE_CONTENT_SID as string,
        statusCallbackUrl: `${env.APP_BASE_URL}/api/webhooks/twilio/status`,
      });
    case 'wa_link':
      return new WaLinkProvider();
    case 'console':
      return new ConsoleProvider();
  }
}

let cached: WhatsAppProvider | undefined;
export function getProvider(): WhatsAppProvider {
  cached ??= createProvider(getServerEnv());
  return cached;
}
