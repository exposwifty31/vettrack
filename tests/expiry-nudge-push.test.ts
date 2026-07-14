/**
 * Unit tests — once-per-event nudge push (T-30c · R-IN-F1 · small-03).
 *
 * GAP ANALYSIS: `runExpiryCheckWorkerForClinic` (server/workers/expiryCheckWorker.ts)
 * already guarantees once-per-event push for the expiry nudge — the select
 * query only returns equipment where `expiryNotifiedAt IS NULL`, and
 * `markNotified` stamps `expiryNotifiedAt` immediately after the push loop.
 * A second sweep over the same equipment therefore selects zero rows and
 * sends zero pushes. This is already covered end-to-end by the live-server
 * test tests/expiry-check-worker.test.js (requires a running dev server on
 * :3001, excluded from `pnpm test` by default) — this file proves the same
 * dedup contract as a mocked unit test (mocked db + push), matching the
 * sibling-worker convention in tests/charge-alert-worker-unit.test.ts and
 * tests/stale-checkout-sweep.test.ts.
 *
 * The drizzle-orm predicate builders (eq/and/isNull/isNotNull/inArray) are
 * mocked with real inspectable objects (same convention as
 * tests/expiry-nudge-feed.test.ts) and evaluated against the in-memory
 * fixture, so this genuinely exercises the WHERE-clause the source code
 * builds — not just a hardcoded stand-in for "what dedup should do." Dropping
 * `isNull(equipment.expiryNotifiedAt)` from fetchExpiringEquipmentForClinic
 * (or removing the `markNotified` stamp) makes the second-sweep tests fail.
 *
 * There is no equivalent restock nudge-push path to test: restock nudges
 * (nudge_shown_restock in server/lib/metrics.ts) exist only as a client-shown
 * telemetry bucket — no server-side worker or dedup column pushes a restock
 * nudge today, so there is nothing analogous to wire without inventing a new
 * feature outside this ticket's "smallest change" scope.
 *
 * Does NOT require Redis, a live server, or a real database.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("bullmq", () => ({
  Queue: vi.fn(),
  Worker: vi.fn(),
}));

vi.mock("../server/lib/redis.js", () => ({
  createRedisConnection: vi.fn().mockResolvedValue(null),
}));

vi.mock("../server/lib/metrics.js", () => ({
  incrementMetric: vi.fn(),
}));

vi.mock("../server/lib/push.js", () => ({
  sendPushToAll: vi.fn().mockResolvedValue(undefined),
}));

// ─── drizzle-orm — pass-through, inspectable predicate builders ────────────
// (same convention as tests/expiry-nudge-feed.test.ts)
vi.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ _type: "eq", a, b }),
  and: (...args: unknown[]) => ({ _type: "and", args }),
  isNull: (x: unknown) => ({ _type: "isNull", x }),
  isNotNull: (x: unknown) => ({ _type: "isNotNull", x }),
  lte: (a: unknown, b: unknown) => ({ _type: "lte", a, b }),
  inArray: (a: unknown, b: unknown) => ({ _type: "inArray", a, b }),
  sql: (strings: TemplateStringsArray, ...exprs: unknown[]) => ({ _type: "sql", strings, exprs }),
}));

type EquipmentFixtureRow = {
  id: string;
  clinicId: string;
  name: string;
  expiryDate: string;
  deletedAt: string | null;
  expiryNotifiedAt: Date | null;
};

let equipmentRows: EquipmentFixtureRow[] = [];

type MockCondition =
  | { _type: "and"; args: MockCondition[] }
  | { _type: "eq"; a: { _column?: string }; b: unknown }
  | { _type: "isNull" | "isNotNull"; x: { _column?: string } }
  | { _type: "lte"; a: unknown; b: unknown }
  | { _type: "inArray"; a: { _column?: string }; b: unknown[] }
  | undefined;

/**
 * Evaluates the actual condition tree the source built against one fixture
 * row. The 7-day lookahead window (`lte(expiryDate, CURRENT_DATE + 7 days)`)
 * isn't reconstructible from a raw `sql` tagged template, so it always
 * passes — every fixture row here is within-window by construction. Every
 * other predicate (clinicId scoping, soft-delete, the expiryNotifiedAt dedup
 * stamp, and the inArray id-list markNotified uses) is evaluated for real.
 */
function evaluateCondition(row: EquipmentFixtureRow, condition: MockCondition): boolean {
  if (!condition) return true;
  switch (condition._type) {
    case "and":
      return condition.args.every((c) => evaluateCondition(row, c));
    case "eq":
      return row[condition.a?._column as keyof EquipmentFixtureRow] === condition.b;
    case "isNull":
      return row[condition.x?._column as keyof EquipmentFixtureRow] == null;
    case "isNotNull":
      return row[condition.x?._column as keyof EquipmentFixtureRow] != null;
    case "lte":
      return true;
    case "inArray":
      return condition.b.includes(row[condition.a?._column as keyof EquipmentFixtureRow] as never);
    default:
      return true;
  }
}

function makeSelectChain() {
  return {
    from: () => ({
      where: (condition: MockCondition) =>
        Promise.resolve(
          equipmentRows
            .filter((r) => evaluateCondition(r, condition))
            .map((r) => ({ id: r.id, clinicId: r.clinicId, name: r.name, expiryDate: r.expiryDate })),
        ),
    }),
  };
}

function makeUpdateChain() {
  return {
    set: (values: { expiryNotifiedAt: Date }) => ({
      where: (condition: MockCondition) => {
        equipmentRows = equipmentRows.map((r) =>
          evaluateCondition(r, condition) ? { ...r, expiryNotifiedAt: values.expiryNotifiedAt } : r,
        );
        return Promise.resolve();
      },
    }),
  };
}

vi.mock("../server/db.js", () => ({
  db: {
    select: () => makeSelectChain(),
    update: () => makeUpdateChain(),
  },
  equipment: new Proxy({}, { get: (_t, prop) => ({ _column: String(prop) }) }),
}));

import { runExpiryCheckWorkerForClinic } from "../server/workers/expiryCheckWorker.js";
import { sendPushToAll } from "../server/lib/push.js";

beforeEach(() => {
  vi.clearAllMocks();
  equipmentRows = [
    {
      id: "eq-1",
      clinicId: "clinic-1",
      name: "Autoclave",
      expiryDate: "2026-07-15",
      deletedAt: null,
      expiryNotifiedAt: null,
    },
  ];
});

describe("runExpiryCheckWorkerForClinic — once-per-event nudge push (T-30c · R-IN-F1)", () => {
  it("a nudge event enqueues exactly ONE push on the first sweep", async () => {
    const notifiedCount = await runExpiryCheckWorkerForClinic("clinic-1");

    expect(notifiedCount).toBe(1);
    expect(sendPushToAll).toHaveBeenCalledOnce();
    expect(sendPushToAll).toHaveBeenCalledWith(
      "clinic-1",
      expect.objectContaining({ tag: "expiry:eq-1" }),
    );
  });

  it("a second sweep over the SAME already-notified event enqueues NONE (dedup)", async () => {
    const firstNotifiedCount = await runExpiryCheckWorkerForClinic("clinic-1");
    expect(firstNotifiedCount).toBe(1);
    vi.mocked(sendPushToAll).mockClear();

    const secondNotifiedCount = await runExpiryCheckWorkerForClinic("clinic-1");

    expect(secondNotifiedCount).toBe(0);
    expect(sendPushToAll).not.toHaveBeenCalled();
  });

  it("two distinct expiring items each get exactly one push, never re-sent on rerun", async () => {
    equipmentRows.push({
      id: "eq-2",
      clinicId: "clinic-1",
      name: "Ultrasound",
      expiryDate: "2026-07-16",
      deletedAt: null,
      expiryNotifiedAt: null,
    });

    const firstNotifiedCount = await runExpiryCheckWorkerForClinic("clinic-1");
    expect(firstNotifiedCount).toBe(2);
    expect(sendPushToAll).toHaveBeenCalledTimes(2);

    vi.mocked(sendPushToAll).mockClear();
    const secondNotifiedCount = await runExpiryCheckWorkerForClinic("clinic-1");
    expect(secondNotifiedCount).toBe(0);
    expect(sendPushToAll).not.toHaveBeenCalled();
  });

  it("a different clinic's expiring equipment is not touched by clinic-1's sweep", async () => {
    equipmentRows.push({
      id: "eq-other-clinic",
      clinicId: "clinic-2",
      name: "X-Ray",
      expiryDate: "2026-07-14",
      deletedAt: null,
      expiryNotifiedAt: null,
    });

    await runExpiryCheckWorkerForClinic("clinic-1");

    const otherClinicRow = equipmentRows.find((r) => r.id === "eq-other-clinic");
    expect(otherClinicRow?.expiryNotifiedAt).toBeNull();
    expect(sendPushToAll).toHaveBeenCalledTimes(1);
  });
});
