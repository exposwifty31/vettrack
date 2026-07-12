/**
 * Shared mock scaffolding for computeNudgesForUser tests
 * (tests/expiry-nudge-feed.test.ts + tests/restock-nudge-feed.test.ts).
 *
 * Both files drive the same clinicId-scoped `vt_equipment` select through a
 * mocked `db` module and the same drizzle-orm predicate-builder stand-ins —
 * this extracts that duplication into one place so the two files can't
 * silently drift apart.
 */

export type EquipmentFixtureRow = {
  id: string;
  clinicId: string;
  name: string;
  expiryDate: string;
  deletedAt: string | null;
};

export type MockCondition =
  | { _type: "and"; args: MockCondition[] }
  | { _type: "eq"; a: { _column?: string }; b: unknown }
  | { _type: "isNull" | "isNotNull"; x: unknown }
  | { _type: "lte"; a: unknown; b: unknown }
  | undefined;

export function extractClinicId(condition: MockCondition): string | undefined {
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

/** Pass-through predicate builders — the mocked db below ignores the real
 * drizzle-orm query-builder semantics and only inspects the `_type` shape. */
export const drizzleOrmPredicateMock = {
  eq: (a: unknown, b: unknown) => ({ _type: "eq", a, b }),
  and: (...args: unknown[]) => ({ _type: "and", args }),
  isNull: (x: unknown) => ({ _type: "isNull", x }),
  isNotNull: (x: unknown) => ({ _type: "isNotNull", x }),
  lte: (a: unknown, b: unknown) => ({ _type: "lte", a, b }),
  sql: (strings: TemplateStringsArray, ...exprs: unknown[]) => ({ _type: "sql", strings, exprs }),
};

/**
 * Builds the `../server/db.js` mock shape for the clinicId-scoped,
 * non-deleted equipment select `computeNudgesForUser` issues for expiry
 * nudges. `getRows` is called lazily on every `where()` so each test file's
 * own mutable fixture array (reset per test in its `beforeEach`) is always
 * read fresh, not captured once at mock-construction time.
 */
export function makeEquipmentDbMock(getRows: () => EquipmentFixtureRow[]) {
  return {
    db: {
      select: () => ({
        from: () => ({
          where: (condition: MockCondition) => {
            const clinicId = extractClinicId(condition);
            const rows = getRows().filter((r) => r.clinicId === clinicId && !r.deletedAt);
            return Promise.resolve(rows.map((r) => ({ id: r.id, name: r.name, expiryDate: r.expiryDate })));
          },
        }),
      }),
    },
    equipment: new Proxy({}, { get: (_t: object, prop: string | symbol) => ({ _column: String(prop) }) }),
  };
}
