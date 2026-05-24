/**
 * Phase 1 — offline mutation registry and enqueue policy gate.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  assertPendingSyncEnqueueAllowed,
  OFFLINE_SYNC_UNREGISTERED_CODE,
  OfflineEmergencyMutationBlockedError,
} from "../src/lib/offline-policy";
import {
  offlineAllowProducers,
  offlineOnlineRequiredDomains,
  ORPHAN_PENDING_SYNC_TYPES,
  PRODUCTION_ENQUEUE_PRODUCER_TYPES,
  resolveAllowRegistryEntry,
} from "../src/lib/offline-mutation-registry";
import type { PendingSyncType } from "../src/lib/offline-db";

const PRODUCER_FIXTURES: Array<{
  type: PendingSyncType;
  method: string;
  endpoint: string;
}> = [
  { type: "create", method: "POST", endpoint: "/api/equipment" },
  { type: "update", method: "PATCH", endpoint: "/api/equipment/eq-1" },
  { type: "delete", method: "DELETE", endpoint: "/api/equipment/eq-1" },
  { type: "scan", method: "POST", endpoint: "/api/equipment/eq-1/scan" },
  { type: "seen", method: "POST", endpoint: "/api/equipment/eq-1/seen" },
  { type: "checkout", method: "POST", endpoint: "/api/equipment/eq-1/checkout" },
  { type: "return", method: "POST", endpoint: "/api/equipment/eq-1/return" },
  { type: "return_with_charge", method: "POST", endpoint: "/api/equipment/eq-1/return" },
];

describe("offline-mutation-registry — production enqueue producers", () => {
  it("every production producer fixture resolves to an allow registry entry", () => {
    for (const fixture of PRODUCER_FIXTURES) {
      const entry = resolveAllowRegistryEntry(fixture);
      expect(entry, `missing registry for ${fixture.type} ${fixture.method} ${fixture.endpoint}`).toBeDefined();
      expect(entry?.policy).toBe("allow");
      expect(entry?.pendingType).toBe(fixture.type);
    }
  });

  it("allow registry covers exactly the eight production producer types", () => {
    const registryTypes = [...new Set(offlineAllowProducers.map((e) => e.pendingType))].sort();
    const expected = [...PRODUCTION_ENQUEUE_PRODUCER_TYPES].sort();
    expect(registryTypes).toEqual(expected);
    expect(registryTypes).toHaveLength(8);
  });

  it("documents orphan PendingSyncType values for Phase 2", () => {
    expect(ORPHAN_PENDING_SYNC_TYPES).toContain("restock");
    expect(ORPHAN_PENDING_SYNC_TYPES).toContain("shift_session");
    for (const orphan of ORPHAN_PENDING_SYNC_TYPES) {
      expect(
        offlineAllowProducers.some((e) => e.pendingType === orphan),
      ).toBe(false);
    }
  });
});

describe("offline-mutation-registry — online-required documentation", () => {
  it("online-required domains are documentation-only (no enqueue producer)", () => {
    for (const entry of offlineOnlineRequiredDomains) {
      expect(entry.policy).toBe("online-required");
      expect(entry.hasEnqueueProducer).toBe(false);
    }
  });

  it("includes Code Blue, medication, billing, authority, and dispense", () => {
    const keys = offlineOnlineRequiredDomains.map((e) => e.key);
    expect(keys).toContain("code_blue.mutations");
    expect(keys).toContain("medication.complete");
    expect(keys).toContain("billing.finalization");
    expect(keys).toContain("authority.enforcement");
    expect(keys).toContain("dispense");
  });
});

describe("offline-policy — assertPendingSyncEnqueueAllowed", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects Code Blue emergency endpoints via classifyEmergencyEndpoint", () => {
    expect(() =>
      assertPendingSyncEnqueueAllowed({
        type: "scan",
        method: "POST",
        endpoint: "/api/code-blue/sessions",
      }),
    ).toThrow(OfflineEmergencyMutationBlockedError);

    expect(() =>
      assertPendingSyncEnqueueAllowed({
        type: "checkout",
        method: "PATCH",
        endpoint: "/api/code-blue/sessions/s1/end",
      }),
    ).toThrow(OfflineEmergencyMutationBlockedError);
  });

  it("allows registered equipment producers without warning", () => {
    for (const fixture of PRODUCER_FIXTURES) {
      expect(() => assertPendingSyncEnqueueAllowed(fixture)).not.toThrow();
    }
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("warns but does not throw for unregistered enqueue", () => {
    assertPendingSyncEnqueueAllowed({
      type: "scan",
      method: "POST",
      endpoint: "/api/unknown/custom",
    });
    expect(console.warn).toHaveBeenCalledWith(
      "[offline-policy] unregistered_pending_sync_enqueue",
      expect.objectContaining({
        code: OFFLINE_SYNC_UNREGISTERED_CODE,
        type: "scan",
        endpoint: "/api/unknown/custom",
        method: "POST",
      }),
    );
  });

  it("does not reject non-emergency paths solely because they are online-required in docs", () => {
    // Medication/billing have no producer; an arbitrary equipment-like unknown still only warns.
    assertPendingSyncEnqueueAllowed({
      type: "update",
      method: "PATCH",
      endpoint: "/api/medication-tasks/task-1/complete",
    });
    expect(console.warn).toHaveBeenCalled();
  });
});
