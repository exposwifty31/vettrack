/**
 * Part B Phase 1 — proactive room-sweep missing-equipment alert.
 *
 * The room sweep (POST /api/docking/rooms/:roomId/sweep) leaves expected-resting
 * items it could not confirm in the `missing` reconciliation state (a `sweep_missing`
 * marker anchor). Today that only surfaces on PULL via the reconciliation `missing`
 * bucket — nothing PROACTIVELY notifies anyone. This module closes that gap: after the
 * sweep transaction commits, it raises an ALERT/WARNING realtime event on the existing
 * outbox → publisher → SSE transport AND pushes the clinic's manager tier.
 *
 * Modelled on server/workers/stale-returned-sweep.worker.ts (scan anchor state → notify
 * managers) and server/lib/rfid/reader-offline-sweep.ts (atomic state + outbox emit).
 *
 * Frozen surfaces respected:
 *  - Adds only a NEW realtime `type` string riding the existing outbox — never touches
 *    event-publisher.ts / realtime.ts.
 *  - `category`/`level` are members of the bounded realtime enums (ALERT / WARNING).
 *  - Every query and every emit is scoped by clinicId (multi-tenancy).
 *  - The audit kind `equipment_missing_alerted` is a member of the closed AuditActionType
 *    union in server/lib/audit.ts.
 */

import { randomUUID } from "crypto";
import { and, eq, gt, inArray, lt } from "drizzle-orm";
import { db, alertAcks } from "../db.js";
import { loadLocale } from "../../lib/i18n/loader.js";
import { resolve as resolveI18nKey } from "../../lib/i18n/index.js";
import { INITIAL_LOCALE } from "../../lib/i18n/types.js";
import type { Locale } from "../../lib/i18n/types.js";
import { logAudit } from "../lib/audit.js";
import { sendPushToRole, type PushPayload, type PushSendResult } from "../lib/push.js";
import { insertRealtimeDomainEvent } from "../lib/realtime-outbox.js";
import { MANAGER_NOTIFY_ROLES } from "../lib/notification-roles.js";

/** New realtime domain event `type` (rides the existing outbox → publisher → SSE). */
export const EQUIPMENT_MISSING_ALERT_EVENT = "EQUIPMENT_MISSING_ALERT";

/** vt_alert_acks.alert_type for the idempotency ledger (fits VARCHAR(30) — 19 chars). */
export const MISSING_ALERT_TYPE = "sweep_missing_alert";

// Re-alert window: an item still `missing` from a prior sweep is NOT re-alerted within this
// window, so a repeated sweep of the same room does not spam. ~half a shift, mirroring
// stale-returned's STALE_RETURNED_HOURS spirit. Env-tunable fleet-wide.
const DEDUPE_WINDOW_MS = Number(process.env.EQUIPMENT_MISSING_ALERT_DEDUPE_MS) || 4 * 3_600_000;

// vt_alert_acks.acknowledgedById / .acknowledgedByEmail are both NOT NULL with no default —
// this is a system-raised ack (no human actor), matching stale-returned's SYSTEM_USER_* pattern.
const SYSTEM_USER_ID = "system:equipment-missing";
const SYSTEM_USER_EMAIL = "equipment-missing@vettrack.system";

/**
 * Pure: the subset of swept-missing ids that have NOT been alerted within the window.
 * De-duplicates the input too (a defensive belt — the sweep loop shouldn't repeat an id).
 * No DB, no side effects — the idempotency decision in isolation.
 */
export function selectUnalertedMissing(missingIds: string[], recentlyAlerted: ReadonlySet<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of missingIds) {
    if (recentlyAlerted.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Broadcast copy resolved at INITIAL_LOCALE (Phase 6 §19 broadcast default) with English fallbacks. */
function equipmentMissingPushCopy(locale: Locale): { title: string; body: string } {
  const dict = loadLocale(locale);
  const title = resolveI18nKey(dict, "equipmentMissing.pushTitle") ?? "Equipment missing after room sweep";
  const body =
    resolveI18nKey(dict, "equipmentMissing.pushBody") ??
    "A room sweep found equipment that isn't at its station. Please locate and re-verify it.";
  return { title, body };
}

function mergeDelivery(a: PushSendResult, b: PushSendResult): PushSendResult {
  return {
    deliveredAny: a.deliveredAny || b.deliveredAny,
    transientFailures: a.transientFailures + b.transientFailures,
    invalidOrGoneCount: a.invalidOrGoneCount + b.invalidOrGoneCount,
  };
}

/** Broadcasts to the clinic's manager-tier roles (no single holder exists for a swept-missing item). */
async function notifyManagersMissing(clinicId: string, payload: PushPayload): Promise<PushSendResult> {
  let result: PushSendResult = { deliveredAny: false, transientFailures: 0, invalidOrGoneCount: 0 };
  for (const role of MANAGER_NOTIFY_ROLES) {
    const roleResult = await sendPushToRole(clinicId, role, payload);
    result = mergeDelivery(result, roleResult);
  }
  return result;
}

/**
 * Detached post-commit manager push. Fully self-contained: resolves the broadcast copy, fans out
 * to the manager tier, and swallows any failure via console.error — it NEVER throws into its caller.
 * Kicked off without `await` so a slow or failed push neither blocks the sweep HTTP response nor
 * endangers the already-committed durable alert.
 */
async function deliverManagerPushForMissing(clinicId: string, roomId: string): Promise<void> {
  try {
    const { title, body } = equipmentMissingPushCopy(INITIAL_LOCALE);
    await notifyManagersMissing(clinicId, {
      title,
      body,
      tag: `equipment-missing:${roomId}`,
      url: "/docking",
    });
  } catch (err) {
    console.error(
      "[equipment-missing-alert] manager push failed (non-fatal):",
      err instanceof Error ? err.message : err,
    );
  }
}

export interface AlertMissingParams {
  clinicId: string;
  roomId: string;
  /** The ids the sweep left in the `missing` state (sweep_missing marker) this run. */
  missingEquipmentIds: string[];
  now?: Date;
}

/**
 * Best-effort proactive alert for equipment a sweep left `missing`. Idempotent per item within
 * DEDUPE_WINDOW_MS via the durable vt_alert_acks ledger. Returns the ids this call actually claimed.
 *
 * The ack upsert is the ATOMIC CLAIM GATE. Inside one transaction we first run, per candidate id,
 * `insert(alertAcks).onConflictDoUpdate({ target: (equipmentId, alertType),
 * setWhere: acknowledgedAt < cutoff }).returning()`: a fresh insert (no prior row) returns the row;
 * an EXPIRED prior claim (acknowledgedAt < cutoff) is reclaimed in place and returns the row; a
 * still-FRESH row (a concurrent sweep just claimed it, so acknowledgedAt >= cutoff) matches nothing →
 * RETURNING is empty → this call did NOT claim that id. The outbox ALERT event is emitted for the
 * claimed ids only, and only when at least one was claimed — so two truly-concurrent sweeps of the
 * same room raise exactly one WARNING (the loser claims nothing), while the re-alert-after-window path
 * still fires because the aged ack is < cutoff. Claims + outbox commit together (reader-offline-sweep
 * pattern): if the outbox insert throws, the whole transaction (claims included) rolls back, so a lost
 * outbox write can never leave an id acked-but-unalerted.
 *
 * The manager push is DETACHED after commit: it runs in the background so a slow/failed push never
 * blocks the sweep response, and a push failure never rolls back the durable alert nor skips audit.
 * The returned `pushSettled` promise resolves once that background push has finished (it never
 * rejects — its own catch logs and swallows failures); callers may await it, or ignore it.
 *
 * Ack-vs-delivery note: unlike stale-returned (which acks only after `deliveredAny`, push being its
 * only channel), the claim commits with the outbox BEFORE push — the SSE/outbox event is the primary
 * channel and always reaches connected clients, so "we alerted" is true once the claim commits.
 */
export async function alertMissingEquipmentAfterSweep(
  params: AlertMissingParams,
): Promise<{ alerted: string[]; pushSettled: Promise<void> }> {
  const { clinicId, roomId } = params;
  const now = params.now ?? new Date();
  if (!clinicId || params.missingEquipmentIds.length === 0) return { alerted: [], pushSettled: Promise.resolve() };

  const uniqueMissing = Array.from(new Set(params.missingEquipmentIds));
  const cutoff = new Date(now.getTime() - DEDUPE_WINDOW_MS);

  // Idempotency: which of these ids were already alerted within the window. Durable +
  // multi-instance-safe (survives restarts, unlike an in-memory dedupe). Clinic-scoped.
  const recentAcks = await db
    .select({ equipmentId: alertAcks.equipmentId })
    .from(alertAcks)
    .where(
      and(
        eq(alertAcks.clinicId, clinicId),
        eq(alertAcks.alertType, MISSING_ALERT_TYPE),
        inArray(alertAcks.equipmentId, uniqueMissing),
        gt(alertAcks.acknowledgedAt, cutoff),
      ),
    );
  const recentlyAlerted = new Set(recentAcks.map((r) => r.equipmentId));
  const toAlert = selectUnalertedMissing(uniqueMissing, recentlyAlerted);
  if (toAlert.length === 0) return { alerted: [], pushSettled: Promise.resolve() };

  // The ids this transaction actually CLAIMED (see below). Declared out here so the post-commit
  // push/audit/return can gate on it — the loser of a concurrent race claims nothing.
  const claimed: string[] = [];
  await db.transaction(async (tx) => {
    // The upsert is the atomic claim gate — run it FIRST, per candidate id. `setWhere` restricts the
    // ON CONFLICT DO UPDATE to rows whose prior claim is already EXPIRED (acknowledgedAt < cutoff), and
    // RETURNING yields a row IFF this transaction claimed the id: a fresh insert (no conflict) returns
    // it; an expired prior claim is reclaimed in place and returns it; a still-fresh row (a concurrent
    // same-room sweep just claimed it, so acknowledgedAt >= cutoff) matches nothing → no row returned →
    // this sweep does NOT claim it. Concurrent sweeps serialize on the lifetime UNIQUE(equipment_id,
    // alert_type) index, so the loser claims nothing and emits no alert. Because the window filter is
    // enforced HERE (not by the pre-tx read), the reclaim can never clobber a still-valid ack.
    for (const equipmentId of toAlert) {
      const [row] = await tx
        .insert(alertAcks)
        .values({
          id: randomUUID(),
          clinicId,
          equipmentId,
          alertType: MISSING_ALERT_TYPE,
          acknowledgedById: SYSTEM_USER_ID,
          acknowledgedByEmail: SYSTEM_USER_EMAIL,
          acknowledgedAt: now,
          ackStatus: "SEEN",
        })
        .onConflictDoUpdate({
          target: [alertAcks.equipmentId, alertAcks.alertType],
          set: {
            acknowledgedById: SYSTEM_USER_ID,
            acknowledgedByEmail: SYSTEM_USER_EMAIL,
            acknowledgedAt: now,
            ackStatus: "SEEN",
          },
          setWhere: lt(alertAcks.acknowledgedAt, cutoff),
        })
        .returning({ equipmentId: alertAcks.equipmentId });
      if (row) claimed.push(row.equipmentId);
    }

    // Emit the ALERT for the CLAIMED ids only, and only if this sweep claimed at least one. The outbox
    // insert stays in the SAME transaction as the claims (reader-offline-sweep atomicity): if it throws,
    // the claims roll back too, so no id is ever left acked-but-unalerted.
    if (claimed.length > 0) {
      await insertRealtimeDomainEvent(tx, {
        clinicId,
        type: EQUIPMENT_MISSING_ALERT_EVENT,
        category: "ALERT",
        level: "WARNING",
        payload: { roomId, equipmentIds: claimed, count: claimed.length },
        occurredAt: now,
      });
    }
  });

  // Nothing claimed (e.g. a concurrent sweep won the race for every id) → no alert was emitted, so no
  // push and no audit either.
  if (claimed.length === 0) return { alerted: [], pushSettled: Promise.resolve() };

  // Detached post-commit broadcast to the manager tier — must NOT block the sweep response and must
  // never throw into it (the helper owns its own try/catch). The per-sweep tag coalesces device
  // notifications for the same room so a repeated sweep replaces rather than stacks.
  const pushSettled = deliverManagerPushForMissing(clinicId, roomId);

  // Fire-and-forget audit (append-only; deliberately outside the state-change transaction). Called
  // right after kicking off the detached push, so a push failure can never skip it.
  logAudit({
    clinicId,
    actionType: "equipment_missing_alerted",
    performedBy: SYSTEM_USER_ID,
    performedByEmail: SYSTEM_USER_EMAIL,
    targetId: roomId,
    targetType: "room",
    metadata: { roomId, count: claimed.length, equipmentIds: claimed },
  });

  return { alerted: claimed, pushSettled };
}
