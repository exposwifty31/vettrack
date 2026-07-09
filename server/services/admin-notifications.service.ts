import { desc, eq } from "drizzle-orm";
import { db, pushSubscriptions, whatsappAlerts } from "../db.js";
import {
  maskPhone,
  maskPushEndpoint,
  type NotificationDeliveryRow,
} from "../../shared/notification-delivery.js";

/** Max rows returned to the admin console (merged across channels). */
const NOTIFICATION_LIST_LIMIT = 100;

/**
 * Clinic-scoped notification-delivery list for the admin console. Reads push
 * subscriptions + WhatsApp alerts, selecting ONLY safe columns (never p256dh/auth,
 * never the message body / wa_url), and masks the target server-side. Merged and
 * sorted newest-first.
 */
export async function listNotificationDeliveries(clinicId: string): Promise<NotificationDeliveryRow[]> {
  const pushRows = await db
    .select({
      id: pushSubscriptions.id,
      endpoint: pushSubscriptions.endpoint,
      alertsEnabled: pushSubscriptions.alertsEnabled,
      createdAt: pushSubscriptions.createdAt,
    })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.clinicId, clinicId))
    .orderBy(desc(pushSubscriptions.createdAt))
    .limit(NOTIFICATION_LIST_LIMIT);

  const waRows = await db
    .select({
      id: whatsappAlerts.id,
      phoneNumber: whatsappAlerts.phoneNumber,
      status: whatsappAlerts.status,
      sentAt: whatsappAlerts.sentAt,
    })
    .from(whatsappAlerts)
    .where(eq(whatsappAlerts.clinicId, clinicId))
    .orderBy(desc(whatsappAlerts.sentAt))
    .limit(NOTIFICATION_LIST_LIMIT);

  const push: NotificationDeliveryRow[] = pushRows.map((r) => ({
    id: r.id,
    channel: "push",
    maskedTarget: maskPushEndpoint(r.endpoint),
    status: r.alertsEnabled ? "active" : "muted",
    createdAt: r.createdAt.toISOString(),
  }));

  const whatsapp: NotificationDeliveryRow[] = waRows.map((r) => ({
    id: r.id,
    channel: "whatsapp",
    maskedTarget: maskPhone(r.phoneNumber),
    status: r.status,
    createdAt: r.sentAt.toISOString(),
  }));

  return [...push, ...whatsapp]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, NOTIFICATION_LIST_LIMIT);
}
