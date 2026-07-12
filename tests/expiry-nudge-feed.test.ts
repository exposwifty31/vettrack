/**
 * Unit tests for computeNudgesForUser expiry-nudge derivation
 * (T-30a1-i · R-IN-F1 · small-03).
 *
 * Compute-on-read: the nudge feed is NOT a worker-pushed store — it derives
 * "expiry" nudges from `vt_equipment` rows on every read, reusing the same
 * clinicId-scoped 7-day lookahead window as `expiryCheckWorker`
 * (server/workers/expiryCheckWorker.ts). This test drives
 * `computeNudgesForUser` directly with a mocked db (same convention as
 * tests/equipment-locate-route.test.ts / tests/cross-tenant-denial.test.ts):
 * drizzle-orm predicate builders are replaced with cheap inspectable values,
 * and the mocked `db.select().from().where()` chain filters an in-memory
 * fixture by the `clinicId` condition the service actually built — so the
 * clinicId-scoping test is a real behavioral check, not just an empty-result
 * stand-in.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  drizzleOrmPredicateMock,
  makeEquipmentDbMock,
  type EquipmentFixtureRow,
} from "./helpers/nudge-feed-db-mock.js";

// ─── drizzle-orm — pass-through predicate builders ─────────────────────────
vi.mock("drizzle-orm", () => drizzleOrmPredicateMock);

// ─── db mock — equipment table, clinicId-scoped ────────────────────────────
let equipmentRows: EquipmentFixtureRow[] = [];

vi.mock("../server/db.js", () => makeEquipmentDbMock(() => equipmentRows));

// computeNudgesForUser also derives "restock" nudges (T-30a1-ii) via
// listLowStockItems — irrelevant to this file's expiry-only assertions, so
// stub it out rather than pulling inventory tables into this db mock.
vi.mock("../server/services/inventory-console.service.js", () => ({
  listLowStockItems: async () => [],
}));

import { computeNudgesForUser } from "../server/services/nudge-feed.service.js";

beforeEach(() => {
  equipmentRows = [];
});

describe("computeNudgesForUser — expiry nudges (T-30a1-i · R-IN-F1)", () => {
  it("yields an expiry nudge for the inventory-responsible role when an item is expiring within the threshold", async () => {
    equipmentRows = [
      {
        id: "eq-1",
        clinicId: "clinic-1",
        name: "Autoclave",
        expiryDate: "2026-07-15",
        deletedAt: null,
      },
    ];

    const nudges = await computeNudgesForUser("clinic-1", "technician");

    expect(nudges).toHaveLength(1);
    expect(nudges[0]).toMatchObject({
      kind: "expiry",
      targetRole: "technician",
      entityId: "eq-1",
    });
    expect(typeof nudges[0].id).toBe("string");
    expect(typeof nudges[0].createdAt).toBe("string");
  });

  it("returns none for a role other than the inventory-responsible role", async () => {
    equipmentRows = [
      {
        id: "eq-1",
        clinicId: "clinic-1",
        name: "Autoclave",
        expiryDate: "2026-07-15",
        deletedAt: null,
      },
    ];

    const vetNudges = await computeNudgesForUser("clinic-1", "vet");
    const adminNudges = await computeNudgesForUser("clinic-1", "admin");
    const studentNudges = await computeNudgesForUser("clinic-1", "student");

    expect(vetNudges).toEqual([]);
    expect(adminNudges).toEqual([]);
    expect(studentNudges).toEqual([]);
  });

  it("excludes items belonging to a different clinic", async () => {
    equipmentRows = [
      {
        id: "eq-1",
        clinicId: "clinic-2",
        name: "Autoclave",
        expiryDate: "2026-07-15",
        deletedAt: null,
      },
    ];

    const nudges = await computeNudgesForUser("clinic-1", "technician");

    expect(nudges).toEqual([]);
  });

  it("excludes equipment with no expiry date set", async () => {
    equipmentRows = [
      {
        id: "eq-1",
        clinicId: "clinic-1",
        name: "Autoclave",
        expiryDate: null as unknown as string,
        deletedAt: null,
      },
    ];

    const nudges = await computeNudgesForUser("clinic-1", "technician");

    expect(nudges).toEqual([]);
  });

  it("excludes equipment expiring more than 7 days out", async () => {
    const farOut = new Date();
    farOut.setDate(farOut.getDate() + 30);
    equipmentRows = [
      {
        id: "eq-1",
        clinicId: "clinic-1",
        name: "Autoclave",
        expiryDate: farOut.toISOString().slice(0, 10),
        deletedAt: null,
      },
    ];

    const nudges = await computeNudgesForUser("clinic-1", "technician");

    expect(nudges).toEqual([]);
  });

  it("includes equipment that has already expired (still within the lte bound)", async () => {
    const alreadyExpired = new Date();
    alreadyExpired.setDate(alreadyExpired.getDate() - 5);
    equipmentRows = [
      {
        id: "eq-1",
        clinicId: "clinic-1",
        name: "Autoclave",
        expiryDate: alreadyExpired.toISOString().slice(0, 10),
        deletedAt: null,
      },
    ];

    const nudges = await computeNudgesForUser("clinic-1", "technician");

    expect(nudges).toHaveLength(1);
    expect(nudges[0]).toMatchObject({ kind: "expiry", entityId: "eq-1" });
  });
});
