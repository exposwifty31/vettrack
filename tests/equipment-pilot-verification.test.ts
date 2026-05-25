/**
 * Equipment pilot verification — regression tests (#415 pilot confirm sync).
 *
 * Covers:
 *   - POST /:id/scan stamps lastVerifiedAt / lastVerifiedById only for status "ok"
 *   - Room bulk verify stamps verification fields on all items
 *   - Room radar pilot staleness bucketing (lastSeen window)
 *
 * No DB or HTTP server required.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const routeSource = fs.readFileSync(
  path.join(__dirname, "..", "server", "routes", "equipment.ts"),
  "utf8",
);

// ── Mirrors POST /:id/scan equipment update block ────────────────────────────

type StatusScanUpdates = {
  lastSeen: Date;
  lastStatus: string;
  status: string;
  lastVerifiedAt?: Date;
  lastVerifiedById?: string;
  lastMaintenanceDate?: Date;
  lastSterilizationDate?: Date;
};

function buildStatusScanUpdates(
  status: string,
  scanTime: Date,
  userId: string,
): StatusScanUpdates {
  const updates: StatusScanUpdates = {
    lastSeen: scanTime,
    lastStatus: status,
    status,
  };
  if (status === "ok") {
    updates.lastVerifiedAt = scanTime;
    updates.lastVerifiedById = userId;
  }
  if (status === "maintenance") updates.lastMaintenanceDate = scanTime;
  if (status === "sterilized") updates.lastSterilizationDate = scanTime;
  return updates;
}

// ── Mirrors room-radar pilotStaleness (lastSeen + staleMs) ───────────────────

function pilotStalenessFromLastSeen(
  lastSeen: string | null | undefined,
  staleMs: number,
  now: number,
): "never" | "stale" | "recent" {
  if (!lastSeen) return "never";
  return now - new Date(lastSeen).getTime() <= staleMs ? "recent" : "stale";
}

describe("buildStatusScanUpdates (POST /:id/scan)", () => {
  const scanTime = new Date("2026-05-24T10:00:00.000Z");
  const userId = "user-pilot-1";

  it('sets lastVerifiedAt and lastVerifiedById when status is "ok"', () => {
    const updates = buildStatusScanUpdates("ok", scanTime, userId);
    expect(updates.lastVerifiedAt).toEqual(scanTime);
    expect(updates.lastVerifiedById).toBe(userId);
    expect(updates.lastSeen).toEqual(scanTime);
  });

  it('does not set verification fields for "maintenance" scans', () => {
    const updates = buildStatusScanUpdates("maintenance", scanTime, userId);
    expect(updates).not.toHaveProperty("lastVerifiedAt");
    expect(updates).not.toHaveProperty("lastVerifiedById");
    expect(updates.lastMaintenanceDate).toEqual(scanTime);
  });

  it('does not set verification fields for "issue" scans', () => {
    const updates = buildStatusScanUpdates("issue", scanTime, userId);
    expect(updates).not.toHaveProperty("lastVerifiedAt");
    expect(updates).not.toHaveProperty("lastVerifiedById");
  });

  it('sets lastSterilizationDate for "sterilized" without verification stamp', () => {
    const updates = buildStatusScanUpdates("sterilized", scanTime, userId);
    expect(updates.lastSterilizationDate).toEqual(scanTime);
    expect(updates).not.toHaveProperty("lastVerifiedAt");
  });
});

function extractStatusScanRouteBody(): string {
  const scanRouteStart = routeSource.indexOf('"/:id/scan"');
  if (scanRouteStart < 0) throw new Error("POST /:id/scan route not found");
  const scanRouteEnd = routeSource.indexOf('router.post("/:id/quick', scanRouteStart + 1);
  return routeSource.slice(
    scanRouteStart,
    scanRouteEnd > scanRouteStart ? scanRouteEnd : scanRouteStart + 8000,
  );
}

describe("POST /:id/scan route — pilot confirm sync contract", () => {
  it("guards lastVerifiedAt behind status === ok", () => {
    const scanRouteBody = extractStatusScanRouteBody();
    expect(scanRouteBody).toContain('if (status === "ok")');
    expect(scanRouteBody).toContain("updates.lastVerifiedAt = scanTime");
    expect(scanRouteBody).toContain("updates.lastVerifiedById = req.authUser!.id");
  });

  it("always updates lastSeen on newer writes", () => {
    const scanRouteBody = extractStatusScanRouteBody();
    expect(scanRouteBody).toContain("lastSeen: scanTime");
  });
});

describe("POST room verify — bulk pilot confirmation contract", () => {
  it("stamps lastVerifiedAt, lastVerifiedById, and lastSeen for every item in room", () => {
    expect(routeSource).toContain("lastVerifiedAt: now");
    expect(routeSource).toContain("lastVerifiedById: req.authUser!.id");
    expect(routeSource).toContain("lastSeen: now");
    expect(routeSource).toContain("Room verified:");
  });

  it("scopes bulk update by clinicId and item ids", () => {
    const bulkIdx = routeSource.indexOf("// 3. Stamp every item with lastVerifiedAt");
    expect(bulkIdx).toBeGreaterThan(-1);
    const bulkSlice = routeSource.slice(bulkIdx, bulkIdx + 600);
    expect(bulkSlice).toContain("eq(equipment.clinicId, clinicId)");
    expect(bulkSlice).toContain("inArray(equipment.id, itemIds)");
  });
});

describe("room radar pilot staleness (lastSeen)", () => {
  const staleMs = 4 * 60 * 60 * 1000;
  const now = Date.parse("2026-05-24T12:00:00.000Z");

  it('returns "never" when lastSeen is absent', () => {
    expect(pilotStalenessFromLastSeen(null, staleMs, now)).toBe("never");
  });

  it('returns "recent" within stale window', () => {
    expect(pilotStalenessFromLastSeen("2026-05-24T09:00:00.000Z", staleMs, now)).toBe("recent");
  });

  it('returns "stale" beyond stale window', () => {
    expect(pilotStalenessFromLastSeen("2026-05-24T07:59:59.000Z", staleMs, now)).toBe("stale");
  });
});
