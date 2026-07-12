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

// ─── drizzle-orm — pass-through predicate builders ─────────────────────────
vi.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ _type: "eq", a, b }),
  and: (...args: unknown[]) => ({ _type: "and", args }),
  isNull: (x: unknown) => ({ _type: "isNull", x }),
  isNotNull: (x: unknown) => ({ _type: "isNotNull", x }),
  lte: (a: unknown, b: unknown) => ({ _type: "lte", a, b }),
  sql: (strings: TemplateStringsArray, ...exprs: unknown[]) => ({ _type: "sql", strings, exprs }),
}));

// ─── db mock — equipment table, clinicId-scoped ────────────────────────────
type EquipmentFixtureRow = {
  id: string;
  clinicId: string;
  name: string;
  expiryDate: string;
  deletedAt: string | null;
};

let equipmentRows: EquipmentFixtureRow[] = [];

type MockCondition =
  | { _type: "and"; args: MockCondition[] }
  | { _type: "eq"; a: { _column?: string }; b: unknown }
  | { _type: "isNull" | "isNotNull"; x: unknown }
  | { _type: "lte"; a: unknown; b: unknown }
  | undefined;

function extractClinicId(condition: MockCondition): string | undefined {
  if (!condition) return undefined;
  if (condition._type === "and") {
    for (const c of condition.args) {
      const found = extractClinicId(c);
      if (found) return found;
    }
    return undefined;
  }
  if (condition._type === "eq" && condition.a?._column === "clinicId") {
    return condition.b as string;
  }
  return undefined;
}

vi.mock("../server/db.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (condition: MockCondition) => {
          const clinicId = extractClinicId(condition);
          const rows = equipmentRows.filter((r) => r.clinicId === clinicId && !r.deletedAt);
          return Promise.resolve(rows.map((r) => ({ id: r.id, name: r.name, expiryDate: r.expiryDate })));
        },
      }),
    }),
  },
  equipment: new Proxy({}, { get: (_t, prop) => ({ _column: String(prop) }) }),
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
});
