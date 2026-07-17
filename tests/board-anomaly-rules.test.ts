/**
 * R-BDF-1.1 — Closed, bounded anomaly-rule set over the existing snapshot (pure pass).
 *
 * Pins the FIXED v1 closed set of EXACTLY THREE rules against the pure
 * `deriveBoardAnomalies` transform (no DB — mirrors the deriveUnitRfid / aggregateByLocation
 * contract tests). Every pinned bullet of the subspec RED is asserted here:
 *   - each rule trips => exactly ONE anomaly with the correct all-5 fields
 *     (type / unitId / severity / since / sourceRef)
 *   - a healthy clinic => none
 *   - each threshold asserted against its NAMED source (battery / 7-day age / heartbeat window)
 *   - the equality boundary per rule (battery AT threshold fires; cart exactly 7d does NOT;
 *     heartbeat exactly at the window does NOT)
 *   - `since` = the condition's first-observed instant, and `since` STABILITY (a still-active
 *     repeated snapshot keeps the ORIGINAL `since`; a cleared-then-reappeared condition gets a NEW one)
 *   - CROSS-CLINIC isolation (clinic A producer given clinic B rows => ZERO anomalies)
 *   - FAIL-SAFE missing/invalid data (null/malformed battery / lastVerifiedAt / heartbeat =>
 *     NO anomaly for that unit, never throws, never suppresses others)
 */
import { describe, it, expect } from "vitest";
import {
  deriveBoardAnomalies,
  CART_UNVERIFIED_MAX_AGE_MS,
  type BoardAnomaly,
  type BoardAnomalyInput,
} from "../server/services/board-anomaly-rules.js";
import { BATTERY_CRITICAL_PERCENT } from "../server/services/equipment-readiness-rules.service.js";
import { READER_HEARTBEAT_ONLINE_WINDOW_MS } from "../shared/rfid-readers.js";

const CLINIC = "clinic-A";
const NOW = new Date("2026-07-17T12:00:00.000Z");

function baseInput(overrides: Partial<BoardAnomalyInput> = {}): BoardAnomalyInput {
  return {
    clinicId: CLINIC,
    now: NOW,
    batteryCriticalPercent: BATTERY_CRITICAL_PERCENT,
    readerStalenessThresholdMs: READER_HEARTBEAT_ONLINE_WINDOW_MS,
    batteries: [],
    carts: [],
    readers: [],
    batteryOnset: new Map<string, string>(),
    ...overrides,
  };
}

function byType(anomalies: BoardAnomaly[], type: string): BoardAnomaly[] {
  return anomalies.filter((a) => a.type === type);
}

/** Age-out helper: a Date `ms` older than NOW. */
function agoMs(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

describe("deriveBoardAnomalies — healthy clinic", () => {
  it("derives ZERO anomalies when nothing trips", () => {
    const result = deriveBoardAnomalies(
      baseInput({
        batteries: [{ clinicId: CLINIC, equipmentId: "eq-1", batteryPercent: 80 }],
        carts: [{ clinicId: CLINIC, equipmentId: "cart-1", lastVerifiedAt: agoMs(1000) }],
        readers: [
          { clinicId: CLINIC, readerId: "rdr-1", status: "active", lastReaderHeartbeatAt: agoMs(1000) },
        ],
      }),
    );
    expect(result).toEqual([]);
  });
});

describe("deriveBoardAnomalies — battery_critical", () => {
  it("trips with all 5 fields when battery is below the threshold", () => {
    const result = deriveBoardAnomalies(
      baseInput({
        batteries: [{ clinicId: CLINIC, equipmentId: "eq-1", batteryPercent: 5 }],
      }),
    );
    const hits = byType(result, "battery_critical");
    expect(hits).toHaveLength(1);
    const a = hits[0];
    expect(a.type).toBe("battery_critical");
    expect(a.unitId).toBe("eq-1");
    expect(a.severity).toBe("pressure");
    expect(a.sourceRef).toEqual({ table: "vt_equipment", id: "eq-1" });
    // no snapshot onset => since is anchored to the observation time (now)
    expect(a.since).toBe(NOW.toISOString());
  });

  it("EQUALITY BOUNDARY: battery EXACTLY at the threshold FIRES", () => {
    const result = deriveBoardAnomalies(
      baseInput({
        batteries: [{ clinicId: CLINIC, equipmentId: "eq-1", batteryPercent: BATTERY_CRITICAL_PERCENT }],
      }),
    );
    expect(byType(result, "battery_critical")).toHaveLength(1);
  });

  it("does NOT fire one point above the threshold", () => {
    const result = deriveBoardAnomalies(
      baseInput({
        batteries: [
          { clinicId: CLINIC, equipmentId: "eq-1", batteryPercent: BATTERY_CRITICAL_PERCENT + 1 },
        ],
      }),
    );
    expect(byType(result, "battery_critical")).toHaveLength(0);
  });

  it("threshold is sourced from the readiness-rules named source (BATTERY_CRITICAL_PERCENT)", () => {
    // The rule must fire iff batteryPercent <= the named constant. Prove it tracks the source
    // value rather than a hard-coded literal by driving both sides of the constant.
    const atThreshold = deriveBoardAnomalies(
      baseInput({ batteries: [{ clinicId: CLINIC, equipmentId: "eq-1", batteryPercent: BATTERY_CRITICAL_PERCENT }] }),
    );
    const aboveThreshold = deriveBoardAnomalies(
      baseInput({ batteries: [{ clinicId: CLINIC, equipmentId: "eq-2", batteryPercent: BATTERY_CRITICAL_PERCENT + 0.01 }] }),
    );
    expect(byType(atThreshold, "battery_critical")).toHaveLength(1);
    expect(byType(aboveThreshold, "battery_critical")).toHaveLength(0);
  });

  it("since STABILITY: a still-active repeated snapshot keeps the ORIGINAL since", () => {
    const onset = new Map<string, string>();
    const first = deriveBoardAnomalies(
      baseInput({ batteryOnset: onset, batteries: [{ clinicId: CLINIC, equipmentId: "eq-1", batteryPercent: 5 }] }),
    );
    const originalSince = byType(first, "battery_critical")[0].since;

    const later = new Date(NOW.getTime() + 60_000);
    const second = deriveBoardAnomalies(
      baseInput({
        now: later,
        batteryOnset: onset,
        batteries: [{ clinicId: CLINIC, equipmentId: "eq-1", batteryPercent: 4 }],
      }),
    );
    expect(byType(second, "battery_critical")[0].since).toBe(originalSince);
  });

  it("since STABILITY: cleared-then-reappeared gets a NEW since", () => {
    const onset = new Map<string, string>();
    const first = deriveBoardAnomalies(
      baseInput({ batteryOnset: onset, batteries: [{ clinicId: CLINIC, equipmentId: "eq-1", batteryPercent: 5 }] }),
    );
    const originalSince = byType(first, "battery_critical")[0].since;

    // Recovered (above threshold) — condition clears; the onset key must be dropped.
    const recoveredAt = new Date(NOW.getTime() + 60_000);
    const recovered = deriveBoardAnomalies(
      baseInput({
        now: recoveredAt,
        batteryOnset: onset,
        batteries: [{ clinicId: CLINIC, equipmentId: "eq-1", batteryPercent: 90 }],
      }),
    );
    expect(byType(recovered, "battery_critical")).toHaveLength(0);

    // Reappears later — a fresh onset (new since), not the original.
    const reappearAt = new Date(NOW.getTime() + 120_000);
    const reappeared = deriveBoardAnomalies(
      baseInput({
        now: reappearAt,
        batteryOnset: onset,
        batteries: [{ clinicId: CLINIC, equipmentId: "eq-1", batteryPercent: 5 }],
      }),
    );
    const newSince = byType(reappeared, "battery_critical")[0].since;
    expect(newSince).toBe(reappearAt.toISOString());
    expect(newSince).not.toBe(originalSince);
  });

  it("FAIL-SAFE: null / NaN battery yields NO anomaly for that unit and does not suppress others", () => {
    const result = deriveBoardAnomalies(
      baseInput({
        batteries: [
          { clinicId: CLINIC, equipmentId: "eq-null", batteryPercent: null },
          { clinicId: CLINIC, equipmentId: "eq-nan", batteryPercent: Number.NaN },
          { clinicId: CLINIC, equipmentId: "eq-low", batteryPercent: 3 },
        ],
      }),
    );
    const hits = byType(result, "battery_critical");
    expect(hits).toHaveLength(1);
    expect(hits[0].unitId).toBe("eq-low");
  });
});

describe("deriveBoardAnomalies — cart_unverified", () => {
  it("trips with all 5 fields when last-verified age is over 7 days", () => {
    const lastVerifiedAt = agoMs(CART_UNVERIFIED_MAX_AGE_MS + 60_000); // 7d + 1min old
    const result = deriveBoardAnomalies(
      baseInput({ carts: [{ clinicId: CLINIC, equipmentId: "cart-1", lastVerifiedAt }] }),
    );
    const hits = byType(result, "cart_unverified");
    expect(hits).toHaveLength(1);
    const a = hits[0];
    expect(a.type).toBe("cart_unverified");
    expect(a.unitId).toBe("cart-1");
    expect(a.severity).toBe("calm");
    expect(a.sourceRef).toEqual({ table: "vt_equipment", id: "cart-1" });
    // since = lastVerifiedAt + 7d (deterministic onset, derivable from the snapshot timestamp)
    expect(a.since).toBe(new Date(lastVerifiedAt.getTime() + CART_UNVERIFIED_MAX_AGE_MS).toISOString());
  });

  it("EQUALITY BOUNDARY: last-verified EXACTLY 7 days ago does NOT fire (strictly greater)", () => {
    const lastVerifiedAt = agoMs(CART_UNVERIFIED_MAX_AGE_MS); // exactly 7d
    const result = deriveBoardAnomalies(
      baseInput({ carts: [{ clinicId: CLINIC, equipmentId: "cart-1", lastVerifiedAt }] }),
    );
    expect(byType(result, "cart_unverified")).toHaveLength(0);
  });

  it("fires one millisecond past the 7-day boundary", () => {
    const lastVerifiedAt = agoMs(CART_UNVERIFIED_MAX_AGE_MS + 1);
    const result = deriveBoardAnomalies(
      baseInput({ carts: [{ clinicId: CLINIC, equipmentId: "cart-1", lastVerifiedAt }] }),
    );
    expect(byType(result, "cart_unverified")).toHaveLength(1);
  });

  it("threshold is the named 7-day source (CART_UNVERIFIED_MAX_AGE_MS)", () => {
    expect(CART_UNVERIFIED_MAX_AGE_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("since STABILITY: same lastVerifiedAt across snapshots keeps the same since; re-verify => new since", () => {
    const v1 = agoMs(CART_UNVERIFIED_MAX_AGE_MS + 60_000);
    const snap1 = deriveBoardAnomalies(
      baseInput({ carts: [{ clinicId: CLINIC, equipmentId: "cart-1", lastVerifiedAt: v1 }] }),
    );
    const since1 = byType(snap1, "cart_unverified")[0].since;

    // Same lastVerifiedAt on a later snapshot => the SAME onset-derived since (stability).
    const snap2 = deriveBoardAnomalies(
      baseInput({ now: new Date(NOW.getTime() + 5000), carts: [{ clinicId: CLINIC, equipmentId: "cart-1", lastVerifiedAt: v1 }] }),
    );
    expect(byType(snap2, "cart_unverified")[0].since).toBe(since1);

    // Re-verified — a NEWER lastVerifiedAt still past the 7-day budget — earns a NEW, later
    // since anchored to the new verification instant (since = lastVerifiedAt + 7d).
    const v2 = agoMs(CART_UNVERIFIED_MAX_AGE_MS + 30_000); // 30s past threshold, newer than v1
    const snap3 = deriveBoardAnomalies(
      baseInput({ carts: [{ clinicId: CLINIC, equipmentId: "cart-1", lastVerifiedAt: v2 }] }),
    );
    const since3 = byType(snap3, "cart_unverified")[0].since;
    expect(since3).toBe(new Date(v2.getTime() + CART_UNVERIFIED_MAX_AGE_MS).toISOString());
    expect(since3).not.toBe(since1);
    expect(new Date(since3).getTime()).toBeGreaterThan(new Date(since1).getTime());
  });

  it("FAIL-SAFE: null / invalid lastVerifiedAt yields NO anomaly and does not suppress others", () => {
    const stale = agoMs(CART_UNVERIFIED_MAX_AGE_MS + 60_000);
    const result = deriveBoardAnomalies(
      baseInput({
        carts: [
          { clinicId: CLINIC, equipmentId: "cart-null", lastVerifiedAt: null },
          { clinicId: CLINIC, equipmentId: "cart-bad", lastVerifiedAt: new Date("not-a-date") },
          { clinicId: CLINIC, equipmentId: "cart-stale", lastVerifiedAt: stale },
        ],
      }),
    );
    const hits = byType(result, "cart_unverified");
    expect(hits).toHaveLength(1);
    expect(hits[0].unitId).toBe("cart-stale");
  });
});

describe("deriveBoardAnomalies — rfid_reader_offline", () => {
  it("trips with all 5 fields when heartbeat age is over the threshold", () => {
    const heartbeat = agoMs(READER_HEARTBEAT_ONLINE_WINDOW_MS + 60_000);
    const result = deriveBoardAnomalies(
      baseInput({
        readers: [{ clinicId: CLINIC, readerId: "rdr-1", status: "active", lastReaderHeartbeatAt: heartbeat }],
      }),
    );
    const hits = byType(result, "rfid_reader_offline");
    expect(hits).toHaveLength(1);
    const a = hits[0];
    expect(a.type).toBe("rfid_reader_offline");
    expect(a.unitId).toBe("rdr-1");
    expect(a.severity).toBe("pressure");
    expect(a.sourceRef).toEqual({ table: "vt_rfid_readers", id: "rdr-1" });
    // since = lastReaderHeartbeatAt + threshold (deterministic onset from the snapshot timestamp)
    expect(a.since).toBe(
      new Date(heartbeat.getTime() + READER_HEARTBEAT_ONLINE_WINDOW_MS).toISOString(),
    );
  });

  it("EQUALITY BOUNDARY: heartbeat EXACTLY at the window does NOT fire (strictly greater)", () => {
    const heartbeat = agoMs(READER_HEARTBEAT_ONLINE_WINDOW_MS); // exactly at window
    const result = deriveBoardAnomalies(
      baseInput({
        readers: [{ clinicId: CLINIC, readerId: "rdr-1", status: "active", lastReaderHeartbeatAt: heartbeat }],
      }),
    );
    expect(byType(result, "rfid_reader_offline")).toHaveLength(0);
  });

  it("fires one millisecond past the window", () => {
    const heartbeat = agoMs(READER_HEARTBEAT_ONLINE_WINDOW_MS + 1);
    const result = deriveBoardAnomalies(
      baseInput({
        readers: [{ clinicId: CLINIC, readerId: "rdr-1", status: "active", lastReaderHeartbeatAt: heartbeat }],
      }),
    );
    expect(byType(result, "rfid_reader_offline")).toHaveLength(1);
  });

  it("threshold is the R-M1.1d named source (READER_HEARTBEAT_ONLINE_WINDOW_MS)", () => {
    expect(READER_HEARTBEAT_ONLINE_WINDOW_MS).toBe(5 * 60 * 1000);
  });

  it("a DEACTIVATED reader is excluded from live status (no anomaly)", () => {
    const heartbeat = agoMs(READER_HEARTBEAT_ONLINE_WINDOW_MS + 60_000);
    const result = deriveBoardAnomalies(
      baseInput({
        readers: [{ clinicId: CLINIC, readerId: "rdr-1", status: "inactive", lastReaderHeartbeatAt: heartbeat }],
      }),
    );
    expect(byType(result, "rfid_reader_offline")).toHaveLength(0);
  });

  it("FAIL-SAFE: null / invalid heartbeat yields NO anomaly and does not suppress others", () => {
    const stale = agoMs(READER_HEARTBEAT_ONLINE_WINDOW_MS + 60_000);
    const result = deriveBoardAnomalies(
      baseInput({
        readers: [
          { clinicId: CLINIC, readerId: "rdr-null", status: "active", lastReaderHeartbeatAt: null },
          { clinicId: CLINIC, readerId: "rdr-bad", status: "active", lastReaderHeartbeatAt: new Date("nope") },
          { clinicId: CLINIC, readerId: "rdr-stale", status: "active", lastReaderHeartbeatAt: stale },
        ],
      }),
    );
    const hits = byType(result, "rfid_reader_offline");
    expect(hits).toHaveLength(1);
    expect(hits[0].unitId).toBe("rdr-stale");
  });
});

describe("deriveBoardAnomalies — cross-clinic isolation", () => {
  it("clinic A's producer given clinic B's tripping rows derives ZERO anomalies", () => {
    const staleCart = agoMs(CART_UNVERIFIED_MAX_AGE_MS + 60_000);
    const staleHeartbeat = agoMs(READER_HEARTBEAT_ONLINE_WINDOW_MS + 60_000);
    const result = deriveBoardAnomalies(
      baseInput({
        clinicId: "clinic-A",
        batteries: [{ clinicId: "clinic-B", equipmentId: "eq-1", batteryPercent: 1 }],
        carts: [{ clinicId: "clinic-B", equipmentId: "cart-1", lastVerifiedAt: staleCart }],
        readers: [
          { clinicId: "clinic-B", readerId: "rdr-1", status: "active", lastReaderHeartbeatAt: staleHeartbeat },
        ],
      }),
    );
    expect(result).toEqual([]);
  });

  it("mixed-clinic sources only surface the board clinic's anomalies", () => {
    const result = deriveBoardAnomalies(
      baseInput({
        clinicId: "clinic-A",
        batteries: [
          { clinicId: "clinic-A", equipmentId: "eq-A", batteryPercent: 2 },
          { clinicId: "clinic-B", equipmentId: "eq-B", batteryPercent: 2 },
        ],
      }),
    );
    const hits = byType(result, "battery_critical");
    expect(hits).toHaveLength(1);
    expect(hits[0].unitId).toBe("eq-A");
  });
});

describe("deriveBoardAnomalies — all three rules together", () => {
  it("derives exactly one anomaly per tripping rule", () => {
    const result = deriveBoardAnomalies(
      baseInput({
        batteries: [{ clinicId: CLINIC, equipmentId: "eq-1", batteryPercent: 5 }],
        carts: [
          { clinicId: CLINIC, equipmentId: "cart-1", lastVerifiedAt: agoMs(CART_UNVERIFIED_MAX_AGE_MS + 60_000) },
        ],
        readers: [
          {
            clinicId: CLINIC,
            readerId: "rdr-1",
            status: "active",
            lastReaderHeartbeatAt: agoMs(READER_HEARTBEAT_ONLINE_WINDOW_MS + 60_000),
          },
        ],
      }),
    );
    expect(result).toHaveLength(3);
    expect(new Set(result.map((a) => a.type))).toEqual(
      new Set(["battery_critical", "cart_unverified", "rfid_reader_offline"]),
    );
  });

  it("never throws on a fully-malformed input batch and derives an EMPTY set", () => {
    let result: BoardAnomaly[] | undefined;
    expect(() => {
      result = deriveBoardAnomalies(
        baseInput({
          batteries: [{ clinicId: CLINIC, equipmentId: "eq-1", batteryPercent: Number.NaN }],
          carts: [{ clinicId: CLINIC, equipmentId: "cart-1", lastVerifiedAt: new Date("x") }],
          readers: [{ clinicId: CLINIC, readerId: "rdr-1", status: "active", lastReaderHeartbeatAt: null }],
        }),
      );
    }).not.toThrow();
    // Each malformed row fail-safes to NO anomaly, so the batch yields [] — never a false alert.
    expect(result).toEqual([]);
  });
});
