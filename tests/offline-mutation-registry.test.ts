/**
 * Phase 1–2 — offline mutation registry and enqueue policy gate.
 * E1 — producer/registry parity lock (api.ts call sites ↔ allow registry).
 */
import { readFileSync } from "fs";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertPendingSyncEnqueueAllowed,
  OFFLINE_SYNC_UNREGISTERED_CODE,
  OfflineEmergencyMutationBlockedError,
  UnknownOfflineMutationError,
} from "../src/lib/offline-policy";
import { classifyEmergencyEndpoint } from "../src/lib/offline-emergency-block";
import {
  discoverEnqueueProducerTypesFromApiSource,
  offlineAllowProducers,
  offlineOnlineRequiredDomains,
  PRODUCTION_ENQUEUE_PRODUCER_TYPES,
  resolveAllowRegistryEntry,
  sampleEndpointForAllowEntry,
} from "../src/lib/offline-mutation-registry";
import type { PendingSyncType } from "../src/lib/offline-db";

/** Code Blue emergency mutations — owned by classifyEmergencyEndpoint, not the allow registry. */
const CODE_BLUE_EMERGENCY_MUTATIONS = [
  {
    label: "POST /sessions (start)",
    url: "/api/code-blue/sessions",
    method: "POST",
    expected: "start" as const,
  },
  {
    label: "POST /sessions/:id/logs (log)",
    url: "/api/code-blue/sessions/sess-1/logs",
    method: "POST",
    expected: "log" as const,
  },
  {
    label: "PATCH /sessions/:id/end (end)",
    url: "/api/code-blue/sessions/sess-1/end",
    method: "PATCH",
    expected: "end" as const,
  },
  {
    label: "PATCH /sessions/:id/presence (presence)",
    url: "/api/code-blue/sessions/sess-1/presence",
    method: "PATCH",
    expected: "presence" as const,
  },
];

const API_SOURCE_PATH = join(process.cwd(), "src/lib/api.ts");

function readApiSource(): string {
  return readFileSync(API_SOURCE_PATH, "utf8");
}

/** Representative endpoint/method per production producer (parity resolution). */
const REPRESENTATIVE_PRODUCER_OPS: ReadonlyArray<{
  pendingType: PendingSyncType;
  method: string;
  endpoint: string;
}> = [
  { pendingType: "create", method: "POST", endpoint: "/api/equipment" },
  { pendingType: "update", method: "PATCH", endpoint: "/api/equipment/eq-e1" },
  { pendingType: "delete", method: "DELETE", endpoint: "/api/equipment/eq-e1" },
  { pendingType: "scan", method: "POST", endpoint: "/api/equipment/eq-e1/scan" },
  { pendingType: "seen", method: "POST", endpoint: "/api/equipment/eq-e1/seen" },
  { pendingType: "checkout", method: "POST", endpoint: "/api/equipment/eq-e1/checkout" },
  { pendingType: "return", method: "POST", endpoint: "/api/equipment/eq-e1/return" },
  {
    pendingType: "return_with_charge",
    method: "POST",
    endpoint: "/api/equipment/eq-e1/return",
  },
];

/**
 * Count direct production enqueue call sites in api.ts (must stay the sole producer module).
 */
function countAddPendingSyncCallSites(apiSource: string): number {
  return (apiSource.match(/await\s+addPendingSync\s*\(/g) ?? []).length;
}

/** Literal offlineType / syncType / inline type values wired to addPendingSync in api.ts. */
function discoverProducerTypeLiteralsInApi(apiSource: string): Set<string> {
  const literals = new Set<string>();
  for (const match of apiSource.matchAll(/\bofflineType:\s*["']([a-z_]+)["']/g)) {
    literals.add(match[1]);
  }
  for (const match of apiSource.matchAll(/\bsyncType:\s*["']([a-z_]+)["']/g)) {
    literals.add(match[1]);
  }
  for (const match of apiSource.matchAll(
    /\btype:\s*["'](scan|seen|create|update|delete|checkout|return|return_with_charge)["']/g,
  )) {
    literals.add(match[1]);
  }
  return literals;
}

describe("offline-mutation-registry — E1 producer/registry parity", () => {
  const apiSource = readApiSource();

  it("discovers every production addPendingSync call site only in api.ts", () => {
    const callSites = countAddPendingSyncCallSites(apiSource);
    expect(callSites).toBeGreaterThan(0);
    expect(
      callSites,
      "update count when adding a new addPendingSync producer in api.ts",
    ).toBe(4);
    const offlineDbSource = readFileSync(join(process.cwd(), "src/lib/offline-db.ts"), "utf8");
    expect((offlineDbSource.match(/addPendingSync\(/g) ?? []).length).toBe(1);
  });

  it("api.ts producer type literals exactly match discoverEnqueueProducerTypesFromApiSource", () => {
    const literals = discoverProducerTypeLiteralsInApi(apiSource);
    const discovered = discoverEnqueueProducerTypesFromApiSource(apiSource);
    expect(literals).toEqual(discovered);
  });

  it("every type discovered in api.ts is in allow registry; return is the only registry-only producer", () => {
    const discovered = discoverEnqueueProducerTypesFromApiSource(apiSource);
    for (const pendingType of discovered) {
      expect(PRODUCTION_ENQUEUE_PRODUCER_TYPES).toContain(pendingType);
    }
    const registryOnly = PRODUCTION_ENQUEUE_PRODUCER_TYPES.filter(
      (t) => !discovered.has(t),
    );
    expect(registryOnly).toEqual(["return"]);
  });

  it("every production producer type resolves to an allow registry entry at a representative endpoint", () => {
    const discovered = discoverEnqueueProducerTypesFromApiSource(apiSource);
    for (const pendingType of discovered) {
      const op = REPRESENTATIVE_PRODUCER_OPS.find((r) => r.pendingType === pendingType);
      expect(
        op,
        `add representative endpoint for new producer type "${pendingType}" in E1 test`,
      ).toBeDefined();
      const resolved = resolveAllowRegistryEntry({
        type: op!.pendingType,
        method: op!.method,
        endpoint: op!.endpoint,
      });
      expect(
        resolved,
        `registry must allow ${op!.method} ${op!.endpoint} as ${pendingType}`,
      ).toBeDefined();
      expect(resolved!.pendingType).toBe(pendingType);
    }
  });

  it("fails discovery when api.ts introduces an unknown addPendingSync producer type", () => {
    const poisoned = `${apiSource}\n// test-only\nofflineType: "not_a_real_producer"`;
    expect(() => discoverEnqueueProducerTypesFromApiSource(poisoned)).toThrow(
      /unknown addPendingSync producer type/,
    );
  });

  it("online-required domains never declare enqueue producers (explicit allow list empty)", () => {
    const explicitOnlineRequiredWithProducers: string[] = [];
    for (const entry of offlineOnlineRequiredDomains) {
      expect(entry.hasEnqueueProducer).toBe(false);
      if (entry.hasEnqueueProducer) {
        explicitOnlineRequiredWithProducers.push(entry.key);
      }
    }
    expect(explicitOnlineRequiredWithProducers).toEqual([]);
    for (const doc of offlineOnlineRequiredDomains) {
      const allowCollision = offlineAllowProducers.find((a) => a.key === doc.key);
      expect(
        allowCollision,
        `online-required ${doc.key} must not duplicate an allow producer key`,
      ).toBeUndefined();
    }
  });
});

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

describe("offline-mutation-registry — emergency classification boundary (B1)", () => {
  it.each(CODE_BLUE_EMERGENCY_MUTATIONS)(
    "classifyEmergencyEndpoint owns emergency classification for $label",
    ({ url, method, expected }) => {
      expect(classifyEmergencyEndpoint(url, method)).toBe(expected);
    },
  );

  it.each(CODE_BLUE_EMERGENCY_MUTATIONS)(
    "emergency path $label is not registered as an offline-allowed producer",
    ({ url, method }) => {
      const pathname = new URL(url, "http://localhost").pathname;
      const upperMethod = method.toUpperCase();

      for (const entry of offlineAllowProducers) {
        const matches =
          entry.method.toUpperCase() === upperMethod && entry.pathPattern.test(pathname);
        expect(
          matches,
          `allow producer ${entry.key} must not match Code Blue emergency ${method} ${url}`,
        ).toBe(false);
      }

      for (const pendingType of PRODUCTION_ENQUEUE_PRODUCER_TYPES) {
        expect(
          resolveAllowRegistryEntry({ type: pendingType, method, endpoint: url }),
          `no allow-registry match for emergency ${method} ${url} as ${pendingType}`,
        ).toBeUndefined();
      }
    },
  );

  it("documents Code Blue mutations as online-required, not allow producers", () => {
    expect(offlineAllowProducers.map((e) => e.key)).not.toContain("code_blue.mutations");
    const codeBlueDoc = offlineOnlineRequiredDomains.find((e) => e.key === "code_blue.mutations");
    expect(codeBlueDoc?.policy).toBe("online-required");
    expect(codeBlueDoc?.hasEnqueueProducer).toBe(false);
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

  it("warns with stable fields then throws UnknownOfflineMutationError (no body logged)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(() =>
      assertPendingSyncEnqueueAllowed({
        type: "scan",
        method: "POST",
        endpoint: "/api/unknown/custom",
      }),
    ).toThrow(UnknownOfflineMutationError);

    expect(warnSpy).toHaveBeenCalledOnce();
    const [tag, fields] = warnSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(tag).toBe("[offline-policy] offline_sync_unknown_mutation");
    expect(fields).toEqual({
      event: "offline_sync_unknown_mutation",
      pendingType: "scan",
      method: "POST",
      endpoint: "/api/unknown/custom",
    });
    expect(fields).not.toHaveProperty("body");
    expect(fields).not.toHaveProperty("payload");
    expect(Object.keys(fields).sort()).toEqual(
      ["endpoint", "event", "method", "pendingType"].sort(),
    );

    warnSpy.mockRestore();
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
