/**
 * R-BDF-1.1 — Closed, bounded anomaly-rule set over the existing board snapshot.
 *
 * A PURE rules pass (no DB, no fetch) the command-board producer calls to derive a
 * FIXED v1 closed set of EXACTLY THREE high-precision anomalies from data already in
 * the snapshot. It NEVER queries, NEVER mutates custody, and is FAIL-SAFE: null or
 * malformed source data for a unit yields no anomaly for that unit and never throws
 * or suppresses anomalies for other units.
 *
 * The three rules (v1 — no others; empty-dock / waitlist are a later, trust-earned
 * expansion), each with a PINNED equality boundary:
 *   - battery_critical   : battery <= critical threshold (AT the threshold FIRES); severity=pressure
 *   - cart_unverified    : crash-cart last-verified age > 7 days (STRICTLY greater; exactly 7d
 *                          does NOT fire); severity=calm
 *   - rfid_reader_offline: reader heartbeat age > the R-M1.1d reader-offline threshold (STRICTLY
 *                          greater; exactly at the window does NOT fire); severity=pressure
 *
 * `since` = the condition's FIRST-OBSERVED ISO instant. Where derivable from an existing
 * snapshot timestamp it is computed deterministically and survives restart/scale-out:
 *   - cart_unverified    => lastVerifiedAt + 7d
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

/** Crash-cart re-verification budget: last-verified age STRICTLY over this trips cart_unverified. */
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
  /** null/invalid => fail-safe skip. */
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
    if (!isUsableDate(c.lastVerifiedAt)) continue;
    const ageMs = input.now.getTime() - c.lastVerifiedAt.getTime();
    // STRICTLY greater: exactly 7 days old does NOT fire.
    if (ageMs <= CART_UNVERIFIED_MAX_AGE_MS) continue;
    anomalies.push({
      type: "cart_unverified",
      unitId: c.equipmentId,
      severity: "calm",
      since: new Date(c.lastVerifiedAt.getTime() + CART_UNVERIFIED_MAX_AGE_MS).toISOString(),
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
