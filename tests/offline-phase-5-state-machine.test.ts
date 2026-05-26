/**
 * OFF-05 / Phase 5 — pendingSync state machine and durable conflicts.
 */
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setAuthState } from "../src/lib/auth-store";
import {
  addPendingSync,
  DEAD_LETTER_RETENTION_MS,
  getConflictCount,
  getDeadCount,
  getPendingSync,
  offlineDb,
  PENDING_SYNC_MAX_RETRIES,
  PENDING_SYNC_SCHEMA_VERSION,
  recoverProcessingPendingSync,
  runStartupCleanup,
  upgradePendingSyncPhase5,
  type PendingSync,
  type PendingSyncCreateInput,
} from "../src/lib/offline-db";
import {
  ensureConflictsHydrated,
  hydrateConflictsFromDexie,
} from "../src/lib/conflict-store";

const PENDING_SYNC_STORES = "++id, type, createdAt, status, clientTimestamp" as const;

function enqueueInput(
  endpoint: string,
  overrides?: Partial<PendingSyncCreateInput>,
): PendingSyncCreateInput {
  return {
    type: "scan",
    endpoint,
    method: "POST",
    body: '{"note":"offline"}',
    createdAt: new Date(),
    retries: 0,
    status: "pending",
    clientTimestamp: Date.now(),
    ...overrides,
  };
}

describe("offline phase 5 — Dexie persistence and cleanup", () => {
  beforeEach(async () => {
    await offlineDb.delete();
    await offlineDb.open();
    setAuthState({
      userId: "off-05-dexie",
      email: "dexie@test.local",
      name: "Dexie",
      bearerToken: null,
    });
  });

  afterEach(async () => {
    await offlineDb.delete();
  });

  it("409 conflict payload survives DB reopen", async () => {
    const id = await addPendingSync(
      enqueueInput("/api/equipment/eq-persist/scan"),
    );
    expect(id).toBeDefined();
    await offlineDb.pendingSync.update(id!, {
      status: "conflict",
      conflictPayload: {
        serverData: { version: 3 },
        localData: { version: 2 },
        capturedAt: Date.now(),
      },
      errorMessage: "Conflict: another change was made to this item",
    });

    await offlineDb.close();
    await offlineDb.open();
    await hydrateConflictsFromDexie();

    const row = await offlineDb.pendingSync.get(id!);
    expect(row?.status).toBe("conflict");
    expect(row?.conflictPayload?.serverData).toEqual({ version: 3 });
    expect(await getConflictCount()).toBe(1);
  });

  it("runStartupCleanup does not delete conflict or young dead; deletes synced", async () => {
    const youngDeadAt = new Date(Date.now() - DEAD_LETTER_RETENTION_MS + 60_000);
    const oldDeadAt = new Date(Date.now() - DEAD_LETTER_RETENTION_MS - 60_000);

    await offlineDb.pendingSync.bulkAdd([
      {
        ...enqueueInput("/api/equipment/a/scan"),
        status: "conflict",
        conflictPayload: { serverData: {}, localData: {}, capturedAt: Date.now() },
        clientMutationId: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(),
        schemaVersion: PENDING_SYNC_SCHEMA_VERSION,
        updatedAt: new Date(),
        structuredError: null,
        createdAt: new Date(),
      },
      {
        ...enqueueInput("/api/equipment/b/scan"),
        status: "dead",
        createdAt: youngDeadAt,
        clientMutationId: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(),
        schemaVersion: PENDING_SYNC_SCHEMA_VERSION,
        updatedAt: youngDeadAt,
        structuredError: null,
      },
      {
        ...enqueueInput("/api/equipment/c/scan"),
        status: "dead",
        createdAt: oldDeadAt,
        clientMutationId: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(),
        schemaVersion: PENDING_SYNC_SCHEMA_VERSION,
        updatedAt: oldDeadAt,
        structuredError: null,
      },
      {
        ...enqueueInput("/api/equipment/d/scan"),
        status: "synced",
        clientMutationId: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(),
        schemaVersion: PENDING_SYNC_SCHEMA_VERSION,
        updatedAt: new Date(),
        structuredError: null,
        createdAt: new Date(),
      },
    ] as PendingSync[]);

    await runStartupCleanup();

    const statuses = (await offlineDb.pendingSync.toArray()).map((r) => r.status);
    expect(statuses).toContain("conflict");
    expect(statuses.filter((s) => s === "dead")).toHaveLength(1);
    expect(statuses).not.toContain("synced");
  });

  it("recoverProcessingPendingSync resets processing → pending", async () => {
    await offlineDb.pendingSync.bulkAdd([
      {
        ...enqueueInput("/api/equipment/proc/scan"),
        status: "processing",
        clientMutationId: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(),
        schemaVersion: PENDING_SYNC_SCHEMA_VERSION,
        updatedAt: new Date(),
        structuredError: null,
        createdAt: new Date(),
      },
    ] as PendingSync[]);

    const recovered = await recoverProcessingPendingSync();
    expect(recovered).toBe(1);
    const row = (await offlineDb.pendingSync.toArray())[0];
    expect(row?.status).toBe("pending");
  });

  it("getPendingSync excludes dead, conflict, and processing", async () => {
    await offlineDb.pendingSync.bulkAdd([
      { ...enqueueInput("/api/equipment/p/scan"), status: "pending" },
      { ...enqueueInput("/api/equipment/d/scan"), status: "dead" },
      { ...enqueueInput("/api/equipment/c/scan"), status: "conflict" },
      { ...enqueueInput("/api/equipment/x/scan"), status: "processing" },
    ].map((row) => ({
      ...row,
      clientMutationId: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      schemaVersion: PENDING_SYNC_SCHEMA_VERSION,
      updatedAt: new Date(),
      structuredError: null,
      conflictPayload: null,
      createdAt: new Date(),
    })) as PendingSync[]);

    const pending = await getPendingSync();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.status).toBe("pending");
    expect(await getDeadCount()).toBe(1);
    expect(await getConflictCount()).toBe(1);
  });
});

describe("offline phase 5 — legacy failed → dead/conflict migration", () => {
  it("maps terminal legacy failed to dead and conflict-shaped failed to conflict", async () => {
    const dbName = `vettrack-p5-migrate-${crypto.randomUUID()}`;
    class V5Db extends Dexie {
      pendingSync!: Dexie.Table<PendingSync, number>;
      constructor() {
        super(dbName);
        this.version(5).stores({ pendingSync: PENDING_SYNC_STORES });
      }
    }
    const db = new V5Db();
    await db.open();
    const now = new Date();
    await db.pendingSync.bulkAdd([
      {
        type: "scan",
        endpoint: "/api/equipment/a/scan",
        method: "POST",
        body: "{}",
        createdAt: now,
        retries: PENDING_SYNC_MAX_RETRIES,
        status: "failed",
        clientTimestamp: 1,
        errorMessage: `Failed after ${PENDING_SYNC_MAX_RETRIES} attempts`,
        clientMutationId: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(),
        schemaVersion: 1,
        updatedAt: now,
        structuredError: null,
      },
      {
        type: "checkout",
        endpoint: "/api/equipment/b/checkout",
        method: "POST",
        body: "{}",
        createdAt: now,
        retries: 1,
        status: "failed",
        clientTimestamp: 2,
        errorMessage: "Conflict: another change was made to this item",
        clientMutationId: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(),
        schemaVersion: 1,
        updatedAt: now,
        structuredError: null,
      },
    ] as PendingSync[]);
    await upgradePendingSyncPhase5(db.pendingSync);
    const rows = await db.pendingSync.orderBy("clientTimestamp").toArray();
    expect(rows[0]?.status).toBe("dead");
    expect(rows[1]?.status).toBe("conflict");
    expect(rows[1]?.conflictPayload?.localData).toEqual({});
    await db.close();
    await Dexie.delete(dbName);
  });
});

describe("offline phase 5 — conflict hydrate API", () => {
  it("ensureConflictsHydrated resolves with real Dexie rows", async () => {
    await offlineDb.delete();
    await offlineDb.open();
    const id = await addPendingSync(enqueueInput("/api/equipment/hydrate/scan"));
    await offlineDb.pendingSync.update(id!, {
      status: "conflict",
      conflictPayload: {
        serverData: { ok: true },
        localData: { ok: false },
        capturedAt: Date.now(),
      },
    });
    await hydrateConflictsFromDexie();
    await expect(ensureConflictsHydrated()).resolves.toBeUndefined();
    await offlineDb.delete();
  });
});
