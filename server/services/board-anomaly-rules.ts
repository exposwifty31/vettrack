/**
 * R-BDF-1.1 — Closed, bounded anomaly-rule set over the existing board snapshot.
 *
 * A PURE rules pass (no DB, no fetch) the command-board producer calls to derive a
 * FIXED v1 closed set of EXACTLY THREE high-precision anomalies from data already in
 * the snapshot. It NEVER queries, NEVER mutates custody, and is FAIL-SAFE: missing or
 * malformed source data for a unit yields no anomaly for that unit and never throws
 * or suppresses anomalies for other units. ONE deliberate exception (owner decision,
 * 2026-08-27): a null `lastVerifiedAt` is not "missing data" but the business fact
 * "never verified", so cart_unverified FIRES on it — see `resolveCartVerifiedMs`.
 *
 * The three rules (v1 — no others; empty-dock / waitlist are a later, trust-earned
 * expansion), each with a PINNED equality boundary:
 *   - battery_critical   : battery <= critical threshold (AT the threshold FIRES); severity=pressure
 *   - cart_unverified    : crash-cart last-verified age > 7 days (STRICTLY greater; exactly 7d
 *                          does NOT fire); a NEVER-verified cart (null lastVerifiedAt) resolves
 *                          to epoch 0 and therefore FIRES; severity=calm
 *   - rfid_reader_offline: reader heartbeat age > the R-M1.1d reader-offline threshold (STRICTLY
 *                          greater; exactly at the window does NOT fire); severity=pressure
 *
 * `since` = the condition's FIRST-OBSERVED ISO instant. Where derivable from an existing
 * snapshot timestamp it is computed deterministically and survives restart/scale-out:
 *   - cart_unverified    => lastVerifiedAt + 7d (never-verified => epoch 0 + 7d)
 *   - rfid_reader_offline => lastReaderHeartbeatAt + threshold
 * `battery_critical` has NO snapshot onset, so its `since` is tracked in PROCESS-LOCAL
 * VOLATILE memory (the `(type, unitId)` absent→active transition time). Volatile means a
 * still-active battery_critical re-anchors `since` to the current observation time on
 * process restart / a fresh scale-out instance — acceptable because `since` is an advisory
 * glance-board hint, NOT an SLA/audit clock.
 *
 * Guardrail: every anomaly source is filtered by the board's `clinicId` here (mirroring the
 * clinicId-scoped queries that feed it), so a cross-clinic row derives ZERO anomalies.
 */
import { managedReaderHealthWithThreshold } from "../../shared/rfid-readers.js";
import type {
  BoardAnomaly,
  BoardAnomalySeverity,
  BoardAnomalyType,
} from "../../shared/equipment-board.js";

// The anomaly-object contract lives in the shared board contract; re-exported here so callers
// (and the RED fixtures) can import the type alongside the derivation function.
export type { BoardAnomaly, BoardAnomalySeverity, BoardAnomalyType };

/**
 * Crash-cart re-verification budget: last-verified age STRICTLY over this trips cart_unverified.
 *
 * DELIBERATELY 7d, not the fleet-wide INACTIVE_THRESHOLD_DAYS (=14) that the app's
 * staleness alert uses (shared/constants.ts). S5b aligned the two rules on the same
 * FIELD — both read `lastVerifiedAt`, so neither can be cleared by a checkout — and
 * left the WINDOW split on purpose: this is a stricter re-verification SLA on a
 * single high-stakes asset class, whereas the 14d rule is fleet-wide hygiene.
 * Widening this to 14d would weaken a crash-cart safety check; narrowing the
 * fleet-wide rule to 7d is a separate product decision, not a consistency fix.
 */
export const CART_UNVERIFIED_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Backing rows the `sourceRef` of each anomaly points at. */
const EQUIPMENT_TABLE = "vt_equipment";
const RFID_READERS_TABLE = "vt_rfid_readers";

/** Per-unit battery reading (battery_critical source). */
export interface BatteryAnomalySource {
  clinicId: string;
  equipmentId: string;
  /** 0..100; null/NaN/non-finite => fail-safe skip. */
  batteryPercent: number | null;
}

/** Per-cart last-verification (cart_unverified source). */
export interface CartAnomalySource {
  clinicId: string;
  equipmentId: string;
  /** null => NEVER verified (fires, epoch-anchored); malformed Date => fail-safe skip. */
  lastVerifiedAt: Date | null;
}

/** Per-reader heartbeat (rfid_reader_offline source). */
export interface ReaderAnomalySource {
  clinicId: string;
  readerId: string;
  /** Only "active" readers are health-checked; a deactivated reader is excluded. */
  status: string;
  /** null/invalid => fail-safe skip (no_signal, never offline). */
  lastReaderHeartbeatAt: Date | null;
}

export interface BoardAnomalyInput {
  /** The board's clinic — every source row not matching this is dropped (tenant isolation). */
  clinicId: string;
  now: Date;
  /** battery_critical threshold (percent); a reading AT this value fires. */
  batteryCriticalPercent: number;
  /** rfid_reader_offline staleness window (ms); age STRICTLY over this fires. */
  readerStalenessThresholdMs: number;
  batteries: BatteryAnomalySource[];
  carts: CartAnomalySource[];
  readers: ReaderAnomalySource[];
  /**
   * Process-local VOLATILE onset store for battery_critical (unitId -> ISO `since`).
   * Mutated in place: a newly-active unit records `now`; a still-active unit keeps its
   * original `since`; a unit whose condition cleared is removed so a reappearance gets a
   * NEW `since`. Not persisted — re-anchors on restart/scale-out by design.
   */
  batteryOnset: Map<string, string>;
}

/** A finite, in-range (0..100) battery percentage; null/NaN/±Infinity/out-of-range => fail-safe. */
function isUsablePercent(value: number | null): value is number {
  return value != null && Number.isFinite(value) && value >= 0 && value <= 100;
}

/** A real, parseable instant; null/Invalid Date => fail-safe (no timestamp). */
function isUsableDate(value: Date | null): value is Date {
  return value != null && !Number.isNaN(value.getTime());
}

/**
 * Effective last-verification instant (ms) for cart_unverified; `null` => epoch 0, which
 * KEEPS the unit flagged. An Invalid Date is the only value that skips.
 *
 * REVERSED 2026-08-27 (owner decision — Dan): a `null` lastVerifiedAt used to skip. It now
 * resolves to EPOCH 0 (maximally stale), so a NEVER-verified cart fires — the strongest form
 * of unverified. This is the substitution every other surface reading this column already
 * makes: `server/lib/alert-reminder.ts:49` (`... ? new Date(...).getTime() : 0`), and the
 * boolean equivalent in `server/routes/analytics.ts:47` / `src/lib/utils.ts:88`
 * (`if (!row.lastVerifiedAt) return true`). The board was the lone holdout.
 *
 * Epoch (not `now`) keeps `since` DETERMINISTIC and restart/scale-out-stable with no volatile
 * onset store, and makes a never-verified cart rank OLDEST in `board-anomaly-ranking.ts`
 * (which orders by `since` age, oldest first) — which is exactly what it is. A `now`-anchored
 * onset would drift forward every poll and rank newest.
 *
 * Only the NULL meaning was reversed. An Invalid Date is CORRUPT DATA, not the business fact
 * "never verified", so it stays a fail-safe skip per this module's header contract.
 */
function resolveCartVerifiedMs(value: Date | null): number | null {
  if (value == null) return 0;
  return isUsableDate(value) ? value.getTime() : null;
}

/**
 * Derive the closed v1 anomaly set for one board clinic. Pure + fail-safe: each rule is
 * evaluated per unit inside its own guard, so a malformed row yields no anomaly for that
 * unit and never affects the others. Every source row is clinicId-filtered first so a
 * cross-clinic row can never surface.
 */
export function deriveBoardAnomalies(input: BoardAnomalyInput): BoardAnomaly[] {
  const anomalies: BoardAnomaly[] = [];

  // ── battery_critical (severity=pressure; onset tracked in process-local volatile memory) ──
  // Battery has no snapshot onset, so `since` is the (type,unitId) absent→active transition
  // time held in `batteryOnset`. Track which units are STILL active this pass so cleared keys
  // (recovered or vanished) are dropped — a reappearance then earns a fresh `since`.
  const activeBatteryUnits = new Set<string>();
  for (const b of input.batteries) {
    if (b.clinicId !== input.clinicId) continue;
    if (!isUsablePercent(b.batteryPercent)) continue;
    // Equality FIRES: a reading AT the threshold is critical.
    if (b.batteryPercent > input.batteryCriticalPercent) continue;

    activeBatteryUnits.add(b.equipmentId);
    let since = input.batteryOnset.get(b.equipmentId);
    if (since == null) {
      since = input.now.toISOString();
      input.batteryOnset.set(b.equipmentId, since);
    }
    anomalies.push({
      type: "battery_critical",
      unitId: b.equipmentId,
      severity: "pressure",
      since,
      sourceRef: { table: EQUIPMENT_TABLE, id: b.equipmentId },
    });
  }
  // Drop onset entries whose condition no longer holds (recovered or absent from this snapshot).
  for (const key of input.batteryOnset.keys()) {
    if (!activeBatteryUnits.has(key)) input.batteryOnset.delete(key);
  }

  // ── cart_unverified (severity=calm; onset derivable from lastVerifiedAt + 7d) ──
  for (const c of input.carts) {
    if (c.clinicId !== input.clinicId) continue;
    // null => epoch 0 (never verified, FIRES); malformed => null (fail-safe skip).
    const lastVerifiedMs = resolveCartVerifiedMs(c.lastVerifiedAt);
    if (lastVerifiedMs == null) continue;
    const ageMs = input.now.getTime() - lastVerifiedMs;
    // STRICTLY greater: exactly 7 days old does NOT fire.
    if (ageMs <= CART_UNVERIFIED_MAX_AGE_MS) continue;
    anomalies.push({
      type: "cart_unverified",
      unitId: c.equipmentId,
      severity: "calm",
      since: new Date(lastVerifiedMs + CART_UNVERIFIED_MAX_AGE_MS).toISOString(),
      sourceRef: { table: EQUIPMENT_TABLE, id: c.equipmentId },
    });
  }

  // ── rfid_reader_offline (severity=pressure; onset derivable from heartbeat + threshold) ──
  // Reuses the R-M1.1d single-source health computation (age STRICTLY over the window ⇒ offline;
  // AT the window ⇒ online, no fire) rather than building a second producer.
  const nowMs = input.now.getTime();
  for (const r of input.readers) {
    if (r.clinicId !== input.clinicId) continue;
    if (r.status !== "active") continue; // deactivated readers are excluded from live status
    if (!isUsableDate(r.lastReaderHeartbeatAt)) continue;
    const health = managedReaderHealthWithThreshold(
      r.lastReaderHeartbeatAt.toISOString(),
      nowMs,
      input.readerStalenessThresholdMs,
    );
    if (health !== "offline") continue;
    anomalies.push({
      type: "rfid_reader_offline",
      unitId: r.readerId,
      severity: "pressure",
      since: new Date(
        r.lastReaderHeartbeatAt.getTime() + input.readerStalenessThresholdMs,
      ).toISOString(),
      sourceRef: { table: RFID_READERS_TABLE, id: r.readerId },
    });
  }

  return anomalies;
}
