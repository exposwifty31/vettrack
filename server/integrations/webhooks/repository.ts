import { eq, and, desc } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, integrationWebhookEvents } from "../../db.js";
import type { WebhookEventRow } from "../../../shared/webhook-events.js";

/** Max inbound events returned to the admin console in one page. */
const WEBHOOK_LIST_LIMIT = 100;

/**
 * Clinic-scoped inbound webhook events for the admin console. Selects ONLY the
 * safe envelope columns — the `payload` jsonb (vendor data) is never fetched, so
 * it cannot leak. Newest first.
 */
export async function listWebhookEventsForClinic(
  clinicId: string,
  opts?: { limit?: number },
): Promise<WebhookEventRow[]> {
  const limit = Math.min(opts?.limit ?? WEBHOOK_LIST_LIMIT, WEBHOOK_LIST_LIMIT);
  const rows = await db
    .select({
      id: integrationWebhookEvents.id,
      adapterId: integrationWebhookEvents.adapterId,
      status: integrationWebhookEvents.status,
      signatureValid: integrationWebhookEvents.signatureValid,
      createdAt: integrationWebhookEvents.createdAt,
      processedAt: integrationWebhookEvents.processedAt,
    })
    .from(integrationWebhookEvents)
    .where(eq(integrationWebhookEvents.clinicId, clinicId))
    .orderBy(desc(integrationWebhookEvents.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    adapterId: r.adapterId,
    status: r.status,
    signatureValid: r.signatureValid,
    createdAt: r.createdAt.toISOString(),
    processedAt: r.processedAt ? r.processedAt.toISOString() : null,
  }));
}

export async function insertWebhookEvent(params: {
  clinicId: string;
  adapterId: string;
  signatureValid: boolean;
  payload: Record<string, unknown>;
}): Promise<{ id: string }> {
  const id = nanoid();
  await db.insert(integrationWebhookEvents).values({
    id,
    clinicId: params.clinicId,
    adapterId: params.adapterId,
    signatureValid: params.signatureValid,
    payload: params.payload,
    status: params.signatureValid ? "received" : "rejected_signature",
  });
  return { id };
}

export async function getWebhookEventForClinic(
  clinicId: string,
  eventId: string,
): Promise<(typeof integrationWebhookEvents.$inferSelect) | null> {
  const [row] = await db
    .select()
    .from(integrationWebhookEvents)
    .where(and(eq(integrationWebhookEvents.clinicId, clinicId), eq(integrationWebhookEvents.id, eventId)))
    .limit(1);
  return row ?? null;
}

export async function markWebhookEventTerminal(
  eventId: string,
  status: "processed" | "failed",
): Promise<void> {
  await db
    .update(integrationWebhookEvents)
    .set({
      status,
      processedAt: new Date(),
    })
    .where(eq(integrationWebhookEvents.id, eventId));
}

export async function markWebhookReplayPending(eventId: string): Promise<void> {
  await db
    .update(integrationWebhookEvents)
    .set({
      status: "replay_pending",
      processedAt: null,
    })
    .where(eq(integrationWebhookEvents.id, eventId));
}
