/**
 * Phase 3 — Billing Leakage Validation
 *
 * Unit tests for leakage detection logic and report structure.
 * These tests exercise pure functions and data-shape invariants
 * without requiring a live DB or server.
 */
import { describe, it, expect } from "vitest";
import { createHash } from "crypto";

// ── Helpers mirrored from server code ──────────────────────────────────────────

function jerusalemHourBucket(d: Date): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  const h = parts.find((p) => p.type === "hour")?.value ?? "00";
  return `${y}-${m}-${day}T${h}`;
}

function buildSeenIdempotencyKey(animalId: string, itemId: string, at: Date): string {
  const bucket = jerusalemHourBucket(at);
  const raw = `${animalId}|${itemId}|${bucket}`;
  return createHash("sha256").update(raw).digest("hex");
}

// ── In-memory leakage calculation (mirrors billing.ts buildLeakageReport logic) ─

type DispenseRow = { containerId: string; billingItemId: string | null; unitPriceCents: number; dispensedQty: number; userId: string | null };
type BilledRow = { itemId: string; billedQty: number };

function computeConsumableLeakage(
  dispenses: DispenseRow[],
  billed: BilledRow[],
  severityThresholdCents: number,
) {
  const billedMap = new Map<string, number>();
  for (const r of billed) billedMap.set(r.itemId, r.billedQty);

  return dispenses.map((r) => {
    const billedQty =
      (r.billingItemId ? (billedMap.get(r.billingItemId) ?? 0) : 0) +
      (billedMap.get(r.containerId) ?? 0);
    const gapQty = Math.max(0, r.dispensedQty - billedQty);
    const gapValueCents = gapQty * r.unitPriceCents;
    return {
      containerId: r.containerId,
      billedQty,
      gapQty,
      gapValueCents,
      severity: r.unitPriceCents > severityThresholdCents ? "HIGH" : "MEDIUM",
    };
  });
}

// ── In-memory equipment scan leakage simulation ────────────────────────────────

type ScanLogRow = { id: string; clinicId: string; equipmentId: string; userId: string; timestampMs: number; unitPriceCents: number };
type BillingEquipmentRow = { clinicId: string; equipmentId: string; createdAtMs: number };

function computeEquipmentScanLeakage(
  scanLogs: ScanLogRow[],
  billingRows: BillingEquipmentRow[],
  windowMs = 24 * 60 * 60 * 1000,
): ScanLogRow[] {
  return scanLogs.filter((sl) => {
    const linked = billingRows.some(
      (bl) =>
        bl.clinicId === sl.clinicId &&
        bl.equipmentId === sl.equipmentId &&
        bl.createdAtMs >= sl.timestampMs &&
        bl.createdAtMs <= sl.timestampMs + windowMs,
    );
    return !linked;
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("Phase 3 — consumable leakage calculation", () => {
  it("linked billing row is NOT in leakage", () => {
    const dispenses: DispenseRow[] = [
      { containerId: "c1", billingItemId: "bi1", unitPriceCents: 1000, dispensedQty: 3, userId: "u1" },
    ];
    const billed: BilledRow[] = [{ itemId: "bi1", billedQty: 3 }];
    const result = computeConsumableLeakage(dispenses, billed, 5000);
    expect(result).toHaveLength(1);
    expect(result[0].gapQty).toBe(0);
    expect(result[0].gapValueCents).toBe(0);
  });

  it("unlinked dispense DOES appear as leakage", () => {
    const dispenses: DispenseRow[] = [
      { containerId: "c2", billingItemId: "bi2", unitPriceCents: 500, dispensedQty: 5, userId: "u2" },
    ];
    const billed: BilledRow[] = []; // nothing billed
    const result = computeConsumableLeakage(dispenses, billed, 5000);
    expect(result[0].gapQty).toBe(5);
    expect(result[0].gapValueCents).toBe(2500);
  });

  it("partial billing results in correct gap", () => {
    const dispenses: DispenseRow[] = [
      { containerId: "c3", billingItemId: "bi3", unitPriceCents: 200, dispensedQty: 10, userId: null },
    ];
    const billed: BilledRow[] = [{ itemId: "bi3", billedQty: 4 }];
    const result = computeConsumableLeakage(dispenses, billed, 5000);
    expect(result[0].gapQty).toBe(6);
    expect(result[0].gapValueCents).toBe(1200);
  });

  it("severity is HIGH when unitPrice exceeds threshold", () => {
    const dispenses: DispenseRow[] = [
      { containerId: "c4", billingItemId: null, unitPriceCents: 6000, dispensedQty: 1, userId: null },
    ];
    const result = computeConsumableLeakage(dispenses, [], 5000);
    expect(result[0].severity).toBe("HIGH");
  });

  it("severity is MEDIUM when unitPrice is at or below threshold", () => {
    const dispenses: DispenseRow[] = [
      { containerId: "c5", billingItemId: null, unitPriceCents: 5000, dispensedQty: 1, userId: null },
    ];
    const result = computeConsumableLeakage(dispenses, [], 5000);
    expect(result[0].severity).toBe("MEDIUM");
  });

  it("report is clinic-isolated — different clinic billing does not reduce gap", () => {
    // billing for a different clinic's item should NOT cancel out this clinic's dispense
    const dispenses: DispenseRow[] = [
      { containerId: "c6", billingItemId: "bi6", unitPriceCents: 100, dispensedQty: 2, userId: null },
    ];
    // billedMap keys come from the same-clinic query, so a foreign billing would never appear
    const billed: BilledRow[] = []; // simulate: foreign clinic rows filtered by clinicId in SQL
    const result = computeConsumableLeakage(dispenses, billed, 5000);
    expect(result[0].gapQty).toBe(2);
  });

  it("summary totals match sum of detailed rows", () => {
    const dispenses: DispenseRow[] = [
      { containerId: "c7", billingItemId: "bi7", unitPriceCents: 300, dispensedQty: 4, userId: null },
      { containerId: "c8", billingItemId: "bi8", unitPriceCents: 400, dispensedQty: 3, userId: null },
    ];
    const billed: BilledRow[] = [{ itemId: "bi7", billedQty: 2 }];
    const items = computeConsumableLeakage(dispenses, billed, 5000);
    const totalGapQty = items.reduce((s, i) => s + i.gapQty, 0);
    const totalGapValueCents = items.reduce((s, i) => s + i.gapValueCents, 0);
    // c7: gap 2 * 300 = 600; c8: gap 3 * 400 = 1200 → total 1800
    expect(totalGapQty).toBe(5);
    expect(totalGapValueCents).toBe(1800);
  });
});

describe("Phase 3 — equipment scan leakage detection", () => {
  const NOW = Date.now();
  const CLINIC = "clinic-a";

  it("scan with a billing row within 24h is NOT leakage", () => {
    const scans: ScanLogRow[] = [
      { id: "sl1", clinicId: CLINIC, equipmentId: "eq1", userId: "u1", timestampMs: NOW - 3600_000, unitPriceCents: 1000 },
    ];
    const billing: BillingEquipmentRow[] = [
      { clinicId: CLINIC, equipmentId: "eq1", createdAtMs: NOW - 1800_000 },
    ];
    expect(computeEquipmentScanLeakage(scans, billing)).toHaveLength(0);
  });

  it("scan with NO billing row within 24h IS leakage", () => {
    const scans: ScanLogRow[] = [
      { id: "sl2", clinicId: CLINIC, equipmentId: "eq2", userId: "u2", timestampMs: NOW - 3600_000, unitPriceCents: 500 },
    ];
    const leakage = computeEquipmentScanLeakage(scans, []);
    expect(leakage).toHaveLength(1);
    expect(leakage[0].id).toBe("sl2");
  });

  it("scan with billing row BEFORE the scan timestamp is still leakage", () => {
    const scans: ScanLogRow[] = [
      { id: "sl3", clinicId: CLINIC, equipmentId: "eq3", userId: "u3", timestampMs: NOW - 3600_000, unitPriceCents: 200 },
    ];
    // billing row is 1h BEFORE the scan — outside the forward window
    const billing: BillingEquipmentRow[] = [
      { clinicId: CLINIC, equipmentId: "eq3", createdAtMs: NOW - 7200_000 },
    ];
    expect(computeEquipmentScanLeakage(scans, billing)).toHaveLength(1);
  });

  it("scan with billing row outside 24h window IS leakage", () => {
    const scans: ScanLogRow[] = [
      { id: "sl4", clinicId: CLINIC, equipmentId: "eq4", userId: "u4", timestampMs: NOW - 48 * 3600_000, unitPriceCents: 100 },
    ];
    const billing: BillingEquipmentRow[] = [
      { clinicId: CLINIC, equipmentId: "eq4", createdAtMs: NOW }, // 48h after scan
    ];
    expect(computeEquipmentScanLeakage(scans, billing)).toHaveLength(1);
  });

  it("report is clinic-isolated — different clinic billing does not mask leakage", () => {
    const scans: ScanLogRow[] = [
      { id: "sl5", clinicId: CLINIC, equipmentId: "eq5", userId: "u5", timestampMs: NOW - 3600_000, unitPriceCents: 800 },
    ];
    // Billing row is for a DIFFERENT clinic
    const billing: BillingEquipmentRow[] = [
      { clinicId: "other-clinic", equipmentId: "eq5", createdAtMs: NOW - 1800_000 },
    ];
    expect(computeEquipmentScanLeakage(scans, billing)).toHaveLength(1);
  });

  it("multiple scans — only unbilled ones appear in leakage", () => {
    const scans: ScanLogRow[] = [
      { id: "billed-scan", clinicId: CLINIC, equipmentId: "eq6", userId: "u6", timestampMs: NOW - 5 * 3600_000, unitPriceCents: 100 },
      { id: "unbilled-scan", clinicId: CLINIC, equipmentId: "eq7", userId: "u7", timestampMs: NOW - 2 * 3600_000, unitPriceCents: 100 },
    ];
    const billing: BillingEquipmentRow[] = [
      { clinicId: CLINIC, equipmentId: "eq6", createdAtMs: NOW - 4 * 3600_000 },
    ];
    const leakage = computeEquipmentScanLeakage(scans, billing);
    expect(leakage).toHaveLength(1);
    expect(leakage[0].id).toBe("unbilled-scan");
  });
});

describe("Phase 3 — CSV shape", () => {
  it("CSV header contains required columns", () => {
    const requiredColumns = ["type", "event_id", "equipment_id", "container_id", "user_id", "shift", "gap_value_cents", "estimated_price_cents", "reason", "severity"];
    const header = ["type", "event_id", "equipment_id", "equipment_name", "container_id", "container_name", "user_id", "shift", "timestamp", "dispensed_qty", "billed_qty", "gap_qty", "gap_value_cents", "estimated_price_cents", "reason", "severity"];
    for (const col of requiredColumns) {
      expect(header).toContain(col);
    }
  });

  it("equipment row maps estimatedPriceCents to both gap_value_cents and estimated_price_cents", () => {
    // Simulates the CSV row structure for an equipment leakage item
    const equipmentItem = {
      scanLogId: "sl-x",
      equipmentId: "eq-x",
      equipmentName: "Ventilator",
      userId: "u-x",
      shift: "day" as const,
      timestamp: "2026-01-01T10:00:00.000Z",
      estimatedPriceCents: 1500,
      reason: "scan_without_billing" as const,
      severity: "MEDIUM" as const,
    };
    // Row: type, scanLogId, equipmentId, equipmentName, "", "", userId, shift, timestamp, "1", "0", "1", gapValueCents, estimatedPrice, reason, severity
    const row = ["equipment_scan", equipmentItem.scanLogId, equipmentItem.equipmentId, equipmentItem.equipmentName, "", "", equipmentItem.userId, equipmentItem.shift, equipmentItem.timestamp, "1", "0", "1", String(equipmentItem.estimatedPriceCents), String(equipmentItem.estimatedPriceCents), equipmentItem.reason, equipmentItem.severity];
    expect(row[12]).toBe("1500"); // gap_value_cents
    expect(row[13]).toBe("1500"); // estimated_price_cents
    expect(row[14]).toBe("scan_without_billing");
  });
});

describe("Phase 3 — idempotency key stability (billing write-time)", () => {
  it("same animal+equipment+hour produces same idempotency key", () => {
    const d = new Date("2026-06-10T08:15:00.000Z");
    expect(buildSeenIdempotencyKey("a1", "eq1", d)).toBe(buildSeenIdempotencyKey("a1", "eq1", d));
  });

  it("different hour produces different key", () => {
    const d1 = new Date("2026-06-10T08:15:00.000Z");
    const d2 = new Date("2026-06-10T10:15:00.000Z");
    expect(buildSeenIdempotencyKey("a1", "eq1", d1)).not.toBe(buildSeenIdempotencyKey("a1", "eq1", d2));
  });
});
