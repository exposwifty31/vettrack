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
  | { _type: "isNull" | "isNotNull"; x: { _column?: string } }
  | { _type: "lte"; a: { _column?: string }; b: unknown }
  | undefined;

function columnRef(node: unknown): string | undefined {
  return (node as { _column?: string } | undefined)?._column;
}

function columnValue(row: EquipmentFixtureRow, column: string | undefined): unknown {
  switch (column) {
    case "clinicId":
      return row.clinicId;
    case "deletedAt":
      return row.deletedAt;
    case "expiryDate":
      return row.expiryDate;
    default:
      return undefined;
  }
}

/**
 * Evaluates the mocked predicate tree against one fixture row — mirrors every
 * predicate `computeNudgesForUser` actually builds for the expiry select
 * (clinicId scope, soft-delete exclusion, expiry-date not-null + the 7-day
 * `lte` lookahead) instead of only extracting clinicId and hand-filtering
 * `deletedAt`. If the service ever drops one of these predicates, the
 * corresponding row stops being filtered out here too — so these tests catch
 * a regression that would let expired-window, null-date, or already-far-out
 * equipment leak into the feed, instead of always applying the correct
 * filtering regardless of what the service actually queried for.
 */
export function matchesCondition(condition: MockCondition, row: EquipmentFixtureRow): boolean {
  if (!condition) return true;
  switch (condition._type) {
    case "and":
      return condition.args.every((c) => matchesCondition(c, row));
    case "eq":
      return columnValue(row, columnRef(condition.a)) === condition.b;
    case "isNull":
      return columnValue(row, columnRef(condition.x)) == null;
    case "isNotNull":
      return columnValue(row, columnRef(condition.x)) != null;
    case "lte": {
      // Only ever applied to expiryDate in this query — mirrors the real
      // `(CURRENT_DATE + INTERVAL '7 days')::date` bound as a same-shape ISO
      // date-string comparison rather than evaluating the opaque sql`` node.
      const value = columnValue(row, columnRef(condition.a));
      if (typeof value !== "string") return false;
      const sevenDaysOut = new Date();
      sevenDaysOut.setDate(sevenDaysOut.getDate() + 7);
      return value <= sevenDaysOut.toISOString().slice(0, 10);
    }
    default:
      return true;
  }
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
 * non-deleted, expiring-within-7-days equipment select `computeNudgesForUser`
 * issues for expiry nudges. `getRows` is called lazily on every `where()` so
 * each test file's own mutable fixture array (reset per test in its
 * `beforeEach`) is always read fresh, not captured once at mock-construction
 * time.
 */
export function makeEquipmentDbMock(getRows: () => EquipmentFixtureRow[]) {
  return {
    db: {
      select: () => ({
        from: () => ({
          where: (condition: MockCondition) => {
            const rows = getRows().filter((r) => matchesCondition(condition, r));
            return Promise.resolve(rows.map((r) => ({ id: r.id, name: r.name, expiryDate: r.expiryDate })));
          },
        }),
      }),
    },
    equipment: new Proxy({}, { get: (_t: object, prop: string | symbol) => ({ _column: String(prop) }) }),
  };
}
