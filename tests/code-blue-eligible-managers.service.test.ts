/**
 * `listCodeBlueEligibleManagers` — the discovery list behind
 * `GET /api/code-blue/eligible-managers`.
 *
 * WHY THIS EXISTS. `POST /api/code-blue/sessions` (and `/one-tap`) accept a nominated
 * manager only if the Code Blue manager evaluator allows them. Until now the client's
 * manager picker read `GET /api/users/managers`, which knows nothing about the
 * evaluator — so in `enforce` mode the picker can offer a manager the POST will reject
 * with 403 MANAGER_NOT_CODE_BLUE_ELIGIBLE, during a cardiac arrest.
 *
 * The whole value of this list is that it CANNOT disagree with that POST. So these
 * tests pin the agreement itself (`the list agrees with the POST's own evaluator`),
 * not merely that some function was called.
 *
 * The candidate predicate deliberately mirrors the POST's manager-validation query
 * (`server/routes/code-blue.ts:362-373`) field for field, including the absence of a
 * `deleted_at` filter. See the note in the implementation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthoritySnapshot } from "../shared/authority.js";
import type { CodeBlueManagerEnforcementMode } from "../server/lib/authority/enforcement/code-blue-manager.types.js";

// ── enforcement mode ────────────────────────────────────────────────────────
// Mocked at the shared config boundary rather than injected as a parameter, so
// the list and `evaluateCodeBlueManagerForRoute` (the POST's helper) genuinely
// read the SAME mode source. The anti-drift test below depends on that.
let currentMode: CodeBlueManagerEnforcementMode = "off";
const modeResolverCalls: Array<[string, string]> = [];

vi.mock("../server/lib/authority/enforcement/config.js", async () => {
  const actual = await vi.importActual<
    typeof import("../server/lib/authority/enforcement/config.js")
  >("../server/lib/authority/enforcement/config.js");
  return {
    ...actual,
    resolveCodeBlueManagerEnforcementMode: async (clinicId: string, endpoint: string) => {
      modeResolverCalls.push([clinicId, endpoint]);
      return currentMode;
    },
  };
});

// ── drizzle-orm: pass-through predicate builders ────────────────────────────
// The mocked db never executes SQL, but the predicates must stay INSPECTABLE:
// the cross-tenant test asserts the clinicId condition was really built, and the
// fake db filters on it, rather than trusting a hand-seeded result set.
vi.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ _t: "eq", a, b }),
  and: (...args: unknown[]) => ({ _t: "and", args }),
  or: (...args: unknown[]) => ({ _t: "or", args }),
  inArray: (a: unknown, b: unknown) => ({ _t: "inArray", a, b }),
  isNull: (a: unknown) => ({ _t: "isNull", a }),
  isNotNull: (a: unknown) => ({ _t: "isNotNull", a }),
  asc: (a: unknown) => ({ _t: "asc", a }),
  desc: (a: unknown) => ({ _t: "desc", a }),
  sql: (...args: unknown[]) => ({ _t: "sql", args }),
}));

// ── db: a users table that honours the clinicId predicate ───────────────────

type UserRow = {
  id: string;
  clinicId: string;
  name: string;
  role: string;
  status: string;
  deletedAt: Date | null;
};

/** Every user across BOTH clinics. The fake db filters, exactly as Postgres would. */
let allUsers: UserRow[] = [];
/** Predicate captured from the candidate-list query (the clinic-scoped one). */
let candidateListPredicate: unknown = null;

function columnName(operand: unknown): string | null {
  if (operand && typeof operand === "object" && "_col" in operand) {
    return String((operand as { _col: unknown })._col);
  }
  return null;
}

/** Walk a pass-through predicate tree collecting `eq(column, value)` bindings. */
function collectEqBindings(node: unknown, out: Map<string, unknown>): void {
  if (!node || typeof node !== "object") return;
  const rec = node as Record<string, unknown>;
  if (rec._t === "eq") {
    const col = columnName(rec.a);
    if (col) out.set(col, rec.b);
    return;
  }
  for (const value of Object.values(rec)) {
    if (Array.isArray(value)) value.forEach((v) => collectEqBindings(v, out));
    else collectEqBindings(value, out);
  }
}

function bindingsOf(predicate: unknown): Map<string, unknown> {
  const out = new Map<string, unknown>();
  collectEqBindings(predicate, out);
  return out;
}

function applyPredicate(predicate: unknown): UserRow[] {
  const bindings = bindingsOf(predicate);
  return allUsers.filter((row) => {
    for (const [col, expected] of bindings) {
      if (col === "id" && row.id !== expected) return false;
      if (col === "clinicId" && row.clinicId !== expected) return false;
      if (col === "status" && row.status !== expected) return false;
    }
    // `inArray(users.role, [...])` — applied only when the query asked for it.
    if (JSON.stringify(predicate).includes('"inArray"')) {
      if (!["vet", "admin"].includes(row.role)) return false;
    }
    // `isNull(users.deletedAt)` — the wiring's lookup filters soft-deleted users.
    if (JSON.stringify(predicate).includes('"isNull"') && row.deletedAt !== null) {
      return false;
    }
    return true;
  });
}

vi.mock("../server/db.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (predicate: unknown) => ({
          // Terminal method distinguishes the two queries that hit `users`:
          // the candidate list orders by name; the per-manager lookup limits 1.
          orderBy: () => {
            candidateListPredicate = predicate;
            // Sorted here so the ordering assertions test the query's ORDER BY
            // rather than the order rows happened to be seeded in.
            return Promise.resolve(
              [...applyPredicate(predicate)].sort((a, b) => a.name.localeCompare(b.name)),
            );
          },
          limit: () => Promise.resolve(applyPredicate(predicate).slice(0, 1)),
        }),
      }),
    }),
  },
  users: new Proxy({}, { get: (_t, prop) => ({ _col: String(prop) }) }),
  auditLogs: {},
  eventOutbox: {},
}));

// ── resolveAuthority: per-user snapshots, controlled per scenario ───────────

/** userId → snapshot, or the string "throw" to simulate a resolver fault. */
let snapshots: Record<string, AuthoritySnapshot | "throw"> = {};
const resolveAuthorityCalls: string[] = [];

vi.mock("../server/lib/authority.js", () => ({
  resolveAuthority: async ({ authUser }: { authUser: { id: string } }) => {
    resolveAuthorityCalls.push(authUser.id);
    const entry = snapshots[authUser.id];
    if (entry === "throw" || entry === undefined) {
      throw new Error(`no snapshot registered for ${authUser.id}`);
    }
    return entry;
  },
}));

// ── audit: capture rows so "no emission" is asserted, not assumed ───────────

const auditCalls: unknown[] = [];
vi.mock("../server/lib/audit.js", async () => {
  const actual = await vi.importActual<typeof import("../server/lib/audit.js")>(
    "../server/lib/audit.js",
  );
  return { ...actual, logAudit: (...args: unknown[]) => { auditCalls.push(args); } };
});

import { listCodeBlueEligibleManagers } from "../server/lib/authority/code-blue-eligible-managers.js";
import { evaluateCodeBlueManagerForRoute } from "../server/lib/authority/code-blue-manager.wiring.js";
import { getMetricsSnapshot, resetMetrics } from "../server/lib/metrics.js";

// ── fixtures ────────────────────────────────────────────────────────────────

const NOW = new Date("2026-08-21T09:00:00.000Z");

function snapshot(overrides: Partial<AuthoritySnapshot> = {}): AuthoritySnapshot {
  return {
    systemRole: "vet",
    clinicalRole: "vet",
    activeShiftRole: null,
    operationalRole: "ward",
    effectiveClinicalRole: "vet",
    source: "check_in",
    reason: "CHECKED_IN",
    resolvedAt: NOW.toISOString(),
    ...overrides,
  } as AuthoritySnapshot;
}

/** On shift and Code-Blue eligible. */
const ELIGIBLE = snapshot();
/** Checked in but holding no operational role → NO_OPEN_CHECK_IN. */
const NO_OPROLE = snapshot({ operationalRole: null, reason: "CHECKED_IN_NO_OPROLE" });
/** Deliberately excluded oprole (DECISION-1) → OPROLE_NOT_IN_CB_ALLOWLIST. */
const NOT_ALLOWLISTED = snapshot({ operationalRole: "night_admission_only" });
/** Strategy A clinic: no check-in path adopted → MODE_INACTIVE_STRATEGY_A (allow). */
const STRATEGY_A = snapshot({ operationalRole: null, reason: "EZSHIFT_ACTIVE" });

function user(overrides: Partial<UserRow> & Pick<UserRow, "id">): UserRow {
  return {
    clinicId: "clinic-a",
    name: `Name ${overrides.id}`,
    role: "vet",
    status: "active",
    deletedAt: null,
    ...overrides,
  };
}

let obsBefore: string | undefined;

beforeEach(() => {
  // The audit half is gated by AUTHORITY_OBS_V1 (server/lib/authority-audit.ts).
  // Unset, "no audit row" would be true for the wrong reason and the suppression
  // assertions below would pass without ever exercising suppression.
  obsBefore = process.env.AUTHORITY_OBS_V1;
  process.env.AUTHORITY_OBS_V1 = "true";
  resetMetrics();
  auditCalls.length = 0;
  resolveAuthorityCalls.length = 0;
  modeResolverCalls.length = 0;
  candidateListPredicate = null;
  allUsers = [];
  snapshots = {};
  currentMode = "off";
});

afterEach(() => {
  if (obsBefore === undefined) delete process.env.AUTHORITY_OBS_V1;
  else process.env.AUTHORITY_OBS_V1 = obsBefore;
  resetMetrics();
});

// ── mode: off ───────────────────────────────────────────────────────────────

describe("listCodeBlueEligibleManagers — mode off", () => {
  beforeEach(() => {
    currentMode = "off";
    allUsers = [
      user({ id: "u-vet-on", name: "Ada Vet" }),
      user({ id: "u-admin", name: "Bo Admin", role: "admin" }),
      user({ id: "u-vet-off", name: "Cy Vet" }),
      // Excluded by the candidate predicate itself, in every mode:
      user({ id: "u-tech", name: "Dee Tech", role: "technician" }),
      user({ id: "u-suspended", name: "Eli Vet", status: "suspended" }),
    ];
    // Registered so that if `off` ever started resolving, it would still work —
    // the point of the assertion below is that it does NOT resolve.
    snapshots = { "u-vet-on": ELIGIBLE, "u-admin": ELIGIBLE, "u-vet-off": NO_OPROLE };
  });

  it("returns EVERY active vet/admin — one-for-one with what the POST accepts", async () => {
    const result = await listCodeBlueEligibleManagers({ clinicId: "clinic-a", now: NOW });

    // Ordered by name, as the query asks — Ada, Bo, Cy.
    expect(result.map((m) => m.userId)).toEqual(["u-vet-on", "u-admin", "u-vet-off"]);
    expect(result).toEqual([
      { userId: "u-vet-on", name: "Ada Vet", role: "vet" },
      { userId: "u-admin", name: "Bo Admin", role: "admin" },
      { userId: "u-vet-off", name: "Cy Vet", role: "vet" },
    ]);
  });

  it("issues NO clinical-validation query — `off` short-circuits the wiring", async () => {
    // CLAUDE.md wiring contract: "`off` — the evaluator path is short-circuited;
    // no clinical-validation queries issue." Going through the per-candidate
    // lookup would fire one resolveAuthority per vet for a verdict that is
    // structurally predetermined.
    await listCodeBlueEligibleManagers({ clinicId: "clinic-a", now: NOW });
    expect(resolveAuthorityCalls).toEqual([]);
  });

  it("excludes technicians and non-active users even in off mode", async () => {
    const result = await listCodeBlueEligibleManagers({ clinicId: "clinic-a", now: NOW });
    const ids = result.map((m) => m.userId);
    expect(ids).not.toContain("u-tech");
    expect(ids).not.toContain("u-suspended");
  });
});

// ── mode: shadow ────────────────────────────────────────────────────────────

describe("listCodeBlueEligibleManagers — mode shadow", () => {
  beforeEach(() => {
    currentMode = "shadow";
    allUsers = [user({ id: "u-on", name: "On Shift" }), user({ id: "u-off", name: "Off Shift" })];
    snapshots = { "u-on": ELIGIBLE, "u-off": NO_OPROLE };
  });

  it("returns both — shadow observes and never denies", async () => {
    const result = await listCodeBlueEligibleManagers({ clinicId: "clinic-a", now: NOW });
    expect(result.map((m) => m.userId)).toEqual(["u-off", "u-on"]);
  });

  it("emits NOTHING — a read must not vote in the rollout signal", async () => {
    // `shadow_would_have_denied` is the counter the off|shadow|enforce decision is
    // read from. One row per off-shift vet per list fetch, during an emergency,
    // would drown the signal that decides whether enforcement is safe to turn on.
    await listCodeBlueEligibleManagers({ clinicId: "clinic-a", now: NOW });

    const manager = getMetricsSnapshot().codeBlue.manager;
    expect(manager.shadowWouldHaveDenied.noOpenCheckIn).toBe(0);
    expect(manager.allow).toBe(0);
    expect(auditCalls).toEqual([]);
  });
});

// ── mode: enforce ───────────────────────────────────────────────────────────

describe("listCodeBlueEligibleManagers — mode enforce", () => {
  beforeEach(() => {
    currentMode = "enforce";
  });

  it("drops the off-shift vet and keeps the eligible one", async () => {
    allUsers = [
      user({ id: "u-on", name: "On Shift" }),
      user({ id: "u-off", name: "Off Shift" }),
      user({ id: "u-wrong-oprole", name: "Night Intake" }),
    ];
    snapshots = {
      "u-on": ELIGIBLE,
      "u-off": NO_OPROLE,
      "u-wrong-oprole": NOT_ALLOWLISTED,
    };

    const result = await listCodeBlueEligibleManagers({ clinicId: "clinic-a", now: NOW });

    expect(result).toEqual([{ userId: "u-on", name: "On Shift", role: "vet" }]);
  });

  it("KEEPS a candidate whose resolver faulted — fail-open, never a false deny", async () => {
    // Master plan §9 / DECISION-2: a false deny during a cardiac arrest is worse
    // than a false allow followed by reconciliation. A transient resolver fault
    // must not make a vet disappear from the picker.
    allUsers = [user({ id: "u-faulty", name: "Faulty Resolve" })];
    snapshots = { "u-faulty": "throw" };

    const result = await listCodeBlueEligibleManagers({ clinicId: "clinic-a", now: NOW });

    expect(result).toEqual([{ userId: "u-faulty", name: "Faulty Resolve", role: "vet" }]);
  });

  it("keeps a Strategy A clinic's vets — mode_inactive is an allow, not a deny", async () => {
    // Strategy A is not retired. A clinic that never adopted the check-in path
    // must not silently lose every eligible manager the moment enforce is set.
    allUsers = [user({ id: "u-legacy", name: "Legacy Vet" })];
    snapshots = { "u-legacy": STRATEGY_A };

    const result = await listCodeBlueEligibleManagers({ clinicId: "clinic-a", now: NOW });

    expect(result.map((m) => m.userId)).toEqual(["u-legacy"]);
  });
});

// ── the anti-drift property ─────────────────────────────────────────────────

describe("listCodeBlueEligibleManagers — agrees with the POST's own evaluator", () => {
  it("includes a candidate if and only if the POST's wiring allows them", async () => {
    // This is the reason the endpoint exists. `evaluateCodeBlueManagerForRoute` is
    // the exact helper called at server/routes/code-blue.ts:330 and :567. If this
    // ever diverges, the picker is offering managers the POST will 403.
    currentMode = "enforce";
    allUsers = [
      user({ id: "u-on", name: "On Shift" }),
      user({ id: "u-off", name: "Off Shift" }),
      user({ id: "u-wrong-oprole", name: "Night Intake" }),
      user({ id: "u-legacy", name: "Legacy Vet" }),
      user({ id: "u-admin-on", name: "Admin On", role: "admin" }),
    ];
    snapshots = {
      "u-on": ELIGIBLE,
      "u-off": NO_OPROLE,
      "u-wrong-oprole": NOT_ALLOWLISTED,
      "u-legacy": STRATEGY_A,
      "u-admin-on": ELIGIBLE,
    };

    const listed = new Set(
      (await listCodeBlueEligibleManagers({ clinicId: "clinic-a", now: NOW })).map(
        (m) => m.userId,
      ),
    );

    for (const candidate of allUsers) {
      const { verdict } = await evaluateCodeBlueManagerForRoute({
        clinicId: "clinic-a",
        managerUserId: candidate.id,
        endpoint: "initiation",
        now: NOW,
      });
      expect(
        listed.has(candidate.id),
        `${candidate.id}: listed=${listed.has(candidate.id)} but POST verdict=${verdict.action}`,
      ).toBe(verdict.action === "allow");
    }

    // Guard against the degenerate pass where both sides are empty.
    expect(listed.size).toBeGreaterThan(0);
    expect(listed.size).toBeLessThan(allUsers.length);
  });
});

// ── cross-tenant isolation ──────────────────────────────────────────────────

describe("listCodeBlueEligibleManagers — cross-tenant isolation", () => {
  beforeEach(() => {
    currentMode = "enforce";
    allUsers = [
      user({ id: "a-vet", clinicId: "clinic-a", name: "Alpha Vet" }),
      user({ id: "b-vet", clinicId: "clinic-b", name: "Bravo Vet" }),
      user({ id: "b-admin", clinicId: "clinic-b", name: "Bravo Admin", role: "admin" }),
    ];
    snapshots = { "a-vet": ELIGIBLE, "b-vet": ELIGIBLE, "b-admin": ELIGIBLE };
  });

  it("a caller scoped to clinic A never sees clinic B's eligible managers", async () => {
    const result = await listCodeBlueEligibleManagers({ clinicId: "clinic-a", now: NOW });

    expect(result).toEqual([{ userId: "a-vet", name: "Alpha Vet", role: "vet" }]);
    const ids = result.map((m) => m.userId);
    expect(ids).not.toContain("b-vet");
    expect(ids).not.toContain("b-admin");
  });

  it("scopes the candidate query by clinicId on the users table itself", async () => {
    // Asserted on the predicate, not merely on the result: a join-only or
    // post-filter scoping would satisfy the test above while leaving the query
    // itself cross-tenant. clinicId on the TARGET table is the repo-wide rule.
    await listCodeBlueEligibleManagers({ clinicId: "clinic-a", now: NOW });

    expect(bindingsOf(candidateListPredicate).get("clinicId")).toBe("clinic-a");
  });

  it("holds in off mode too, where no evaluator runs to catch a leak", async () => {
    currentMode = "off";
    const result = await listCodeBlueEligibleManagers({ clinicId: "clinic-a", now: NOW });
    expect(result.map((m) => m.userId)).toEqual(["a-vet"]);
  });
});
