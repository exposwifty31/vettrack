/**
 * R-CBF-1.2 — Code Blue soft-reserve (additive custody hint, compare-and-set).
 *
 * A crash-cart's `vt_equipment.reservedForSessionId` is a nullable ADVISORY hint
 * that an active Code Blue session has claimed it as its nearest-ready cart. It
 * NEVER blocks a clinician grabbing a different cart and does not touch
 * custody-toggle semantics.
 *
 * - Reserve is compare-and-set: write only where `reservedForSessionId IS NULL`.
 * - On a CAS miss (another session reserved it first) the loser re-resolves to
 *   the next eligible ready cart and never overwrites; if none remain it returns
 *   an explicit `no_cart_available` signal (the session still starts — the
 *   reservation is advisory).
 * - Cleanup (a failed OR ended session) clears ONLY its own reservation, scoped
 *   by session id, never another session's.
 *
 * Frozen Code Blue doctrine: additive column; no change to custody-toggle
 * semantics; every query is clinic-scoped.
 */
import { and, eq, isNull } from "drizzle-orm";
import { db, equipment } from "../db.js";
import type { AuditDbExecutor } from "./audit.js";

/** Accepts the app pool or an open transaction (compose inside R-CBF-1.1's txn). */
type DbExecutor = AuditDbExecutor | typeof db;

export type SoftReserveResult =
  | { reserved: true; cartId: string }
  | { reserved: false; reason: "no_cart_available" };

/**
 * Storage port for the soft-reserve compare-and-set primitive. The Drizzle
 * implementation issues the clinic-scoped, CAS-guarded SQL; tests inject a
 * faithful in-memory model of the same semantics.
 */
export interface CartReservationStore {
  /**
   * Compare-and-set: reserve `cartId` for `sessionId` only where its
   * `reservedForSessionId` is currently NULL and the row is in `clinicId`.
   * Returns true iff THIS call set the reservation.
   */
  compareAndReserve(clinicId: string, cartId: string, sessionId: string): Promise<boolean>;
  /** Clear `reservedForSessionId` for rows currently equal to `sessionId`, in `clinicId` only. */
  clearBySession(clinicId: string, sessionId: string): Promise<void>;
}

export class DrizzleCartReservationStore implements CartReservationStore {
  private readonly executor: DbExecutor;

  constructor(executor: DbExecutor = db) {
    this.executor = executor;
  }

  async compareAndReserve(clinicId: string, cartId: string, sessionId: string): Promise<boolean> {
    const updated = await this.executor
      .update(equipment)
      .set({ reservedForSessionId: sessionId })
      .where(
        and(
          eq(equipment.clinicId, clinicId),
          eq(equipment.id, cartId),
          isNull(equipment.reservedForSessionId),
        ),
      )
      .returning({ id: equipment.id });
    return updated.length > 0;
  }

  async clearBySession(clinicId: string, sessionId: string): Promise<void> {
    await this.executor
      .update(equipment)
      .set({ reservedForSessionId: null })
      .where(
        and(
          eq(equipment.clinicId, clinicId),
          eq(equipment.reservedForSessionId, sessionId),
        ),
      );
  }
}

/**
 * Try each candidate cart in order; the first successful compare-and-set wins.
 * A loser (CAS miss) advances to the next eligible cart and never overwrites.
 * If no candidate could be reserved, returns `no_cart_available` — the caller
 * still starts the session (the reservation is advisory, not a gate).
 */
export async function reserveNearestReadyCart(
  store: CartReservationStore,
  clinicId: string,
  sessionId: string,
  candidateCartIds: readonly string[],
): Promise<SoftReserveResult> {
  for (const cartId of candidateCartIds) {
    const won = await store.compareAndReserve(clinicId, cartId, sessionId);
    if (won) return { reserved: true, cartId };
  }
  return { reserved: false, reason: "no_cart_available" };
}

/**
 * Clear a session's advisory reservation (failed OR ended session). Scoped by
 * session id + clinic, so it never clears another session's reservation.
 */
export async function clearReservationForSession(
  store: CartReservationStore,
  clinicId: string,
  sessionId: string,
): Promise<void> {
  await store.clearBySession(clinicId, sessionId);
}
