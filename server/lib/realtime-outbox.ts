import type { AuditDbExecutor } from "./audit.js";
import { db, eventOutbox } from "../db.js";
import { REALTIME_PAYLOAD_VERSION } from "./realtime-outbox-version.js";

export { REALTIME_PAYLOAD_VERSION };

/**
 * Inserts a domain realtime row into `vt_event_outbox` inside an existing transaction
 * (same atomic unit as the clinical write), or directly via the global `db` client when
 * called outside a transaction (fire-and-forget outbox pattern for route handlers).
 */
export async function insertRealtimeDomainEvent(
  tx: AuditDbExecutor | typeof db,
  params: {
    clinicId: string;
    type: string;
    payload: unknown;
    occurredAt?: Date;
    eventVersion?: number;
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
    })
    .returning({ id: eventOutbox.id });

  return row?.id;
}
