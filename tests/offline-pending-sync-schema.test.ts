/**
 * Phase 3 — pendingSync Dexie schema extension and migration.
 */
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { readFileSync } from "fs";
import { join } from "path";
import { beforeEach, describe, expect, it } from "vitest";
import { setAuthState, setCurrentClinicId } from "../src/lib/auth-store";
import {
  addPendingSync,
  applyPendingSyncSchemaDefaults,
  getAllPendingSync,
  getPendingSync,
  offlineDb,
  PENDING_SYNC_SCHEMA_VERSION,
  upgradePendingSyncTable,
  type PendingSync,
  type PendingSyncCreateInput,
  type PendingSyncType,
} from "../src/lib/offline-db";
import {
  offlineAllowProducers,
  sampleEndpointForAllowEntry,
} from "../src/lib/offline-mutation-registry";

/** Legacy row shape before Phase 3 (Dexie v4). */
type LegacyPendingSyncRow = {
  id?: number;
  type: PendingSyncType;
  endpoint: string;
  method: string;
  body: string;
  createdAt: Date;
  retries: number;
  status: "pending" | "synced" | "failed";
  clientTimestamp: number;
  optimisticData?: string;
  errorMessage?: string;
  equipmentName?: string;
};

const PENDING_SYNC_STORES = "++id, type, createdAt, status, clientTimestamp" as const;

async function seedLegacyPendingQueue(
  dbName: string,
  rows: LegacyPendingSyncRow[],
): Promise<void> {
  class V4OnlyDb extends Dexie {
    pendingSync!: Table<LegacyPendingSyncRow, number>;
    constructor() {
      super(dbName);
      this.version(4).stores({ pendingSync: PENDING_SYNC_STORES });
    }
  }
  const db = new V4OnlyDb();
  await db.open();
  await db.pendingSync.bulkAdd(rows);
  await db.close();
}

async function openMigratedTestDb(dbName: string) {
  class MigratedDb extends Dexie {
    pendingSync!: Table<PendingSync, number>;
    constructor() {
      super(dbName);
      this.version(4).stores({ pendingSync: PENDING_SYNC_STORES });
      this.version(5)
        .stores({ pendingSync: PENDING_SYNC_STORES })
        .upgrade(async (tx) => {
          await upgradePendingSyncTable(tx.table("pendingSync"));
        });
    }
  }
  const db = new MigratedDb();
  await db.open();
  return db;
}

function legacyRow(
  overrides: Partial<LegacyPendingSyncRow> & Pick<LegacyPendingSyncRow, "type" | "endpoint">,
): LegacyPendingSyncRow {
  return {
    method: "POST",
    body: "{}",
    createdAt: new Date("2026-01-15T10:00:00.000Z"),
    retries: 0,
    status: "pending",
    clientTimestamp: 1_700_000_000_000,
    ...overrides,
  };
}

function enqueueInput(
  type: PendingSyncType,
  endpoint: string,
): PendingSyncCreateInput {
  return {
    type,
    endpoint,
    method: "POST",
    body: "{}",
    createdAt: new Date(),
    retries: 0,
    status: "pending",
    clientTimestamp: Date.now(),
  };
}

describe("offline-pending-sync-schema — Dexie v4 → v5 migration", () => {
  it("migrates legacy rows with safe defaults and preserves queue data", async () => {
    const dbName = `vettrack-migrate-${crypto.randomUUID()}`;
    const createdAt = new Date("2026-02-01T12:00:00.000Z");
    await seedLegacyPendingQueue(dbName, [
      legacyRow({
        type: "scan",
        endpoint: "/api/equipment/eq-1/scan",
        clientTimestamp: 100,
        createdAt,
      }),
      legacyRow({
        type: "checkout",
        endpoint: "/api/equipment/eq-2/checkout",
        clientTimestamp: 200,
        createdAt,
      }),
    ]);

    const db = await openMigratedTestDb(dbName);
    const rows = await db.pendingSync.orderBy("clientTimestamp").toArray();
    expect(rows).toHaveLength(2);

    for (const row of rows) {
      expect(row.clientMutationId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(row.idempotencyKey).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(row.schemaVersion).toBe(PENDING_SYNC_SCHEMA_VERSION);
      expect(row.updatedAt).toEqual(createdAt);
      expect(row.structuredError).toBeNull();
    }

    await db.close();
    await Dexie.delete(dbName);
  });

  it("migration is idempotent (second upgrade does not regenerate UUIDs)", async () => {
    const dbName = `vettrack-migrate-idempotent-${crypto.randomUUID()}`;
    await seedLegacyPendingQueue(dbName, [
      legacyRow({ type: "seen", endpoint: "/api/equipment/eq-3/seen" }),
    ]);
    const db = await openMigratedTestDb(dbName);

    const afterFirst = (await db.pendingSync.toArray())[0];
    const mutationId = afterFirst.clientMutationId;
    const idempotencyKey = afterFirst.idempotencyKey;

    await upgradePendingSyncTable(db.pendingSync);
    const afterSecond = (await db.pendingSync.toArray())[0];
    expect(afterSecond.clientMutationId).toBe(mutationId);
    expect(afterSecond.idempotencyKey).toBe(idempotencyKey);

    await db.close();
    await Dexie.delete(dbName);
  });

  it("multi-row queue survives upgrade with stable count and FIFO ordering", async () => {
    const dbName = `vettrack-migrate-multi-${crypto.randomUUID()}`;
    const timestamps = [300, 100, 200];
    await seedLegacyPendingQueue(
      dbName,
      timestamps.map((ts) =>
        legacyRow({
          type: "scan",
          endpoint: `/api/equipment/eq-${ts}/scan`,
          clientTimestamp: ts,
        }),
      ),
    );
    const db = await openMigratedTestDb(dbName);

    const rows = await db.pendingSync.orderBy("clientTimestamp").toArray();
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.clientTimestamp)).toEqual([100, 200, 300]);

    await db.close();
    await Dexie.delete(dbName);
  });

  it("repeated open after migration remains stable", async () => {
    const dbName = `vettrack-migrate-reload-${crypto.randomUUID()}`;
    await seedLegacyPendingQueue(dbName, [
      legacyRow({ type: "create", endpoint: "/api/equipment", method: "POST" }),
    ]);

    for (let i = 0; i < 3; i++) {
      const db = await openMigratedTestDb(dbName);
      const rows = await db.pendingSync.toArray();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.schemaVersion).toBe(PENDING_SYNC_SCHEMA_VERSION);
      await db.close();
    }

    await Dexie.delete(dbName);
  });
});

describe("offline-pending-sync-schema — new enqueue rows", () => {
  beforeEach(async () => {
    await offlineDb.delete();
    await offlineDb.open();
    setAuthState({
      userId: "user-phase3-test",
      email: "phase3@test.local",
      name: "Phase 3",
      bearerToken: null,
    });
    setCurrentClinicId();
  });

  it("new rows contain Phase 3 metadata fields", async () => {
    await addPendingSync(
      enqueueInput("scan", "/api/equipment/eq-new/scan"),
    );
    const [row] = await getPendingSync();
    expect(row?.clientMutationId).toBeTruthy();
    expect(row?.idempotencyKey).toBeTruthy();
    expect(row?.schemaVersion).toBe(PENDING_SYNC_SCHEMA_VERSION);
    expect(row?.updatedAt).toBeInstanceOf(Date);
    expect(row?.structuredError).toBeNull();
    expect(row?.userId).toBe("user-phase3-test");
    expect(row?.clinicId).toBeUndefined();
  });

  it("populates clinicId from getCurrentClinicId when set", async () => {
    setCurrentClinicId("clinic-phase3-test");
    await addPendingSync(
      enqueueInput("scan", "/api/equipment/eq-clinic/scan"),
    );
    const [row] = await getPendingSync();
    expect(row?.clinicId).toBe("clinic-phase3-test");
    expect(row?.userId).toBe("user-phase3-test");
  });

  it("empty clinicId becomes undefined on enqueue", async () => {
    setCurrentClinicId("   ");
    await addPendingSync(
      enqueueInput("seen", "/api/equipment/eq-no-clinic/seen"),
    );
    const [row] = await getPendingSync();
    expect(row?.clinicId).toBeUndefined();
    expect(row?.userId).toBe("user-phase3-test");
  });

  it("clinicId survives dedup updates", async () => {
    setCurrentClinicId("clinic-dedup-test");
    const endpoint = "/api/equipment/eq-dedup-clinic/checkout";
    const op = enqueueInput("checkout", endpoint);
    await addPendingSync({ ...op, clientTimestamp: 1000 });
    const first = (await getPendingSync())[0]!;
    expect(first.clinicId).toBe("clinic-dedup-test");

    setCurrentClinicId("clinic-other-should-not-replace");
    await addPendingSync({ ...op, clientTimestamp: 2001, body: '{"location":"B"}' });
    const second = (await getPendingSync())[0]!;
    expect(second.clientTimestamp).toBe(2001);
    expect(second.clinicId).toBe("clinic-dedup-test");
    expect(second.userId).toBe("user-phase3-test");
  });

  const producerTypes: PendingSyncType[] = [
    "checkout",
    "return",
    "return_with_charge",
    "scan",
    "seen",
    "create",
    "update",
    "delete",
  ];

  it.each(producerTypes)("registered producer %s enqueues with schema fields", async (pendingType) => {
    const entry = offlineAllowProducers.find((e) => e.pendingType === pendingType)!;
    await addPendingSync({
      ...enqueueInput(pendingType, sampleEndpointForAllowEntry(entry)),
      method: entry.method,
    });
    const rows = await getAllPendingSync();
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.clientMutationId).toBeTruthy();
    expect(row.idempotencyKey).toBeTruthy();
    expect(row.schemaVersion).toBe(PENDING_SYNC_SCHEMA_VERSION);
    expect(row.updatedAt).toBeInstanceOf(Date);
    expect(row.structuredError).toBeNull();
  });

  it("applyPendingSyncSchemaDefaults does not overwrite existing clientMutationId", () => {
    const existingId = "aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee";
    const row = {
      type: "scan" as const,
      endpoint: "/api/equipment/x/scan",
      method: "POST",
      body: "{}",
      createdAt: new Date(),
      retries: 0,
      status: "pending" as const,
      clientTimestamp: 1,
      clientMutationId: existingId,
      idempotencyKey: "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
      schemaVersion: PENDING_SYNC_SCHEMA_VERSION,
      updatedAt: new Date(),
      structuredError: null,
    };
    applyPendingSyncSchemaDefaults(row);
    expect(row.clientMutationId).toBe(existingId);
  });
});

describe("offline-pending-sync-schema — replay ordering (Phase 3 storage; Phase 4 headers)", () => {
  it("sync-engine reads Phase 3 fields for replay headers without regenerating keys", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/sync-engine.ts"), "utf8");
    expect(source).toContain('headers["Idempotency-Key"]');
    expect(source).toContain("item.idempotencyKey");
    expect(source).toContain('headers["X-Client-Mutation-Id"]');
    expect(source).toContain("item.clientMutationId");
    expect(source).not.toMatch(/randomUUID\(\)/);
    expect(source).toContain('headers["X-Client-Timestamp"]');
  });

  it("getPendingSync still orders by clientTimestamp (FIFO unchanged)", async () => {
    await offlineDb.delete();
    await offlineDb.open();
    await addPendingSync(
      enqueueInput("scan", "/api/equipment/a/scan"),
    );
    await new Promise((r) => setTimeout(r, 2));
    const ts = Date.now();
    await addPendingSync({
      ...enqueueInput("scan", "/api/equipment/b/scan"),
      clientTimestamp: ts,
    });
    const pending = await getPendingSync();
    expect(pending.map((r) => r.clientTimestamp)).toEqual(
      pending.map((r) => r.clientTimestamp).slice().sort((a, b) => a - b),
    );
  });
});
