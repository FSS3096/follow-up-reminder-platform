/**
 * wa.me click-to-send link for the receptionist (Brief 6.3 fallback). No API call, no join,
 * no template restrictions. The body must come from renderTemplate.
 */
export function buildWaLink(phoneE164: string, body: string): string {
  const digits = phoneE164.replace(/\D/g, '');
  if (!/^[1-9]\d{9,14}$/.test(digits)) throw new RangeError('phone must be E.164');
  return `https://wa.me/${digits}?text=${encodeURIComponent(body)}`;
}
