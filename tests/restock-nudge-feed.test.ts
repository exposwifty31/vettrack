/**
 * Unit tests for computeNudgesForUser restock-nudge derivation
 * (T-30a1-ii · R-IN-F1 · small-03).
 *
 * Extends the compute-on-read feed from T-30a1-i (expiry nudges) with a
 * second "restock" kind. Reuses the codebase's existing clinicId-scoped
 * restock-needed rule verbatim — `listLowStockItems` in
 * server/services/inventory-console.service.ts (an item has a par level and
 * its summed on-hand across containers is below it) — instead of
 * re-implementing the aggregation query. This test mocks that service call
 * directly (rather than re-deriving the SQL join/groupBy/having chain in a
 * db mock), and keeps the same db-mock convention as
 * tests/expiry-nudge-feed.test.ts for the expiry regression case.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  drizzleOrmPredicateMock,
  makeEquipmentDbMock,
  type EquipmentFixtureRow,
} from "./helpers/nudge-feed-db-mock.js";

// ─── drizzle-orm — pass-through predicate builders (expiry path only) ──────
vi.mock("drizzle-orm", () => drizzleOrmPredicateMock);

// ─── db mock — equipment table, clinicId-scoped (expiry regression) ───────
let equipmentRows: EquipmentFixtureRow[] = [];

vi.mock("../server/db.js", () => makeEquipmentDbMock(() => equipmentRows));

// ─── inventory-console.service mock — restock-needed rows, clinicId-scoped ─
type LowStockFixtureRow = {
  itemId: string;
  label: string;
  parLevel: number;
  onHand: number;
  short: number;
  clinicId: string;
};

let lowStockRows: LowStockFixtureRow[] = [];

const listLowStockItems = vi.fn(async (clinicId: string) =>
  lowStockRows
    .filter((r) => r.clinicId === clinicId)
    .map(({ clinicId: _clinicId, ...row }) => row),
);

vi.mock("../server/services/inventory-console.service.js", () => ({
  listLowStockItems: (clinicId: string) => listLowStockItems(clinicId),
}));

import { computeNudgesForUser } from "../server/services/nudge-feed.service.js";

beforeEach(() => {
  equipmentRows = [];
  lowStockRows = [];
  listLowStockItems.mockClear();
});

describe("computeNudgesForUser — restock nudges (T-30a1-ii · R-IN-F1)", () => {
  it("yields a restock nudge for the inventory-responsible role when an item needs restock", async () => {
    lowStockRows = [
      { itemId: "item-1", label: "Gauze 4x4", parLevel: 20, onHand: 5, short: 15, clinicId: "clinic-1" },
    ];

    const nudges = await computeNudgesForUser("clinic-1", "technician");

    expect(nudges).toHaveLength(1);
    expect(nudges[0]).toMatchObject({
      kind: "restock",
      targetRole: "technician",
      entityId: "item-1",
    });
    expect(typeof nudges[0].id).toBe("string");
    expect(typeof nudges[0].createdAt).toBe("string");
  });

  it("returns none for a role other than the inventory-responsible role", async () => {
    lowStockRows = [
      { itemId: "item-1", label: "Gauze 4x4", parLevel: 20, onHand: 5, short: 15, clinicId: "clinic-1" },
    ];

    const vetNudges = await computeNudgesForUser("clinic-1", "vet");
    const adminNudges = await computeNudgesForUser("clinic-1", "admin");
    const studentNudges = await computeNudgesForUser("clinic-1", "student");

    expect(vetNudges).toEqual([]);
    expect(adminNudges).toEqual([]);
    expect(studentNudges).toEqual([]);
  });

  it("excludes items belonging to a different clinic", async () => {
    lowStockRows = [
      { itemId: "item-1", label: "Gauze 4x4", parLevel: 20, onHand: 5, short: 15, clinicId: "clinic-2" },
    ];

    const nudges = await computeNudgesForUser("clinic-1", "technician");

    expect(nudges).toEqual([]);
  });

  it("still derives expiry nudges alongside restock nudges (no regression)", async () => {
    equipmentRows = [
      {
        id: "eq-1",
        clinicId: "clinic-1",
        name: "Autoclave",
        expiryDate: "2026-07-15",
        deletedAt: null,
      },
    ];
    lowStockRows = [
      { itemId: "item-1", label: "Gauze 4x4", parLevel: 20, onHand: 5, short: 15, clinicId: "clinic-1" },
    ];

    const nudges = await computeNudgesForUser("clinic-1", "technician");

    expect(nudges).toHaveLength(2);
    const kinds = nudges.map((n) => n.kind).sort();
    expect(kinds).toEqual(["expiry", "restock"]);
  });
});
