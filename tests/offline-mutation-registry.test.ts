/**
 * Phase 1 — offline mutation registry and enqueue policy gate.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  assertPendingSyncEnqueueAllowed,
  OFFLINE_SYNC_UNREGISTERED_CODE,
  OfflineEmergencyMutationBlockedError,
} from "../src/lib/offline-policy";
import {
  discoverEnqueueProducerTypesFromApiSource,
  offlineAllowProducers,
  offlineOnlineRequiredDomains,
  ORPHAN_PENDING_SYNC_TYPES,
  PRODUCTION_ENQUEUE_PRODUCER_TYPES,
  resolveAllowRegistryEntry,
  sampleEndpointForAllowEntry,
} from "../src/lib/offline-mutation-registry";

const API_SOURCE_PATH = join(process.cwd(), "src/lib/api.ts");

function readApiSource(): string {
  return readFileSync(API_SOURCE_PATH, "utf8");
}

describe("offline-mutation-registry — production enqueue producers", () => {
  it("discovers enqueue producer types from api.ts (not a static fixture list)", () => {
    const source = readApiSource();
    const discovered = discoverEnqueueProducerTypesFromApiSource(source);
    expect(discovered.size).toBeGreaterThan(0);
    // Current api.ts literals: create, update, delete, scan, seen, checkout, return_with_charge
    expect(discovered.has("create")).toBe(true);
    expect(discovered.has("scan")).toBe(true);
    expect(discovered.has("checkout")).toBe(true);
    expect(discovered.has("return_with_charge")).toBe(true);
  });

  it("every type discovered in api.ts resolves to an allow registry entry", () => {
    const discovered = discoverEnqueueProducerTypesFromApiSource(readApiSource());
    for (const pendingType of discovered) {
      const entry = offlineAllowProducers.find((e) => e.pendingType === pendingType);
      expect(entry, `registry missing discovered producer ${pendingType}`).toBeDefined();
      const endpoint = sampleEndpointForAllowEntry(entry!);
      const resolved = resolveAllowRegistryEntry({
        type: pendingType,
        method: entry!.method,
        endpoint,
      });
      expect(resolved?.key).toBe(entry!.key);
    }
  });

  it("every allow registry entry is exercised by a discovered api producer or documented sync contract", () => {
    const discovered = discoverEnqueueProducerTypesFromApiSource(readApiSource());
    for (const entry of offlineAllowProducers) {
      const endpoint = sampleEndpointForAllowEntry(entry);
      expect(
        resolveAllowRegistryEntry({
          type: entry.pendingType,
          method: entry.method,
          endpoint,
        }),
        `registry entry ${entry.key} must resolve for sample endpoint`,
      ).toBeDefined();
      if (!discovered.has(entry.pendingType) && entry.pendingType === "return") {
        // handleOptimisticMutation accepts syncType "return"; no literal call site today.
        expect(entry.key).toBe("equipment.return");
        continue;
      }
      expect(
        discovered.has(entry.pendingType),
        `registry type ${entry.pendingType} has no literal in api.ts — add call site or Phase 2 cleanup`,
      ).toBe(true);
    }
  });

  it("addPendingSync is only invoked from api.ts (single producer module)", () => {
    const source = readApiSource();
    expect(source.includes("addPendingSync(")).toBe(true);
    const offlineDbSource = readFileSync(join(process.cwd(), "src/lib/offline-db.ts"), "utf8");
    const dbCalls = (offlineDbSource.match(/addPendingSync\(/g) ?? []).length;
    expect(dbCalls).toBe(1); // export definition only
  });

  it("documents orphan PendingSyncType values for Phase 2", () => {
    expect(ORPHAN_PENDING_SYNC_TYPES).toContain("restock");
    expect(ORPHAN_PENDING_SYNC_TYPES).toContain("shift_session");
    for (const orphan of ORPHAN_PENDING_SYNC_TYPES) {
      expect(offlineAllowProducers.some((e) => e.pendingType === orphan)).toBe(false);
    }
  });

  it("production producer type union matches allow registry rows", () => {
    const registryTypes = [...new Set(offlineAllowProducers.map((e) => e.pendingType))].sort();
    expect([...PRODUCTION_ENQUEUE_PRODUCER_TYPES].sort()).toEqual(registryTypes);
    expect(registryTypes).toHaveLength(8);
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

  it("allows every type discovered from api.ts without warning", () => {
    const discovered = discoverEnqueueProducerTypesFromApiSource(readApiSource());
    for (const pendingType of discovered) {
      const entry = offlineAllowProducers.find((e) => e.pendingType === pendingType)!;
      expect(() =>
        assertPendingSyncEnqueueAllowed({
          type: pendingType,
          method: entry.method,
          endpoint: sampleEndpointForAllowEntry(entry),
        }),
      ).not.toThrow();
    }
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("emits stable structured warn payload for unregistered enqueue", () => {
    assertPendingSyncEnqueueAllowed({
      type: "scan",
      method: "POST",
      endpoint: "/api/unknown/custom",
    });
    expect(console.warn).toHaveBeenCalledWith(
      "[offline-policy] unregistered_pending_sync_enqueue",
      {
        code: OFFLINE_SYNC_UNREGISTERED_CODE,
        pendingType: "scan",
        endpoint: "/api/unknown/custom",
        method: "POST",
      },
    );
  });

  it("does not reject non-emergency paths solely because they are online-required in docs", () => {
    assertPendingSyncEnqueueAllowed({
      type: "update",
      method: "PATCH",
      endpoint: "/api/medication-tasks/task-1/complete",
    });
    expect(console.warn).toHaveBeenCalled();
  });
});
