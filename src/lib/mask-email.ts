/**
 * Masks an email for display in semi-public surfaces (e.g. account card).
 * Preserves first two local characters and full domain for recognition.
 */
export function maskEmail(email: string): string {
  const trimmed = email.trim();
  const at = trimmed.indexOf("@");
  if (at <= 0) return trimmed;
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  if (!domain) return trimmed;
  const visible = local.slice(0, Math.min(2, local.length));
  const hiddenLen = Math.max(1, local.length - visible.length);
  return `${visible}${"•".repeat(hiddenLen)}@${domain}`;
}
