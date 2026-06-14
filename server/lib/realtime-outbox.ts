import type { AuditDbExecutor } from "./audit.js";
import { db, eventOutbox } from "../db.js";
import { REALTIME_PAYLOAD_VERSION } from "./realtime-outbox-version.js";

export type RealtimeEventLevel = "INFO" | "WARNING" | "CRITICAL";
export type RealtimeEventCategory = "TASK" | "PATIENT" | "INVENTORY" | "ALERT" | "SYSTEM";

/**
 * Inserts a domain realtime row into `vt_event_outbox` inside an existing transaction
 * (same atomic unit as the clinical write), or directly via the global `db` client when
 * called outside a transaction (fire-and-forget outbox pattern for route handlers).
 *
 * level and category are optional — they default to INFO / SYSTEM when omitted.
 * Callers should set level=WARNING or CRITICAL for alerts that drive push notifications.
 */
export async function insertRealtimeDomainEvent(
  tx: AuditDbExecutor | typeof db,
  params: {
    clinicId: string;
    type: string;
    payload: unknown;
    occurredAt?: Date;
    eventVersion?: number;
    /** Severity for client prioritisation and push mapping. Default: INFO */
    level?: RealtimeEventLevel;
    /** Domain category for filtering. Default: SYSTEM */
    category?: RealtimeEventCategory;
  },
): Promise<number | undefined> {
  const clinicId = params.clinicId.trim();
  if (!clinicId) return undefined;

  const [row] = await tx
    .insert(eventOutbox)
    .values({
      clinicId,
      type: params.type,
      payload: params.payload,
      occurredAt: params.occurredAt ?? new Date(),
      eventVersion: params.eventVersion ?? REALTIME_PAYLOAD_VERSION,
      level: params.level ?? "INFO",
      category: params.category ?? "SYSTEM",
    })
    .returning({ id: eventOutbox.id });

  return row?.id;
}
