/**
 * Phase 1–2 — offline mutation registry and enqueue policy gate.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  assertPendingSyncEnqueueAllowed,
  OFFLINE_SYNC_UNREGISTERED_CODE,
  OfflineEmergencyMutationBlockedError,
  UnknownOfflineMutationError,
} from "../src/lib/offline-policy";
import {
  discoverEnqueueProducerTypesFromApiSource,
  offlineAllowProducers,
  offlineOnlineRequiredDomains,
  PRODUCTION_ENQUEUE_PRODUCER_TYPES,
  resolveAllowRegistryEntry,
  sampleEndpointForAllowEntry,
} from "../src/lib/offline-mutation-registry";
import type { PendingSyncType } from "../src/lib/offline-db";

const API_SOURCE_PATH = join(process.cwd(), "src/lib/api.ts");

function readApiSource(): string {
  return readFileSync(API_SOURCE_PATH, "utf8");
}

describe("offline-mutation-registry — production enqueue producers", () => {
  it("discovers enqueue producer types from api.ts (not a static fixture list)", () => {
    const discovered = discoverEnqueueProducerTypesFromApiSource(readApiSource());
    expect(discovered.size).toBeGreaterThan(0);
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
        expect(entry.key).toBe("equipment.return");
        continue;
      }
      expect(
        discovered.has(entry.pendingType),
        `registry type ${entry.pendingType} has no literal in api.ts`,
      ).toBe(true);
    }
  });

  it("addPendingSync is only invoked from api.ts (single producer module)", () => {
    const source = readApiSource();
    expect(source.includes("addPendingSync(")).toBe(true);
    const offlineDbSource = readFileSync(join(process.cwd(), "src/lib/offline-db.ts"), "utf8");
    const dbCalls = (offlineDbSource.match(/addPendingSync\(/g) ?? []).length;
    expect(dbCalls).toBe(1);
  });

  it("PendingSyncType union matches registry producer types (no orphans)", () => {
    const pendingSyncSource = readFileSync(join(process.cwd(), "src/lib/offline-db.ts"), "utf8");
    expect(pendingSyncSource).not.toMatch(/["']restock["']/);
    expect(pendingSyncSource).not.toMatch(/["']shift_session["']/);
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

  it("allows every type discovered from api.ts", () => {
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
  });

  it("throws UnknownOfflineMutationError with structured payload for unregistered enqueue", () => {
    expect(() =>
      assertPendingSyncEnqueueAllowed({
        type: "scan",
        method: "POST",
        endpoint: "/api/unknown/custom",
      }),
    ).toThrow(UnknownOfflineMutationError);

    try {
      assertPendingSyncEnqueueAllowed({
        type: "scan",
        method: "POST",
        endpoint: "/api/unknown/custom",
      });
    } catch (err) {
      expect(err).toBeInstanceOf(UnknownOfflineMutationError);
      const error = err as UnknownOfflineMutationError;
      expect(error.payload).toEqual({
        code: OFFLINE_SYNC_UNREGISTERED_CODE,
        pendingType: "scan",
        endpoint: "/api/unknown/custom",
        method: "POST",
      });
    }
  });

  it("does not reject non-emergency paths solely because they are online-required in docs", () => {
    expect(() =>
      assertPendingSyncEnqueueAllowed({
        type: "update",
        method: "PATCH",
        endpoint: "/api/medication-tasks/task-1/complete",
      }),
    ).toThrow(UnknownOfflineMutationError);
  });
});

describe("offline-policy — registered producer types", () => {
  const registeredTypes: PendingSyncType[] = [
    "checkout",
    "return",
    "return_with_charge",
    "scan",
    "seen",
    "create",
    "update",
    "delete",
  ];

  it.each(registeredTypes)("allows registered producer %s", (pendingType) => {
    const entry = offlineAllowProducers.find((e) => e.pendingType === pendingType);
    expect(entry).toBeDefined();
    expect(() =>
      assertPendingSyncEnqueueAllowed({
        type: pendingType,
        method: entry!.method,
        endpoint: sampleEndpointForAllowEntry(entry!),
      }),
    ).not.toThrow();
  });
});
