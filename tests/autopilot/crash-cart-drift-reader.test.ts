import { describe, it, expect } from "vitest";
import {
  InMemoryCrashCartDriftReader,
  InMemoryCrashCartStaleHoursConfigReader,
  CRASH_CART_CHECK_STALE_AFTER_HOURS_DEFAULT,
  clampCrashCartStaleHours,
} from "../../server/lib/autopilot/crash-cart-drift-reader.port.js";

const CLINIC_A = "clinic-a";
const CLINIC_B = "clinic-b";
const NOW = new Date("2026-07-22T12:00:00.000Z");

describe("CrashCartDriftReader (missing-item + staleness drift detection)", () => {
  it("flags missing-item drift when the most recent check has a checked:false entry, citing the failed item matched to its active vt_crash_cart_items row", async () => {
    const reader = new InMemoryCrashCartDriftReader({
      checks: [
        {
          id: "check-1",
          clinicId: CLINIC_A,
          performedAt: new Date("2026-07-22T10:00:00.000Z"),
          allPassed: false,
          itemsChecked: [
            { key: "epinephrine", label: "Epinephrine", checked: false },
            { key: "oxygen", label: "Oxygen", checked: true },
          ],
        },
      ],
      items: [
        { id: "item-epi", clinicId: CLINIC_A, key: "epinephrine", label: "Epinephrine", active: true },
        { id: "item-o2", clinicId: CLINIC_A, key: "oxygen", label: "Oxygen", active: true },
      ],
    });

    const result = await reader.read(CLINIC_A, NOW);
    expect(result.missingItemsFlagged).toBe(true);
    expect(result.failedItems).toEqual([{ key: "epinephrine", label: "Epinephrine", itemRowId: "item-epi" }]);
    expect(result.lastCheck?.id).toBe("check-1");
  });

  it("does not flag missing-item drift when the most recent check is allPassed:true", async () => {
    const reader = new InMemoryCrashCartDriftReader({
      checks: [
        {
          id: "check-2",
          clinicId: CLINIC_A,
          performedAt: NOW,
          allPassed: true,
          itemsChecked: [{ key: "oxygen", label: "Oxygen", checked: true }],
        },
      ],
      items: [{ id: "item-o2", clinicId: CLINIC_A, key: "oxygen", label: "Oxygen", active: true }],
    });

    const result = await reader.read(CLINIC_A, NOW);
    expect(result.missingItemsFlagged).toBe(false);
    expect(result.failedItems).toEqual([]);
  });

  it("flags staleness drift when the most recent check is older than the resolved threshold, citing the last check's performedAt", async () => {
    const performedAt = new Date("2026-07-21T00:00:00.000Z"); // 36h before NOW, default threshold 24h
    const reader = new InMemoryCrashCartDriftReader({
      checks: [{ id: "check-3", clinicId: CLINIC_A, performedAt, allPassed: true, itemsChecked: [] }],
      items: [],
    });

    const result = await reader.read(CLINIC_A, NOW);
    expect(result.staleFlagged).toBe(true);
    expect(result.hasNeverBeenChecked).toBe(false);
    expect(result.lastCheck?.performedAt).toEqual(performedAt);
    expect(result.thresholdHours).toBe(CRASH_CART_CHECK_STALE_AFTER_HOURS_DEFAULT);
    expect(result.hoursSinceLastCheck).toBeCloseTo(36, 5);
  });

  it("does not flag staleness drift when the most recent check is within the threshold", async () => {
    const performedAt = new Date("2026-07-22T00:00:00.000Z"); // 12h before NOW
    const reader = new InMemoryCrashCartDriftReader({
      checks: [{ id: "check-4", clinicId: CLINIC_A, performedAt, allPassed: true, itemsChecked: [] }],
      items: [],
    });

    const result = await reader.read(CLINIC_A, NOW);
    expect(result.staleFlagged).toBe(false);
  });

  it("flags staleness drift with hasNeverBeenChecked:true when no check exists ever, citing active vt_crash_cart_items rows as the only citable facts", async () => {
    const reader = new InMemoryCrashCartDriftReader({
      checks: [],
      items: [
        { id: "item-epi", clinicId: CLINIC_A, key: "epinephrine", label: "Epinephrine", active: true },
        { id: "item-o2", clinicId: CLINIC_A, key: "oxygen", label: "Oxygen", active: true },
      ],
    });

    const result = await reader.read(CLINIC_A, NOW);
    expect(result.staleFlagged).toBe(true);
    expect(result.hasNeverBeenChecked).toBe(true);
    expect(result.lastCheck).toBeNull();
    expect(result.hoursSinceLastCheck).toBeNull();
    expect(result.activeItems).toEqual([
      { id: "item-epi", key: "epinephrine", label: "Epinephrine" },
      { id: "item-o2", key: "oxygen", label: "Oxygen" },
    ]);
  });

  it("respects a per-clinic config override for the staleness threshold instead of the 24h default", async () => {
    const performedAt = new Date("2026-07-22T09:00:00.000Z"); // 3h before NOW
    const reader = new InMemoryCrashCartDriftReader({
      checks: [{ id: "check-5", clinicId: CLINIC_A, performedAt, allPassed: true, itemsChecked: [] }],
      items: [],
      staleHoursOverrides: { [CLINIC_A]: 2 }, // stricter than default — 3h since last check now counts as stale
    });

    const result = await reader.read(CLINIC_A, NOW);
    expect(result.thresholdHours).toBe(2);
    expect(result.staleFlagged).toBe(true);
  });

  it("clamps an out-of-range config override into [1, 168]", () => {
    expect(clampCrashCartStaleHours(0)).toBe(1);
    expect(clampCrashCartStaleHours(-5)).toBe(1);
    expect(clampCrashCartStaleHours(500)).toBe(168);
    expect(clampCrashCartStaleHours(48)).toBe(48);
  });

  it("InMemoryCrashCartStaleHoursConfigReader returns null for an unset clinic and a clamped value for a set one", async () => {
    const configReader = new InMemoryCrashCartStaleHoursConfigReader({ [CLINIC_A]: 500 });
    expect(await configReader.read(CLINIC_A)).toBe(168);
    expect(await configReader.read(CLINIC_B)).toBeNull();
  });

  it("never matches an inactive item into failedItems even when its key appears checked:false in the check", async () => {
    const reader = new InMemoryCrashCartDriftReader({
      checks: [
        {
          id: "check-6",
          clinicId: CLINIC_A,
          performedAt: NOW,
          allPassed: false,
          itemsChecked: [{ key: "retired_item", label: "Retired Item", checked: false }],
        },
      ],
      items: [{ id: "item-retired", clinicId: CLINIC_A, key: "retired_item", label: "Retired Item", active: false }],
    });

    const result = await reader.read(CLINIC_A, NOW);
    expect(result.missingItemsFlagged).toBe(true);
    expect(result.failedItems).toEqual([]);
  });

  it("cross-tenant negative: clinic A's checks and items are invisible to a clinic B read", async () => {
    const reader = new InMemoryCrashCartDriftReader({
      checks: [
        {
          id: "check-7",
          clinicId: CLINIC_A,
          performedAt: NOW,
          allPassed: false,
          itemsChecked: [{ key: "epinephrine", label: "Epinephrine", checked: false }],
        },
      ],
      items: [{ id: "item-epi", clinicId: CLINIC_A, key: "epinephrine", label: "Epinephrine", active: true }],
    });

    const result = await reader.read(CLINIC_B, NOW);
    expect(result.lastCheck).toBeNull();
    expect(result.activeItems).toEqual([]);
    // no check ever seen for clinic B -> staleness (never-checked) flagged, never missing-items
    expect(result.missingItemsFlagged).toBe(false);
    expect(result.hasNeverBeenChecked).toBe(true);
  });
});
