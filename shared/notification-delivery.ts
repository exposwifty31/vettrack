/**
 * Admin notification-delivery row (Phase 7b). A unified, clinic-scoped, read-only
 * view over push subscriptions + WhatsApp alerts. The raw target (push endpoint /
 * subscription keys / phone number / message body) NEVER crosses the wire — the
 * server masks it here. Only `maskedTarget` is exposed.
 */
export type NotificationChannel = "push" | "whatsapp";

export type NotificationDeliveryRow = {
  id: string;
  channel: NotificationChannel;
  /** Server-masked identifier — never the raw endpoint/keys/phone. */
  maskedTarget: string;
  status: string;
  createdAt: string;
};

/** Mask a phone number to its last 4 digits: "0501234567" → "••••••4567". */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return "—";
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 4) return "•".repeat(Math.max(1, digits.length));
  return "•".repeat(digits.length - 4) + digits.slice(-4);
}

/**
 * Mask a Web Push endpoint to its host + a short tail: never the full token, and
 * never the p256dh/auth keys (those are not passed in). Two subscriptions to the
 * same host are distinguishable by the tail without reconstructing the endpoint.
 */
export function maskPushEndpoint(endpoint: string | null | undefined): string {
  if (!endpoint) return "—";
  const tail = endpoint.slice(-4);
  let host = "";
  try {
    host = new URL(endpoint).host;
  } catch {
    host = "";
  }
  return host ? `${host} …${tail}` : `…${tail}`;
}
