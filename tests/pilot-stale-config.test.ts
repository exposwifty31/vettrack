/**
 * Pilot stale-ms config — regression tests (Day 12–13).
 *
 * Covers:
 *   - server/lib/pilot-config.ts parse + default
 *   - PATCH /api/pilot/config body bounds
 *   - pilot coverage summary bucketing (equipment route)
 *   - UI staleness helpers + equipment cache merge (#396)
 *
 * No DB or HTTP server required.
 */

import { describe, it, expect } from "vitest";
import {
  PILOT_STALE_MS_DEFAULT,
  parsePilotStaleMsValue,
} from "../server/lib/pilot-config.js";
import { patchConfigSchema } from "../server/routes/pilot.js";

const ONE_HOUR_MS = 60 * 60 * 1000;
const MAX_STALE_MS = 7 * 24 * ONE_HOUR_MS;

// ── Mirrors GET /api/equipment/pilot-coverage summary logic ─────────────────

type CoverageRow = { lastSeen: Date | string | null };

function computePilotCoverageSummary(rows: CoverageRow[], staleMs: number, now: number) {
  return {
    total: rows.length,
    everConfirmed: rows.filter((r) => r.lastSeen != null).length,
    confirmedToday: rows.filter(
      (r) => r.lastSeen != null && now - new Date(r.lastSeen as Date).getTime() <= staleMs,
    ).length,
    neverConfirmed: rows.filter((r) => r.lastSeen == null).length,
  };
}

// ── Mirrors admin-pilot-coverage itemStaleness ───────────────────────────────

function itemStaleness(
  lastSeen: string | null | undefined,
  staleMs: number,
  now: number,
): "never" | "stale" | "recent" {
  if (!lastSeen) return "never";
  return now - new Date(lastSeen).getTime() <= staleMs ? "recent" : "stale";
}

// ── Mirrors equipment-detail floor-note cache merge (#396) ───────────────────

type EquipmentCache = {
  id: string;
  name: string;
  usuallyFoundHere?: string | null;
  staffNote?: string | null;
  lastSeen?: string | null;
};

function mergeEquipmentCacheUpdate(
  prev: EquipmentCache | undefined,
  updated: Partial<EquipmentCache>,
): EquipmentCache | undefined {
  return prev ? { ...prev, ...updated } : prev;
}

describe("parsePilotStaleMsValue", () => {
  it("returns null for empty or invalid stored values", () => {
    expect(parsePilotStaleMsValue(undefined)).toBeNull();
    expect(parsePilotStaleMsValue("")).toBeNull();
    expect(parsePilotStaleMsValue("abc")).toBeNull();
    expect(parsePilotStaleMsValue("0")).toBeNull();
    expect(parsePilotStaleMsValue("-3600000")).toBeNull();
  });

  it("parses positive integer milliseconds", () => {
    expect(parsePilotStaleMsValue("3600000")).toBe(3_600_000);
    expect(parsePilotStaleMsValue(String(PILOT_STALE_MS_DEFAULT))).toBe(PILOT_STALE_MS_DEFAULT);
  });
});

describe("patchConfigSchema (PATCH /api/pilot/config)", () => {
  it("accepts staleMs within 1h–7d bounds", () => {
    expect(patchConfigSchema.safeParse({ staleMs: ONE_HOUR_MS }).success).toBe(true);
    expect(patchConfigSchema.safeParse({ staleMs: MAX_STALE_MS }).success).toBe(true);
    expect(patchConfigSchema.safeParse({ staleMs: PILOT_STALE_MS_DEFAULT }).success).toBe(true);
  });

  it("rejects below 1 hour and above 7 days", () => {
    expect(patchConfigSchema.safeParse({ staleMs: ONE_HOUR_MS - 1 }).success).toBe(false);
    expect(patchConfigSchema.safeParse({ staleMs: MAX_STALE_MS + 1 }).success).toBe(false);
  });

  it("rejects fractional milliseconds", () => {
    expect(patchConfigSchema.safeParse({ staleMs: ONE_HOUR_MS + 0.5 }).success).toBe(false);
  });
});

describe("pilot coverage summary bucketing", () => {
  const staleMs = 24 * ONE_HOUR_MS;
  const now = Date.parse("2026-05-23T12:00:00.000Z");

  const rows: CoverageRow[] = [
    { lastSeen: null },
    { lastSeen: "2026-05-22T12:00:00.000Z" }, // 24h ago — edge recent
    { lastSeen: "2026-05-21T11:59:59.000Z" }, // just over 24h — stale
    { lastSeen: "2026-05-20T12:00:00.000Z" },
  ];

  it("counts total, never confirmed, and within-window confirmations", () => {
    const summary = computePilotCoverageSummary(rows, staleMs, now);
    expect(summary).toEqual({
      total: 4,
      everConfirmed: 3,
      confirmedToday: 1,
      neverConfirmed: 1,
    });
  });
});

describe("itemStaleness helper", () => {
  const staleMs = 4 * 60 * 60 * 1000;
  const now = Date.parse("2026-05-23T12:00:00.000Z");

  it('returns "never" when lastSeen is absent', () => {
    expect(itemStaleness(null, staleMs, now)).toBe("never");
  });

  it('classifies within-window as "recent"', () => {
    expect(itemStaleness("2026-05-23T09:00:00.000Z", staleMs, now)).toBe("recent");
  });

  it('classifies beyond window as "stale"', () => {
    expect(itemStaleness("2026-05-23T07:59:59.000Z", staleMs, now)).toBe("stale");
  });
});

describe("equipment detail cache merge (floor note regression)", () => {
  const cached: EquipmentCache = {
    id: "eq-1",
    name: "Defibrillator",
    usuallyFoundHere: "ICU shelf",
    staffNote: "Check battery",
    lastSeen: "2026-05-23T10:00:00.000Z",
  };

  it("merges partial API update without dropping unrelated fields", () => {
    const apiResponse = { usuallyFoundHere: "Procedure room" };
    const merged = mergeEquipmentCacheUpdate(cached, apiResponse);
    expect(merged).toEqual({
      id: "eq-1",
      name: "Defibrillator",
      usuallyFoundHere: "Procedure room",
      staffNote: "Check battery",
      lastSeen: "2026-05-23T10:00:00.000Z",
    });
  });

  it("leaves cache undefined when there was no prior entry", () => {
    expect(mergeEquipmentCacheUpdate(undefined, { usuallyFoundHere: "ICU" })).toBeUndefined();
  });
});

describe("pilot_config_updated audit kind", () => {
  it("is a member of the closed AuditActionType union", async () => {
    const mod = await import("../server/lib/audit.js");
    type AuditActionType = Parameters<typeof mod.logAudit>[0]["actionType"];
    const kind: AuditActionType = "pilot_config_updated";
    expect(kind).toBe("pilot_config_updated");
  });
});
