/**
 * Phase 4 / E2 — sync-engine replay sends stored idempotency headers (no regeneration).
 */
import "fake-indexeddb/auto";
import { readFileSync } from "fs";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PendingSync } from "../src/lib/offline-db";
import {
  clearHaltQueue,
  processQueue,
  setAuthStateRef,
} from "../src/lib/sync-engine";

const SYNC_ENGINE_SOURCE = readFileSync(
  join(process.cwd(), "src/lib/sync-engine.ts"),
  "utf8",
);

const STORED_MUTATION_ID = "aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee";
const STORED_IDEMPOTENCY_KEY = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";

type FetchCall = { url: string; init: RequestInit };

const fetchCalls = vi.hoisted((): FetchCall[] => []);

const mockGetPendingSync = vi.hoisted(() => vi.fn<() => Promise<PendingSync[]>>());

vi.mock("../src/lib/offline-db", () => ({
  getPendingSync: mockGetPendingSync,
  updatePendingSync: vi.fn().mockResolvedValue(undefined),
  removePendingSync: vi.fn().mockResolvedValue(undefined),
  runStartupCleanup: vi.fn().mockResolvedValue(undefined),
  recoverProcessingPendingSync: vi.fn().mockResolvedValue(0),
  PENDING_SYNC_MAX_RETRIES: 5,
  PENDING_SYNC_SCHEMA_VERSION: 2,
}));

vi.mock("../src/lib/safe-browser", () => ({
  isOnline: vi.fn(() => true),
}));

vi.mock("../src/lib/auth-store", () => ({
  getAuthHeaders: vi.fn(() => ({ Authorization: "Bearer replay-test-jwt" })),
}));

vi.mock("../src/lib/conflict-store", () => ({
  addConflict: vi.fn(),
  ensureConflictsHydrated: vi.fn().mockResolvedValue(undefined),
  persistConflictPayload: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/lib/offline-session", () => ({
  clearOfflineSession: vi.fn(),
}));

vi.mock("@sentry/react", () => ({
  captureMessage: vi.fn(),
  captureEvent: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    warning: vi.fn(),
    success: vi.fn(),
  },
}));

function buildPendingRow(
  overrides: Partial<PendingSync> & Pick<PendingSync, "type" | "endpoint" | "method">,
): PendingSync {
  return {
    id: 1,
    body: "{}",
    createdAt: new Date(),
    retries: 0,
    status: "pending",
    clientTimestamp: 1_700_000_000_000,
    clientMutationId: STORED_MUTATION_ID,
    idempotencyKey: STORED_IDEMPOTENCY_KEY,
    schemaVersion: 1,
    updatedAt: new Date(),
    structuredError: null,
    ...overrides,
  };
}

/** Offline-capable equipment producers (registry allow list). */
const OFFLINE_CAPABLE_REPLAY_CASES: ReadonlyArray<{
  label: string;
  type: PendingSync["type"];
  method: string;
  endpoint: string;
}> = [
  { label: "equipment create", type: "create", method: "POST", endpoint: "/api/equipment" },
  {
    label: "equipment update",
    type: "update",
    method: "PATCH",
    endpoint: "/api/equipment/eq-e2/update-target",
  },
  {
    label: "equipment delete",
    type: "delete",
    method: "DELETE",
    endpoint: "/api/equipment/eq-e2/delete-target",
  },
  {
    label: "equipment scan",
    type: "scan",
    method: "POST",
    endpoint: "/api/equipment/eq-e2/scan",
  },
  {
    label: "equipment seen",
    type: "seen",
    method: "POST",
    endpoint: "/api/equipment/eq-e2/seen",
  },
  {
    label: "equipment checkout",
    type: "checkout",
    method: "POST",
    endpoint: "/api/equipment/eq-e2/checkout",
  },
  {
    label: "equipment return",
    type: "return",
    method: "POST",
    endpoint: "/api/equipment/eq-e2/return",
  },
  {
    label: "equipment return_with_charge",
    type: "return_with_charge",
    method: "POST",
    endpoint: "/api/equipment/eq-e2/return",
  },
];

function headerRecord(init: RequestInit | undefined): Record<string, string> {
  const raw = init?.headers;
  if (!raw || typeof raw === "string") return {};
  if (raw instanceof Headers) {
    const out: Record<string, string> = {};
    raw.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  return Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, String(v)]),
  );
}

describe("sync-engine replay headers — static contract", () => {
  it("sends Idempotency-Key from pending row when present", () => {
    expect(SYNC_ENGINE_SOURCE).toContain('headers["Idempotency-Key"]');
    expect(SYNC_ENGINE_SOURCE).toContain("item.idempotencyKey");
    expect(SYNC_ENGINE_SOURCE).toMatch(/idempotencyKey\s*=\s*item\.idempotencyKey\?\.trim\(\)/);
  });

  it("sends X-Client-Mutation-Id from pending row when present", () => {
    expect(SYNC_ENGINE_SOURCE).toContain('headers["X-Client-Mutation-Id"]');
    expect(SYNC_ENGINE_SOURCE).toContain("item.clientMutationId");
    expect(SYNC_ENGINE_SOURCE).toMatch(
      /clientMutationId\s*=\s*item\.clientMutationId\?\.trim\(\)/,
    );
  });

  it("does not regenerate idempotency keys during replay", () => {
    expect(SYNC_ENGINE_SOURCE).not.toMatch(/randomUUID\(\)/);
  });

  it("preserves FIFO ordering via getPendingSync (sorted in offline-db)", () => {
    const offlineDbSource = readFileSync(join(process.cwd(), "src/lib/offline-db.ts"), "utf8");
    expect(SYNC_ENGINE_SOURCE).toContain("getPendingSync()");
    expect(offlineDbSource).toContain("sortBy(\"clientTimestamp\")");
  });

  it("still sends X-Client-Timestamp for offline replay", () => {
    expect(SYNC_ENGINE_SOURCE).toContain('headers["X-Client-Timestamp"]');
  });
});

describe("sync-engine replay headers — E2 behavioral replay", () => {
  beforeEach(() => {
    fetchCalls.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        fetchCalls.push({
          url: String(input),
          init: init ?? {},
        });
        return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
      }),
    );
    mockGetPendingSync.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function runReplayForRow(row: PendingSync): Promise<Record<string, string>> {
    clearHaltQueue();
    setAuthStateRef(() => ({ isSignedIn: true, isOfflineSession: false }));
    mockGetPendingSync.mockResolvedValueOnce([row]);
    await processQueue();
    expect(fetchCalls).toHaveLength(1);
    return headerRecord(fetchCalls[0]!.init);
  }

  it.each(OFFLINE_CAPABLE_REPLAY_CASES)(
    "replay $label sends stored Idempotency-Key and X-Client-Mutation-Id",
    async ({ type, method, endpoint }) => {
      const headers = await runReplayForRow(
        buildPendingRow({ type, method, endpoint }),
      );
      expect(headers["Idempotency-Key"]).toBe(STORED_IDEMPOTENCY_KEY);
      expect(headers["X-Client-Mutation-Id"]).toBe(STORED_MUTATION_ID);
      expect(headers["X-Client-Timestamp"]).toBe("1700000000000");
      expect(fetchCalls[0]!.url).toBe(endpoint);
      expect(fetchCalls[0]!.init.method).toBe(method);
    },
  );

  it("replay does not regenerate idempotency headers (exact stored values)", async () => {
    const customMutationId = "cccccccc-dddd-4eee-ffff-000000000001";
    const customIdempotencyKey = "dddddddd-eeee-4fff-aaaa-111111111111";
    const headers = await runReplayForRow(
      buildPendingRow({
        type: "checkout",
        method: "POST",
        endpoint: "/api/equipment/eq-regen/checkout",
        clientMutationId: customMutationId,
        idempotencyKey: customIdempotencyKey,
      }),
    );
    expect(headers["Idempotency-Key"]).toBe(customIdempotencyKey);
    expect(headers["X-Client-Mutation-Id"]).toBe(customMutationId);
    expect(headers["Idempotency-Key"]).not.toBe(STORED_IDEMPOTENCY_KEY);
  });

  it("missing stored keys do not emit fake Idempotency-Key or X-Client-Mutation-Id headers", async () => {
    const headers = await runReplayForRow(
      buildPendingRow({
        type: "seen",
        method: "POST",
        endpoint: "/api/equipment/eq-missing/seen",
        clientMutationId: "",
        idempotencyKey: "",
      }),
    );
    expect(headers["Idempotency-Key"]).toBeUndefined();
    expect(headers["X-Client-Mutation-Id"]).toBeUndefined();
  });

  it("whitespace-only stored keys are omitted (trim guard)", async () => {
    const headers = await runReplayForRow(
      buildPendingRow({
        type: "scan",
        method: "POST",
        endpoint: "/api/equipment/eq-ws/scan",
        clientMutationId: "   ",
        idempotencyKey: "  \t  ",
      }),
    );
    expect(headers["Idempotency-Key"]).toBeUndefined();
    expect(headers["X-Client-Mutation-Id"]).toBeUndefined();
  });
});
