function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c] as string);
}

/** Empty <Response/> or one canned <Message>. The text always comes from renderTemplate. */
export function twiml(message: string | null): string {
  const inner = message === null ? '' : `<Message>${escapeXml(message)}</Message>`;
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`;
}
