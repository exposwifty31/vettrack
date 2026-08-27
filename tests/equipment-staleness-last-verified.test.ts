/**
 * S5b — equipment staleness is derived from `lastVerifiedAt`, never `lastSeen`.
 *
 * WHY: `lastSeen` is bumped by custody mutations (checkout at
 * server/services/equipment-custody-toggle.service.ts:283 and return at :448,
 * plus server/lib/equipment-seen.ts:34). So merely taking a cart off the wall
 * silently cleared its "not verified in 14 days" alert without anyone having
 * actually looked at it. `lastVerifiedAt` is written only by a real
 * verification (post-equipment-confirm-in-room, post-equipment-bulk-verify-room,
 * and the /:id/scan verify path), which is the signal the alert is about.
 *
 * Three independent derivations existed and all read `lastSeen`; this pins all
 * three to the same field and the same shared INACTIVE_THRESHOLD_DAYS window:
 *   1. src/lib/utils.ts            isInactive  → the alert bell the user sees
 *   2. server/lib/alert-reminder.ts isAlertStillActive → reminder re-open rule
 *   3. server/routes/analytics.ts   isEquipmentInactive → statusBreakdown.inactive
 *
 * Deliberately NOT reusing resolveEquipmentConfirm() from
 * src/lib/equipment-recovery-state.ts: it returns the NEWER of lastSeen and
 * lastVerifiedAt, so a checkout's lastSeen bump would still clear the alert —
 * it does not fix the bug this slice exists for.
 */
import { describe, expect, it } from "vitest";
import type { Equipment } from "@/types";
import { computeAlerts, isInactive } from "@/lib/utils";
import { isAlertStillActive } from "../server/lib/alert-reminder.js";
import { isEquipmentInactive } from "../server/routes/analytics.js";
import { INACTIVE_THRESHOLD_DAYS } from "../shared/constants.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-08-26T12:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS).toISOString();

function equipmentFixture(overrides: Partial<Equipment> = {}): Equipment {
  return {
    id: "eq-1",
    clinicId: "clinic-1",
    name: "Crash cart",
    status: "ok",
    lastStatus: "ok",
    maintenanceIntervalDays: null,
    lastMaintenanceDate: null,
    lastSterilizationDate: null,
    lastSeen: null,
    lastVerifiedAt: null,
    ...overrides,
  } as Equipment;
}

describe("client isInactive — verification, not sightings", () => {
  it("stays inactive when a checkout bumped lastSeen but nobody verified", () => {
    // The exact regression: verified 30d ago, then checked out just now, which
    // writes lastSeen. Under the old lastSeen rule this read as freshly active.
    const eq = equipmentFixture({
      lastVerifiedAt: daysAgo(30),
      lastSeen: NOW.toISOString(),
    });
    expect(isInactive(eq)).toBe(true);
  });

  it("is inactive when lastVerifiedAt is missing, even with a fresh lastSeen", () => {
    expect(isInactive(equipmentFixture({ lastSeen: NOW.toISOString() }))).toBe(true);
  });

  it("is active when verified inside the window, even with no lastSeen at all", () => {
    expect(isInactive(equipmentFixture({ lastVerifiedAt: daysAgo(1) }))).toBe(false);
  });

  it("is inactive once verification is older than the shared threshold", () => {
    expect(
      isInactive(equipmentFixture({ lastVerifiedAt: daysAgo(INACTIVE_THRESHOLD_DAYS + 1) })),
    ).toBe(true);
    expect(
      isInactive(equipmentFixture({ lastVerifiedAt: daysAgo(INACTIVE_THRESHOLD_DAYS - 1) })),
    ).toBe(false);
  });

  it("raises the inactive alert for a checked-out-but-unverified cart", () => {
    const alerts = computeAlerts([
      equipmentFixture({ lastVerifiedAt: daysAgo(30), lastSeen: NOW.toISOString() }),
    ]);
    expect(alerts.map((a) => a.type)).toEqual(["inactive"]);
  });
});

describe("server isAlertStillActive — inactive branch reads lastVerifiedAt", () => {
  const row = (overrides: Partial<Parameters<typeof isAlertStillActive>[1]> = {}) => ({
    status: "ok",
    lastMaintenanceDate: null,
    lastSterilizationDate: null,
    lastSeen: null,
    lastVerifiedAt: null,
    maintenanceIntervalDays: null,
    ...overrides,
  });

  it("keeps the ack open when only lastSeen is fresh", () => {
    expect(
      isAlertStillActive("inactive", row({ lastSeen: new Date(), lastVerifiedAt: daysAgo(30) })),
    ).toBe(true);
  });

  it("closes the ack once a real verification lands inside the window", () => {
    expect(
      isAlertStillActive("inactive", row({ lastSeen: null, lastVerifiedAt: daysAgo(1) })),
    ).toBe(false);
  });

  it("treats a never-verified unit as still inactive", () => {
    expect(isAlertStillActive("inactive", row({ lastSeen: new Date() }))).toBe(true);
  });
});

describe("analytics statusBreakdown.inactive — same field, same window", () => {
  it("counts a checked-out-but-unverified unit as inactive", () => {
    expect(
      isEquipmentInactive({ lastVerifiedAt: new Date(daysAgo(30)) }, NOW),
    ).toBe(true);
  });

  it("does not count a recently verified unit", () => {
    expect(isEquipmentInactive({ lastVerifiedAt: new Date(daysAgo(1)) }, NOW)).toBe(false);
  });

  it("counts a never-verified unit", () => {
    expect(isEquipmentInactive({ lastVerifiedAt: null }, NOW)).toBe(true);
  });

  it("agrees with the client bell on the same row", () => {
    const lastVerifiedAt = daysAgo(INACTIVE_THRESHOLD_DAYS + 1);
    expect(isEquipmentInactive({ lastVerifiedAt: new Date(lastVerifiedAt) }, NOW)).toBe(
      isInactive(equipmentFixture({ lastVerifiedAt })),
    );
  });
});
